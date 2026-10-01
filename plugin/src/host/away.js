/**
 * Away mode and the phone's pending queue.
 *
 * - Away ON: every live root session (and each one created while away) switches to an approval
 *   preset (default `workspace-write`, approval: ask); the previous preset is remembered on disk and
 *   restored when away mode goes OFF.
 * - While away and at least one device is paired, this plugin answers `approval/request` and
 *   `user-questions/request` itself (prepended, so it runs before the GUI forwarder): the request
 *   waits in the pending queue, the phones get a push, and whoever answers first — a phone or the
 *   pairing page on the desktop — settles it. Unanswered approvals are rejected after a timeout.
 * - Away OFF (and `answerOnPhone` not false): the request goes on to DSH's own prompt as usual and
 *   to the phones as well, without a push. The first answer wins; when a phone answers, DSH's prompt
 *   closes through the request's signal. When DSH has no prompt to show it (no window connected),
 *   only the phones can answer: they get a push, and approvals time out as in away mode.
 */
import { randomUUID } from 'node:crypto';

export function createAway({ ctx, state, config, log = () => {}, onChange = () => {}, titleOf = async () => undefined, notify = async () => {} }) {
  const awayPreset = config.awayPreset ?? 'workspace-write';
  const approvalTimeoutMs = (config.approvalTimeoutMinutes ?? 30) * 60_000;
  const pending = new Map();

  const sessionIdOf = (agent) => agent?.session?.id ?? agent?.id;
  const paired = () => state.devices().length > 0;
  const active = () => state.away.on && paired();
  const sharing = () => !state.away.on && paired() && config.answerOnPhone !== false;

  function presetOf(session) {
    try { return ctx.permissionPresets.current(session); } catch { return undefined; }
  }

  function applyTo(agent, restore) {
    const session = agent?.session;
    if (!session) return;
    const current = presetOf(session);
    if (!current || current === awayPreset) return;
    try {
      ctx.permissionPresets.set(session, awayPreset);
      restore[session.id] = current;
    } catch (error) {
      log(`dsh-pair: 无法为会话 ${session.id} 切换到 ${awayPreset}：${error.message}`);
    }
  }

  async function set(on) {
    if (on === state.away.on) return view();
    if (on) {
      try { ctx.permissionPresets.resolve(awayPreset); } catch { throw new Error(`权限预设「${awayPreset}」不存在`); }
      const restore = {};
      for (const agent of ctx.agents.roots?.() ?? ctx.agents.list()) applyTo(agent, restore);
      await state.setAway({ on: true, since: Date.now(), restore });
    } else {
      const { restore = {} } = state.away;
      for (const [sessionId, preset] of Object.entries(restore)) {
        const agent = ctx.agents.get(sessionId);
        if (!agent?.session) continue;
        try { if (presetOf(agent.session) === awayPreset) ctx.permissionPresets.set(agent.session, preset); } catch (error) {
          log(`dsh-pair: 恢复会话 ${sessionId} 的权限失败：${error.message}`);
        }
      }
      await state.setAway({ on: false, restore: {} });
      // Anything only the phones held goes back to the desktop: reject rather than hang forever.
      for (const item of [...pending.values()]) if (!item.shared) settle(item.id, item.kind === 'approval' ? 'rejected' : null, 'away-off');
    }
    onChange();
    return view();
  }

  // Sessions created while away join it (their creation preset is the profile default).
  ctx.on('agent/created', ({ agent }) => {
    if (!state.away.on) return;
    const header = typeof agent?.session?.header === 'function' ? agent.session.header() : agent?.session?.header;
    if (header?.parentSession) return;
    const restore = { ...state.away.restore };
    applyTo(agent, restore);
    state.setAway({ ...state.away, restore }).catch(() => {});
  });

  function publicItem(item) {
    const { resolve, reject, timer, cleanup, ...rest } = item;
    return rest;
  }

  /** Take a request off the queue without answering it. @returns whether it was still waiting. */
  function drop(id) {
    const item = pending.get(id);
    if (!item) return false;
    pending.delete(id);
    clearTimeout(item.timer);
    item.cleanup?.();
    onChange();
    return true;
  }

  function settle(id, answer, by) {
    const item = pending.get(id);
    if (!drop(id)) return false;
    if (item.kind === 'question' && answer === null) item.reject(new Error(by === 'away-off' ? '离开模式已关闭，请在电脑上回答' : '问题已取消'));
    else item.resolve(answer);
    return true;
  }

  function notifyPhones(item) {
    const body = item.kind === 'approval'
      ? `${item.toolName}${item.reason ? `：${item.reason}` : ''}`
      : item.questions?.[0]?.question ?? '有一个问题需要回答';
    const title = item.sessionTitle ?? '会话';
    notify({
      title: item.kind === 'approval' ? `需要审批 · ${title}` : `需要回答 · ${title}`,
      body: body.slice(0, 160), urgent: true, tag: `pending-${item.id}`, sessionId: item.sessionId, pendingId: item.id,
    }).catch(() => {});
  }

  function enqueue(item, signal, { push = true } = {}) {
    pending.set(item.id, item);
    const abort = () => settle(item.id, item.kind === 'approval' ? 'cancelled' : null, 'aborted');
    if (signal) {
      if (signal.aborted) { queueMicrotask(abort); return; }
      signal.addEventListener('abort', abort, { once: true });
      item.cleanup = () => signal.removeEventListener('abort', abort);
    }
    onChange();
    titleOf(item.sessionId).then((title) => {
      if (title) { item.sessionTitle = title; onChange(); }
      if (push && pending.has(item.id)) notifyPhones(item);
    });
  }

  /**
   * Away mode off: pass the request on to DSH's prompt and offer it to the phones too.
   * @param noPrompt - whether the rest of the waterfall settled only because no prompt could be shown.
   */
  function share(item, req, next, noPrompt) {
    const signal = req.signal;
    // Closes DSH's prompt once a phone has answered. A request that cannot take the combined signal
    // keeps its desktop prompt until the turn moves on; answering it then changes nothing.
    const answered = new AbortController();
    try { req.signal = signal ? AbortSignal.any([signal, answered.signal]) : answered.signal; } catch {}
    return new Promise((resolve, reject) => {
      Object.assign(item, {
        shared: true,
        resolve: (value) => { answered.abort(); resolve(value); },
        reject: (error) => { answered.abort(); reject(error); },
      });
      enqueue(item, signal, { push: false });
      Promise.resolve().then(next).then(
        (value) => (noPrompt(value, undefined) ? phonesOnly(item) : drop(item.id) && resolve(value)),
        (error) => (noPrompt(undefined, error) ? phonesOnly(item) : drop(item.id) && reject(error)));
    });
  }

  /** DSH could not show the request: it waits for a phone, as in away mode. */
  function phonesOnly(item) {
    if (!pending.has(item.id)) return;
    if (item.kind === 'approval') item.timer = setTimeout(() => settle(item.id, 'rejected', 'timeout'), approvalTimeoutMs);
    notifyPhones(item);
  }

  const approvalItem = (req) => ({
    id: randomUUID(), kind: 'approval', createdAt: Date.now(), sessionId: sessionIdOf(req.agent),
    toolName: req.toolName ?? 'tool', reason: typeof req.displayReason === 'string' ? req.displayReason : typeof req.reason === 'string' ? req.reason : undefined,
    callId: req.callId,
  });
  const questionItem = (req) => ({
    id: randomUUID(), kind: 'question', createdAt: Date.now(), sessionId: sessionIdOf(req.agent), callId: req.callId,
    questions: (req.questions ?? []).map((q) => ({ id: q.id, question: q.question, header: q.header, detail: q.detail, options: q.options, multiSelect: q.multiSelect })),
  });

  ctx.on('approval/request', function onApproval(req, next) {
    if (sharing()) return share(approvalItem(req), req, next, (value) => value === 'unavailable');
    if (!active()) return next();
    return new Promise((resolve) => {
      const item = { ...approvalItem(req), resolve };
      item.timer = setTimeout(() => settle(item.id, 'rejected', 'timeout'), approvalTimeoutMs);
      enqueue(item, req.signal);
    });
  }, true);

  ctx.on('user-questions/request', function onQuestion(req, next) {
    if (sharing()) return share(questionItem(req), req, next, (value, error) => error?.code === 'NO_PROVIDER');
    if (!active()) return next();
    return new Promise((resolve, reject) => {
      enqueue({ ...questionItem(req), resolve, reject }, req.signal);
    });
  }, true);

  ctx.effect(() => () => {
    for (const item of [...pending.values()]) settle(item.id, item.kind === 'approval' ? 'unavailable' : null, 'stopping');
  }, 'dsh-pair: pending queue');

  function answer(id, input) {
    const item = pending.get(id);
    if (!item) throw Object.assign(new Error('这条请求已经处理过了'), { status: 404 });
    if (item.kind === 'approval') {
      const decision = input?.decision === 'allow' ? 'allowed-once' : 'rejected';
      return settle(id, decision, 'user');
    }
    const answers = Array.isArray(input?.answers) ? input.answers : [];
    const byId = new Map(answers.map((a) => [a.id, a]));
    const normalized = item.questions.map((q) => {
      const a = byId.get(q.id) ?? {};
      const selected = Array.isArray(a.selected) ? a.selected.filter((s) => typeof s === 'string') : [];
      return { id: q.id, selected, ...(typeof a.custom === 'string' && a.custom.trim() ? { custom: a.custom.trim() } : {}) };
    });
    return settle(id, { answers: normalized }, 'user');
  }

  function view() {
    return { on: state.away.on, since: state.away.since, preset: awayPreset, sessions: Object.keys(state.away.restore ?? {}).length };
  }

  return {
    set, view, answer,
    pending: () => [...pending.values()].map(publicItem).sort((a, b) => a.createdAt - b.createdAt),
  };
}

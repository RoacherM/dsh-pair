/**
 * Phones connected through the relay: E2E handshake → auth (resume a paired device, or pair with a
 * one-time token + desktop confirmation) → encrypted RPC.
 *
 * Frames after the handshake are {id, m, p} requests answered by {id, ok, r|e}; the desktop also
 * pushes {ev, ...} events (session items, live text, status changes, pending queue).
 */
import { randomUUID } from 'node:crypto';
import { desktopAccept } from '../../../shared/e2e.js';
import { projectEvent, projectRecords, queueOf, statsOf, streamText, tokensOf } from './project.js';
import { createUploads } from './uploads.js';

const WATCH_WINDOW = { minMessages: 24, minTurns: 2 };
const MAX_SNAPSHOT_ITEMS = 120;
const LIVE_THROTTLE_MS = 120;
const MAX_KNOWN_IMAGES = 400;
const STATS_DELAY_MS = 300;
// Events after which the session's numbers or its queue may have changed.
const STATS_EVENTS = new Set(['turn/end', 'step/end', 'assistant/message', 'request/context', 'agent/inbox/spliced', 'compaction/end', 'user/message']);

export function createPhones({ ctx, state, pairing, away, push, images, commands, link: getLink, log = () => {}, onChange = () => {} }) {
  const peers = new Map(); // cid → peer
  const titles = new Map();

  const online = (deviceId) => [...peers.values()].some((peer) => peer.device?.id === deviceId && peer.stage === 'ready');

  async function listSessions() {
    const signal = AbortSignal.timeout(15_000);
    const value = await ctx.sessionController.list({}, signal);
    const items = [];
    for (const item of value?.items ?? []) {
      if (item.origin === 'subagent' || item.parentSessionId) continue;
      const values = item.projections?.values ?? {};
      const title = values.title ?? null;
      if (title) titles.set(item.sessionId, title);
      if (item.blank && !item.running) continue;
      items.push({ id: item.sessionId, title, cwd: item.cwd ?? null, running: item.running, updatedAt: item.updatedAt, lastPromptAt: values.sessionListMetadata?.lastPromptAt ?? null });
    }
    items.sort((a, b) => (b.running - a.running) || (b.updatedAt - a.updatedAt));
    return items.slice(0, 100);
  }

  async function titleOf(sessionId) {
    if (!sessionId) return undefined;
    if (!titles.has(sessionId)) { try { await listSessions(); } catch {} }
    return titles.get(sessionId) ?? undefined;
  }

  // Routable models for the phone's model picker: [{ id, name, models: [{ id, name, efforts, defaultEffort }] }].
  let catalog = null;
  async function modelCatalog() {
    if (catalog && Date.now() - catalog.at < 60_000) return catalog.value;
    const raw = await ctx.sessionController.modelCatalog();
    const value = {
      default: raw?.default ?? null,
      groups: (raw?.groups ?? []).map((group) => ({
        id: group.id, name: group.name,
        models: (group.models ?? []).map((model) => ({
          id: model.id, name: model.name,
          efforts: (model.reasoning?.efforts ?? []).map((effort) => ({ id: effort.id, name: effort.name })),
          defaultEffort: model.reasoning?.defaultEffort ?? null,
        })),
      })),
    };
    catalog = { at: Date.now(), value };
    return value;
  }

  async function modelOf(sessionId) {
    try {
      const baseline = await ctx.sessionController.projections({ sessionId }, AbortSignal.timeout(10_000));
      return baseline?.values?.modelSelection?.next ?? null;
    } catch { return null; }
  }

  function workspaces() {
    return (ctx.workspaceRegistry.list?.() ?? []).map((space) => ({ id: space.id, path: space.path, title: space.title ?? space.name ?? space.path?.split('/').pop() }));
  }

  // ---------------------------------------------------------------- transport ----
  function sendRaw(peer, text) { getLink()?.send(peer.cid, text); }
  function send(peer, value) { if (peer.cipher) sendRaw(peer, peer.cipher.seal(value)); }
  function event(peer, ev, payload) { if (peer.stage === 'ready') send(peer, { ev, ...payload }); }
  function broadcast(ev, payload) { for (const peer of peers.values()) event(peer, ev, payload); }

  function open(cid) {
    peers.set(cid, { cid, stage: 'hello', cipher: null, device: null, watch: null, images: new Map(), uploads: createUploads() });
  }

  /** Items about to go to `peer`: remember their images, so `image.get` serves only what it was shown. */
  function share(peer, items) {
    for (const item of items) {
      for (const ref of item.refs ?? []) {
        peer.images.delete(ref.attachmentId);
        peer.images.set(ref.attachmentId, ref);
        if (peer.images.size > MAX_KNOWN_IMAGES) peer.images.delete(peer.images.keys().next().value);
      }
    }
    return items;
  }

  function close(cid) {
    const peer = peers.get(cid);
    if (!peer) return;
    peers.delete(cid);
    stopWatch(peer);
    pairing.dropped(cid);
    if (peer.device) onChange();
  }

  function kick(peer, code, message) {
    if (peer.cipher) send(peer, { type: 'error', code, message });
    else sendRaw(peer, JSON.stringify({ type: 'error', code, error: message }));
    setTimeout(() => getLink()?.close(peer.cid, code), 50);
  }

  async function data(cid, text) {
    const peer = peers.get(cid);
    if (!peer) return;
    if (peer.stage === 'hello') {
      try {
        const accepted = desktopAccept(state.boxKeys, text);
        Object.assign(peer, { cipher: accepted.cipher, sas: accepted.sas, pub: accepted.phonePublicKey, stage: 'auth' });
        sendRaw(peer, accepted.welcome);
      } catch (error) {
        kick(peer, 'bad-hello', error.message);
      }
      return;
    }
    let message;
    try { message = peer.cipher.open(text); } catch { kick(peer, 'bad-frame', 'decryption failed'); return; }
    if (peer.stage === 'auth') return auth(peer, message);
    if (peer.stage === 'ready' && message && typeof message.id !== 'undefined') return rpc(peer, message);
  }

  async function auth(peer, message) {
    if (message?.type !== 'auth') return kick(peer, 'bad-auth', 'expected auth');
    if (message.mode === 'resume') {
      const device = state.deviceByKey(peer.pub);
      if (!device) return kick(peer, 'unknown-device', '这台设备已被移除或尚未配对，请重新扫码配对');
      return ready(peer, device);
    }
    if (message.mode === 'pair') {
      peer.stage = 'pairing';
      send(peer, { type: 'confirm', sas: peer.sas, desktopName: state.desktopName });
      const verdict = await pairing.ask({ cid: peer.cid, token: message.token, name: message.name, sas: peer.sas, pub: peer.pub });
      if (!peers.has(peer.cid)) return;
      if (verdict === 'invalid') return kick(peer, 'expired', '配对二维码已失效，请在电脑上重新生成');
      if (verdict === 'busy') return kick(peer, 'busy', '电脑正在确认另一台设备，请稍后再试');
      if (verdict !== 'allowed') return kick(peer, 'denied', '电脑上拒绝了这次配对');
      const device = await state.addDevice({ name: message.name, pub: peer.pub });
      return ready(peer, device, true);
    }
    return kick(peer, 'bad-auth', 'unknown auth mode');
  }

  async function ready(peer, device, paired = false) {
    peer.device = device;
    peer.stage = 'ready';
    await state.updateDevice(device.id, { lastSeen: Date.now() });
    send(peer, {
      type: 'ready', paired, deviceId: device.id, deviceName: device.name, desktopName: state.desktopName,
      vapidPublicKey: push.publicKey, hasPush: Boolean(device.push), away: away.view(), pending: away.pending(),
    });
    onChange();
  }

  // ---------------------------------------------------------------- RPC ----------
  const methods = {
    'sessions.list': async () => ({ sessions: await listSessions(), workspaces: workspaces() }),
    'session.watch': (peer, p) => watch(peer, String(p.sessionId)),
    'session.unwatch': (peer) => { stopWatch(peer); return {}; },
    'session.older': (peer, p) => older(peer, String(p.sessionId), Number(p.beforeSeq)),
    'session.prompt': async (peer, p) => {
      const text = String(p.text ?? '').trim();
      const hasImages = Array.isArray(p.uploads) && p.uploads.length > 0;
      if (!text && !hasImages) throw new Error('消息不能为空');
      const command = await commands.run(String(p.sessionId), text, hasImages);
      if (command) return { command };
      // take() checks every upload before removing any. If DSH then refuses the prompt, the phone
      // still has its images and uploads them again when the user retries.
      const images = hasImages ? peer.uploads.take(p.uploads) : [];
      await ctx.sessionController.prompt({
        requestId: randomUUID(), sessionId: String(p.sessionId), mode: p.mode === 'steer' ? 'steer' : 'queue',
        content: [...(text ? [{ type: 'text', text }] : []), ...images], ...(p.timeZone ? { clientTimeZone: String(p.timeZone) } : {}),
      }, AbortSignal.timeout(60_000));
      return { accepted: true };
    },
    'models.list': () => modelCatalog(),
    'session.model': async (peer, p) => {
      const selection = { provider: String(p.provider ?? ''), model: String(p.model ?? '') };
      if (!selection.provider || !selection.model) throw new Error('请选择模型');
      if (p.reasoningEffort) selection.reasoningEffort = String(p.reasoningEffort);
      const { selected } = await ctx.sessionController.selectModel({ sessionId: String(p.sessionId), ...selection });
      return { model: selected };
    },
    // The queue, as in DSH's composer: steer a queued message into the running turn, or remove it.
    'queue.steer': (peer, p) => ctx.sessionController.updateQueue({ sessionId: String(p.sessionId), itemId: String(p.itemId), action: { kind: 'steer' } }),
    'queue.remove': (peer, p) => ctx.sessionController.updateQueue({ sessionId: String(p.sessionId), itemId: String(p.itemId), action: { kind: 'remove' } }),
    'upload.put': (peer, p) => peer.uploads.put(p),
    'upload.drop': (peer, p) => { peer.uploads.drop(p.id); return {}; },
    'session.cancel': (peer, p) => ctx.sessionController.cancel({ sessionId: String(p.sessionId) }),
    'session.create': async (peer, p) => {
      const text = String(p.text ?? '').trim();
      if (!text && !(Array.isArray(p.uploads) && p.uploads.length)) throw new Error('第一条消息不能为空');
      const request = p.workspaceId ? { workspaceId: String(p.workspaceId) } : p.cwd ? { cwd: String(p.cwd) } : {};
      const { sessionId } = await ctx.sessionController.create(request);
      // The model picked in the phone's new-session composer, as DSH's hero composer applies it.
      if (p.model?.provider && p.model?.model) await methods['session.model'](peer, { sessionId, ...p.model });
      const { command } = await methods['session.prompt'](peer, { sessionId, text, uploads: p.uploads, timeZone: p.timeZone });
      return { sessionId, ...(command ? { command } : {}) };
    },
    'commands.list': (peer, p) => commands.list(String(p.sessionId)),
    'image.get': (peer, p) => {
      const ref = peer.images.get(String(p.id ?? ''));
      if (!ref) throw new Error('这张图片不在已打开的会话里');
      if (!images) throw new Error('电脑上的图片服务不可用');
      return images.chunk(ref, Number(p.offset) || 0);
    },
    'pending.list': () => ({ pending: away.pending() }),
    'pending.answer': (peer, p) => ({ ok: away.answer(String(p.id), p) }),
    'away.set': async (peer, p) => ({ away: await away.set(p.on === true) }),
    'push.subscribe': async (peer, p) => {
      const sub = p.subscription;
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('无效的推送订阅');
      await state.updateDevice(peer.device.id, { push: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } });
      onChange();
      return { ok: true };
    },
    'push.unsubscribe': async (peer) => { await state.updateDevice(peer.device.id, { push: null }); onChange(); return { ok: true }; },
    'push.test': async (peer) => push.sendTo(state.deviceById(peer.device.id), { title: 'DSH 推送测试', body: `来自「${state.desktopName}」的测试通知`, tag: 'test' }),
    'device.forget': async (peer) => { await state.removeDevice(peer.device.id); setTimeout(() => getLink()?.close(peer.cid, 'forgotten'), 50); onChange(); return { ok: true }; },
  };

  async function rpc(peer, { id, m, p = {} }) {
    const fn = methods[m];
    if (!fn) return send(peer, { id, ok: false, e: `未知方法 ${m}` });
    try {
      const r = await fn(peer, p ?? {});
      send(peer, { id, ok: true, r: r ?? {} });
    } catch (error) {
      send(peer, { id, ok: false, e: error?.message ?? String(error) });
    }
  }

  // ---------------------------------------------------------------- watching -----
  function stopWatch(peer) {
    peer.watch?.abort.abort();
    clearTimeout(peer.watch?.liveTimer);
    clearTimeout(peer.watch?.statsTimer);
    peer.watch = null;
  }

  async function watch(peer, sessionId) {
    stopWatch(peer);
    const abort = new AbortController();
    const w = { sessionId, abort, cursor: 0, live: '', liveTimer: null, liveSent: '' };
    peer.watch = w;
    const iterable = await ctx.sessionController.follow({ address: { kind: 'session', sessionId }, assistantStream: true, turnWindow: WATCH_WINDOW }, abort.signal);
    const iterator = iterable[Symbol.asyncIterator]();
    const first = await iterator.next();
    const snapshot = first.value;
    if (first.done || snapshot?.type !== 'snapshot') throw new Error('无法读取会话');
    w.cursor = snapshot.cursor;
    const values = snapshot.projections?.values ?? {};
    if (values.title) titles.set(sessionId, values.title);
    let items = projectRecords(snapshot.records);
    if (items.length > MAX_SNAPSHOT_ITEMS) items = items.slice(-MAX_SNAPSHOT_ITEMS);
    share(peer, items);
    w.live = snapshot.activeAttempt ? streamText(snapshot.activeAttempt.stream) : '';
    w.attemptId = snapshot.activeAttempt?.attemptId;
    pump(peer, w, iterator);
    return {
      sessionId, title: values.title ?? null, cwd: snapshot.header?.cwd ?? null, items,
      hasMore: snapshot.hasMore ?? false, firstSeq: snapshot.records?.[0]?.event?.seq ?? null,
      live: w.live, todos: values.todos ?? null, preset: values.permissions?.currentValue ?? null,
      model: values.modelSelection?.next ?? null,
      stats: statsOf(values), tokens: tokensOf(values), queue: queueOf(values.inbox),
    };
  }

  function flushLive(peer, w) {
    w.liveTimer = null;
    if (peer.watch !== w || w.live === w.liveSent) return;
    w.liveSent = w.live;
    event(peer, 'live', { sessionId: w.sessionId, text: w.live });
  }

  function queueLive(peer, w) {
    if (!w.liveTimer) w.liveTimer = setTimeout(() => flushLive(peer, w), LIVE_THROTTLE_MS);
  }

  /** Numbers and queue are projections, not stream frames: read them again shortly after a change. */
  function queueStats(peer, w) {
    if (w.statsTimer) return;
    w.statsTimer = setTimeout(async () => {
      w.statsTimer = null;
      try {
        const baseline = await ctx.sessionController.projections({ sessionId: w.sessionId }, AbortSignal.timeout(10_000));
        const values = baseline?.values ?? {};
        if (peer.watch === w) event(peer, 'stats', { sessionId: w.sessionId, stats: statsOf(values), tokens: tokensOf(values), queue: queueOf(values.inbox) });
      } catch {}
    }, STATS_DELAY_MS);
  }

  async function pump(peer, w, iterator) {
    try {
      for (;;) {
        const { value: frame, done } = await iterator.next();
        if (done || peer.watch !== w) break;
        if (frame.type === 'event') {
          w.cursor = Math.max(w.cursor, frame.event.seq);
          if (frame.event.type === 'session/title' && typeof frame.event.data?.title === 'string') {
            titles.set(w.sessionId, frame.event.data.title);
            event(peer, 'title', { sessionId: w.sessionId, title: frame.event.data.title });
          }
          if (STATS_EVENTS.has(frame.event.type)) queueStats(peer, w);
          // The model was switched (on the desktop or by a phone): send the session's next model.
          if (frame.event.type === 'model/selection') {
            modelOf(w.sessionId).then((model) => { if (peer.watch === w) event(peer, 'model', { sessionId: w.sessionId, model }); });
          }
          const item = projectEvent(frame.event);
          if (item) {
            if (item.k === 'assistant') { w.live = ''; w.liveSent = ''; }
            event(peer, 'items', { sessionId: w.sessionId, items: share(peer, [item]) });
          }
        } else if (frame.type === 'assistant-stream') {
          const f = frame.frame;
          if (f.type === 'start') { w.attemptId = f.attemptId; w.live = ''; queueLive(peer, w); }
          else if (f.type === 'chunk' && f.attemptId === w.attemptId && f.chunk?.type === 'text-delta') { w.live += f.chunk.text ?? ''; queueLive(peer, w); }
          else if (f.type === 'end' && f.attemptId === w.attemptId) { w.live = ''; queueLive(peer, w); }
        }
      }
    } catch (error) {
      if (!w.abort.signal.aborted) {
        log(`dsh-pair: 跟随会话 ${w.sessionId} 中断：${error.message}`);
        event(peer, 'watch-ended', { sessionId: w.sessionId, error: error.message });
      }
    } finally {
      try { await iterator.return?.(); } catch {}
    }
  }

  async function older(peer, sessionId, beforeSeq) {
    const w = peer.watch?.sessionId === sessionId ? peer.watch : null;
    const page = await ctx.sessionController.page({
      address: { kind: 'session', sessionId }, throughSeq: w?.cursor ?? beforeSeq, beforeSeq, turnWindow: WATCH_WINDOW,
    }, AbortSignal.timeout(20_000));
    return { items: share(peer, projectRecords(page.records)), hasMore: page.hasMore, firstSeq: page.records?.[0]?.event?.seq ?? null };
  }

  return {
    open, close, data, broadcast, online, titleOf, listSessions,
    connected: () => [...peers.values()].filter((peer) => peer.stage === 'ready').map((peer) => peer.device.id),
    kickDevice(deviceId, reason) {
      for (const peer of peers.values()) if (peer.device?.id === deviceId) kick(peer, 'revoked', reason);
    },
  };
}

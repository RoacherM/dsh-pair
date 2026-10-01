// Simulated desktop for UI testing: real dsh-pair host code + fake DSH services + real relay.
// Prints a pairing link; auto-approves pairing; streams a fake agent reply to every prompt.
//   node dev/fake-desktop.mjs
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../plugin/src/host/index.js';

const RELAY = process.env.RELAY ?? 'https://dsh-pair-relay.sir-housir.workers.dev';
const listeners = new Map();
const routes = new Map();
const followers = new Set();
let seq = 10;
const records = [
  { type: 'event', event: { type: 'user/message', seq: 1, time: Date.now() - 600000, data: { content: [{ type: 'text', text: '帮我看看 parser 里为什么会漏掉最后一行' }], source: { kind: 'user' } } } },
  { type: 'event', event: { type: 'tool/call', seq: 2, time: Date.now() - 590000, data: { callId: 'c1', name: 'read', arguments: '{"file_path":"/Users/me/proj/src/parser.ts"}' } } },
  { type: 'event', event: { type: 'tool/result', seq: 3, time: Date.now() - 589000, data: { callId: 'c1', message: { content: [{ type: 'text', text: '1: export function parse(src) {\n2:   const lines = src.split("\\n")\n3:   for (let i = 0; i < lines.length - 1; i++) {' }] } } } },
  { type: 'event', event: { type: 'assistant/message', seq: 4, time: Date.now() - 580000, data: { message: { content: [{ type: 'text', text: '找到了：第 3 行循环条件写成了 `i < lines.length - 1`，所以**最后一行被跳过**。\n\n```ts\nfor (let i = 0; i < lines.length; i++) {\n```\n\n要我直接修改并跑测试吗？' }] } } } },
  { type: 'event', event: { type: 'turn/end', seq: 5, time: Date.now() - 579000, data: { reason: { kind: 'completed' } } } },
];
// Attachment bytes by id: the screenshot below and images the phone sends.
const stored = new Map();
// A screenshot tool result with an image, as DSH records it (FAKE_IMAGE: any PNG/JPEG on this Mac).
if (process.env.FAKE_IMAGE) {
  const image = await readFile(process.env.FAKE_IMAGE);
  const png = image[0] === 0x89;
  const width = png ? image.readUInt32BE(16) : 1280;
  const height = png ? image.readUInt32BE(20) : 720;
  const shot = { attachmentId: 'att-fake-shot', mediaType: png ? 'image/png' : 'image/jpeg', bytes: image.length, width, height, name: 'screen.png' };
  records.push(
    { type: 'event', event: { type: 'tool/call', seq: 6, time: Date.now() - 500000, data: { callId: 'c6', name: 'computer_screenshot', arguments: '{"computer_id":"omarchy-local"}' } } },
    { type: 'event', event: { type: 'tool/result', seq: 7, time: Date.now() - 499000, data: { callId: 'c6', message: { content: [{ type: 'text', text: `Screenshot of omarchy-local: ${width}×${height}` }, { type: 'image', attachment: shot }] } } } },
  );
  stored.set(shot.attachmentId, { data: image, mediaType: shot.mediaType });
}
// Images the phone sends are stored like DSH's prompt admission does, so the echoed message shows them.
globalThis.fakeAttachments = {
  async readImageRequest(ref, target) { const s = stored.get(ref.attachmentId); return { data: s.data, mediaType: s.mediaType, width: target.width, height: target.height }; },
};
const admit = (content) => content.map((part) => {
  if (part.type !== 'image') return part;
  const data = Buffer.from(part.data, 'base64');
  const png = data[0] === 0x89;
  const attachmentId = `att-upload-${stored.size + 1}`;
  stored.set(attachmentId, { data, mediaType: part.mediaType });
  console.log('received image', part.mediaType, data.length, 'bytes', part.name ?? '');
  return { type: 'image', attachment: { attachmentId, mediaType: part.mediaType, bytes: data.length, width: png ? data.readUInt32BE(16) : 1200, height: png ? data.readUInt32BE(20) : 900, name: part.name } };
});
const sessions = [
  { sessionId: 's1', title: '修复 parser 漏行', cwd: '/Users/me/proj', running: false, updatedAt: Date.now() - 579000 },
  { sessionId: 's2', title: '写周报', cwd: '/Users/me/notes', running: false, updatedAt: Date.now() - 86400000 },
];
const presets = new Map([['s1', 'danger-full-access']]);
let model = { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'high' };
const session = { id: 's1', header: () => ({}) };
const push = (frame) => { for (const f of followers) f(frame); };
const emit = (name, ...args) => { for (const fn of listeners.get(name) ?? []) fn(...args); };
const waterfall = (name, payload, fallback) => { const list = listeners.get(name) ?? []; const run = (i) => (i < list.length ? list[i].call({}, payload, () => run(i + 1)) : fallback()); return run(0); };

const add = (event) => { event.seq = ++seq; event.time = Date.now(); records.push({ type: 'event', event }); push({ type: 'event', event }); };
const inbox = { 'next-turn': [], 'next-step': [] };
const stats = { turns: 1, steps: 3, llmMs: 9000, toolMs: 400, ttftMs: 800, ttftSteps: 1, decodeMs: 4000, decodeTokens: 220 };
const usage = { uncachedInputTokens: 3200, cacheReadTokens: 38000, cacheWriteTokens: 900, outputTokens: 700 };
function runTurn(content) {
  add({ type: 'user/message', data: { content, source: { kind: 'user' } } });
  const said = content.find((part) => part.type === 'text')?.text ?? '（一张图片）';
  const s = sessions[0]; s.running = true; s.updatedAt = Date.now(); emit('api-session/status', 's1', true);
  setTimeout(async () => {
    const callId = `c${seq + 1}`;
    add({ type: 'tool/call', data: { callId, name: 'bash', arguments: JSON.stringify({ command: 'npm test', description: 'Run the test suite' }) } });
    // Ask for approval. The fallback stands for DSH's own prompt: it answers after FAKE_DESKTOP_MS
    // (default at once) unless the request's signal closes it first (a phone answered).
    const req = { agent: { session }, toolName: 'bash', reason: 'npm test' };
    const verdict = await waterfall('approval/request', req, () => new Promise((resolve) => {
      const timer = setTimeout(() => { console.log('desktop prompt answered'); resolve('allowed-once'); }, Number(process.env.FAKE_DESKTOP_MS ?? 0));
      req.signal?.addEventListener('abort', () => { clearTimeout(timer); console.log('desktop prompt closed'); resolve('cancelled'); });
    }));
    add({ type: 'tool/result', data: { callId, message: { content: [{ type: 'text', text: verdict === 'allowed-once' ? '✓ 42 tests passed' : `denied (${verdict})` }] }, ...(verdict === 'allowed-once' ? {} : { error: 'denied' }) } });
    const reply = `收到：「${said}」。测试${verdict === 'allowed-once' ? '全部通过 ✅' : '被拒绝执行'}。\n\n- 修复了循环边界\n- 增加了一条回归测试`;
    const attempt = 'a' + seq;
    push({ type: 'assistant-stream', frame: { type: 'start', attemptId: attempt, revision: 1, turn: 1, step: 1 } });
    for (const ch of reply) { push({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: attempt, revision: 1, index: 0, time: Date.now(), chunk: { type: 'text-delta', index: 0, text: ch } } }); await new Promise((r) => setTimeout(r, 40)); }
    push({ type: 'assistant-stream', frame: { type: 'end', attemptId: attempt, revision: 1, index: 1, outcome: { kind: 'committed', eventType: 'assistant/message', seq: seq + 1 } } });
    add({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: reply }] } } });
    Object.assign(stats, { turns: stats.turns + 1, steps: stats.steps + 2, decodeMs: stats.decodeMs + 1500, decodeTokens: stats.decodeTokens + 90 });
    Object.assign(usage, { cacheReadTokens: usage.cacheReadTokens + 41000, uncachedInputTokens: usage.uncachedInputTokens + 2600, outputTokens: usage.outputTokens + 400 });
    add({ type: 'turn/end', data: { reason: { kind: 'completed' } } });
    s.running = false; emit('api-session/status', 's1', false);
    const next = inbox['next-turn'].shift();
    if (next) { add({ type: 'agent/inbox/spliced', data: { target: 'next-turn' } }); setTimeout(() => runTurn(next.content), 300); }
  }, 800);
}
// DSH's command registry and agent lookup (`ctx.commands`, `ctx.typert`), with the global commands a
// phone may and may not run, and a skill catalog for the "/" menu.
const agentS1 = { id: 's1', session };
const commandDefs = [
  { name: 'compact', description: '压缩上下文' },
  { name: 'goal', description: '设置会话目标', input: { hint: '<目标>' } },
  { name: 'danger-full-access', description: '切换到完全访问' },
];
let commandSeq = 0;
const fakeServices = {
  attachments: globalThis.fakeAttachments,
  commands: {
    list: (agent) => (agent === agentS1 ? commandDefs : []),
    find: (agent, name) => (agent === agentS1 ? commandDefs.find((c) => c.name === name) : undefined),
    async execute(agent, line) {
      const [, name, args] = /^\/([a-z0-9_-]+)\s*(.*)$/s.exec(line) ?? [];
      if (!commandDefs.some((c) => c.name === name)) return undefined;
      const commandId = `cmd-${++commandSeq}`;
      add({ type: 'command/run', data: { commandId, name, args, source: { kind: 'user' } } });
      await new Promise((r) => setTimeout(r, 600));
      const result = name === 'goal' && !args.trim() ? { kind: 'error', text: '/goal 需要一个目标' } : { kind: 'success', text: name === 'compact' ? '已压缩：82K → 12K tokens' : `目标：${args}` };
      add({ type: 'command/done', data: { commandId, kind: result.kind, text: result.text } });
      return { commandId, result };
    },
  },
  typert: { lookups: { get: (key) => (key === 'agent' ? { resolve: async (id) => (id === 's1' ? agentS1 : undefined) } : undefined) } },
  // Enough skills that the menu has to scroll.
  sessionSkillCatalog: { list: async () => ({ skills: [{ name: 'code-review', description: '评审当前改动' }, { name: 'commit', description: '整理并提交' },
    ...Array.from({ length: 20 }, (_, i) => ({ name: `extra-skill-${String(i + 1).padStart(2, '0')}`, description: `第 ${i + 1} 个技能` }))] }) },
};

const projectionValues = () => ({
  modelSelection: { lastUsed: null, next: model }, inbox, sessionStats: stats, tokenUsage: usage,
  contextPressure: { contextWindow: 200000, pressureTokens: 78000, projectedTokens: 82000 },
});

const ctx = {
  logger: { warn: (m) => console.log('[warn]', m) },
  on(name, fn, prepend) { const l = listeners.get(name) ?? []; prepend ? l.unshift(fn) : l.push(fn); listeners.set(name, l); },
  effect(fn) { fn(); },
  connection: { fetch: { register(r) { routes.set(r.methods[0] + ' ' + r.path, r.fetch); return () => {}; } } },
  sessionController: {
    async list() { return { items: sessions.map((s) => ({ ...s, blank: false, agentAvailable: true, projections: { values: { title: s.title } } })) }; },
    async follow(req, signal) {
      const id = req.address.sessionId;
      const queue = [{ type: 'snapshot', header: { cwd: '/Users/me/proj' }, cursor: seq, hasMore: false, projections: { values: { title: sessions.find((s) => s.sessionId === id)?.title, ...projectionValues() } }, records: id === 's1' ? records : [] }];
      let wake;
      const fn = (frame) => { if (id === 's1') { queue.push(frame); wake?.(); } };
      followers.add(fn);
      signal.addEventListener('abort', () => followers.delete(fn));
      return (async function* () { while (!signal.aborted) { if (queue.length) { yield queue.shift(); continue; } await new Promise((r) => { wake = r; signal.addEventListener('abort', r, { once: true }); }); } })();
    },
    async prompt(req) {
      const content = admit(req.content);
      // While a turn runs, a message waits in the inbox (DSH's queue) until the turn ends or is steered in.
      if (sessions[0].running) {
        inbox['next-turn'].push({ id: `q${seq}-${inbox['next-turn'].length}`, role: 'user', content, source: { kind: 'user' } });
        add({ type: 'agent/inbox/spliced', data: { target: 'next-turn' } });
        return { accepted: true };
      }
      runTurn(content);
      return { accepted: true };
    },
    async updateQueue(req) {
      const i = inbox['next-turn'].findIndex((m) => m.id === req.itemId);
      if (i < 0) throw new Error('queued item is no longer pending');
      const [message] = inbox['next-turn'].splice(i, 1);
      add({ type: 'agent/inbox/spliced', data: { target: 'next-turn' } });
      if (req.action.kind === 'steer') add({ type: 'user/message', data: { content: message.content, source: { kind: 'user' } } });
      return { accepted: true };
    },
    cancel() { return {}; },
    async modelCatalog() {
      const efforts = [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }];
      return { default: { provider: 'claude', model: 'claude-opus-5-5' }, groups: [
        { id: 'claude', name: 'Claude', models: [
          { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 · Claude Code', reasoning: { efforts, defaultEffort: 'high' } },
          { id: 'claude-sonnet-5', name: 'Sonnet 5', reasoning: { efforts, defaultEffort: 'medium' } },
        ] },
        { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek V4' }] },
      ] };
    },
    async projections() { return { asOfSeq: seq, values: projectionValues() }; },
    async selectModel(req) {
      model = { provider: req.provider, model: req.model, ...(req.reasoningEffort ? { reasoningEffort: req.reasoningEffort } : {}) };
      const event = { type: 'model/selection', seq: ++seq, time: Date.now(), data: model };
      records.push({ type: 'event', event }); push({ type: 'event', event });
      return { selected: model };
    },
    async create() { return { sessionId: 's1' }; },
    async page() { return { records: [], hasMore: false }; },
  },
  agents: { roots: () => [{ session }], list: () => [{ session }], get: (id) => (id === 's1' ? { session } : undefined) },
  permissionPresets: { current: (s) => presets.get(s.id), set: (s, n) => presets.set(s.id, n), resolve: (n) => ({ name: n }) },
  workspaceRegistry: { list: () => [{ id: 'w1', path: '/Users/me/proj', title: 'proj' }, { id: 'w2', path: '/Users/me/notes', title: 'notes' }] },
  get: (name) => fakeServices[name],
};

apply(ctx, { relayUrl: RELAY, dataDir: process.env.DATA ?? await mkdtemp(join(tmpdir(), 'dsh-pair-fake-')) });
const call = async (key, body) => (await routes.get(key)(new Request('http://x' + key.split(' ')[1], { method: key.split(' ')[0], body: body ? JSON.stringify(body) : undefined }))).json();
let state;
for (let i = 0; i < 60; i++) { state = await call('GET /api/pair/state'); if (state.relay.status === 'online') break; await new Promise((r) => setTimeout(r, 250)); }
state = await call('POST /api/pair/start');
console.log('PAIR_LINK', state.pairing.offer.link);
setInterval(async () => {
  const s = await call('GET /api/pair/state');
  if (s.pairing.request) { console.log('auto-approving', s.pairing.request.name, s.pairing.request.sas); await call('POST /api/pair/decide', { allow: true }); }
}, 500);

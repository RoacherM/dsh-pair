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
  globalThis.fakeAttachments = { async readImageRequest(ref, target) { return { data: image, mediaType: shot.mediaType, width: target.width, height: target.height }; } };
}
const sessions = [
  { sessionId: 's1', title: '修复 parser 漏行', cwd: '/Users/me/proj', running: false, updatedAt: Date.now() - 579000 },
  { sessionId: 's2', title: '写周报', cwd: '/Users/me/notes', running: false, updatedAt: Date.now() - 86400000 },
];
const presets = new Map([['s1', 'danger-full-access']]);
const session = { id: 's1', header: () => ({}) };
const push = (frame) => { for (const f of followers) f(frame); };
const emit = (name, ...args) => { for (const fn of listeners.get(name) ?? []) fn(...args); };
const waterfall = (name, payload, fallback) => { const list = listeners.get(name) ?? []; const run = (i) => (i < list.length ? list[i].call({}, payload, () => run(i + 1)) : fallback()); return run(0); };

const ctx = {
  logger: { warn: (m) => console.log('[warn]', m) },
  on(name, fn, prepend) { const l = listeners.get(name) ?? []; prepend ? l.unshift(fn) : l.push(fn); listeners.set(name, l); },
  effect(fn) { fn(); },
  connection: { fetch: { register(r) { routes.set(r.methods[0] + ' ' + r.path, r.fetch); return () => {}; } } },
  sessionController: {
    async list() { return { items: sessions.map((s) => ({ ...s, blank: false, agentAvailable: true, projections: { values: { title: s.title } } })) }; },
    async follow(req, signal) {
      const id = req.address.sessionId;
      const queue = [{ type: 'snapshot', header: { cwd: '/Users/me/proj' }, cursor: seq, hasMore: false, projections: { values: { title: sessions.find((s) => s.sessionId === id)?.title } }, records: id === 's1' ? records : [] }];
      let wake;
      const fn = (frame) => { if (id === 's1') { queue.push(frame); wake?.(); } };
      followers.add(fn);
      signal.addEventListener('abort', () => followers.delete(fn));
      return (async function* () { while (!signal.aborted) { if (queue.length) { yield queue.shift(); continue; } await new Promise((r) => { wake = r; signal.addEventListener('abort', r, { once: true }); }); } })();
    },
    async prompt(req) {
      const add = (event) => { event.seq = ++seq; event.time = Date.now(); records.push({ type: 'event', event }); push({ type: 'event', event }); };
      add({ type: 'user/message', data: { content: req.content, source: { kind: 'user' } } });
      const s = sessions[0]; s.running = true; s.updatedAt = Date.now(); emit('api-session/status', 's1', true);
      setTimeout(async () => {
        const callId = `c${seq + 1}`;
        add({ type: 'tool/call', data: { callId, name: 'bash', arguments: JSON.stringify({ command: 'npm test', description: 'Run the test suite' }) } });
        // ask for approval (only intercepted in away mode)
        const verdict = await waterfall('approval/request', { agent: { session }, toolName: 'bash', reason: 'npm test' }, () => Promise.resolve('allowed-once'));
        add({ type: 'tool/result', data: { callId, message: { content: [{ type: 'text', text: verdict === 'allowed-once' ? '✓ 42 tests passed' : `denied (${verdict})` }] }, ...(verdict === 'allowed-once' ? {} : { error: 'denied' }) } });
        const reply = `收到：「${req.content[0].text}」。测试${verdict === 'allowed-once' ? '全部通过 ✅' : '被拒绝执行'}。\n\n- 修复了循环边界\n- 增加了一条回归测试`;
        push({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a' + seq, revision: 1, turn: 1, step: 1 } });
        const attempt = 'a' + seq;
        for (const ch of reply) { push({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: attempt, revision: 1, index: 0, time: Date.now(), chunk: { type: 'text-delta', index: 0, text: ch } } }); await new Promise((r) => setTimeout(r, 25)); }
        push({ type: 'assistant-stream', frame: { type: 'end', attemptId: attempt, revision: 1, index: 1, outcome: { kind: 'committed', eventType: 'assistant/message', seq: seq + 1 } } });
        add({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: reply }] } } });
        add({ type: 'turn/end', data: { reason: { kind: 'completed' } } });
        s.running = false; emit('api-session/status', 's1', false);
      }, 800);
      return { accepted: true };
    },
    cancel() { return {}; },
    async create() { return { sessionId: 's1' }; },
    async page() { return { records: [], hasMore: false }; },
  },
  agents: { roots: () => [{ session }], list: () => [{ session }], get: (id) => (id === 's1' ? { session } : undefined) },
  permissionPresets: { current: (s) => presets.get(s.id), set: (s, n) => presets.set(s.id, n), resolve: (n) => ({ name: n }) },
  workspaceRegistry: { list: () => [{ id: 'w1', path: '/Users/me/proj', title: 'proj' }, { id: 'w2', path: '/Users/me/notes', title: 'notes' }] },
  get: (name) => (name === 'attachments' ? globalThis.fakeAttachments : undefined),
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

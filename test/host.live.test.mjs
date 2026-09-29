// Full-path test: fake DSH host ctx + real relay + simulated phone.
//   RELAY=https://dsh-pair-relay.sir-housir.workers.dev node --test test/host.live.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../plugin/src/host/index.js';
import { decodePairLink, newBoxKeys, phoneHandshake, unb64 } from '../shared/e2e.js';

const RELAY = process.env.RELAY ?? 'https://dsh-pair-relay.sir-housir.workers.dev';

function fakeCtx() {
  const listeners = new Map();
  const routes = new Map();
  const disposers = [];
  const prompts = [];
  const presets = new Map([['s1', 'danger-full-access']]);
  const session = { id: 's1', header: () => ({}) };
  let followPush;
  const ctx = {
    logger: { warn: (m) => console.log('[warn]', m) },
    on(name, fn, prepend) { const list = listeners.get(name) ?? []; prepend ? list.unshift(fn) : list.push(fn); listeners.set(name, list); },
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); },
    emit(name, ...args) { for (const fn of listeners.get(name) ?? []) fn(...args); },
    waterfall(name, payload, fallback) {
      const list = listeners.get(name) ?? [];
      const run = (i) => (i < list.length ? list[i].call({}, payload, () => run(i + 1)) : fallback());
      return run(0);
    },
    connection: { fetch: { register(r) { routes.set(r.methods[0] + ' ' + r.path, r.fetch); return () => {}; } } },
    sessionController: {
      async list() { return { items: [{ sessionId: 's1', updatedAt: Date.now(), running: false, blank: false, agentAvailable: true, cwd: '/tmp/proj', projections: { values: { title: '测试会话' } } }] }; },
      async follow(req, signal) {
        const queue = [{ type: 'snapshot', header: { cwd: '/tmp/proj' }, cursor: 3, hasMore: false, projections: { values: { title: '测试会话' } }, records: [
          { type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } } } },
          { type: 'event', event: { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'reasoning', text: 'x' }, { type: 'text', text: '**嗨**' }] } } } },
          { type: 'event', event: { type: 'tool/call', seq: 3, time: 3, data: { callId: 'c1', name: 'bash', arguments: '{"command":"ls -la","description":"List files"}' } } },
        ] }];
        let wake;
        followPush = (frame) => { queue.push(frame); wake?.(); };
        return (async function* () {
          while (!signal.aborted) {
            if (queue.length) { yield queue.shift(); continue; }
            await new Promise((r) => { wake = r; signal.addEventListener('abort', r, { once: true }); });
          }
        })();
      },
      async prompt(req) { prompts.push(req); return { accepted: true }; },
      cancel() { return {}; },
      async create() { return { sessionId: 's2' }; },
      async page() { return { records: [], hasMore: false }; },
    },
    agents: { roots: () => [{ session }], list: () => [{ session }], get: (id) => (id === 's1' ? { session } : undefined) },
    permissionPresets: { current: (s) => presets.get(s.id), set: (s, name) => presets.set(s.id, name), resolve: (n) => ({ name: n }) },
    workspaceRegistry: { list: () => [{ id: 'w1', path: '/tmp/proj', title: 'proj' }] },
  };
  return { ctx, routes, disposers, prompts, presets, followPush: (f) => followPush(f) };
}

function phoneSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url); ws.q = []; ws.w = [];
    ws.onmessage = (m) => (ws.w.length ? ws.w.shift()(m.data) : ws.q.push(m.data));
    ws.onopen = () => resolve(ws); ws.onerror = () => reject(new Error('ws error'));
  });
}
const next = (ws, ms = 15000) => ws.q.length ? Promise.resolve(ws.q.shift()) : new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms); ws.w.push((d) => { clearTimeout(t); res(d); });
});
const call = async (routes, key, body) => (await routes.get(key)(new Request('http://x/api' + key.split(' ')[1], { method: key.split(' ')[0], body: body ? JSON.stringify(body) : undefined }))).json();

test('pair, browse, prompt, live stream, away approval — through the real relay', { timeout: 90_000 }, async () => {
  const f = fakeCtx();
  apply(f.ctx, { relayUrl: RELAY, dataDir: await mkdtemp(join(tmpdir(), 'dsh-pair-')) });
  let state;
  for (let i = 0; i < 40; i++) { state = await call(f.routes, 'GET /api/pair/state'); if (state.relay.status === 'online') break; await new Promise((r) => setTimeout(r, 250)); }
  assert.equal(state.relay.status, 'online');

  state = await call(f.routes, 'POST /api/pair/start');
  const offer = decodePairLink(state.pairing.offer.link);
  assert.match(state.pairing.offer.qr, /<svg/);

  // --- phone pairs
  const P = newBoxKeys();
  const ws = await phoneSocket(`${offer.r}/v1/client/${offer.i}`);
  assert.equal(await next(ws), '\u0000online');
  const hs = phoneHandshake(P, unb64(offer.k));
  ws.send(hs.hello);
  const { cipher, sas } = hs.finish(await next(ws));
  const rx = async () => cipher.open(await next(ws));
  ws.send(cipher.seal({ type: 'auth', mode: 'pair', token: offer.t, name: '测试 iPhone' }));
  assert.equal((await rx()).sas, sas);
  for (let i = 0; i < 40 && !(state = await call(f.routes, 'GET /api/pair/state')).pairing.request; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(state.pairing.request.sas, sas);
  await call(f.routes, 'POST /api/pair/decide', { allow: true });
  const ready = await rx();
  assert.equal(ready.type, 'ready'); assert.equal(ready.paired, true);

  let id = 0;
  const events = [];
  const rpc = async (m, p) => {
    const rid = ++id; ws.send(cipher.seal({ id: rid, m, p }));
    for (;;) { const msg = await rx(); if (msg.id === rid) { if (!msg.ok) throw new Error(msg.e); return msg.r; } events.push(msg); }
  };
  const nextEvent = async (ev) => { for (;;) { const i = events.findIndex((e) => e.ev === ev); if (i >= 0) return events.splice(i, 1)[0]; events.push(await rx()); } };

  const list = await rpc('sessions.list');
  assert.equal(list.sessions[0].title, '测试会话');
  const watched = await rpc('session.watch', { sessionId: 's1' });
  assert.deepEqual(watched.items.map((i) => i.k), ['user', 'assistant', 'tool']);
  assert.equal(watched.items[1].text, '**嗨**');
  assert.equal(watched.items[2].summary, 'List files');

  f.followPush({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 2 } });
  f.followPush({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 1, index: 0, time: 1, chunk: { type: 'text-delta', index: 0, text: '正在' } } });
  f.followPush({ type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a1', revision: 1, index: 1, time: 1, chunk: { type: 'text-delta', index: 0, text: '思考' } } });
  assert.equal((await nextEvent('live')).text, '正在思考');
  f.followPush({ type: 'event', event: { type: 'tool/result', seq: 4, time: 4, data: { callId: 'c1', message: { content: [{ type: 'text', text: 'file.txt' }] } } } });
  const items = await nextEvent('items');
  assert.equal(items.items[0].k, 'result');

  await rpc('session.prompt', { sessionId: 's1', text: '继续' });
  assert.equal(f.prompts[0].content[0].text, '继续');

  // --- away mode: approval goes to the phone
  await rpc('away.set', { on: true });
  assert.equal(f.presets.get('s1'), 'workspace-write');
  const decision = f.ctx.waterfall('approval/request', { agent: { session: { id: 's1' } }, toolName: 'bash', reason: 'rm -rf build' }, () => Promise.resolve('unavailable'));
  let pend; do { pend = await nextEvent('pending'); } while (!pend.pending.length);
  assert.equal(pend.pending[0].toolName, 'bash');
  await rpc('pending.answer', { id: pend.pending[0].id, decision: 'allow' });
  assert.equal(await decision, 'allowed-once');

  const q = f.ctx.waterfall('user-questions/request', { agent: { session: { id: 's1' } }, questions: [{ id: 'q1', question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] }] }, () => Promise.reject(new Error('none')));
  let pq; do { pq = await nextEvent('pending'); } while (!pq.pending.some((x) => x.kind === 'question'));
  pq.pending = pq.pending.filter((x) => x.kind === 'question');
  await rpc('pending.answer', { id: pq.pending[0].id, answers: [{ id: 'q1', selected: ['B'] }] });
  assert.deepEqual(await q, { answers: [{ id: 'q1', selected: ['B'] }] });

  await rpc('away.set', { on: false });
  assert.equal(f.presets.get('s1'), 'danger-full-access');
  assert.equal(await f.ctx.waterfall('approval/request', { agent: {}, toolName: 'x' }, () => Promise.resolve('passed-through')), 'passed-through');

  // --- reconnect as a paired device (resume)
  ws.close();
  const ws2 = await phoneSocket(`${offer.r}/v1/client/${offer.i}`);
  assert.equal(await next(ws2), '\u0000online');
  const hs2 = phoneHandshake(P, unb64(offer.k));
  ws2.send(hs2.hello);
  const c2 = hs2.finish(await next(ws2)).cipher;
  ws2.send(c2.seal({ type: 'auth', mode: 'resume' }));
  assert.equal(c2.open(await next(ws2)).type, 'ready');

  // --- unknown phone is refused
  const ws3 = await phoneSocket(`${offer.r}/v1/client/${offer.i}`);
  await next(ws3);
  const hs3 = phoneHandshake(newBoxKeys(), unb64(offer.k));
  ws3.send(hs3.hello);
  const c3 = hs3.finish(await next(ws3)).cipher;
  ws3.send(c3.seal({ type: 'auth', mode: 'resume' }));
  assert.equal(c3.open(await next(ws3)).code, 'unknown-device');

  ws2.close(); ws3.close();
  for (const d of f.disposers) d();
});

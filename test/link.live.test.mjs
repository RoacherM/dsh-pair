// The phone's Link (app/src/link.js) through the real relay (or RELAY=http://127.0.0.1:8799 for
// `wrangler dev`), with short deadlines:
//   node --test test/link.live.test.mjs
//
// Each test stands in for a desktop over the real relay and checks that the phone never waits
// forever: an unanswered handshake, a desktop path that died while the relay still pongs, and a
// socket left over from before the phone was suspended all end in a fresh, working connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { b64, desktopAccept, desktopIdFor, newBoxKeys, newSignKeys, relayAuthQuery } from '../shared/e2e.js';

globalThis.document ??= Object.assign(new EventTarget(), { visibilityState: 'visible' });
globalThis.window ??= new EventTarget();
const { Link } = await import('../app/src/link.js');

const RELAY = process.env.RELAY ?? 'https://dsh-pair-relay.sir-housir.workers.dev';
const WS_BASE = RELAY.replace(/^http/, 'ws').replace(/\/$/, '');
const FAST = { connect: 2000, handshake: 1500, ping: 500, silent: 2500, asleep: 1000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A desktop over the relay. `answer` decides whether it replies to phones at all. */
async function desktop({ answer = true } = {}) {
  const sign = newSignKeys();
  const box = newBoxKeys();
  const id = await desktopIdFor(sign.publicKey);
  const peers = new Map();
  const d = { id, key: b64(box.publicKey), answer, hellos: 0, ws: null };
  d.connect = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/v1/desktop/${id}?${relayAuthQuery(id, sign)}`);
    d.ws = ws;
    ws.onopen = () => resolve(d);
    ws.onerror = () => reject(new Error('desktop ws error'));
    const ping = setInterval(() => { try { ws.send('ping'); } catch {} }, 500);
    ws.onclose = () => clearInterval(ping);
    ws.onmessage = (m) => {
      if (m.data === 'pong') return;
      const frame = JSON.parse(m.data);
      if (frame.t === 'open') peers.delete(frame.c); // a new or reconnected phone starts over
      if (frame.t !== 'data' || !d.answer) return;
      const peer = peers.get(frame.c);
      if (!peer) {
        d.hellos++;
        const accepted = desktopAccept(box, frame.d);
        peers.set(frame.c, accepted);
        ws.send(JSON.stringify({ t: 'data', c: frame.c, d: accepted.welcome }));
        return;
      }
      const msg = peer.cipher.open(frame.d);
      const reply = msg.type === 'auth' ? { type: 'ready', paired: false } : { id: msg.id, ok: true, r: { echo: msg.m } };
      ws.send(JSON.stringify({ t: 'data', c: frame.c, d: peer.cipher.seal(reply) }));
    };
  });
  return d.connect();
}

function phone(d) {
  return new Link({ relay: RELAY, desktopId: d.id, desktopKey: d.key, deviceKeys: newBoxKeys(), timeouts: FAST });
}
function until(link, status, ms = 8000) {
  if (link.status === status) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`still ${link.status}, wanted ${status}`)), ms);
    link.addEventListener('status', function on() {
      if (link.status !== status) return;
      clearTimeout(timer); link.removeEventListener('status', on); resolve();
    });
  });
}

test('the phone connects and talks to a desktop that answers', async () => {
  const d = await desktop();
  const link = phone(d);
  await until(link, 'ready');
  assert.deepEqual(await link.rpc('x.y'), { echo: 'x.y' });
  link.close(); d.ws.close();
});

test('an unanswered handshake is retried instead of waiting forever', async () => {
  const d = await desktop({ answer: false }); // online at the relay, but its replies never come
  const link = phone(d);
  await sleep(FAST.handshake + 300);
  assert.notEqual(link.status, 'ready');
  d.answer = true; // the desktop recovers: the next attempt goes through
  await until(link, 'ready');
  assert.ok(d.hellos >= 1);
  link.close(); d.ws.close();
});

test('a request with no reply at all drops the dead path and reconnects', async () => {
  const d = await desktop();
  const link = phone(d);
  await until(link, 'ready');
  d.answer = false; // the relay still pongs; the desktop path is dead
  await assert.rejects(link.rpc('lost', {}, 800), /请求超时/);
  assert.notEqual(link.status, 'ready');
  d.answer = true;
  await until(link, 'ready');
  assert.deepEqual(await link.rpc('again'), { echo: 'again' });
  link.close(); d.ws.close();
});

test('back in the foreground after a long sleep, the phone reconnects at once', async () => {
  const d = await desktop();
  const link = phone(d);
  await until(link, 'ready');
  const before = link.ws;
  link.lastHeard = Date.now() - FAST.asleep - 1; // as if iOS had suspended the app
  link.wake();
  assert.notEqual(link.ws, before);
  await until(link, 'ready');
  link.close(); d.ws.close();
});

test('a desktop that reconnects is picked up by a waiting phone', async () => {
  const d = await desktop();
  const link = phone(d);
  await until(link, 'ready');
  d.ws.close();
  await until(link, 'offline');
  await d.connect();
  await until(link, 'ready');
  link.close(); d.ws.close();
});

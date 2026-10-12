// Live test of the relay's dead-connection handling, against a local relay with short timeouts:
//   cd relay && npx wrangler dev --port 8799 --var DESKTOP_STALE_MS:3000 --var CLIENT_STALE_MS:3000
//   RELAY=http://127.0.0.1:8799 node --test test/relay-zombie.live.mjs
//
// A "zombie" is a socket whose peer vanished without a TCP FIN or a close frame (a laptop that went
// to sleep, a phone that iOS suspended, a network that changed). The relay cannot tell it from a
// quiet live socket except by its pings, so the zombie here is a raw TCP WebSocket that answers
// nothing, not even the relay's close frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { desktopIdFor, newSignKeys, relayAuthQuery } from '../shared/e2e.js';

const RELAY = new URL(process.env.RELAY ?? 'http://127.0.0.1:8799');
const WS_BASE = RELAY.href.replace(/^http/, 'ws').replace(/\/$/, '');
const STALE_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A WebSocket client over raw TCP that never answers the server: once silent, it is a zombie. */
function zombieSocket(path) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(Number(RELAY.port), RELAY.hostname);
    const key = randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0);
    let upgraded = false;
    const texts = [];
    sock.on('connect', () => sock.write(`GET ${path} HTTP/1.1\r\nHost: ${RELAY.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buf.subarray(0, end).toString();
        if (!/^HTTP\/1\.1 101/.test(head)) { reject(new Error(head.split('\r\n')[0])); return; }
        upgraded = true;
        buf = buf.subarray(end + 4);
        resolve({
          texts,
          sendText(text) {
            const payload = Buffer.from(text);
            const mask = randomBytes(4);
            const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 255]);
            sock.write(Buffer.concat([header, mask, payload.map((b, i) => b ^ mask[i % 4])]));
          },
          destroy() { sock.destroy(); },
        });
      }
      // Server frames are unmasked; keep text frames, ignore everything else (including close).
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        if ((buf[0] & 0x0f) === 1) texts.push(buf.subarray(off, off + len).toString());
        buf = buf.subarray(off + len);
      }
    });
  });
}

function socket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.q = []; ws.w = []; ws.closed = null;
    ws.onmessage = (m) => (ws.w.length ? ws.w.shift()(m.data) : ws.q.push(m.data));
    ws.onclose = (e) => { ws.closed = { code: e.code, reason: e.reason }; };
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`ws error ${url}`));
  });
}
const next = (ws, ms = 3000) => (ws.q.length ? Promise.resolve(ws.q.shift()) : new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out waiting for a frame')), ms);
  ws.w.push((data) => { clearTimeout(timer); resolve(data); });
}));
async function nextData(ws, ms) {
  for (;;) { const frame = JSON.parse(await next(ws, ms)); if (frame.t === 'data') return frame; }
}
async function seat() {
  const keys = newSignKeys();
  const id = await desktopIdFor(keys.publicKey);
  return { id, path: () => `/v1/desktop/${id}?${relayAuthQuery(id, keys)}` };
}
const status = async (id) => (await fetch(new URL(`/v1/status/${id}`, RELAY))).json();

test('a reconnected desktop receives phone frames even while its dead predecessor lingers', async () => {
  const { id, path } = await seat();
  const old = await zombieSocket(path()); // goes silent from here on: the laptop fell asleep
  const phone = await socket(`${WS_BASE}/v1/client/${id}`);
  assert.equal(await next(phone), '\u0000online');

  const fresh = await socket(`${WS_BASE}${path()}`); // the laptop woke up and reconnected
  assert.equal(JSON.parse(await next(fresh)).t, 'open');
  assert.equal(await next(phone), '\u0000online');

  phone.send('hello from phone');
  const frame = await nextData(fresh);
  assert.equal(frame.d, 'hello from phone');
  fresh.close(); phone.close(); old.destroy();
});

test('a desktop that stopped pinging is offline to phones, and is dropped', async () => {
  const { id, path } = await seat();
  const desktop = await zombieSocket(path());
  desktop.sendText('ping');
  await sleep(STALE_MS + 1500);
  assert.equal((await status(id)).online, false);
  const phone = await socket(`${WS_BASE}/v1/client/${id}`);
  assert.equal(await next(phone), '\u0000offline');

  // The real desktop comes back: phones are told at once.
  const back = await socket(`${WS_BASE}${path()}`);
  assert.equal(JSON.parse(await next(back)).t, 'open');
  assert.equal(await next(phone), '\u0000online');
  assert.equal((await status(id)).online, true);
  back.close(); phone.close(); desktop.destroy();
});

test('a pinging desktop stays online past the stale window', async () => {
  const { id, path } = await seat();
  const desktop = await socket(`${WS_BASE}${path()}`);
  for (let i = 0; i < 4; i++) { desktop.send('ping'); assert.equal(await next(desktop), 'pong'); await sleep(STALE_MS / 2); }
  const phone = await socket(`${WS_BASE}/v1/client/${id}`);
  assert.equal(await next(phone), '\u0000online');
  phone.send('still here?');
  assert.equal((await nextData(desktop)).d, 'still here?');
  desktop.close(); phone.close();
});

test('dead phone sockets are pruned instead of filling the client slots', async () => {
  const { id, path } = await seat();
  const desktop = await socket(`${WS_BASE}${path()}`);
  const zombies = [];
  for (let i = 0; i < 8; i++) zombies.push(await zombieSocket(`/v1/client/${id}`));
  await sleep(STALE_MS + 1500);
  desktop.send('ping'); // keep the desktop fresh
  const phone = await socket(`${WS_BASE}/v1/client/${id}`);
  assert.equal(await next(phone), '\u0000online');
  assert.equal((await status(id)).clients, 1);
  desktop.close(); phone.close(); for (const z of zombies) z.destroy();
});

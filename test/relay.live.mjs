// Live test against a running relay: RELAY=http://127.0.0.1:8787 node test/relay.live.mjs
import { newBoxKeys, newSignKeys, desktopIdFor, relayAuthQuery, phoneHandshake, desktopAccept } from '../shared/e2e.js';
const base = (process.env.RELAY ?? 'http://127.0.0.1:8787').replace(/^http/, 'ws');
const S = newSignKeys(), D = newBoxKeys(), P = newBoxKeys();
const id = await desktopIdFor(S.publicKey);
const open = (url) => new Promise((res, rej) => {
  const ws = new WebSocket(url); ws.q = []; ws.w = [];
  ws.onmessage = (m) => (ws.w.length ? ws.w.shift()(m.data) : ws.q.push(m.data));
  ws.onopen = () => res(ws); ws.onerror = () => rej(new Error('ws error ' + url));
});
const next = (ws) => ws.q.length ? Promise.resolve(ws.q.shift()) : new Promise((res) => ws.w.push(res));

// 1. forged desktop is rejected
try { await open(`${base}/v1/desktop/${id}?pub=AAAA&ts=${Date.now()}&sig=AAAA`); console.log('FAIL forged accepted'); process.exit(1); } catch { console.log('ok forged desktop rejected'); }

// 2. phone first (desktop offline), then desktop
const phone = await open(`${base}/v1/client/${id}`);
console.log('phone got', JSON.stringify(await next(phone)));
const desktop = await open(`${base}/v1/desktop/${id}?${relayAuthQuery(id, S)}`);
const openFrame = JSON.parse(await next(desktop));
console.log('desktop got', openFrame.t, 'phone got', JSON.stringify(await next(phone)));

// 3. E2E handshake through the relay
const hs = phoneHandshake(P, D.publicKey);
phone.send(hs.hello);
const f = JSON.parse(await next(desktop));
const acc = desktopAccept(D, f.d);
desktop.send(JSON.stringify({ t: 'data', c: f.c, d: acc.welcome }));
const { cipher, sas } = hs.finish(await next(phone));
phone.send(cipher.seal({ type: 'auth', mode: 'resume' }));
const g = JSON.parse(await next(desktop));
console.log('desktop decrypted', JSON.stringify(acc.cipher.open(g.d)), 'sas match', sas === acc.sas, 'relay saw', g.d.slice(0, 20) + '…');
desktop.send(JSON.stringify({ t: 'data', c: f.c, d: acc.cipher.seal({ type: 'ready' }) }));
console.log('phone decrypted', JSON.stringify(cipher.open(await next(phone))));

// 4. ping auto-response, then desktop drops → phone told offline
phone.send('ping'); console.log('ping ->', await next(phone));
desktop.close(1000, 'bye');
console.log('after desktop close phone got', JSON.stringify(await next(phone)));
const status = await (await fetch(`${base.replace(/^ws/, 'http')}/v1/status/${id}`)).json();
console.log('status', JSON.stringify(status));
phone.close(); process.exit(0);

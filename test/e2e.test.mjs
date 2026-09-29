import test from 'node:test';
import assert from 'node:assert/strict';
import { newBoxKeys, newSignKeys, phoneHandshake, desktopAccept, desktopIdFor, encodePairLink, decodePairLink, relayAuthQuery } from '../shared/e2e.js';

test('handshake agrees, encrypts both ways, rejects replay', () => {
  const D = newBoxKeys(), P = newBoxKeys();
  const phone = phoneHandshake(P, D.publicKey);
  const desk = desktopAccept(D, phone.hello);
  const { cipher: pc, sas } = phone.finish(desk.welcome);
  assert.equal(sas, desk.sas);
  const f1 = pc.seal({ hi: 1 });
  assert.deepEqual(desk.cipher.open(f1), { hi: 1 });
  assert.throws(() => desk.cipher.open(f1), /decryption failed/);
  assert.deepEqual(pc.open(desk.cipher.seal({ ok: 'yes' })), { ok: 'yes' });
});

test('wrong desktop key (relay MITM) cannot finish', () => {
  const D = newBoxKeys(), fake = newBoxKeys(), P = newBoxKeys();
  const phone = phoneHandshake(P, D.publicKey);
  const mitm = desktopAccept(fake, phone.hello);
  const { cipher } = phone.finish(mitm.welcome);
  assert.throws(() => mitm.cipher.open(cipher.seal({ x: 1 })), /decryption failed/);
});

test('pair link roundtrip and desktop id', async () => {
  const S = newSignKeys();
  const id = await desktopIdFor(S.publicKey);
  assert.equal(id.length, 22);
  const link = encodePairLink('https://relay.example.com', { v: 1, r: 'wss://relay.example.com', i: id, k: 'abc', t: 'tok', n: 'Mac' });
  assert.equal(decodePairLink(link).i, id);
  assert.match(relayAuthQuery(id, S), /^pub=.+&ts=\d+&sig=.+$/);
});

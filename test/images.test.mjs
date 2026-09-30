import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_BYTES, createImages, fitWithin, PHONE_MAX_BYTES } from '../plugin/src/host/images.js';
import { projectEvent } from '../plugin/src/host/project.js';
import { unb64 } from '../shared/e2e.js';

const ref = (id, width = 3024, height = 1900) => ({ attachmentId: id, mediaType: 'image/png', bytes: 900_000, width, height, name: `${id}.png` });

test('user and tool-result images become pics; full refs stay off the wire', () => {
  const user = projectEvent({ type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '看这张' }, { type: 'image', attachment: ref('u1', 800, 600) }], source: { kind: 'user' } } });
  assert.deepEqual(user.pics, [{ id: 'u1', w: 800, h: 600 }]);
  assert.equal(user.images, 1);
  assert.equal(user.refs[0].name, 'u1.png');

  const result = projectEvent({ type: 'tool/result', seq: 2, time: 2, data: { callId: 'c1', message: { content: [
    { type: 'text', text: 'Screenshot of macmini' }, { type: 'image', attachment: ref('s1') },
  ] } } });
  assert.equal(result.preview, 'Screenshot of macmini');
  assert.deepEqual(result.pics, [{ id: 's1', w: 3024, h: 1900 }]);
  const wire = JSON.parse(JSON.stringify(result));
  assert.equal(wire.refs, undefined, 'the phone never gets the full attachment reference');
  assert.deepEqual(wire.pics, [{ id: 's1', w: 3024, h: 1900 }]);

  const plain = projectEvent({ type: 'tool/result', seq: 3, data: { callId: 'c2', message: { content: [{ type: 'text', text: 'ok' }] } } });
  assert.equal(plain.pics, undefined);
  assert.equal(plain.refs, undefined);
});

test('fitWithin keeps the aspect ratio and never upscales', () => {
  assert.deepEqual(fitWithin(3024, 1900), { width: 1600, height: 1005 });
  assert.deepEqual(fitWithin(1900, 3024), { width: 1005, height: 1600 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
});

test('phone variant comes from readImageRequest, in chunks that reassemble, cached once', async () => {
  const bytes = Uint8Array.from({ length: CHUNK_BYTES * 2 + 1234 }, (_, i) => (i * 7) % 251);
  const calls = [];
  const images = createImages({ attachments: () => ({
    async readImageRequest(r, target) {
      calls.push({ id: r.attachmentId, target });
      return { data: bytes, mediaType: 'image/jpeg', width: target.width, height: target.height };
    },
  }) });
  const parts = [];
  let offset = 0;
  let r;
  do {
    r = await images.chunk(ref('s1'), offset);
    const piece = unb64(r.data);
    assert.ok(piece.length <= CHUNK_BYTES);
    parts.push(piece);
    offset = r.offset + piece.length;
  } while (!r.done);
  assert.equal(parts.length, 3);
  assert.deepEqual(Buffer.concat(parts), Buffer.from(bytes));
  assert.equal(r.total, bytes.length);
  assert.equal(r.mediaType, 'image/jpeg');
  assert.deepEqual(calls, [{ id: 's1', target: { width: 1600, height: 1005, maxBytes: PHONE_MAX_BYTES } }], 'one variant for all chunks');
  const past = await images.chunk(ref('s1'), bytes.length + 99);
  assert.equal(past.done, true);
  assert.equal(unb64(past.data).length, 0);
});

test('a failed variant is not cached; without readImageRequest the stored image is used if small', async () => {
  let fail = true;
  const images = createImages({ attachments: () => ({
    async readImage(r) {
      if (fail) throw new Error('disk busy');
      return { ref: r, data: new Uint8Array([1, 2, 3]) };
    },
  }) });
  await assert.rejects(images.chunk(ref('a')), /disk busy/);
  fail = false;
  const r = await images.chunk(ref('a'));
  assert.deepEqual([...unb64(r.data)], [1, 2, 3]);
  assert.equal(r.mediaType, 'image/png');

  const huge = createImages({ attachments: () => ({ readImage: async (x) => ({ ref: x, data: new Uint8Array(5 * 1024 * 1024) }) }) });
  await assert.rejects(huge.chunk(ref('b')), /太大/);
  await assert.rejects(createImages({ attachments: () => undefined }).chunk(ref('c')), /不可用/);
});

test('the cache is bounded by total size, oldest first', async () => {
  const produced = [];
  const images = createImages({
    cacheBytes: 250,
    attachments: () => ({ async readImageRequest(r) { produced.push(r.attachmentId); return { data: new Uint8Array(100), mediaType: 'image/png', width: 1, height: 1 }; } }),
  });
  for (const id of ['a', 'b', 'c']) await images.chunk(ref(id));
  assert.equal(images.cached(), 2);
  await images.chunk(ref('c'));
  await images.chunk(ref('a'));
  assert.deepEqual(produced, ['a', 'b', 'c', 'a'], 'a was evicted and made again; c was still cached');
});

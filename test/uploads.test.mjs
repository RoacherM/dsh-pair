import test from 'node:test';
import assert from 'node:assert/strict';
import { createUploads, MAX_IMAGES_PER_MESSAGE, MAX_UPLOAD_BYTES, UPLOAD_TTL_MS } from '../plugin/src/host/uploads.js';
import { b64 } from '../shared/e2e.js';

const bytes = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * seed) % 256);

function upload(store, data, { mediaType = 'image/jpeg', chunk = 1000, name } = {}) {
  let id = null;
  for (let offset = 0; offset < data.length; offset += chunk) {
    const r = store.put({ id, offset, total: data.length, mediaType, name, data: b64(data.subarray(offset, offset + chunk)) });
    id = r.id;
    assert.equal(r.received, Math.min(offset + chunk, data.length));
  }
  return id;
}

test('chunks reassemble into a DSH prompt image part, once', () => {
  const store = createUploads();
  const data = bytes(2500, 7);
  const id = upload(store, data, { name: '截图 1.jpg' });
  const [part] = store.take([id]);
  assert.deepEqual(Object.keys(part).sort(), ['data', 'mediaType', 'name', 'type']);
  assert.equal(part.type, 'image');
  assert.equal(part.mediaType, 'image/jpeg');
  assert.equal(part.name, '截图 1.jpg');
  assert.deepEqual(Buffer.from(part.data, 'base64'), Buffer.from(data));
  assert.throws(() => store.take([id]), /过期/, 'an upload is used by one prompt only');
});

test('incomplete, unknown or out-of-order uploads are refused; take removes nothing on failure', () => {
  const store = createUploads();
  const done = upload(store, bytes(10));
  const first = store.put({ offset: 0, total: 100, mediaType: 'image/png', data: b64(bytes(40)) });
  assert.equal(first.done, false);
  assert.throws(() => store.put({ id: first.id, offset: 0, total: 100, data: b64(bytes(10)) }), /顺序/);
  assert.throws(() => store.take([done, first.id]), /还没上传完/);
  assert.equal(store.take([done]).length, 1, 'the complete one is still there after the failed take');
  assert.throws(() => store.put({ id: 'nope', offset: 0, data: '' }), /过期/);
  assert.throws(() => store.put({ id: first.id, offset: 40, data: b64(bytes(61)) }), /超过/);
  assert.throws(() => store.take([first.id]), /过期/, 'an overflowing upload is discarded');
});

test('type, size, count and total pending are bounded', () => {
  const store = createUploads();
  assert.throws(() => store.put({ offset: 0, total: 10, mediaType: 'image/svg+xml', data: '' }), /不支持/);
  assert.throws(() => store.put({ offset: 0, total: 0, mediaType: 'image/png', data: '' }), /大小无效/);
  assert.throws(() => store.put({ offset: 0, total: MAX_UPLOAD_BYTES + 1, mediaType: 'image/png', data: '' }), /太大/);
  for (let i = 0; i < 3; i++) store.put({ offset: 0, total: MAX_UPLOAD_BYTES, mediaType: 'image/png', data: '' });
  assert.throws(() => store.put({ offset: 0, total: 10, mediaType: 'image/png', data: '' }), /太多/);
  const many = createUploads();
  const ids = Array.from({ length: MAX_IMAGES_PER_MESSAGE + 1 }, () => upload(many, bytes(5)));
  assert.throws(() => many.take(ids), new RegExp(`最多 ${MAX_IMAGES_PER_MESSAGE}`));
});

test('unused uploads expire', () => {
  let t = 1_000;
  const store = createUploads({ now: () => t });
  const id = upload(store, bytes(10));
  t += UPLOAD_TTL_MS + 1;
  assert.throws(() => store.take([id]), /过期/);
  assert.equal(store.size(), 0);
});

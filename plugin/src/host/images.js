/**
 * Images for the phone. Session items carry only small references ({id, w, h}); the phone fetches
 * the bytes with `image.get`, in chunks, over the same E2E channel, so a screenshot never blocks
 * live text and nothing goes to the relay in the clear.
 *
 * The bytes are a phone-sized variant made by DSH's own attachment service (`readImageRequest`:
 * deterministic, verified against the stored object), falling back to the stored image when that
 * is unavailable and small enough. Variants are cached briefly, by total size.
 */
import { b64 } from '../../../shared/e2e.js';

export const PHONE_MAX_EDGE = 1600;
export const PHONE_MAX_BYTES = 600 * 1024;
export const CHUNK_BYTES = 192 * 1024;
const FALLBACK_MAX_BYTES = 4 * 1024 * 1024;

/** Image attachment references in a message's content, in order. */
export function imageRefsOf(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part?.type === 'image' && typeof part.attachment?.attachmentId === 'string')
    .map((part) => part.attachment);
}

/** What the phone gets for one image: enough to lay it out before the bytes arrive. */
export const picOf = (ref) => ({ id: ref.attachmentId, w: ref.width ?? null, h: ref.height ?? null });

/** Largest size within `max` on the long edge, keeping the aspect ratio; never upscales. */
export function fitWithin(width, height, max = PHONE_MAX_EDGE) {
  const w = Number(width) || max;
  const h = Number(height) || max;
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function createImages({ attachments, cacheBytes = 24 * 1024 * 1024 }) {
  const cache = new Map(); // attachmentId → Promise<{ data, mediaType, width, height }>, oldest first
  const sizes = new Map();
  let total = 0;

  function evict() {
    for (const [id] of cache) {
      if (total <= cacheBytes || cache.size <= 1) break;
      total -= sizes.get(id) ?? 0;
      sizes.delete(id);
      cache.delete(id);
    }
  }

  async function produce(ref) {
    const service = attachments();
    if (!service) throw new Error('电脑上的图片服务不可用');
    if (typeof service.readImageRequest === 'function') {
      const target = fitWithin(ref.width, ref.height);
      const variant = await service.readImageRequest(ref, { ...target, maxBytes: PHONE_MAX_BYTES }, AbortSignal.timeout(30_000));
      return { data: variant.data, mediaType: variant.mediaType, width: variant.width, height: variant.height };
    }
    const stored = await service.readImage(ref, AbortSignal.timeout(30_000));
    if (stored.data.length > FALLBACK_MAX_BYTES) throw new Error('图片太大，无法发到手机');
    return { data: stored.data, mediaType: stored.ref.mediaType, width: stored.ref.width, height: stored.ref.height };
  }

  function variant(ref) {
    const id = ref.attachmentId;
    const hit = cache.get(id);
    if (hit) {
      cache.delete(id); // most recently used goes last
      cache.set(id, hit);
      return hit;
    }
    const pending = produce(ref).then((value) => {
      if (cache.get(id) === pending) {
        sizes.set(id, value.data.length);
        total += value.data.length;
        evict();
      }
      return value;
    });
    pending.catch(() => { if (cache.get(id) === pending) cache.delete(id); });
    cache.set(id, pending);
    return pending;
  }

  /** One chunk of the phone variant of `ref`, starting at `offset`. */
  async function chunk(ref, offset = 0) {
    const value = await variant(ref);
    const start = Math.max(0, Math.min(Math.floor(offset) || 0, value.data.length));
    const slice = value.data.subarray(start, start + CHUNK_BYTES);
    const end = start + slice.length;
    return {
      id: ref.attachmentId, mediaType: value.mediaType, width: value.width, height: value.height,
      total: value.data.length, offset: start, data: b64(slice), done: end >= value.data.length,
    };
  }

  return { chunk, cached: () => cache.size };
}

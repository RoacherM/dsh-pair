/**
 * Images the phone sends with a message. The phone downsizes them first, then uploads each in
 * chunks with `upload.put` over the E2E channel; `session.prompt` / `session.create` name the
 * finished uploads, and DSH's own prompt admission validates and stores them (image parts are
 * `{type:'image', mediaType, data}`). Uploads live only in memory, per phone connection, bounded in
 * size and count, and expire when unused.
 */
import { randomUUID } from 'node:crypto';
import { unb64 } from '../../../shared/e2e.js';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_PENDING_BYTES = 24 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 6;
export const UPLOAD_TTL_MS = 10 * 60 * 1000;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function createUploads({ now = () => Date.now() } = {}) {
  const uploads = new Map(); // id → { mediaType, name, total, parts, received, touched }

  const pendingBytes = () => [...uploads.values()].reduce((n, u) => n + u.total, 0);
  function expire() {
    for (const [id, upload] of uploads) if (now() - upload.touched > UPLOAD_TTL_MS) uploads.delete(id);
  }

  /** One chunk. The first chunk (offset 0, no id) opens an upload; chunks must arrive in order. */
  function put(p = {}) {
    expire();
    const data = unb64(String(p.data ?? ''));
    let id = p.id ? String(p.id) : null;
    let upload = id ? uploads.get(id) : undefined;
    if (!upload) {
      if (id) throw new Error('上传已过期，请重新选择图片');
      const mediaType = String(p.mediaType ?? '');
      const total = Number(p.total);
      if (!MEDIA_TYPES.has(mediaType)) throw new Error(`不支持的图片格式 ${mediaType || '（未知）'}`);
      if (!Number.isSafeInteger(total) || total <= 0) throw new Error('图片大小无效');
      if (total > MAX_UPLOAD_BYTES) throw new Error(`图片太大（${Math.round(total / 1024 / 1024)} MB），上限 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
      if (pendingBytes() + total > MAX_PENDING_BYTES) throw new Error('待发送的图片太多，请先发送或移除一些');
      id = randomUUID();
      upload = { mediaType, name: p.name ? String(p.name).slice(0, 120) : undefined, total, parts: [], received: 0, touched: now() };
      uploads.set(id, upload);
    }
    if (Number(p.offset ?? 0) !== upload.received) throw new Error(`上传顺序错误：期望偏移 ${upload.received}`);
    if (upload.received + data.length > upload.total) { uploads.delete(id); throw new Error('上传的数据超过声明的大小'); }
    upload.parts.push(data);
    upload.received += data.length;
    upload.touched = now();
    return { id, received: upload.received, done: upload.received === upload.total };
  }

  /** Complete uploads as DSH prompt parts, removed from the store. Throws before removing anything. */
  function take(ids = []) {
    expire();
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    if (list.length > MAX_IMAGES_PER_MESSAGE) throw new Error(`一条消息最多 ${MAX_IMAGES_PER_MESSAGE} 张图片`);
    const found = list.map((id) => {
      const upload = uploads.get(id);
      if (!upload) throw new Error('有图片上传已过期，请重新选择');
      if (upload.received !== upload.total) throw new Error('有图片还没上传完');
      return [id, upload];
    });
    return found.map(([id, upload]) => {
      uploads.delete(id);
      const bytes = Buffer.concat(upload.parts);
      return { type: 'image', mediaType: upload.mediaType, data: bytes.toString('base64'), ...(upload.name ? { name: upload.name } : {}) };
    });
  }

  function drop(id) { uploads.delete(String(id)); }

  return { put, take, drop, size: () => uploads.size };
}

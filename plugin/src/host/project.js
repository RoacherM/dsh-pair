/**
 * Compact phone view of DSH session events. The phone never renders DSH's own tool cards:
 * a turn becomes user bubbles, assistant Markdown and one-line tool rows.
 *
 * Items:
 *   { k:'user', seq, time, text, images, pics?, source }
 *   { k:'assistant', seq, time, text }
 *   { k:'tool', seq, time, callId, name, summary }
 *   { k:'result', seq, callId, error, preview, pics? } (merged into its tool row by the phone)
 *   { k:'end', seq, time, reason }                    (a turn ended; reason ≠ completed is shown)
 *
 * `pics` are [{id, w, h}]: the phone fetches the bytes with `image.get`. Items leave here with a
 * non-enumerable `refs` (the full attachment references), which phones.js keeps on the desktop.
 */
import { imageRefsOf, picOf } from './images.js';

const MAX_TEXT = 20_000;
const MAX_PICS = 8;

function withPics(item, content) {
  const refs = imageRefsOf(content).slice(0, MAX_PICS);
  if (!refs.length) return item;
  item.pics = refs.map(picOf);
  Object.defineProperty(item, 'refs', { value: refs, enumerable: false });
  return item;
}
const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n\n');
}

const SUMMARY_KEYS = ['description', 'command', 'file_path', 'path', 'pattern', 'query', 'url', 'prompt', 'objective', 'name', 'text'];

export function toolSummary(name, rawArguments) {
  let args = rawArguments;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { return clip(args.replace(/\s+/g, ' '), 140); }
  }
  if (!args || typeof args !== 'object') return '';
  for (const key of SUMMARY_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return clip(value.replace(/\s+/g, ' ').trim(), 140);
  }
  const first = Object.values(args).find((value) => typeof value === 'string');
  return first ? clip(first.replace(/\s+/g, ' '), 140) : '';
}

/** One durable session event → zero or one phone item. */
export function projectEvent(event) {
  const { type, seq, time, data } = event ?? {};
  switch (type) {
    case 'user/message': {
      const content = data?.content ?? [];
      const images = Array.isArray(content) ? content.filter((part) => part?.type === 'image').length : 0;
      const text = clip(textOf(content), MAX_TEXT);
      if (!text && !images) return null;
      return withPics({ k: 'user', seq, time, text, images, source: data?.source?.kind ?? 'user' }, content);
    }
    case 'assistant/message': {
      const text = clip(textOf(data?.message?.content), MAX_TEXT);
      return text.trim() ? { k: 'assistant', seq, time, text } : null;
    }
    case 'tool/call':
      return { k: 'tool', seq, time, callId: data?.callId, name: data?.name ?? 'tool', summary: toolSummary(data?.name, data?.arguments) };
    case 'tool/result': {
      const message = data?.message ?? {};
      const error = data?.error !== undefined || message.isError === true;
      const preview = clip(textOf(message.content).trim(), 400);
      return withPics({ k: 'result', seq, callId: data?.callId ?? message.toolCallId, error, preview }, message.content);
    }
    case 'turn/end':
      return { k: 'end', seq, time, reason: data?.reason?.kind ?? 'completed' };
    default:
      return null;
  }
}

export function projectRecords(records = []) {
  const items = [];
  for (const record of records) {
    if (record?.type !== 'event') continue;
    const item = projectEvent(record.event);
    if (item) items.push(item);
  }
  return items;
}

/** Live assistant text from a compact attempt stream (the snapshot's activeAttempt.stream). */
export function streamText(stream = []) {
  let text = '';
  for (const chunk of stream) if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
  return text;
}

/**
 * The session's running numbers as DSH's own composer shows them, from its projections:
 * `sessionStats` (turns, steps, decode speed), `tokenUsage` (cache hit = cache reads over all billed
 * prompt input) and `contextPressure` (projected tokens over the context window).
 */
export function statsOf(values = {}) {
  const s = values.sessionStats;
  const u = values.tokenUsage;
  const p = values.contextPressure;
  const billed = u ? (u.uncachedInputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0) : 0;
  let cacheHit = null;
  if (billed > 0) {
    // Like DSH: 100 only for a full hit, never rounded up to it.
    cacheHit = u.cacheReadTokens >= billed ? 100 : Math.min(99, Math.round((u.cacheReadTokens / billed) * 100));
  }
  const used = p?.projectedTokens ?? p?.pressureTokens;
  return {
    turns: s?.turns ?? null,
    steps: s?.steps ?? null,
    tps: s?.decodeMs > 0 ? Math.round(s.decodeTokens / (s.decodeMs / 1000)) : null,
    cacheHit,
    context: used !== undefined && p?.contextWindow ? Math.min(100, Math.round((used / p.contextWindow) * 100)) : null,
  };
}

/**
 * Messages waiting in the session's inbox (the `inbox` projection): `next-turn` ones are queued and
 * can be steered in; `next-step` ones are already steering into the running turn.
 */
export function queueOf(inbox) {
  const items = [];
  for (const [target, list] of [['next-turn', inbox?.['next-turn']], ['next-step', inbox?.['next-step']]]) {
    for (const message of Array.isArray(list) ? list : []) {
      if (message?.role !== 'user' || message.source?.kind !== 'user') continue;
      const content = message.content ?? [];
      items.push({
        id: message.id, target, text: clip(textOf(content), 400),
        images: Array.isArray(content) ? content.filter((part) => part?.type === 'image').length : 0,
      });
    }
  }
  return items;
}

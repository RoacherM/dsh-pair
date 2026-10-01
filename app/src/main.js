/**
 * DSH phone app (PWA). Screens: pair → home (pending + sessions) → session (transcript + composer).
 * All desktop traffic goes through Link (E2E encrypted); nothing is sent anywhere else except the
 * Web Push subscription, which the desktop uses to wake this app.
 */
import { marked } from 'marked';
import { b64, boxKeysFromSecret, decodePairLink, newBoxKeys, unb64 } from '../../shared/e2e.js';
import { Link } from './link.js';
import { scanQr } from './scan.js';

// ------------------------------------------------------------------ utilities --
const $ = (sel, root = document) => root.querySelector(sel);
/** replaceChildren that skips null/false (the DOM would print them as text). */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
marked.use({
  gfm: true, breaks: true,
  renderer: {
    html: (token) => escapeHtml(token.raw ?? token.text ?? ''),
    link(token) { const href = /^(https?:|mailto:)/i.test(token.href) ? token.href : '#'; return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${this.parser.parseInline(token.tokens)}</a>`; },
    image: (token) => `<span class="md-img">[图片 ${escapeHtml(token.text || '')}]</span>`,
  },
});
const md = (text) => { try { return marked.parse(text ?? '', { async: false }); } catch { return escapeHtml(text); } };
const base = (p) => (p ? p.replace(/\/+$/, '').split('/').pop() : '');
function ago(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const vibrate = (ms = 10) => { try { navigator.vibrate?.(ms); } catch {} };
function toast(text, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, text);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
}
// ------------------------------------------------------------------ images --
// Items carry {id, w, h}; the bytes come from the desktop in chunks (`image.get`), only once an
// image scrolls into view, two at a time, and stay as object URLs for the most recent ones.
const MAX_CACHED_IMAGES = 60;
const imageUrls = new Map(); // id → Promise<objectURL>
const imageQueue = [];
let imageActive = 0;

function runImageQueue() {
  while (imageActive < 2 && imageQueue.length) {
    const job = imageQueue.shift();
    imageActive++;
    job().finally(() => { imageActive--; runImageQueue(); });
  }
}

async function fetchImage(id) {
  const parts = [];
  let offset = 0;
  let meta;
  for (;;) {
    const r = await app.link.rpc('image.get', { id, offset }, 60_000);
    const bytes = unb64(r.data);
    parts.push(bytes);
    meta = r;
    offset = r.offset + bytes.length;
    if (r.done || !bytes.length) break;
  }
  return URL.createObjectURL(new Blob(parts, { type: meta.mediaType }));
}

function imageUrl(id) {
  const hit = imageUrls.get(id);
  if (hit) { imageUrls.delete(id); imageUrls.set(id, hit); return hit; }
  const pending = new Promise((resolve, reject) => imageQueue.push(() => fetchImage(id).then(resolve, reject)));
  runImageQueue();
  pending.catch(() => imageUrls.get(id) === pending && imageUrls.delete(id));
  imageUrls.set(id, pending);
  while (imageUrls.size > MAX_CACHED_IMAGES) {
    const [oldId, oldUrl] = imageUrls.entries().next().value;
    imageUrls.delete(oldId);
    oldUrl.then((url) => URL.revokeObjectURL(url), () => {});
  }
  return pending;
}

function loadPic(el) {
  if (el.dataset.state === 'loading' || el.dataset.state === 'ok') return;
  el.dataset.state = 'loading';
  imageUrl(el.dataset.id).then(
    (url) => { $('img', el).src = url; el.dataset.state = 'ok'; },
    (e) => { el.dataset.state = 'err'; $('.pic-note', el).textContent = `图片加载失败：${e.message}。点按重试`; },
  );
}

const picObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { picObserver.unobserve(entry.target); loadPic(entry.target); }
  }, { rootMargin: '300px' })
  : null;

function openViewer(src) {
  const close = () => viewer.remove();
  const viewer = h('div', { class: 'viewer', onClick: close }, h('img', { src, alt: '图片' }));
  document.body.append(viewer);
}

function picsNode(pics) {
  if (!Array.isArray(pics) || !pics.length) return null;
  return h('div', { class: 'pics' }, pics.map((pic) => {
    const ratio = pic.w && pic.h ? `${pic.w} / ${pic.h}` : '4 / 3';
    const el = h('div', {
      class: 'pic', 'data-id': pic.id, style: { aspectRatio: ratio },
      onClick: () => {
        if (el.dataset.state === 'ok') openViewer($('img', el).src);
        else if (el.dataset.state === 'err') { el.dataset.state = ''; $('.pic-note', el).textContent = ''; loadPic(el); }
      },
    }, h('img', { alt: '图片' }), h('span', { class: 'pic-note' }));
    if (picObserver) picObserver.observe(el); else loadPic(el);
    return el;
  }));
}

const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  term: '<svg viewBox="0 0 24 24"><path d="M5 7l5 5-5 5M12 17h7"/></svg>',
  scan: '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 12h10"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8.5 8.5"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4M6 12v6a2 2 0 002 2h8a2 2 0 002-2v-6"/></svg>',
};

// ------------------------------------------------------------------ sending images --
// Picked images are downsized here (long edge 2048, JPEG; HEIC from the camera becomes JPEG too),
// uploaded in chunks when the message is sent, and named in session.prompt.
const MAX_EDGE = 2048;
const UPLOAD_CHUNK = 192 * 1024;
const MAX_DRAFT_IMAGES = 6;

async function prepareImage(file) {
  const small = file.size <= 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type);
  if (file.type === 'image/gif' && file.size <= 8 * 1024 * 1024) return file; // keep animation
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { if (small) return file; throw new Error(`无法读取图片 ${file.name || ''}`); }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (small && scale === 1) { bitmap.close?.(); return file; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('图片压缩失败');
  return blob;
}

async function uploadImage(blob, name, onProgress) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let id = null;
  let offset = 0;
  do {
    const part = bytes.subarray(offset, offset + UPLOAD_CHUNK);
    const r = await app.link.rpc('upload.put', { id, offset, total: bytes.length, mediaType: blob.type, name, data: b64(part) }, 60_000);
    id = r.id;
    offset = r.received;
    onProgress(offset);
  } while (offset < bytes.length);
  return id;
}

async function addDraftImages(files) {
  const s = app.session;
  if (!s) return;
  s.drafts ??= [];
  for (const file of files) {
    if (s.drafts.length >= MAX_DRAFT_IMAGES) { toast(`一条消息最多 ${MAX_DRAFT_IMAGES} 张图片`, 'err'); break; }
    try {
      const blob = await prepareImage(file);
      s.drafts.push({ blob, url: URL.createObjectURL(blob), name: (file.name || 'image').replace(/\.\w+$/, '') + (blob.type === 'image/jpeg' ? '.jpg' : '') });
    } catch (e) { toast(e.message, 'err'); }
    renderDrafts();
  }
}

function clearDrafts() {
  for (const d of app.session?.drafts ?? []) URL.revokeObjectURL(d.url);
  if (app.session) app.session.drafts = [];
  renderDrafts();
}

function renderDrafts() {
  const el = $('#drafts');
  if (!el) return;
  const drafts = app.session?.drafts ?? [];
  fill(el, drafts.map((d, i) => h('div', { class: 'draft' },
    h('img', { src: d.url, alt: '待发送的图片' }),
    app.session.sending ? null : h('button', { class: 'draft-x', 'aria-label': '移除', onClick: () => { URL.revokeObjectURL(d.url); drafts.splice(i, 1); renderDrafts(); } }, icon('x')))));
  renderSendState();
}
const icon = (name) => h('span', { class: 'ico', html: ICON[name] });

// ------------------------------------------------------------------ storage ----
const STORE_KEY = 'dsh-pair/v1';
const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; } };
const save = (value) => localStorage.setItem(STORE_KEY, JSON.stringify(value));
function deviceKeys() {
  const store = load();
  if (!store.deviceSecret) { store.deviceSecret = b64(newBoxKeys().secretKey); save(store); }
  return boxKeysFromSecret(unb64(store.deviceSecret));
}
const currentDesktop = () => load().desktop ?? null;
function defaultDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android 手机';
  return '浏览器';
}

// ------------------------------------------------------------------ app state --
const app = {
  link: null,
  info: null,
  sessions: [],
  workspaces: [],
  pending: [],
  away: { on: false },
  view: { name: 'home' },
  session: null, // { id, title, items, live, running, hasMore, firstSeq, tools: Map }
};
const root = () => $('#app');

function connect(desktop, pair) {
  app.link?.close();
  const link = new Link({ relay: desktop.relay, desktopId: desktop.id, desktopKey: desktop.k, deviceKeys: deviceKeys(), pair });
  app.link = link;
  link.addEventListener('status', () => renderStatus());
  link.addEventListener('ready', async (e) => {
    app.info = e.detail;
    app.pending = e.detail.pending ?? [];
    app.away = e.detail.away ?? { on: false };
    if (e.detail.paired) {
      const store = load();
      store.desktop = { ...desktop, name: e.detail.desktopName, deviceId: e.detail.deviceId, pairedAt: Date.now() };
      save(store);
      toast('配对成功', 'ok');
      vibrate(30);
      app.view = { name: 'home' };
    }
    await refreshSessions();
    if (app.view.name === 'session') openSession(app.view.id, { silent: true });
    else render();
    maybeResubscribePush();
  });
  link.addEventListener('ev', (e) => onEvent(e.detail));
  link.addEventListener('fatal', (e) => onFatal(e.detail));
  link.addEventListener('confirm', (e) => { app.view = { ...app.view, name: 'pairing', sas: e.detail.sas, desktopName: e.detail.desktopName }; render(); });
  return link;
}

function onFatal({ code, message }) {
  if (code === 'unknown-device' || code === 'revoked') {
    const store = load(); delete store.desktop; save(store);
    app.view = { name: 'welcome', error: message };
  } else if (app.view.name === 'pairing') {
    app.view = { name: 'welcome', error: message };
  } else {
    toast(message, 'err');
  }
  render();
}

async function refreshSessions() {
  try {
    const r = await app.link.rpc('sessions.list');
    app.sessions = r.sessions; app.workspaces = r.workspaces;
  } catch (e) { toast(e.message, 'err'); }
  if (app.view.name === 'home') render();
}

function onEvent(msg) {
  switch (msg.ev) {
    case 'status': {
      const s = app.sessions.find((x) => x.id === msg.sessionId);
      if (s) { s.running = msg.running; s.updatedAt = Date.now(); }
      else if (msg.running) refreshSessions();
      if (app.session?.id === msg.sessionId) { app.session.running = msg.running; if (!msg.running) app.session.live = ''; renderSessionChrome(); renderLive(); }
      if (app.view.name === 'home') renderHomeList();
      break;
    }
    case 'pending':
      app.pending = msg.pending; app.away = msg.away ?? app.away;
      if (msg.pending.length) vibrate(20);
      renderPending(); renderAway();
      break;
    case 'items':
      if (app.session?.id === msg.sessionId) { for (const item of msg.items) addItem(item, true); }
      break;
    case 'live':
      if (app.session?.id === msg.sessionId) { app.session.live = msg.text; renderLive(); }
      break;
    case 'title': {
      const s = app.sessions.find((x) => x.id === msg.sessionId); if (s) s.title = msg.title;
      if (app.session?.id === msg.sessionId) { app.session.title = msg.title; renderSessionChrome(); }
      break;
    }
    case 'stats':
      if (app.session?.id === msg.sessionId) { app.session.stats = msg.stats; app.session.queue = msg.queue ?? []; renderStats(); renderQueue(); }
      break;
    case 'model':
      if (app.session?.id === msg.sessionId) { app.session.model = msg.model; renderSessionChrome(); }
      break;
    case 'session-error':
      if (app.session?.id === msg.sessionId) toast(`出错：${msg.message}`, 'err');
      break;
    case 'watch-ended':
      if (app.session?.id === msg.sessionId) setTimeout(() => app.view.name === 'session' && openSession(msg.sessionId, { silent: true }), 1500);
      break;
  }
}

// ------------------------------------------------------------------ rendering --
function render() {
  const el = root();
  fill(el);
  const desktop = currentDesktop();
  if (app.view.name === 'pairing') return el.append(renderPairing());
  if (!desktop || app.view.name === 'welcome') return el.append(renderWelcome());
  if (app.view.name === 'session') return el.append(renderSession());
  if (app.view.name === 'settings') return el.append(renderSettings());
  if (app.view.name === 'new') return el.append(renderNew());
  el.append(renderHome());
}

function statusLine() {
  const st = app.link?.status;
  const map = { ready: ['ok', '已连接'], connecting: ['busy', '连接中…'], offline: ['err', '电脑离线'], error: ['err', '连接失败'] };
  const [cls, text] = map[st] ?? ['busy', '连接中…'];
  return h('span', { class: 'status', id: 'status' }, h('span', { class: `dot ${cls}` }), text);
}
function renderStatus() {
  const el = $('#status');
  if (el) el.replaceWith(statusLine());
  const banner = $('#offline');
  if (banner) banner.hidden = app.link?.status !== 'offline';
}

// ---- welcome / pairing
function renderWelcome() {
  const hash = location.hash.includes('p=') ? location.hash : null;
  const wrap = h('main', { class: 'screen welcome' },
    h('div', { class: 'hero' },
      h('div', { class: 'logo' }, 'DSH'),
      h('h1', {}, 'DSH 远程控制'),
      h('p', {}, '在这台设备上操作电脑里的 DSH：看会话、发消息、审批，有事时推送通知。内容端到端加密。')),
    app.view.error ? h('div', { class: 'note err' }, app.view.error) : null,
  );
  if (hash) {
    wrap.append(
      h('div', { class: 'card' },
        h('b', {}, '准备配对'),
        !standalone() && isIOS() ? h('p', { class: 'muted' }, '提示：在 Safari 里配对后也能用，但收不到通知。想收通知：点「分享 → 添加到主屏幕」，从主屏幕打开 DSH 后再扫一次码。') : null,
        h('label', { class: 'field' }, h('span', {}, '这台设备的名字'), h('input', { id: 'devname', value: defaultDeviceName(), maxlength: 40 })),
        h('button', { class: 'btn primary block', onClick: () => startPairing(hash, $('#devname').value) }, '开始配对')));
  } else {
    wrap.append(
      h('div', { class: 'card steps' },
        h('ol', {},
          h('li', {}, '在电脑的 DSH 左侧栏打开「远程控制」，点「配对新设备」。'),
          h('li', {}, isIOS() && !standalone() ? '建议先点 Safari 的「分享 → 添加到主屏幕」，之后从主屏幕打开，才能收到通知。' : '点下面的按钮扫描电脑上的二维码。'),
          h('li', {}, '在电脑上确认两边的 6 位核对码一致。'))),
      h('button', { class: 'btn primary block', onClick: scanAndPair }, icon('scan'), '扫描二维码'),
      h('details', { class: 'paste' }, h('summary', {}, '或粘贴配对链接'),
        h('textarea', { id: 'pastelink', rows: 3, placeholder: 'https://…/#p=…' }),
        h('button', { class: 'btn block', onClick: () => startPairing($('#pastelink').value, defaultDeviceName()) }, '使用链接配对')));
  }
  return wrap;
}

async function scanAndPair() {
  try {
    const text = await scanQr();
    if (text) startPairing(text, defaultDeviceName());
  } catch (e) { toast(e.message, 'err'); }
}

function startPairing(linkText, name) {
  let offer;
  try { offer = decodePairLink(linkText.trim()); } catch (e) { toast('不是有效的配对链接', 'err'); return; }
  if (offer.e && Date.now() > offer.e) { app.view = { name: 'welcome', error: '二维码已过期，请在电脑上重新生成' }; render(); return; }
  history.replaceState(null, '', location.pathname);
  const desktop = { id: offer.i, relay: offer.r, k: offer.k, name: offer.n };
  app.view = { name: 'pairing', desktopName: offer.n };
  render();
  connect(desktop, { token: offer.t, name: name || defaultDeviceName() });
}

function renderPairing() {
  const { sas, desktopName } = app.view;
  return h('main', { class: 'screen welcome' },
    h('div', { class: 'hero' }, h('div', { class: 'logo' }, 'DSH'), h('h1', {}, sas ? '在电脑上确认' : '正在连接…'),
      h('p', {}, sas ? `请确认「${desktopName ?? '电脑'}」上显示的核对码与下面一致，然后在电脑上点「允许连接」。` : `正在连接「${desktopName ?? '电脑'}」`)),
    sas ? h('div', { class: 'sas' }, `${sas.slice(0, 3)} ${sas.slice(3)}`) : h('div', { class: 'spinner' }),
    h('button', { class: 'btn block ghost', onClick: () => { app.link?.close(); app.view = { name: 'welcome' }; render(); } }, '取消'));
}

// ---- home
function renderHome() {
  const desktop = currentDesktop();
  const screen = h('main', { class: 'screen home' },
    h('header', { class: 'bar' },
      h('div', { class: 'bar-title' }, h('b', {}, desktop?.name ?? 'DSH'), statusLine()),
      h('button', { class: 'icon-btn', 'aria-label': '设置', onClick: () => { app.view = { name: 'settings' }; render(); } }, icon('gear'))),
    h('div', { class: 'banner', id: 'offline', hidden: app.link?.status !== 'offline' }, '电脑离线或 DSH 未运行。电脑恢复后会自动重连。'),
    h('div', { id: 'away' }),
    h('div', { id: 'pending' }),
    h('div', { id: 'sessions', class: 'sessions' }),
    h('button', { class: 'fab', 'aria-label': '新会话', onClick: () => { app.view = { name: 'new' }; render(); } }, icon('plus')));
  queueMicrotask(() => { renderAway(); renderPending(); renderHomeList(); });
  return screen;
}

function renderAway() {
  const el = $('#away');
  if (!el) return;
  const on = app.away?.on;
  fill(el, h('button', { class: `away ${on ? 'on' : ''}`, onClick: toggleAway },
    h('span', { class: 'away-text' }, h('b', {}, on ? '离开模式已开启' : '离开模式'), h('span', {}, on ? '审批和提问会发到这台设备' : '开启后，会话需要审批时发到这台设备')),
    h('span', { class: `switch ${on ? 'on' : ''}` })));
}
async function toggleAway() {
  try { const r = await app.link.rpc('away.set', { on: !app.away?.on }); app.away = r.away; vibrate(); renderAway(); } catch (e) { toast(e.message, 'err'); }
}

function renderPending() {
  const el = $('#pending');
  if (!el) return;
  fill(el, ...app.pending.map((item) => pendingCard(item)));
}

function pendingCard(item) {
  const title = item.sessionTitle ?? '会话';
  if (item.kind === 'approval') {
    return h('div', { class: 'pcard' },
      h('div', { class: 'pcard-head' }, h('span', { class: 'tag warn' }, '需要审批'), h('span', { class: 'muted' }, title)),
      h('div', { class: 'pcard-body' }, h('code', {}, item.toolName), item.reason ? h('p', {}, item.reason) : null),
      h('div', { class: 'pcard-actions' },
        h('button', { class: 'btn danger', onClick: () => answer(item.id, { decision: 'reject' }) }, '拒绝'),
        h('button', { class: 'btn primary', onClick: () => answer(item.id, { decision: 'allow' }) }, '允许一次')),
      h('button', { class: 'link-btn', onClick: () => openSession(item.sessionId) }, '查看会话 ›'));
  }
  const answers = new Map(item.questions.map((q) => [q.id, { id: q.id, selected: [], custom: '' }]));
  return h('div', { class: 'pcard' },
    h('div', { class: 'pcard-head' }, h('span', { class: 'tag' }, '需要回答'), h('span', { class: 'muted' }, title)),
    ...item.questions.map((q) => {
      const a = answers.get(q.id);
      const opts = h('div', { class: 'opts' }, ...(q.options ?? []).map((o) => {
        const b = h('button', { class: 'opt', onClick: () => {
          if (q.multiSelect) { a.selected.includes(o.label) ? a.selected.splice(a.selected.indexOf(o.label), 1) : a.selected.push(o.label); b.classList.toggle('on'); }
          else { a.selected = [o.label]; for (const x of opts.children) x.classList.remove('on'); b.classList.add('on'); }
        } }, h('b', {}, o.label), o.description ? h('span', {}, o.description) : null);
        return b;
      }));
      return h('div', { class: 'q' },
        q.header ? h('div', { class: 'muted small' }, q.header) : null,
        h('p', { class: 'q-text' }, q.question),
        q.detail ? h('p', { class: 'muted small' }, q.detail) : null,
        opts,
        h('input', { class: 'input', placeholder: q.options?.length ? '或输入其他回答' : '输入回答', onInput: (e) => { a.custom = e.target.value; } }));
    }),
    h('div', { class: 'pcard-actions' }, h('button', { class: 'btn primary', onClick: () => answer(item.id, { answers: [...answers.values()] }) }, '提交回答')));
}

async function answer(id, payload) {
  try { await app.link.rpc('pending.answer', { id, ...payload }); vibrate(15); app.pending = app.pending.filter((x) => x.id !== id); renderPending(); }
  catch (e) { toast(e.message, 'err'); }
}

function renderHomeList() {
  const el = $('#sessions');
  if (!el) return;
  if (!app.sessions.length) {
    fill(el, h('div', { class: 'empty' }, app.link?.status === 'ready' ? '还没有会话。点右下角 + 开始一个。' : '连接后显示会话'));
    return;
  }
  const running = app.sessions.filter((s) => s.running);
  const rest = app.sessions.filter((s) => !s.running);
  const row = (s) => h('button', { class: 'srow', onClick: () => openSession(s.id) },
    h('span', { class: `dot ${s.running ? 'busy' : ''}` }),
    h('span', { class: 'srow-main' }, h('b', {}, s.title || '未命名会话'), h('span', {}, [base(s.cwd), ago(s.updatedAt)].filter(Boolean).join(' · '))),
    h('span', { class: 'chev' }, '›'));
  fill(el, 
    running.length ? h('div', { class: 'group' }, h('div', { class: 'group-head' }, '运行中'), ...running.map(row)) : null,
    h('div', { class: 'group' }, h('div', { class: 'group-head' }, '最近'), ...rest.slice(0, 60).map(row)),
  );
  }

// ---- new session
function renderNew() {
  const spaces = app.workspaces.length ? app.workspaces : [...new Set(app.sessions.map((s) => s.cwd).filter(Boolean))].map((p) => ({ path: p, title: base(p) }));
  const pre = Math.max(0, spaces.findIndex((w) => app.view.cwd && w.path === app.view.cwd));
  const select = h('select', { class: 'input', id: 'ws' }, ...spaces.map((w, i) => h('option', { value: i, selected: i === pre }, w.title || base(w.path))));
  const back = () => { if (app.view.from) openSession(app.view.from); else { app.view = { name: 'home' }; render(); } };
  const text = h('textarea', { class: 'input', rows: 6, placeholder: '要让 Agent 做什么？' });
  const go = async (btn) => {
    const w = spaces[Number(select.value)];
    if (!text.value.trim()) return;
    btn.disabled = true;
    try {
      const r = await app.link.rpc('session.create', { workspaceId: w?.id, cwd: w?.id ? undefined : w?.path, text: text.value, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, 60_000);
      await refreshSessions();
      openSession(r.sessionId);
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  };
  const btn = h('button', { class: 'btn primary block', onClick: () => go(btn) }, '开始');
  return h('main', { class: 'screen form' },
    h('header', { class: 'bar' }, h('button', { class: 'icon-btn', onClick: back }, icon('back')), h('div', { class: 'bar-title' }, h('b', {}, '新会话'))),
    h('label', { class: 'field' }, h('span', {}, '工作区'), select),
    h('label', { class: 'field' }, h('span', {}, '第一条消息'), text),
    btn);
}

// ---- session
async function openSession(id, { silent = false } = {}) {
  const known = app.sessions.find((s) => s.id === id);
  if (!silent || app.session?.id !== id) {
    app.session = { id, title: known?.title ?? '', running: known?.running ?? false, items: [], tools: new Map(), live: '', loading: true, hasMore: false };
  }
  app.view = { name: 'session', id };
  render();
  try {
    const r = await app.link.rpc('session.watch', { sessionId: id });
    if (app.session?.id !== id) return;
    Object.assign(app.session, { title: r.title ?? app.session.title, cwd: r.cwd, model: r.model ?? null, stats: r.stats ?? null, queue: r.queue ?? [], hasMore: r.hasMore, firstSeq: r.firstSeq, live: r.live, loading: false, items: [], tools: new Map() });
    loadModels();
    $('#log') && fill($('#log'));
    for (const item of r.items) addItem(item, false);
    renderSessionChrome(); renderLive(); renderMore();
    scrollBottom(true);
  } catch (e) {
    if (app.session) app.session.loading = false;
    toast(e.message, 'err');
    renderSessionChrome();
  }
}

function leaveSession() {
  app.link?.rpc('session.unwatch').catch(() => {});
  clearDrafts();
  app.session = null; app.view = { name: 'home' }; render(); refreshSessions();
}

function renderSession() {
  const s = app.session;
  const input = h('textarea', { id: 'composer', rows: 1, placeholder: '发消息…', onInput: (e) => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; renderSendState(); } });
  return h('main', { class: 'screen session' },
    h('header', { class: 'bar sbar' },
      h('button', { class: 'round-btn', 'aria-label': '返回', onClick: leaveSession }, icon('back')),
      h('div', { class: 'bar-center', id: 'stitle' }),
      h('button', { class: 'round-btn', 'aria-label': '更多', onClick: openSessionMenu }, icon('dots'))),
    h('div', { class: 'banner', id: 'offline', hidden: app.link?.status !== 'offline' }, '电脑离线，恢复后自动重连。'),
    h('div', { class: 'log-wrap', id: 'logwrap' },
      h('div', { id: 'more' }),
      h('div', { class: 'log', id: 'log' }, s?.loading ? h('div', { class: 'spinner' }) : null),
      h('div', { id: 'live' })),
    h('div', { id: 'pending', class: 'pending-inline' }),
    h('footer', { class: 'composer' },
      h('div', { class: 'queue', id: 'queue' }),
      h('div', { class: 'stats', id: 'stats' }),
      h('div', { class: 'composer-card' },
        h('div', { class: 'drafts', id: 'drafts' }),
        input,
        h('div', { class: 'composer-bar' },
          h('label', { class: 'round-btn sm', 'aria-label': '添加图片' }, icon('plus'),
            h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onChange: (e) => { addDraftImages([...e.target.files]); e.target.value = ''; } })),
          h('button', { class: 'pill', id: 'model', hidden: true, onClick: openModelPicker }),
          h('span', { class: 'grow' }),
          h('button', { class: 'send', id: 'send', 'aria-label': '发送', onClick: () => ($('#send')?.dataset.stop ? stopSession() : sendMessage()) }, icon('send'))))));
}

/** Send while there is something to send; while a turn runs and the box is empty it is the stop button. */
function renderSendState() {
  const s = app.session;
  const send = $('#send');
  if (!s || !send) return;
  const has = Boolean($('#composer')?.value.trim()) || (s.drafts?.length ?? 0) > 0;
  const stop = s.running && !has && !s.sending;
  if (stop) send.dataset.stop = '1'; else delete send.dataset.stop;
  send.setAttribute('aria-label', stop ? '停止' : '发送');
  fill(send, icon(stop ? 'stop' : 'send'));
  send.disabled = !stop && (!has || Boolean(s.sending));
}

function renderSessionChrome() {
  const s = app.session;
  const t = $('#stitle');
  if (!s || !t) return;
  fill(t, h('b', {}, s.title || '会话'), h('span', { class: 'status' }, s.running ? h('span', { class: 'dot busy' }) : null, s.running ? '运行中' : base(s.cwd) || '空闲'));
  renderStats(); renderQueue();
  const model = $('#model');
  if (model) {
    const label = modelLabel(s.model ?? app.models?.default);
    model.hidden = !label || app.modelsFailed;
    if (label) fill(model, h('span', {}, label.name), label.effort ? h('small', {}, ` ${label.effort}`) : null);
  }
  renderSendState();
  renderPending();
  const pend = $('#pending');
  if (pend) for (const card of [...pend.children]) card.hidden = false;
}

// ---- stats and queue (as in DSH's composer)
/** "12 轮 48 步 · 缓存 93% · 上下文 41% · 52 tok/s" — only the numbers DSH has. */
function renderStats() {
  const el = $('#stats');
  const st = app.session?.stats;
  if (!el) return;
  const parts = [];
  if (st?.turns) parts.push(`${st.turns} 轮 ${st.steps ?? 0} 步`);
  if (st?.cacheHit !== null && st?.cacheHit !== undefined) parts.push(`缓存 ${st.cacheHit}%`);
  if (st?.context !== null && st?.context !== undefined) parts.push(h('span', { class: st.context >= 80 ? 'warn' : '' }, `上下文 ${st.context}%`));
  if (st?.tps) parts.push(`${st.tps} tok/s`);
  fill(el, parts.flatMap((part, i) => (i ? [h('i', {}, '·'), part] : [part])));
}

/** Messages sent while the agent works wait here; each can be steered into the running turn. */
function renderQueue() {
  const el = $('#queue');
  const s = app.session;
  if (!el || !s) return;
  fill(el, (s.queue ?? []).map((q) => h('div', { class: 'qitem' },
    h('span', { class: 'qtext' }, q.text || `[${q.images} 张图片]`, q.text && q.images ? h('small', {}, ` +${q.images} 图`) : null),
    q.target === 'next-step' ? h('span', { class: 'qstate' }, '插话中')
      : h('button', { class: 'qact', disabled: !s.running, onClick: () => queueAction('queue.steer', q.id) }, '插话'),
    q.target === 'next-step' ? null : h('button', { class: 'qact x', 'aria-label': '删除排队消息', onClick: () => queueAction('queue.remove', q.id) }, icon('x')))));
}

async function queueAction(method, itemId) {
  const s = app.session;
  if (!s) return;
  try { await app.link.rpc(method, { sessionId: s.id, itemId }); vibrate(); }
  catch (e) { toast(method === 'queue.steer' ? `插话失败：${e.message}` : e.message, 'err'); }
}

// ---- sheets, models, copying
function openSheet(title, build) {
  const close = () => { bg.classList.remove('show'); setTimeout(() => bg.remove(), 220); };
  const bg = h('div', { class: 'sheet-bg', onClick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'sheet' }, h('div', { class: 'sheet-grab' }), title ? h('div', { class: 'sheet-title' }, title) : null, build(close)));
  document.body.append(bg);
  requestAnimationFrame(() => bg.classList.add('show'));
}

/** A small menu under the "…" button, like the Claude app's. */
function openSessionMenu() {
  const s = app.session;
  if (!s) return;
  const close = () => bg.remove();
  const item = (ico, label, fn, cls = '') => h('button', { class: `pop-item ${cls}`, onClick: () => { close(); fn(); } }, icon(ico), h('span', {}, label));
  const bg = h('div', { class: 'pop-bg', onClick: (e) => { if (e.target === bg) close(); } },
    h('div', { class: 'popover' },
      item('plus', '新会话', () => newSessionFrom(s)),
      item('refresh', '刷新', () => openSession(s.id, { silent: true })),
      s.running ? h('div', { class: 'pop-sep' }) : null,
      s.running ? item('stop', '停止运行', stopSession, 'danger') : null));
  document.body.append(bg);
}

/** New session in the same workspace as `s`; Back returns to `s`. */
function newSessionFrom(s) {
  app.link?.rpc('session.unwatch').catch(() => {});
  clearDrafts();
  app.session = null;
  app.view = { name: 'new', from: s.id, cwd: s.cwd };
  render();
}

/** "Claude Opus 5.5 · Claude Code" → "Opus 5.5": the pill shows the model, not its route. */
const shortModelName = (name) => String(name).split(' · ')[0].replace(/^Claude\s+/, '');

async function loadModels() {
  // An older desktop plugin has no model picker; ask again a minute later (DSH may have restarted).
  if (app.models || app.modelsLoading || (app.modelsFailed && Date.now() - app.modelsFailed < 60_000)) return;
  app.modelsLoading = true;
  try { app.models = await app.link.rpc('models.list'); app.modelsFailed = 0; }
  catch { app.modelsFailed = Date.now(); }
  finally { app.modelsLoading = false; renderSessionChrome(); }
}

/** {name, effort} for a selection {provider, model, reasoningEffort}, from the desktop's catalog. */
function modelLabel(sel) {
  if (!sel?.model) return null;
  const model = app.models?.groups?.find((g) => g.id === sel.provider)?.models.find((m) => m.id === sel.model)
    ?? app.models?.groups?.flatMap((g) => g.models).find((m) => m.id === sel.model);
  const effortId = sel.reasoningEffort ?? model?.defaultEffort;
  const effort = model?.efforts?.find((e) => e.id === effortId)?.name ?? effortId ?? '';
  return { name: shortModelName(model?.name ?? sel.model), effort };
}

function openModelPicker() {
  const s = app.session;
  if (!s || !app.models) return;
  const cur = s.model ?? app.models.default ?? {};
  const choose = async (close, provider, model, reasoningEffort) => {
    close();
    try {
      const r = await app.link.rpc('session.model', { sessionId: s.id, provider, model, reasoningEffort });
      if (app.session === s) { s.model = r.model; renderSessionChrome(); }
      vibrate();
    } catch (e) { toast(e.message, 'err'); }
  };
  openSheet('模型', (close) => h('div', { class: 'sheet-list models' }, app.models.groups.map((g) => [
    h('div', { class: 'sheet-group' }, g.name),
    g.models.map((m) => {
      const on = cur.provider === g.id && cur.model === m.id;
      const curEffort = cur.reasoningEffort ?? m.defaultEffort;
      return h('div', { class: `model-row ${on ? 'on' : ''}` },
        h('button', { class: 'model-name', onClick: () => choose(close, g.id, m.id, on ? cur.reasoningEffort : undefined) },
          h('span', {}, shortModelName(m.name)), on ? icon('check') : null),
        m.efforts.length ? h('div', { class: 'efforts' }, m.efforts.map((e) => h('button', {
          class: `effort ${on && curEffort === e.id ? 'on' : ''}`, onClick: () => choose(close, g.id, m.id, e.id),
        }, e.name))) : null);
    }),
  ])));
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const area = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    area.value = text; document.body.append(area); area.select();
    try { document.execCommand('copy'); } finally { area.remove(); }
  }
  vibrate(); toast('已复制', 'ok');
}

function onLongPress(el, fn) {
  let timer;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('touchstart', () => { timer = setTimeout(fn, 480); }, { passive: true });
  for (const ev of ['touchend', 'touchmove', 'touchcancel']) el.addEventListener(ev, cancel, { passive: true });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); fn(); });
}

/** A rendered reply: copy buttons on its code blocks, and a row of actions under it. */
function replyNode(text) {
  const body = h('div', { class: 'md', html: md(text) });
  for (const pre of body.querySelectorAll('pre')) {
    const wrap = h('div', { class: 'codewrap' });
    pre.replaceWith(wrap);
    wrap.append(pre, h('button', { class: 'code-copy', 'aria-label': '复制代码', onClick: () => copyText(pre.innerText) }, icon('copy')));
  }
  const share = navigator.share ? h('button', { class: 'act-btn', 'aria-label': '分享', onClick: () => navigator.share({ text }).catch(() => {}) }, icon('share')) : null;
  return h('div', { class: 'msg assistant' }, body,
    h('div', { class: 'msg-actions' }, h('button', { class: 'act-btn', 'aria-label': '复制', onClick: () => copyText(text) }, icon('copy')), share));
}

function renderMore() {
  const el = $('#more');
  if (!el || !app.session) return;
  fill(el, app.session.hasMore ? h('button', { class: 'link-btn center', onClick: loadOlder }, '加载更早的消息') : null);
}

async function loadOlder() {
  const s = app.session;
  if (!s?.firstSeq) return;
  const wrap = $('#logwrap');
  const before = wrap.scrollHeight;
  try {
    const r = await app.link.rpc('session.older', { sessionId: s.id, beforeSeq: s.firstSeq });
    s.hasMore = r.hasMore; s.firstSeq = r.firstSeq ?? s.firstSeq;
    const frag = document.createDocumentFragment();
    for (const item of r.items) { const node = itemNode(item); if (node) appendNode(frag, node); }
    $('#log').prepend(frag);
    for (const item of r.items) if (item.k === 'result') applyResult(item);
    renderMore();
    wrap.scrollTop += wrap.scrollHeight - before;
  } catch (e) { toast(e.message, 'err'); }
}

function itemNode(item) {
  const s = app.session;
  switch (item.k) {
    case 'user': {
      const bubble = h('div', { class: 'bubble' }, item.text,
        item.pics?.length ? picsNode(item.pics) : item.images ? h('span', { class: 'muted small' }, ` [${item.images} 张图片]`) : null);
      if (item.text) onLongPress(bubble, () => copyText(item.text)); // long press copies your message
      return h('div', { class: 'msg user' }, bubble,
        item.source && item.source !== 'user' ? h('div', { class: 'src' }, item.source === 'schedule' ? '定时任务' : item.source) : null);
    }
    case 'assistant':
      return replyNode(item.text);
    case 'tool': {
      const node = h('details', { class: 'tool', 'data-call': item.callId },
        h('summary', {}, h('span', { class: 'tool-state' }), h('b', {}, item.name), h('span', { class: 'tool-sum' }, item.summary)),
        h('pre', { class: 'tool-out' }, '…'));
      s?.tools.set(item.callId, node);
      return node;
    }
    case 'end':
      return item.reason === 'completed' ? h('div', { class: 'turn-end' }) : h('div', { class: 'turn-end note-line' }, item.reason === 'aborted' ? '已停止' : `回合结束：${item.reason}`);
    default:
      return null;
  }
}

function applyResult(item) {
  const node = app.session?.tools.get(item.callId) ?? $(`.tool[data-call="${CSS.escape(item.callId ?? '')}"]`);
  if (!node) return;
  node.classList.add(item.error ? 'err' : 'done');
  $('.tool-out', node).textContent = item.preview || (item.error ? '失败' : '（无输出）');
  const group = node.closest('.steps');
  if (group) updateSteps(group);
  // Images of the result (screenshots) show under the steps, visible without opening them.
  if (item.pics?.length && !node.dataset.pics) {
    node.dataset.pics = '1';
    (group ?? node).after(picsNode(item.pics));
  }
}

/** Consecutive tool calls fold into one row: "4 个步骤 · <latest>", opened on tap. */
function appendNode(parent, node) {
  if (!node.classList?.contains('tool')) { parent.append(node); return; }
  let group = parent.lastElementChild;
  if (!group?.classList.contains('steps')) {
    group = h('details', { class: 'steps' },
      h('summary', {}, h('span', { class: 'tool-state' }), h('b', { class: 'steps-label' }), h('span', { class: 'tool-sum' })),
      h('div', { class: 'steps-list' }));
    parent.append(group);
  }
  $('.steps-list', group).append(node);
  updateSteps(group);
}

function updateSteps(group) {
  const tools = [...group.querySelectorAll('.steps-list > .tool')];
  const last = tools.at(-1);
  $('.steps-label', group).textContent = tools.length === 1 ? $('summary b', last).textContent : `${tools.length} 个步骤`;
  $(':scope > summary .tool-sum', group).textContent = $('.tool-sum', last).textContent;
  const failed = tools.some((t) => t.classList.contains('err'));
  const running = tools.some((t) => !t.classList.contains('done') && !t.classList.contains('err'));
  group.classList.toggle('err', failed && !running);
  group.classList.toggle('done', !failed && !running);
}

function addItem(item, live) {
  const log = $('#log');
  if (!log || !app.session) return;
  if (live && item.seq && app.session.lastSeq && item.seq <= app.session.lastSeq) return;
  if (item.seq) app.session.lastSeq = Math.max(app.session.lastSeq ?? 0, item.seq);
  log.querySelector(':scope > .spinner')?.remove();
  if (item.k === 'result') { applyResult(item); return; }
  if (item.k === 'assistant') app.session.lastReply = item.text;
  if (item.k === 'assistant' && live) { app.session.live = ''; renderLive(); }
  const near = isNearBottom();
  const node = itemNode(item);
  if (node) appendNode(log, node);
  if (live && near) scrollBottom();
}

function renderLive() {
  const el = $('#live');
  if (!el || !app.session) return;
  const s = app.session;
  if (s.live) fill(el, h('div', { class: 'msg assistant md live', html: md(s.live) }));
  else if (s.running) fill(el, h('div', { class: 'thinking' }, h('i'), h('i'), h('i')));
  else fill(el);
  if (isNearBottom(240)) scrollBottom();
}

function isNearBottom(slack = 120) {
  const w = $('#logwrap');
  return !w || w.scrollHeight - w.scrollTop - w.clientHeight < slack;
}
function scrollBottom(instant = false) {
  const w = $('#logwrap');
  if (w) requestAnimationFrame(() => w.scrollTo({ top: w.scrollHeight, behavior: instant ? 'instant' : 'smooth' }));
}

async function sendMessage() {
  const input = $('#composer');
  const text = input.value.trim();
  const s = app.session;
  const drafts = s?.drafts ?? [];
  if (!s || s.sending || (!text && !drafts.length)) return;
  const send = $('#send');
  s.sending = true;
  renderDrafts();
  if (send) send.disabled = true;
  input.value = ''; input.style.height = 'auto';
  vibrate();
  try {
    // Uploaded on every attempt: the desktop keeps an upload only until the prompt that names it.
    const uploads = [];
    const total = drafts.reduce((n, d) => n + d.blob.size, 0);
    let before = 0;
    for (const d of drafts) {
      uploads.push(await uploadImage(d.blob, d.name, (sent) => { if (send) send.dataset.progress = `${Math.round(((before + sent) / total) * 100)}%`; }));
      before += d.blob.size;
    }
    await app.link.rpc('session.prompt', { sessionId: s.id, text, uploads, mode: 'queue', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, 90_000);
    s.sending = false;
    clearDrafts();
    s.running = true; renderSessionChrome(); renderLive(); scrollBottom();
  } catch (e) {
    s.sending = false;
    input.value = text;
    renderDrafts();
    toast(e.message, 'err');
  } finally {
    if (send) delete send.dataset.progress;
    renderSendState();
  }
}

async function stopSession() {
  if (!app.session) return;
  vibrate(20);
  try { await app.link.rpc('session.cancel', { sessionId: app.session.id }); toast('已发送停止'); } catch (e) { toast(e.message, 'err'); }
}

// ---- settings
function renderSettings() {
  const desktop = currentDesktop();
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window;
  let pushNote;
  if (!pushSupported) pushNote = isIOS() && !standalone() ? 'iPhone 需要先「分享 → 添加到主屏幕」，并从主屏幕打开，才能开启通知（配对需在主屏幕 App 里重新扫码）。' : '这个浏览器不支持推送通知。';
  const permission = pushSupported ? Notification.permission : 'unsupported';
  return h('main', { class: 'screen form' },
    h('header', { class: 'bar' }, h('button', { class: 'icon-btn', onClick: () => { app.view = { name: 'home' }; render(); } }, icon('back')), h('div', { class: 'bar-title' }, h('b', {}, '设置'))),
    h('section', { class: 'card' },
      h('b', {}, '通知'),
      h('p', { class: 'muted' }, '任务完成、需要审批或回答、出错时通知你。通知内容端到端加密。'),
      pushNote ? h('div', { class: 'note' }, pushNote) : null,
      pushSupported ? h('div', { class: 'row' },
        h('button', { class: 'btn primary', onClick: enablePush }, icon('bell'), permission === 'granted' ? '重新开启通知' : '开启通知'),
        h('button', { class: 'btn', onClick: async () => { try { const r = await app.link.rpc('push.test'); toast(r.sent ? '已发送测试通知' : '未开启通知', r.sent ? 'ok' : 'err'); } catch (e) { toast(e.message, 'err'); } } }, '测试')) : null),
    h('section', { class: 'card' },
      h('b', {}, '已连接的电脑'),
      h('p', { class: 'muted' }, `${desktop?.name ?? '—'}`),
      h('p', { class: 'muted small' }, `本机名称：${app.info?.deviceName ?? '—'}`),
      h('button', { class: 'btn danger', onClick: forget }, '取消配对')),
    h('p', { class: 'muted small center' }, 'DSH Pair · 中继只转发密文'));
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const raw = atob((base64String + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { toast('没有获得通知权限（可在系统设置里打开）', 'err'); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const key = app.info?.vapidPublicKey;
    if (sub && key && sub.options?.applicationServerKey) {
      const current = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (current !== key) { await sub.unsubscribe(); sub = null; }
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await app.link.rpc('push.subscribe', { subscription: sub.toJSON() });
    const store = load(); store.push = true; save(store);
    toast('通知已开启', 'ok');
  } catch (e) { toast(`开启失败：${e.message}`, 'err'); }
}

async function maybeResubscribePush() {
  // Re-send an existing subscription (e.g. after re-pairing) so the desktop always has it.
  if (!load().push || !('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub && !app.info?.hasPush) await app.link.rpc('push.subscribe', { subscription: sub.toJSON() });
  } catch {}
}

async function forget() {
  if (!confirm('取消与这台电脑的配对？之后需要重新扫码。')) return;
  try { await app.link.rpc('device.forget'); } catch {}
  app.link?.close();
  const store = load(); delete store.desktop; save(store);
  app.view = { name: 'welcome' };
  render();
}

// ------------------------------------------------------------------ boot -------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.open) openFromNotification(e.data.open); });
function openFromNotification(target) {
  if (target.sessionId && app.link?.status === 'ready') openSession(target.sessionId);
  else if (target.sessionId) app.view = { name: 'session', id: target.sessionId };
}

(function boot() {
  const params = new URLSearchParams(location.search);
  const desktop = currentDesktop();
  if (location.hash.includes('p=')) { app.view = { name: 'welcome' }; render(); return; }
  if (!desktop) { app.view = { name: 'welcome' }; render(); return; }
  if (params.get('s')) { app.view = { name: 'session', id: params.get('s') }; app.session = { id: params.get('s'), title: '', items: [], tools: new Map(), loading: true }; history.replaceState(null, '', '/'); }
  render();
  connect(desktop);
})();

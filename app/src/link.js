/**
 * Phone ↔ desktop link: relay WebSocket + E2E handshake + encrypted RPC, with reconnects.
 * Emits: 'status' (connecting|offline|ready|error), 'confirm' {sas}, 'ready' {…}, 'ev' {ev, …}, 'fatal' {code, message}
 */
import { phoneHandshake, unb64 } from '../../shared/e2e.js';

export class Link extends EventTarget {
  constructor({ relay, desktopId, desktopKey, deviceKeys, pair }) {
    super();
    this.url = `${relay.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/client/${desktopId}`;
    this.desktopKey = unb64(desktopKey);
    this.deviceKeys = deviceKeys;
    this.pair = pair; // { token, name } while pairing
    this.status = 'connecting';
    this.pending = new Map();
    this.nextId = 1;
    this.attempt = 0;
    this.closed = false;
    this.onVisible = () => { if (document.visibilityState === 'visible') this.wake(); };
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onVisible);
    this.connect();
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  setStatus(status, detail) { this.status = status; this.emit('status', { status, ...detail }); }

  connect() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    this.cipher = null;
    this.hs = null;
    ws.onopen = () => {
      clearInterval(this.pingTimer);
      this.lastHeard = Date.now();
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastHeard > 50_000) { try { ws.close(); } catch {} return; }
        try { ws.send('ping'); } catch {}
      }, 20_000);
    };
    ws.onmessage = (m) => this.receive(ws, m.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.failAll('连接已断开');
      if (this.closed) return;
      if (this.status !== 'error') this.setStatus('offline', { reason: 'network' });
      const delay = Math.min(15_000, 700 * 2 ** this.attempt);
      this.attempt = Math.min(this.attempt + 1, 5);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  wake() {
    if (this.closed) return;
    if (!this.ws || this.ws.readyState > 1) { this.attempt = 0; this.connect(); }
    else if (this.ws.readyState === 1) { try { this.ws.send('ping'); } catch {} }
  }

  receive(ws, data) {
    if (ws !== this.ws) return;
    this.lastHeard = Date.now();
    if (data === 'pong') return;
    if (data[0] === '\u0000') {
      const state = data.slice(1);
      if (state === 'online') {
        // (Re)start the handshake: the desktop may have restarted and lost our session.
        this.failAll('电脑已重新连接');
        this.cipher = null;
        this.hs = phoneHandshake(this.deviceKeys, this.desktopKey);
        ws.send(this.hs.hello);
        this.setStatus('connecting');
      } else if (state === 'offline') {
        this.cipher = null;
        this.failAll('电脑离线');
        this.setStatus('offline', { reason: 'desktop' });
      }
      return;
    }
    if (!this.cipher) {
      if (!this.hs) return;
      try {
        const { cipher, sas } = this.hs.finish(data);
        this.cipher = cipher;
        this.sas = sas;
        this.hs = null;
        this.send(this.pair ? { type: 'auth', mode: 'pair', token: this.pair.token, name: this.pair.name } : { type: 'auth', mode: 'resume' });
      } catch (error) {
        let parsed; try { parsed = JSON.parse(data); } catch {}
        this.fatal(parsed?.code ?? 'handshake', parsed?.error ?? error.message);
      }
      return;
    }
    let msg;
    try { msg = this.cipher.open(data); } catch { try { ws.close(); } catch {} return; }
    if (msg.type === 'confirm') { this.emit('confirm', msg); return; }
    if (msg.type === 'ready') {
      this.pair = null;
      this.attempt = 0;
      this.info = msg;
      this.setStatus('ready');
      this.emit('ready', msg);
      return;
    }
    if (msg.type === 'error') { this.fatal(msg.code, msg.message); return; }
    if (msg.ev) { this.emit('ev', msg); return; }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      msg.ok ? p.resolve(msg.r) : p.reject(new Error(msg.e));
    }
  }

  fatal(code, message) {
    const permanent = ['unknown-device', 'denied', 'expired', 'revoked', 'busy', 'bad-hello'].includes(code);
    this.setStatus('error', { code, message });
    this.emit('fatal', { code, message });
    if (permanent) this.close();
  }

  send(value) { this.ws?.send(this.cipher.seal(value)); }

  rpc(m, p = {}, timeoutMs = 30_000) {
    if (this.status !== 'ready') return Promise.reject(new Error(this.status === 'offline' ? '电脑离线' : '尚未连接'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('请求超时')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, m, p });
    });
  }

  failAll(reason) {
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(reason)); this.pending.delete(id); }
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onVisible);
    this.failAll('已断开');
    try { this.ws?.close(); } catch {}
  }
}

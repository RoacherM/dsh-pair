/**
 * dsh-pair relay: a zero-knowledge WebSocket matchmaker on Cloudflare Workers + Durable Objects.
 *
 *   desktop  ──wss /v1/desktop/<id>?pub&ts&sig──┐
 *                                                ├── Room DO (one per desktop id) ── forwards opaque frames
 *   phone(s) ──wss /v1/client/<id>──────────────┘
 *
 * - The desktop proves it owns <id>: id = base64url(sha256(ed25519 pub))[0..22], and it signs
 *   `dsh-pair-relay:v1:<id>:<ts>` with that key. Nobody else can take its seat.
 * - Clients need no relay-level auth: everything they exchange with the desktop is end-to-end
 *   encrypted (see shared/e2e.js); the relay only sees ciphertext and connection ids.
 * - Wire format on the desktop socket (JSON text):
 *     relay → desktop: {t:'open',c} {t:'data',c,d} {t:'close',c}
 *     desktop → relay: {t:'data',c,d} {t:'close',c}
 *   Client sockets carry the raw `d` strings; the relay also tells clients {t:'online'|'offline'}
 *   in frames starting with "\u0000" so they never collide with payloads.
 * - Literal "ping" is answered "pong" by the runtime without waking the DO (hibernation).
 * - Everything else is served from ./public (the PWA).
 */

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const MAX_CLIENTS = 8;
const MAX_FRAME = 4 * 1024 * 1024;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const b64urlDecode = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const b64urlEncode = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function desktopIdFor(pub) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', pub));
  return b64urlEncode(digest).slice(0, 22);
}

async function verifyDesktop(id, url) {
  const pubText = url.searchParams.get('pub');
  const ts = Number(url.searchParams.get('ts'));
  const sigText = url.searchParams.get('sig');
  if (!pubText || !sigText || !Number.isFinite(ts)) return 'missing pub/ts/sig';
  if (Math.abs(Date.now() - ts) > CLOCK_SKEW_MS) return 'clock skew';
  let pub, sig;
  try { pub = b64urlDecode(pubText); sig = b64urlDecode(sigText); } catch { return 'bad encoding'; }
  if (pub.length !== 32 || sig.length !== 64) return 'bad key/signature length';
  if ((await desktopIdFor(pub)) !== id) return 'id does not match key';
  const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, new TextEncoder().encode(`dsh-pair-relay:v1:${id}:${ts}`));
  return ok ? null : 'bad signature';
}

const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = /^\/v1\/(desktop|client|status)\/([^/]+)$/.exec(url.pathname);
    if (!match) {
      if (url.pathname === '/v1/health') return text('ok');
      return env.ASSETS ? env.ASSETS.fetch(request) : text('not found', 404);
    }
    const [, role, id] = match;
    if (!ID_RE.test(id)) return text('bad id', 400);
    const room = env.ROOM.get(env.ROOM.idFromName(id));
    if (role === 'status') return room.fetch(new Request('https://room/status'));
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return text('expected websocket', 426);
    if (role === 'desktop') {
      const problem = await verifyDesktop(id, url);
      if (problem) return text(`desktop auth failed: ${problem}`, 403);
    }
    return room.fetch(new Request(`https://room/${role}`, request));
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  desktop() {
    return this.state.getWebSockets('desktop')[0];
  }

  clients() {
    return this.state.getWebSockets('client');
  }

  clientById(cid) {
    return this.state.getWebSockets(`c:${cid}`)[0];
  }

  async fetch(request) {
    const role = new URL(request.url).pathname.slice(1);
    if (role === 'status') return Response.json({ online: Boolean(this.desktop()), clients: this.clients().length });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === 'desktop') {
      for (const old of this.state.getWebSockets('desktop')) {
        try { old.close(4000, 'replaced by a newer desktop connection'); } catch {}
      }
      this.state.acceptWebSocket(server, ['desktop']);
      server.serializeAttachment({ role: 'desktop' });
      for (const ws of this.clients()) {
        const { cid } = ws.deserializeAttachment();
        server.send(JSON.stringify({ t: 'open', c: cid }));
        safeSend(ws, '\u0000online');
      }
    } else {
      if (this.clients().length >= MAX_CLIENTS) return text('too many clients', 429);
      const cid = crypto.randomUUID();
      this.state.acceptWebSocket(server, ['client', `c:${cid}`]);
      server.serializeAttachment({ role: 'client', cid });
      const desktop = this.desktop();
      if (desktop) {
        safeSend(desktop, JSON.stringify({ t: 'open', c: cid }));
        server.send('\u0000online');
      } else {
        server.send('\u0000offline');
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string') message = new TextDecoder().decode(message);
    if (message.length > MAX_FRAME) { ws.close(1009, 'frame too large'); return; }
    const meta = ws.deserializeAttachment();
    if (meta?.role === 'client') {
      const desktop = this.desktop();
      if (desktop) safeSend(desktop, JSON.stringify({ t: 'data', c: meta.cid, d: message }));
      else safeSend(ws, '\u0000offline');
      return;
    }
    let frame;
    try { frame = JSON.parse(message); } catch { return; }
    const target = typeof frame?.c === 'string' ? this.clientById(frame.c) : undefined;
    if (frame.t === 'data' && target && typeof frame.d === 'string') safeSend(target, frame.d);
    else if (frame.t === 'close' && target) { try { target.close(4001, String(frame.reason ?? 'closed by desktop').slice(0, 100)); } catch {} }
    else if (frame.t === 'close' && typeof frame.c === 'string') safeSend(ws, JSON.stringify({ t: 'close', c: frame.c }));
  }

  async webSocketClose(ws, code, reason) {
    this.gone(ws);
    try { ws.close(code === 1005 ? 1000 : code, reason); } catch {}
  }

  async webSocketError(ws) {
    this.gone(ws);
  }

  gone(ws) {
    const meta = ws.deserializeAttachment();
    if (meta?.role === 'client') {
      const desktop = this.desktop();
      if (desktop && desktop !== ws) safeSend(desktop, JSON.stringify({ t: 'close', c: meta.cid }));
    } else if (meta?.role === 'desktop') {
      // Only announce offline when no newer desktop socket took over.
      const others = this.state.getWebSockets('desktop').filter((other) => other !== ws);
      if (!others.length) for (const client of this.clients()) safeSend(client, '\u0000offline');
    }
  }
}

function safeSend(ws, data) {
  try { ws.send(data); } catch {}
}

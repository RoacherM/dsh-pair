/**
 * dsh-pair — control this DSH from a paired phone.
 *
 * The desktop keeps ONE outbound WebSocket to a Cloudflare relay (no listening port, no tunnel);
 * phones reach it through the same relay. Every byte between phone and desktop is end-to-end
 * encrypted (shared/e2e.js); the relay only matches sockets. Pairing = scan a one-time QR on the
 * pairing page + confirm the 6-digit code on the desktop.
 */
import { desktopIdFor } from '../../../shared/e2e.js';
import { createAway } from './away.js';
import { createImages } from './images.js';
import { createPairing } from './pairing.js';
import { createPhones } from './phones.js';
import { createPush } from './push.js';
import { createRelayLink } from './relay-link.js';
import { registerRoutes } from './routes.js';
import { createState } from './state.js';

export const name = 'dsh-pair';
export const inject = ['connection', 'sessionController', 'agents', 'permissionPresets', 'workspaceRegistry'];

export const DEFAULT_RELAY = 'https://dsh-pair-relay.sir-housir.workers.dev';

export function apply(ctx, config = {}) {
  const log = (message) => ctx.logger?.warn?.(message);
  const relayUrl = config.relayUrl ?? DEFAULT_RELAY;

  // Change feed for the pairing page's long-poll.
  const listeners = new Set();
  const changes = {
    revision: 0,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    bump() { changes.revision++; for (const fn of listeners) fn(); },
  };

  let disposed = false;
  let runtime = null;
  const ready = (async () => {
    const state = await createState(config.dataDir ? { dir: config.dataDir } : {});
    const desktopId = await desktopIdFor(state.signKeys.publicKey);
    if (disposed) return null;

    let link;
    let phones;
    const pairing = createPairing({ relayUrl, desktopId, boxKeys: state.boxKeys, desktopName: () => state.desktopName, onChange: () => changes.bump() });
    const push = createPush({ state, log, isOnline: (deviceId) => phones?.online(deviceId) ?? false });
    const away = createAway({
      ctx, state, config, log,
      onChange: () => { changes.bump(); phones?.broadcast('pending', { pending: away.pending(), away: away.view() }); },
      titleOf: (id) => phones?.titleOf(id) ?? Promise.resolve(undefined),
      notify: (payload) => push.notify(payload),
    });
    // Looked up per request: the attachments service is optional and may arrive after this plugin.
    const images = createImages({ attachments: () => ctx.get?.('attachments') });
    phones = createPhones({ ctx, state, pairing, away, push, images, link: () => link, log, onChange: () => changes.bump() });

    link = createRelayLink({
      relayUrl, desktopId, signKeys: state.signKeys, log,
      onOpen: (cid) => phones.open(cid),
      onData: (cid, data) => { phones.data(cid, data).catch((error) => log(`dsh-pair: ${error.message}`)); },
      onClose: (cid) => phones.close(cid),
      onStatus: () => changes.bump(),
    });

    // Session running/idle → live list updates on phones, and a "finished" push for long runs.
    const startedAt = new Map();
    ctx.on('api-session/status', (sessionId, running) => {
      phones.broadcast('status', { sessionId, running });
      if (running) { startedAt.set(sessionId, Date.now()); return; }
      const began = startedAt.get(sessionId);
      startedAt.delete(sessionId);
      const longRun = began !== undefined && Date.now() - began >= (config.notifyAfterSeconds ?? 20) * 1000;
      if (!longRun && !state.away.on) return;
      phones.titleOf(sessionId).then((title) => {
        if (title === undefined) return; // subagents and unknown sessions stay quiet
        push.notify({ title: '✅ 已完成', body: title, tag: `done-${sessionId}`, sessionId }).catch(() => {});
      });
    });
    ctx.on('api-session/error', (sessionId, message) => {
      phones.broadcast('session-error', { sessionId, message });
      phones.titleOf(sessionId).then((title) => {
        push.notify({ title: '⚠️ 会话出错', body: `${title ?? '会话'}：${String(message).slice(0, 120)}`, tag: `err-${sessionId}`, sessionId }).catch(() => {});
      });
    });

    runtime = { state, desktopId, link, pairing, away, phones, push, relayUrl };
    changes.bump();
    return runtime;
  })();
  ready.catch((error) => log(`dsh-pair: 启动失败：${error.stack ?? error.message}`));

  ctx.effect(() => () => {
    disposed = true;
    runtime?.link.dispose();
  }, 'dsh-pair: relay link');

  registerRoutes(ctx, { ready, changes });
}

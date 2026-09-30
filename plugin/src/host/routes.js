/**
 * Authenticated `/api/pair/*` routes for the desktop pairing page (through `ctx.connection.fetch`).
 */
import QRCode from 'qrcode';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

export function registerRoutes(ctx, { ready, changes }) {
  let qrCache = { link: null, svg: null };
  async function qrSvg(link) {
    if (qrCache.link !== link) qrCache = { link, svg: await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }) };
    return qrCache.svg;
  }

  async function view() {
    const rt = await ready;
    if (!rt) throw new Error('dsh-pair 尚未启动');
    const pairing = rt.pairing.view();
    const connected = new Set(rt.phones.connected());
    return {
      revision: changes.revision,
      relay: { url: rt.relayUrl, status: rt.link.status() },
      desktopId: rt.desktopId,
      desktopName: rt.state.desktopName,
      pairing: { ...pairing, offer: pairing.offer ? { ...pairing.offer, qr: await qrSvg(pairing.offer.link) } : null },
      devices: rt.state.devices().map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen, push: Boolean(d.push), online: connected.has(d.id) })),
      away: rt.away.view(),
      pending: rt.away.pending(),
    };
  }

  const routes = [
    ['GET', '/api/pair/state', async () => json(await view())],
    ['GET', '/api/pair/wait', async (request, url) => {
      const since = Number(url.searchParams.get('revision') ?? -1);
      if (changes.revision === since) {
        await new Promise((resolve) => {
          const timer = setTimeout(done, 20_000);
          const unsubscribe = changes.subscribe(done);
          request.signal?.addEventListener('abort', done, { once: true });
          function done() { clearTimeout(timer); unsubscribe(); resolve(); }
        });
      }
      return json({ revision: changes.revision });
    }],
    ['POST', '/api/pair/start', async () => { (await ready).pairing.start(); return json(await view()); }],
    ['POST', '/api/pair/cancel', async () => { (await ready).pairing.cancel(); return json(await view()); }],
    ['POST', '/api/pair/decide', async (request) => { (await ready).pairing.decide((await body(request)).allow === true); return json(await view()); }],
    ['POST', '/api/pair/revoke', async (request) => {
      const rt = await ready;
      const { deviceId } = await body(request);
      rt.phones.kickDevice(deviceId, '这台设备已在电脑上被移除');
      await rt.state.removeDevice(deviceId);
      changes.bump();
      return json(await view());
    }],
    ['POST', '/api/pair/away', async (request) => { await (await ready).away.set((await body(request)).on === true); return json(await view()); }],
    ['POST', '/api/pair/answer', async (request) => {
      const input = await body(request);
      (await ready).away.answer(String(input.id), input);
      return json(await view());
    }],
    ['POST', '/api/pair/test-push', async (request) => {
      const rt = await ready;
      const device = rt.state.deviceById((await body(request)).deviceId);
      if (!device) return json({ error: '设备不存在' }, 404);
      const result = await rt.push.sendTo(device, { title: 'DSH 推送测试', body: `来自「${rt.state.desktopName}」的测试通知`, tag: 'test' });
      return json(result);
    }],
  ];

  for (const [method, path, fn] of routes) {
    ctx.effect(() => ctx.connection.fetch.register({
      path, methods: [method], requestBody: 'buffered',
      fetch: async (request) => {
        try { return await fn(request, new URL(request.url)); } catch (error) {
          return json({ error: error?.message ?? String(error) }, error?.status ?? 500);
        }
      },
    }), 'dsh-pair: ' + path);
  }
}

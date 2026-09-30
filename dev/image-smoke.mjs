// Images in the phone app, before deploying: serve the freshly built PWA (relay/public) on
// localhost, pair it as an iPhone with dev/fake-desktop.mjs through the real relay, open the
// session and check that the screenshot tool result loads and opens full screen.
//   FAKE_IMAGE=/path/to.png node dev/fake-desktop.mjs   → prints PAIR_LINK
//   node dev/image-smoke.mjs <PAIR_LINK>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import puppeteer from 'puppeteer-core';

const link = new URL(process.argv[2]);
const root = new URL('../relay/public/', import.meta.url);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  try { res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }); res.end(await readFile(new URL(`.${path}`, root))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const local = `http://localhost:${server.address().port}/${link.hash}`;

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const shot = async (name) => { await new Promise((r) => setTimeout(r, 500)); await page.screenshot({ path: `dev/shots/${name}.png` }); console.log('shot', name); };
try {
  await page.goto(local, { waitUntil: 'networkidle0' });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开始配对')).click());
  await page.waitForSelector('.srow', { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.srow').click());
  await page.waitForSelector('.pic', { timeout: 20000 });
  await page.evaluate(() => document.querySelector('.pic').scrollIntoView({ block: 'center' }));
  await page.waitForSelector('.pic[data-state="ok"], .pic[data-state="err"]', { timeout: 60000 });
  const state = await page.evaluate(() => { const el = document.querySelector('.pic'); const img = el.querySelector('img'); return { state: el.dataset.state, note: el.textContent, natural: [img.naturalWidth, img.naturalHeight] }; });
  console.log('pic', JSON.stringify(state));
  await shot('img-1-session');
  await page.evaluate(() => document.querySelector('.pic').click());
  await page.waitForSelector('.viewer img', { timeout: 5000 });
  await shot('img-2-viewer');
  if (state.state !== 'ok' || !state.natural[0]) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

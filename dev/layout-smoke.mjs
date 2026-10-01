// Session screen layout, before deploying: serves relay/public on localhost, pairs with
// dev/fake-desktop.mjs through the real relay, and screenshots the session screen (light and dark),
// the model picker, the menu and a running turn; checks copy and model switching.
//   node dev/fake-desktop.mjs   → PAIR_LINK;   node dev/layout-smoke.mjs <PAIR_LINK>
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
const origin = `http://localhost:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
const shot = async (name) => { await new Promise((r) => setTimeout(r, 450)); await page.screenshot({ path: `dev/shots/${name}.png` }); console.log('shot', name); };
const text = (sel) => page.$eval(sel, (el) => el.innerText.trim());
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) process.exitCode = 1; };
try {
  await page.goto(`${origin}/${link.hash}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开始配对')).click());
  await page.waitForSelector('.srow', { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.srow').click());
  await page.waitForSelector('.msg.assistant .msg-actions', { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('#model').hidden, { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.toast')?.remove());
  await shot('ui-1-session-light');
  check((await text('#model')) === 'Opus 5.5 High', `model pill shows "${await text('#model')}"`);
  check(await page.$eval('#send', (b) => b.disabled), 'send is disabled while the box is empty');

  await page.click('.msg.assistant .msg-actions .act-btn');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check(copied.startsWith('找到了：第 3 行'), 'copy puts the reply Markdown on the clipboard');
  await page.click('.codewrap .code-copy');
  check((await page.evaluate(() => navigator.clipboard.readText())).trim() === 'for (let i = 0; i < lines.length; i++) {', 'code copy takes only the code');

  await page.click('#model');
  await page.waitForSelector('.sheet-bg.show .model-row');
  await shot('ui-2-models');
  await page.evaluate(() => [...document.querySelectorAll('.model-row')].find((r) => r.innerText.includes('Sonnet 5')).querySelectorAll('.effort')[1].click());
  await page.waitForFunction(() => document.querySelector('#model').innerText.trim() === 'Sonnet 5 Medium', { timeout: 15000 });
  check(true, 'picking Sonnet 5 · Medium switches the session model');

  await page.click('.sbar .round-btn:last-child');
  await page.waitForSelector('.sheet-bg.show .sheet-item');
  await shot('ui-3-menu');
  await page.evaluate(() => document.querySelector('.sheet-bg').click());
  await new Promise((r) => setTimeout(r, 300));

  await page.type('#composer', '好的，改吧');
  check(!(await page.$eval('#send', (b) => b.disabled)), 'send is enabled once there is text');
  await page.click('#send');
  await page.waitForFunction(() => document.querySelector('#send').dataset.stop === '1', { timeout: 15000 });
  await shot('ui-4-running');
  check(!(await page.$eval('#mode', (b) => b.hidden)), 'queue/steer pill shows while running');
  await page.waitForFunction(() => document.body.innerText.includes('收到：「好的，改吧」') && !document.querySelector('.md.live'), { timeout: 30000 });

  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await shot('ui-5-session-dark');
  check(errors.length === 0, 'no page errors');
} finally {
  await browser.close();
  server.close();
}

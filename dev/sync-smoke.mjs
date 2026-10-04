// A turn that ends while the phone is away (iOS suspends the socket in the background), and copying
// your message by long press, driven as an iPhone against dev/fake-desktop.mjs:
//   FAKE_DESKTOP_MS=3000 node dev/fake-desktop.mjs   → prints PAIR_LINK
//   node dev/sync-smoke.mjs <PAIR_LINK>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', webmanifest: 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  try { res.writeHead(200, { 'content-type': TYPES[path.split('.').pop()] ?? 'application/octet-stream' }).end(await readFile(new URL(`../relay/public${path}`, import.meta.url))); }
  catch { res.writeHead(404).end(); }
}).listen(0);
const origin = `http://localhost:${server.address().port}`;
const link = process.argv[2].replace(/^https?:\/\/[^/#]+/, origin);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
// iOS kills a backgrounded page's socket: these let the test drop it and refuse new ones for a while.
await page.evaluateOnNewDocument(() => {
  const Real = window.WebSocket;
  window.__sockets = [];
  window.WebSocket = function (url, protocols) {
    const ws = new Real(window.__away ? 'ws://127.0.0.1:9/' : url, protocols);
    window.__sockets.push(ws);
    return ws;
  };
  window.WebSocket.prototype = Real.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
});
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); process.exitCode = 1; });
const shot = async (name) => { await new Promise((r) => setTimeout(r, 400)); await page.screenshot({ path: `dev/shots/${name}.png` }); console.log('shot', name); };
const check = (ok, what) => { console.log(ok ? '✔' : '✖', what); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = () => page.evaluate(() => !document.querySelector('.thinking') && !document.querySelector('#send')?.dataset.stop && !document.querySelector('#stitle')?.innerText.includes('运行中'));

await page.goto(link, { waitUntil: 'networkidle0' });
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开始配对')).click());
await page.waitForSelector('.srow', { timeout: 20000 });
await page.evaluate(() => document.querySelector('.srow').click());
await page.waitForSelector('.msg.assistant', { timeout: 15000 });

// Send, then lose the connection while the turn runs; it ends while the phone is away.
await page.type('#composer', '跑一下测试');
await page.click('#send');
await page.waitForFunction(() => document.querySelector('#stitle')?.innerText.includes('运行中'), { timeout: 10000 });
await page.evaluate(() => { window.__away = true; for (const ws of window.__sockets) ws.close(); });
await sleep(9000); // the fake turn (approval wait + streaming) is over by now, its status event lost
await page.evaluate(() => { window.__away = false; window.dispatchEvent(new Event('online')); });
await page.waitForFunction(() => document.body.innerText.includes('全部通过'), { timeout: 30000 }).catch(() => {});
await page.waitForFunction(() => !document.querySelector('.thinking') && !document.querySelector('#send')?.dataset.stop, { timeout: 15000 }).catch(() => {});
check(await idle(), 'a turn that ended while away: no dots, no stop button, not "运行中"');
await page.type('#composer', 'x');
check(await page.$eval('#send', (b) => !b.dataset.stop && !b.disabled), 'the button sends again');
await page.$eval('#composer', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); });
await shot('sync-1-after-away');

// Long press on your message: a "复制" button; tapping it copies, and the transcript stays.
const longPress = async () => {
  const box = await page.$eval('.msg.user .bubble', (el) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.touchStart(box.x, box.y); await sleep(650); await page.touchscreen.touchEnd();
};
const intact = () => page.evaluate(() => ({ msgs: document.querySelectorAll('.log .msg').length, bar: Boolean(document.querySelector('.sbar #stitle b')), y: window.scrollY }));
const before = await intact();
await longPress();
check(Boolean(await page.$('.copy-pop')), 'long press shows a copy button');
await shot('sync-2-copy-menu');
await page.click('.copy-pop .pop-item');
await sleep(300);
check((await page.evaluate(() => navigator.clipboard.readText())) === '帮我看看 parser 里为什么会漏掉最后一行', 'tapping it copies the message');
// Without the clipboard API: the execCommand fallback, which must not move or blank the page.
await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('NotAllowedError')); });
await longPress();
await page.click('.copy-pop .pop-item');
await sleep(400);
const after = await intact();
check(await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => t.innerText.includes('已复制'))), 'the fallback copies too');
check(after.msgs === before.msgs && after.bar && after.y === before.y && !(await page.$('textarea[readonly]')), 'the page neither moves nor loses its transcript');
await shot('sync-3-after-copy');

// A reply: no system selection in the transcript; long press offers 复制 and 选择文本, which opens
// the text in a panel of its own.
check(await page.$eval('.log', (el) => getComputedStyle(el).webkitUserSelect === 'none' || getComputedStyle(el).userSelect === 'none'), 'the transcript is not selectable on a touch screen');
await page.evaluate(() => document.querySelector('.copy-pop')?.closest('.pop-bg')?.remove());
const reply = await page.$eval('.msg.assistant .md', (el) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + 40, y: r.top + 12 }; });
await page.touchscreen.touchStart(reply.x, reply.y); await sleep(650); await page.touchscreen.touchEnd();
await sleep(200);
check((await page.$$eval('.copy-pop .pop-item', (els) => els.map((e) => e.innerText.trim()))).join('|') === '复制|选择文本', 'long press on a reply: 复制 | 选择文本');
await shot('sync-4-reply-menu');
await page.evaluate(() => [...document.querySelectorAll('.copy-pop .pop-item')].find((b) => b.innerText.includes('选择文本')).click());
await page.waitForSelector('.sheet-bg.show .select-text');
check((await page.$eval('.select-text', (el) => el.innerText)).includes('找到了'), '选择文本 shows the reply in a panel');
check(await page.$eval('.select-text', (el) => getComputedStyle(el).webkitUserSelect !== 'none'), '…where it can be selected');
await shot('sync-5-select-text');

await browser.close();
server.close();

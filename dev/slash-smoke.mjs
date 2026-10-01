// The "/" menu and slash commands, driven as an iPhone against dev/fake-desktop.mjs, with the PWA
// served from this checkout's relay/public (nothing deployed):
//   node dev/fake-desktop.mjs            → prints PAIR_LINK
//   node dev/slash-smoke.mjs <PAIR_LINK>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', webmanifest: 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
  try { res.writeHead(200, { 'content-type': TYPES[path.split('.').pop()] ?? 'application/octet-stream' }).end(await readFile(new URL(`../relay/public${path}`, import.meta.url))); }
  catch { res.writeHead(404).end(); }
}).listen(0);
const link = process.argv[2].replace(/^https?:\/\/[^/#]+/, `http://localhost:${server.address().port}`);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); process.exitCode = 1; });
const shot = async (name) => { await new Promise((r) => setTimeout(r, 500)); await page.screenshot({ path: `dev/shots/${name}.png` }); console.log('shot', name); };
const check = (ok, what) => { console.log(ok ? '✔' : '✖', what); if (!ok) process.exitCode = 1; };
const typeInto = async (text) => { await page.$eval('#composer', (el) => { el.value = ''; }); await page.type('#composer', text); };
const lastToast = () => page.evaluate(() => document.querySelector('.toast')?.innerText ?? '');

await page.goto(link, { waitUntil: 'networkidle0' });
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开始配对')).click());
await page.waitForSelector('.srow', { timeout: 20000 });
await page.evaluate(() => document.querySelector('.srow').click());
await page.waitForSelector('.msg.assistant', { timeout: 15000 });

await typeInto('/');
await page.waitForSelector('.slash-item', { timeout: 10000 });
const names = await page.$$eval('.slash-item b', (els) => els.map((el) => el.innerText));
check(names.slice(0, 4).join(' ') === '/compact /goal /code-review /commit' && names.length === 24, `menu lists allowed commands then all skills: ${names.length} items`);
// The long list scrolls inside the menu, which stays within a third of the screen.
const box = await page.$eval('#slash', (el) => ({ h: el.clientHeight, sh: el.scrollHeight, vh: innerHeight }));
check(box.h <= box.vh * 0.35 && box.sh > box.h, `the menu is capped (${box.h}px of ${box.sh}px) and scrolls`);
await page.mouse.move(195, (await page.$eval('#slash', (el) => el.getBoundingClientRect().top + 60)));
await page.mouse.wheel({ deltaY: 2000 });
await new Promise((r) => setTimeout(r, 400));
check(await page.$eval('#slash', (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), 'scrolling reaches the last skill');
check(await page.$eval('#slash', (el) => { const last = el.lastElementChild.getBoundingClientRect(); const r = el.getBoundingClientRect(); return last.bottom <= r.bottom + 1 && last.top >= r.top; }), 'the last skill is visible after scrolling');
await shot('slash-1b-scrolled');
await page.$eval('#slash', (el) => { el.scrollTop = 0; });
await shot('slash-1-menu');
await page.type('#composer', 'g');
check((await page.$$eval('.slash-item b', (els) => els.map((el) => el.innerText))).join(' ') === '/goal', 'typing filters by prefix');
await page.click('.slash-item');
check(await page.$eval('#composer', (el) => el.value) === '/goal ', 'picking inserts "/goal "');
check((await page.$eval('#slash', (el) => el.innerText)).includes('/goal <目标>'), 'the hint shows after picking');
await shot('slash-2-hint');

// "/goal" without a target: the command fails, its row turns red, the text stays for correction.
await page.click('.send');
await page.waitForSelector('.cmd.err', { timeout: 10000 });
check(await page.$eval('#composer', (el) => el.value) === '/goal', 'a failed command keeps its text');
check((await lastToast()).includes('需要一个目标'), 'a failed command shows its error');

await typeInto('/compact');
await page.click('.send');
await page.waitForSelector('.cmd.done', { timeout: 10000 });
check((await page.$eval('.cmd.done', (el) => el.innerText)).includes('已压缩'), 'the command row shows its result');
check(await page.$eval('#composer', (el) => el.value) === '', 'a successful command clears the composer');
check(await page.$eval('#slash', (el) => el.childElementCount) === 0, 'the menu closes after sending');
await shot('slash-3-ran');

// Not on the allowlist: refused by the desktop, nothing runs.
const rows = await page.$$eval('.cmd', (els) => els.length);
await typeInto('/danger-full-access');
await page.click('.send');
await new Promise((r) => setTimeout(r, 1500));
check((await lastToast()).includes('不能从手机运行'), 'a command outside phoneCommands is refused');
check(await page.$$eval('.cmd', (els) => els.length) === rows, '…and never runs');
await shot('slash-4-refused');

// Away mode off: the approval shows on the phone as well (run the fake desktop with FAKE_DESKTOP_MS
// so its own prompt waits), and answering it here closes the desktop prompt.
await typeInto('跑一下测试');
await page.click('.send');
await page.waitForSelector('.pcard', { timeout: 15000 });
check((await page.$eval('.pcard', (el) => el.innerText)).includes('电脑上也可处理'), 'away off: the approval shows on the phone too');
await shot('slash-5-shared-approval');
await page.evaluate(() => [...document.querySelectorAll('.pcard button')].find((b) => b.innerText.includes('允许一次')).click());
await page.waitForFunction(() => document.body.innerText.includes('全部通过'), { timeout: 20000 });
check(!(await page.$('.pcard')), 'answering on the phone settles it');
await shot('slash-6-after');

await browser.close();
server.close();

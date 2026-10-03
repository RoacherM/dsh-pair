// Keyboard and mouse in a computer's browser, against dev/fake-desktop.mjs, with the PWA served
// from this checkout's relay/public (nothing deployed):
//   FAKE_DESKTOP_MS=4000 node dev/fake-desktop.mjs   → prints PAIR_LINK (the wait keeps a turn running)
//   node dev/desktop-smoke.mjs <PAIR_LINK>
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
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); process.exitCode = 1; });
const shot = async (name) => { await new Promise((r) => setTimeout(r, 400)); await page.screenshot({ path: `dev/shots/${name}.png` }); console.log('shot', name); };
const check = (ok, what) => { console.log(ok ? '✔' : '✖', what); if (!ok) process.exitCode = 1; };
const value = () => page.$eval('#composer', (el) => el.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A PNG made in the page, delivered the way the browser delivers a paste or a drop.
const deliver = (kind) => page.evaluate(async (kind) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 200 });
  const g = canvas.getContext('2d'); g.fillStyle = kind === 'paste' ? '#d97757' : '#2c5aa8'; g.fillRect(0, 0, 320, 200);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], `${kind}.png`, { type: 'image/png' }));
  const target = document.querySelector('#composer');
  if (kind === 'paste') target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  else {
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }
}, kind);
const drafts = async (n) => { await page.waitForFunction((n) => document.querySelectorAll('.draft').length === n, { timeout: 5000 }).catch(() => {}); return page.$$eval('.draft', (els) => els.length); };

await page.goto(link, { waitUntil: 'networkidle0' });
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('开始配对')).click());
await page.waitForSelector('.side-row', { timeout: 20000 });

// Opens on DSH's new-session hero, sessions grouped by workspace on the left, composer focused.
check(Boolean(await page.$('.shell .side')) && Boolean(await page.$('.main .hero-head')), 'wide window: sidebar + new-session hero');
check((await page.$$eval('.side-group-head', (els) => els.map((el) => el.innerText.trim()))).join(',') === 'proj,notes', 'sessions grouped by workspace');
await page.waitForFunction(() => document.activeElement?.id === 'composer', { timeout: 3000 }).catch(() => {});
check(await page.evaluate(() => document.activeElement?.id === 'composer'), 'the composer has the focus');
await page.waitForFunction(() => document.querySelector('#wschip')?.innerText.includes('proj'), { timeout: 5000 }).catch(() => {});
check((await page.$eval('#wschip', (el) => el.innerText)).includes('proj'), 'workspace chip shows the latest workspace');
await shot('desk-1-new');

// Workspace menu: open, Esc closes, pick another.
await page.click('#wschip');
await page.waitForSelector('.ws-menu');
await shot('desk-2-workspaces');
await page.keyboard.press('Escape');
check(!(await page.$('.ws-menu')), 'Esc closes the workspace menu');
await page.click('#wschip');
await page.evaluate(() => [...document.querySelectorAll('.ws-menu .pop-item')].find((b) => b.innerText.includes('notes')).click());
check((await page.$eval('#wschip', (el) => el.innerText)).includes('notes'), 'picking a workspace updates the chip');

// Cmd+V an image, Shift+Enter is a new line, IME Enter does nothing, Enter creates the session.
await page.focus('#composer');
await deliver('paste');
check(await drafts(1) === 1, 'a pasted image becomes a draft');
await page.keyboard.type('第一行');
await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
await page.keyboard.type('第二行');
check(await value() === '第一行\n第二行', 'Shift+Enter inserts a new line');
await page.$eval('#composer', (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true })));
await sleep(300);
check(Boolean(await page.$('.hero-head')) && await value() === '第一行\n第二行', 'Enter inside an IME composition does not send');
await shot('desk-3-draft');
await page.keyboard.press('Enter');
await page.waitForSelector('.session .msg.user', { timeout: 15000 });
check((await page.$eval('.log', (el) => el.innerText)).includes('第一行'), 'Enter creates the session with the message');
check(await page.$$eval('.msg.user .pic', (els) => els.length) >= 1, '…and its pasted image');
check(await page.$eval('.side-row.on', (el) => el.innerText).catch(() => '') !== '', 'the open session is highlighted in the sidebar');
await page.waitForFunction(() => document.body.innerText.includes('全部通过'), { timeout: 20000 });
await shot('desk-4-session');

// "/" menu by keyboard: ArrowDown, Enter picks; Esc closes.
await page.focus('#composer');
await page.keyboard.type('/');
await page.waitForSelector('.slash-item.on', { timeout: 10000 });
await page.keyboard.press('ArrowDown');
check((await page.$eval('.slash-item.on b', (el) => el.innerText)) === '/goal', 'ArrowDown moves the selection');
await page.keyboard.press('Enter');
check(await value() === '/goal ', 'Enter picks the selected command');
await page.$eval('#composer', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); });
await page.keyboard.type('/co');
await page.waitForSelector('.slash-item');
await page.keyboard.press('Escape');
check(await page.$$eval('.slash-item', (els) => els.length) === 0, 'Esc closes the menu');
await page.$eval('#composer', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); });

// Drop an image, Enter sends it; while the turn runs, Esc twice stops it.
await deliver('drop');
check(await drafts(1) === 1, 'a dropped image becomes a draft');
await page.keyboard.type('再跑一次');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelector('#stitle')?.innerText.includes('运行中'), { timeout: 10000 }).catch(() => {});
check(await drafts(0) === 0 && await value() === '', 'Enter sends text and image');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.innerText.includes('已发送停止')), { timeout: 3000 }).catch(() => {});
check(await page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => t.innerText.includes('已发送停止'))), 'Esc twice stops the running turn');
await shot('desk-5-running');

// The model picker is a centered dialog, closed by Esc.
await page.click('#model');
await page.waitForSelector('.sheet-bg.show');
await shot('desk-6-models');
await page.keyboard.press('Escape');
await sleep(300);
check(!(await page.$('.sheet-bg')), 'Esc closes the model picker');

// Narrow again: the phone layout comes back, with the session still open.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await sleep(400);
check(!(await page.$('.shell')) && Boolean(await page.$('.session .narrow-only')), 'a narrow window gets the phone layout');
await shot('desk-7-narrow');

await browser.close();
server.close();

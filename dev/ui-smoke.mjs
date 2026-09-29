// Drive the deployed PWA as an iPhone against the simulated desktop and screenshot each screen.
import puppeteer from 'puppeteer-core';
const link = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const shot = async (name) => { await new Promise((r) => setTimeout(r, 600)); await page.screenshot({ path: `dev/shots/${name}.png` }); console.log('shot', name); };
const clickText = async (text) => {
  const ok = await page.evaluate((t) => { const el = [...document.querySelectorAll('button')].find((b) => b.innerText.includes(t)); if (el) { el.click(); return true; } return false; }, text);
  if (!ok) throw new Error('no button ' + text);
};
await page.goto(link, { waitUntil: 'networkidle0' });
await shot('1-welcome-link');
await clickText('开始配对');
await page.waitForFunction(() => document.body.innerText.includes('运行中') || document.body.innerText.includes('最近'), { timeout: 20000 });
await shot('2-home');
await page.evaluate(() => document.querySelector('.srow').click());
await page.waitForSelector('.msg.assistant', { timeout: 15000 });
await shot('3-session');
await page.type('#composer', '好的，改吧，然后跑一下测试');
await page.click('.send');
await new Promise((r) => setTimeout(r, 2200));
await shot('4-streaming');
await page.waitForFunction(() => document.body.innerText.includes('回归测试') && !document.querySelector('.md.live'), { timeout: 20000 });
await shot('5-done');
// away mode + approval
await page.click('.bar .icon-btn');
await page.waitForSelector('.away');
await page.click('.away');
await page.waitForSelector('.away.on', { timeout: 10000 });
await page.evaluate(() => document.querySelector('.srow').click());
await page.waitForSelector('#composer');
await page.type('#composer', '再跑一次');
await page.click('.send');
await page.waitForSelector('.pcard', { timeout: 15000 });
await shot('6-approval');
await clickText('允许一次');
await page.waitForFunction(() => document.body.innerText.includes('全部通过'), { timeout: 20000 });
await shot('7-after-approval');
await page.click('.bar .icon-btn');
await page.waitForSelector('.away'); await page.click('.away');
await page.click('.bar .icon-btn[aria-label="设置"]');
await shot('8-settings');
await browser.close();

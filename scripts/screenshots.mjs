// Drives the built game with Playwright and saves screenshots.
// Usage: npx vite preview --port 4173 & node scripts/screenshots.mjs [outDir] [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'capturas';
const base = process.argv[3] || 'http://localhost:4173/';
fs.mkdirSync(out, { recursive: true });
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(name, ctxOpts) {
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.ppCell && document.querySelector('#h-coins')?.textContent);
  await sleep(1500);
  const shot = async (n) => { await page.screenshot({ path: path.join(out, `${name}-${n}.png`) }); console.log('saved', name, n); };
  const tap = async (sel) => { await page.locator(sel).first().click(); await sleep(400); };
  const tapCell = async (i, j) => {
    const p = await page.evaluate(([i, j]) => window.ppCell(i, j), [i, j]);
    if (ctxOpts.hasTouch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    await sleep(500);
  };
  const button = (text) => page.locator('button', { hasText: text }).first();

  await shot('1-load');

  // build a house, rush it, wait for / rush the first clone
  await tap('#f-build');
  await page.locator('.item', { hasText: 'TERRA TERRACE' }).first().click();
  await sleep(300);
  await tapCell(2, 0);
  await shot('2-placed-house');
  await tapCell(2, 0);
  await button('RUSH').click(); await sleep(400);
  await page.locator('.panel .close').click(); await sleep(1500);
  await tap('#f-ac');
  await button('RUSH').click(); await sleep(1200);
  await button('SPLICE').click(); await sleep(400);
  await page.locator('.gene', { hasText: 'MAYOR' }).first().click();
  await page.locator('.gene', { hasText: 'MECHANIC' }).first().click();
  await sleep(300);
  await shot('3-splicer');
  await page.locator('.splicetop button').click(); await sleep(500);
  await button('FREE?').click(); await sleep(1500);
  await shot('4-discovery');

  // place the free workplace
  await button('PLACE IT NOW').click(); await sleep(400);
  await tapCell(3, 3);
  await sleep(500);
  await shot('5-placed-workplace');

  // coins: tap the Town Hall to start its shift and wait for ticks
  await tapCell(0, 3);
  await sleep(3500);
  await shot('6-coin-tick');
  console.log(name, 'errors:', errors.length ? errors : 'none');
  await browser.close();
}

await run('desktop', { viewport: { width: 1280, height: 800 } });
await run('iphone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });

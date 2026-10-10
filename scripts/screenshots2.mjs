// Milestone 2 screenshots: hearts, mission list, completed mission card, edit mode, Utopium Mine.
// Usage: npx vite preview --port 4173 & node scripts/screenshots2.mjs [outDir] [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'capturas/etapa2';
const base = process.argv[3] || 'http://localhost:4173/';
fs.mkdirSync(out, { recursive: true });
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(name, ctxOpts) {
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(base);
  await page.waitForFunction(() => window.ppCell && document.querySelector('#h-coins')?.textContent);
  await sleep(1200);
  const shot = async (n) => { await page.screenshot({ path: path.join(out, `${name}-${n}.png`) }); console.log('saved', name, n); };
  const tapCell = async (i, j) => {
    const p = await page.evaluate(([i, j]) => window.ppCell(i, j), [i, j]);
    if (ctxOpts.hasTouch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    await sleep(500);
  };
  const press = async (text) => {
    const b = page.locator('button', { hasText: text }).first();
    await b.click();
    await sleep(500);
  };
  const closePanel = async () => { await page.locator('.panel .close').first().click(); await sleep(400); };

  // Set up a mid-game city through the debug handle: houses (22+ land for hearts), Utopia HQ, the mine, animals.
  await page.evaluate(() => {
    const g = window.pp;
    const put = (type, x, y) => {
      if (!g.canPlaceAt(type, x, y)) throw new Error(`cannot place ${type} at ${x},${y}`);
      const id = `${type}_s${++g.state.counter}`;
      g.state.buildings.push({ id, type, x, y, flip: false, buildStart: -1, buildEnd: -1, shiftStart: -1, level: 1 });
      return id;
    };
    put('Residence4', 3, 0);
    put('Residence4', 3, 3);
    put('MissionControl', -3, -1);
    const mine = put('Utopium Mine', 2, -1);
    put('Park', -4, 2);
    put('Construction Yard', 5, 2);
    put('PlainR', 3, 2); put('PlainR', 4, 2);
    g.state.landUsed = 26;
    g.state.unlockedJobs.push('Engineer');
    g.state.peeps.push({ id: 'Clone_50', female: true, job: 'Engineer', home: 'Residence4_s11', work: mine, cps: 1 });
    for (const [a, n] of [['Tabby Cat', 5], ['Tom Cat', 4], ['Pug', 2], ['Horse', 1], ['Cow', 2]]) g.state.animals[a] = n;
    g.state.coins = 2_000_000;
    g.heartNext = 0; // spawn a heart on the next tick
  });
  await sleep(2500);
  // make sure the AClowder mission (9 cats) is in a Normal slot so it can be completed
  await page.evaluate(() => {
    const g = window.pp;
    const m = g.state.missions;
    if (!m.slots.some((a) => a && a.id === 'AClowder')) m.slots[5] = g.missions.create({ ...g.missions.eligible(2, 0).find((x) => x.id === 'AClowder') });
  });
  await sleep(1200);
  await shot('1-hearts-map');
  const heartAt = await page.evaluate(() => { const b = window.pp.building(window.pp.state.hearts.on); return b ? [b.x, b.y] : null; });
  if (heartAt) {
    await page.evaluate(() => window.pp.tapHeart(Math.floor(Date.now() / 1000)));
    await sleep(600);
  }
  await page.locator('#s-heart').click(); await sleep(400);
  await shot('2-hearts-popup');
  for (let i = 0; i < 5; i++) { await page.locator('.bigheart').click(); await sleep(150); }
  await sleep(500);
  await shot('3-heart-reward-card');
  if (await page.locator('.panel .close').count()) await closePanel();
  await sleep(800);
  while (await page.locator('.panel.card').count()) { await closePanel(); await sleep(600); }

  // mission list
  await page.locator('#s-missions').click(); await sleep(500);
  await shot('4-mission-list');
  await page.locator('.mrow', { hasText: 'A CLOWDER' }).first().click(); await sleep(500);
  await press('AUTO-FILL ANIMALS');
  await shot('5-mission-detail');
  await press('COMPLETE');
  await sleep(900);
  await shot('6-mission-complete-card');
  while (await page.locator('.panel.card').count()) { await closePanel(); await sleep(600); }

  // wonder: send the vessel for MonumentPart1
  await page.locator('#s-missions').click(); await sleep(400);
  await page.locator('.mrow.t5').first().click(); await sleep(400);
  await shot('7-wonder-mission');
  await press('SEND VESSEL');
  const spot = await page.evaluate(() => {
    for (const [i, j] of [[2, 4], [1, 5], [0, 5], [3, 5], [-1, 5], [2, 6]]) if (window.pp.canPlaceAt('MonumentPart1', i, j)) return [i, j];
    return null;
  });
  await tapCell(spot[0], spot[1]);
  await sleep(500);
  console.log('wonder placed:', await page.evaluate(() => window.pp.state.buildings.some((b) => b.type === 'MonumentPart1')));
  await shot('7b-wonder-placed');
  // a Mission Pod for a mission with clone requirements
  await page.evaluate(() => {
    const g = window.pp;
    const i = g.state.missions.slots.findIndex((a) => a && a.reqs.some((r) => r.code.startsWith('J-')));
    const a = i >= 0 ? g.state.missions.slots[i] : g.state.missions.slots[4];
    if (!a.reqs.some((r) => r.code.startsWith('J-'))) a.reqs[0].code = 'J-0';
    window.__podMission = a.id;
  });
  await page.locator('#s-missions').click(); await sleep(400);
  await page.locator('.mrow').filter({ has: page.locator('.mname') }).nth(await page.evaluate(() => {
    const st = window.pp.state.missions; const rows = [st.wonder, ...st.slots].filter((x) => x !== undefined);
    return rows.findIndex((x) => x && x.id === window.__podMission);
  })).click();
  await sleep(400);
  await press('BUILD MISSION POD');
  const podSpot = await page.evaluate(() => {
    for (const [i, j] of [[1, 5], [0, 5], [3, 5], [-1, 5], [2, 6], [0, 6]]) if (window.pp.canPlaceAt('RocketShip', i, j)) return [i, j];
    return null;
  });
  await tapCell(podSpot[0], podSpot[1]);
  await sleep(600);
  while (await page.locator('.panel').count()) { await closePanel(); await sleep(300); }
  await shot('7c-mission-pod');

  // edit mode
  await page.locator('#s-edit').click(); await sleep(300);
  await tapCell(3, 0);
  await sleep(500);
  await shot('8-edit-mode');
  await press('DONE');

  // Utopium Mine: notif on the map, then its popup
  await sleep(300);
  await shot('9-mine-map');
  await tapCell(2, -1);
  await sleep(500);
  await shot('10-mine-popup');
  await press('COLLECT UTOPIUM');
  await sleep(500);
  await shot('11-mine-collected');
  console.log(name, 'errors:', errors.length ? errors : 'none');
  await browser.close();
}

await run('desktop', { viewport: { width: 1280, height: 800 } });
await run('iphone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });

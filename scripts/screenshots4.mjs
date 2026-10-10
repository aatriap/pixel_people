// HUD round screenshots on an iPhone-sized viewport (390x844, safe areas emulated): map HUD, Arrival Center, character
// card, workplace and vacant slot, residence with the HOLD heart, heart-bar envelope and the gallery.
// Usage: npx vite preview --port 4173 & node scripts/screenshots4.mjs [outDir] [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'capturas/hud';
const base = process.argv[3] || 'http://localhost:4173/';
fs.mkdirSync(out, { recursive: true });
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base);
await page.addStyleTag({ content: ':root { --safe-top: 47px !important; --safe-bottom: 34px !important; }' });
await page.waitForFunction(() => window.ppUI && document.querySelector('#h-coins')?.textContent);
await sleep(1200);
const shot = async (n) => { await sleep(500); await page.screenshot({ path: path.join(out, `${n}.png`) }); console.log('saved', n); };
const ev = (f, a) => page.evaluate(f, a);

// a small city: tutorial skipped, a mine with an engineer, houses, a few jobs and animals
await ev(() => {
  const g = window.pp, ui = window.ppUI, now = Math.floor(Date.now() / 1000);
  g.skipTutorial(); ui.endBuild();
  const s = g.state;
  s.coins = 4_000_000; s.utopium = 200;
  for (const t of ['Residence1', 'Residence1', 'Residence7', 'Residence7']) {
    const [x, y] = g.findFreeSpot(t, [2, 2]); const r = g.place(t, x, y, false, now);
    const b = g.building(r.msg); if (b) b.buildEnd = -1;
  }
  for (const j of ['Engineer', 'Sheriff', 'Deputy', 'Cook', 'Waiter', 'Assistant', 'Philosopher', 'Chef']) if (!s.unlockedJobs.includes(j)) s.unlockedJobs.push(j);
  s.pendingWorkplaces = [];
  for (const t of ['Utopium Mine', 'Sheriffs Office', 'Diner']) {
    const [x, y] = g.findFreeSpot(t, [-2, 2]);
    s.buildings.push({ id: `${t}_x`, type: t, x, y, flip: false, buildStart: 0, buildEnd: -1, shiftStart: now - 30, level: 1 });
  }
  g.addAnimal('Tabby Cat', 2); g.addAnimal('Siamese Cat', 1); g.addAnimal('Snail', 2); g.addAnimal('Hippo', 1);
  s.heartCount = 6; s.landUsed = Math.max(s.landUsed, 22);
  window.ppScene.refresh(); ui.update();
});
await ev(() => {
  // clones: an engineer at the mine, a sheriff, a waiter, plus Arrival Center slots in each state
  const g = window.pp, s = g.state, now = Math.floor(Date.now() / 1000);
  const homes = s.buildings.filter((b) => b.type.startsWith('Residence'));
  let n = 0;
  const add = (job, work, female) => { const id = `p_x${n++}`; s.peeps.push({ id, female, job, home: homes[n % homes.length].id, work, cps: 1 }); return id; };
  add('Engineer', 'Utopium Mine_x', true); add('Sheriff', 'Sheriffs Office_x', true); add('Deputy', 'Sheriffs Office_x', true);
  add('Waiter', 'Diner_x', true);
  const blank = add(null, null, false);
  const waiter = add('Cook', null, false);
  s.slots[0] = { state: 3, start: now, end: now, peep: blank, job: null };
  s.slots[1] = { state: 2, start: now, end: now + 65, peep: null, job: null };
  s.slots[2] = { state: 5, start: now, end: now, peep: waiter, job: 'Cook' };
  window.ppScene.refresh(); window.ppUI.update();
});
await shot('01-map-hud');
await ev(() => window.ppUI.openArrivalCenter());
await shot('02-arrival-center');
await page.locator('.acslot.st5').click();
await shot('03-clone-card-spliced');
await page.locator('.pp-back').click();
await page.locator('.acslot.st3').click();
await shot('04-clone-card-blank');
await ev(() => window.ppUI.close());
await ev(() => window.ppUI.openBuilding('Utopium Mine_x'));
await shot('05-utopium-mine');
await page.locator('.wrow.empty').first().click();
await shot('06-vacant');
await ev(() => window.ppUI.openBuilding('Sheriffs Office_x'));
await shot('07-sheriff');
await page.locator('.wrow:not(.empty)').first().click();
await shot('08-clone-card-employed');
await ev(() => window.ppUI.openBuilding('Diner_x'));
await shot('09-diner');
await page.locator('[data-k^="pp-stats"]').click();
await shot('10-diner-stats');
await ev(() => window.ppUI.close());
// a heart over a house: tap it, then hold
const house = await ev(() => { const g = window.pp; const b = g.state.buildings.find((x) => x.type === 'Residence7'); g.state.hearts.on = b.id; window.ppUI.update(); return b.id; });
await ev((id) => window.ppUI.tapHeartOn(id), house);
await shot('11-residence-heart');
const hb = await page.locator('.rs-hold').boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 3);
await page.mouse.down();
await sleep(800);
await page.screenshot({ path: path.join(out, '12-residence-holding.png') });
await sleep(1200);
await page.mouse.up();
await shot('13-residence-collected');
// fill the bar: the envelope arrives on its own
await ev(() => { const g = window.pp; g.state.heartCount = 10; g.state.hearts.on = g.state.buildings.find((x) => x.type === 'Residence1').id; g.state.level = 4; window.ppUI.close(); });
const h2 = await ev(() => window.pp.state.hearts.on);
await ev((id) => window.ppUI.tapHeartOn(id), h2);
const hb2 = await page.locator('.rs-hold').boundingBox();
await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 3);
await page.mouse.down(); await sleep(2000); await page.mouse.up();
await sleep(1500);
await shot('14-heart-envelope');
await ev(() => { window.ppUI.close(); window.pp.state.packets = []; });
await page.locator('#p-jobs').click();
await shot('15-gallery-jobs');
await page.locator('[data-k="gal-next"]').click();
await shot('16-gallery-jobs-p2');
await page.locator('[data-k="gal-switch"]').click();
await shot('17-gallery-animals');
await ev(() => window.ppUI.close());
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();

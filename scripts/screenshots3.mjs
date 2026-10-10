// Milestone 3 screenshots: the tutorial played through the UI, then calendar, guests and mini-quests,
// achievements, Altar, Arcade, TV Station and settings, on desktop and on a 390x844 phone.
// Usage: npx vite preview --port 4173 & node scripts/screenshots3.mjs [outDir] [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'capturas/etapa3';
const base = process.argv[3] || 'http://localhost:4173/';
fs.mkdirSync(out, { recursive: true });
const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(name, ctxOpts, fullTutorial) {
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.ppCell && document.querySelector('#h-coins')?.textContent);
  await sleep(1500);
  const shot = async (n) => { await page.screenshot({ path: path.join(out, `${name}-${n}.png`) }); console.log('saved', name, n); };
  const tapAt = async (p) => {
    if (ctxOpts.hasTouch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    await sleep(600);
  };
  const tapCell = async (i, j) => tapAt(await page.evaluate(([i, j]) => window.ppCell(i, j), [i, j]));
  const tapBuilding = async (type) => {
    const [x, y] = await page.evaluate((t) => { const b = window.pp.state.buildings.find((b) => b.type === t || b.id === t); return [b.x, b.y]; }, type);
    await tapCell(x, y);
  };
  const click = async (sel) => { await page.locator(sel).first().click(); await sleep(500); };
  const openB = async (type) => {
    await page.evaluate((t) => { const b = window.pp.state.buildings.find((b) => b.type === t); window.ppScene.focusOn(b.id); window.ppUI.openBuilding(b.id); }, type);
    await sleep(700);
  };
  const step = () => page.evaluate(() => window.pp.state.tutorial);
  const closePanel = async () => { if (await page.locator('.panel .close').count()) { await page.locator('.panel .close').first().click(); await sleep(400); } };

  // ---------------------------------------------------------------- tutorial
  if ((await step()) !== 0) throw new Error('a new game should start at tutorial step 0');
  await shot('01-tutorial-start');
  await click('button[data-k="tut-next"]');
  await sleep(800);
  await shot('02-tutorial-flashing-square');
  await tapCell(...(await page.evaluate(() => window.ppUI.tutSpot('Residence1')))); // tap the flashing square
  await sleep(800);
  if ((await step()) !== 2) throw new Error(`placing the house should reach step 2, got ${await step()}`);
  const site = await page.evaluate(() => window.pp.state.buildings.find((b) => b.buildEnd >= 0).id);
  await tapBuilding(site);
  await shot('03-tutorial-rush');
  if (fullTutorial) {
    await click('button[data-k="bld-rush"]');
    await closePanel();
    await click('button[data-k="tut-next"]');            // 4 -> 5
    await click('#f-ac');                                  // 5 -> 6
    await click('button[data-k="tut-next"]');            // 6 -> 7
    await sleep(1600);
    await click('button[data-k^="arr"]');                 // 7 -> 8
    await sleep(600);
    await click('.slot .portrait.tap');                    // 8 -> 9
    await click('button[data-k^="spl"]');                 // 9 -> 10
    await shot('04-tutorial-splicer');
    await click('button[data-k="tut-next"]');            // 10 -> 11
    await click('.spcol.l .gene[data-job="Mayor"]');       // 11 -> 12
    await click('.spcol.r .gene[data-job="Mechanic"]');    // 12 -> 13
    await click('button[data-k="splice-go"]');             // 13 -> 14
    await sleep(9000);                                     // 7 s splice, then the card
    await shot('05-tutorial-eureka');
    await click('button[data-k="disc-place"]');            // 15 -> 16
    await sleep(800);
    await tapCell(...(await page.evaluate(() => window.ppUI.tutSpot('Utopium Mine')))); // 16 -> 17
    await sleep(600);
    const mine = await page.evaluate(() => window.pp.state.buildings.find((b) => b.type === 'Utopium Mine').id);
    await tapBuilding(mine);
    await click('button[data-k="bld-rush"]');              // 17 -> 18
    await closePanel();
    await click('#f-ac');                                  // 18 -> 19
    await click('.slot .portrait.tap');                    // 19 -> 20
    await click('button[data-k^="as"][data-k$="Utopium Mine"]'); // 20 -> 21
    await closePanel();
    await click('button[data-k="tut-next"]');            // 21 -> 22
    await shot('06-tutorial-tap-mine');
    await tapBuilding(mine);                               // 22 -> 23
    for (let k = 0; k < 3; k++) await click('button[data-k="tut-next"]');
    await sleep(800);
    if ((await step()) !== -1) throw new Error(`tutorial should be done, at step ${await step()}`);
    await shot('07-tutorial-done');
  } else {
    await closePanel();
    await click('#f-menu');
    await shot('07-settings-in-tutorial');
    await click('button[data-k="set-skip"]');
    await click('button[data-k="confirm-yes"]');
    await sleep(600);
    if ((await step()) !== -1) throw new Error('skip tutorial failed');
  }

  // ---------------------------------------------------------------- a mid-game city
  await page.evaluate(() => {
    const g = window.pp;
    const put = (type, x, y) => {
      for (let r = 0; r < 12; r++) for (let dx = -r; dx <= r; dx++) for (const dy of [-r, r]) {
        for (const [a, b] of [[x + dx, y + dy], [x + dy, y + dx]]) {
          if (g.canPlaceAt(type, a, b)) {
            const id = `${type}_s${++g.state.counter}`;
            g.state.buildings.push({ id, type, x: a, y: b, flip: false, buildStart: -1, buildEnd: -1, shiftStart: -1, level: 1 });
            return id;
          }
        }
      }
      throw new Error('no room for ' + type);
    };
    for (const t of ['Altar', 'Arcade', 'TV Station', 'Police Station', 'Park', 'Bank', 'MissionControl', 'Observatory', 'Funeral Parlor', 'Residence4']) put(t, 0, -4);
    put('PlainR', 3, 2); put('PlainR', 4, 2); put('PlainR', 5, 2);
    for (const [a, n] of [['Tabby Cat', 3], ['Tom Cat', 2], ['Pug', 2], ['Corgi', 1], ['Horse', 1], ['Cow', 2], ['Pig', 1]]) g.state.animals[a] = n;
    g.state.coins = 3_000_000; g.state.utopium = 400; g.state.chroma = 900; g.state.level = 8;
    g.state.skins.push('TownHallSkinA', 'BankSkinA');
    g.state.buildings.find((b) => b.type === 'Town Hall').skin = 'TownHallSkinA';
    g.state.buildings.find((b) => b.type === 'Residence1').paint = [0xff4fa0, 0x3fd0ff];
    g.state.spiritWatch = true;
    g.state.dailyGift = true;
    g.state.missions.completed = 1;
    g.miniquests.save(2).qty = 1;
    g.achievements.complete(21); g.achievements.complete(22); g.achievements.complete(15);
  });
  await sleep(2500);
  await shot('08-city-guest-skin-paint');

  // calendar
  await click('#s-cal');
  await shot('09-calendar');
  await closePanel();

  // mini-quest guest on the road
  const gp = await page.evaluate(() => window.ppScene.guestScreen());
  if (gp) await tapAt(gp);
  if (!(await page.locator('.miniquest').count())) await page.evaluate(() => window.ppUI?.x.openMiniQuests());
  await sleep(400);
  await shot('10-miniquest');
  await closePanel();

  // achievements (Police Station / side button)
  await click('#s-ach');
  await shot('11-achievements');
  await closePanel();

  // Altar
  await openB('Altar');
  await click('button[data-k="altar"]');
  await page.locator('.altar .acell', { hasText: 'TABBY' }).first().click(); await sleep(200);
  await page.locator('.altar .acell', { hasText: 'TOM' }).first().click(); await sleep(300);
  await shot('12-altar');
  await click('button[data-k="altar-splice"]');
  await sleep(800);
  await shot('13-altar-result');
  await closePanel();

  // Arcade
  await openB('Arcade');
  await click('button[data-k="arcade"]');
  await shot('14-arcade');
  await click('button[data-k="claw-c"]');
  await click('button[data-k="confirm-yes"]');
  await sleep(800);
  await shot('15-arcade-new-skin');
  await closePanel();

  // TV Station
  await openB('TV Station');
  await click('button[data-k="tv"]');
  await shot('16-tv-catalogue');
  await click('button[data-k="tv-packs"]');
  await shot('17-tv-chroma-shop');
  await click('button[data-k="tv-coins"]');
  await shot('18-tv-get-coins');
  await closePanel();

  // building popup with skin selector, residence paint
  await openB('Town Hall');
  await shot('19-skin-selector');
  await closePanel();
  await openB('Residence1');
  await shot('20-paint');
  await closePanel();

  // settings
  await click('#f-menu');
  await shot('21-settings');
  await click('button[data-k="set-reset"]');
  await shot('22-reset-confirm');
  await click('button[data-k="confirm-no"]');
  await closePanel();

  console.log(name, 'errors:', errors.length ? errors : 'none');
  await browser.close();
}

await run('desktop', { viewport: { width: 1280, height: 800 } }, true);
await run('phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, false);

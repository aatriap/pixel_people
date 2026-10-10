import { describe, expect, it } from 'vitest';
import { Game, SPECIAL_GENE_POOL } from '../src/logic/game';
import { seeded } from '../src/logic/rng';
import { ACHIEVEMENTS, ANIMAL, LAND, OFFERS } from '../src/logic/data';
import {
  CAL_EPOCH, WEEK, calendarAt, dailyReward, realEventAt, seasonAt, weekRewards, weekday, layoutFor,
} from '../src/logic/calendar';
import { TUTORIAL } from '../src/logic/tutorial';
import { MQ } from '../src/logic/miniquests';
import { ACH, pageJobs } from '../src/logic/achievements';
import {
  BASE_CATS, BASE_DOGS, CATALOGUE, PACK_ITEMS, altarResult, dealPrice, exchangeCoins, packItemChroma,
} from '../src/logic/shop';
import { Building, migrate, newGame } from '../src/logic/state';
import { landRow } from '../src/logic/formulas';

// 2027-01-15 is a Friday. T0 is 09:00 UTC, and the tests use UTC as "local" time.
const DAY0 = Date.UTC(2027, 0, 15) / 1000;
const T0 = DAY0 + 9 * 3600;

function game(seed = 1, now = T0, tutorial = false): Game {
  const g = Game.fresh(now, tutorial);
  g.rng = seeded(seed);
  g.localOffset = () => 0;
  return g;
}

let n = 0;
function add(g: Game, type: string, x?: number, y?: number): Building {
  n++;
  const b = { id: `${type}_t${n}`, type, x: x ?? 40 + n * 3, y: y ?? 40, flip: false, buildStart: -1, buildEnd: -1, shiftStart: -1, level: 1 };
  g.state.buildings.push(b);
  return b;
}

// ------------------------------------------------------------------ tutorial
describe('tutorial (01 §5)', () => {
  it('a new game starts at step 0; old saves count as done', () => {
    expect(newGame(T0, true).tutorial).toBe(0);
    const old = newGame(T0) as unknown as Record<string, unknown>;
    delete old.tutorial;
    expect(migrate(old as never).tutorial).toBe(-1);
    expect(TUTORIAL).toHaveLength(26);
    expect(TUTORIAL[0].text).toBe('Tutorial_Desc_1');
    expect(TUTORIAL[23].text).toBe('Tutorial_Desc_24');
  });

  it('plays through all the steps with the real actions', () => {
    const g = game(3, T0, true);
    let t = T0;
    expect(g.tutorialActive()).toBe(true);
    expect(g.tut('openAC')).toBe(false); // wrong action: nothing happens
    expect(g.tut('next')).toBe(true);
    const [hx, hy] = g.findFreeSpot('Residence1');
    const r = g.place('Residence1', hx, hy, false, t);
    expect(r.ok).toBe(true);
    expect(g.state.coins).toBe(9000);
    expect(g.state.tutorial).toBe(2);
    g.tut('openSite');
    expect(g.rushConstruction(r.msg!, t).ok).toBe(true);
    expect(g.state.tutorial).toBe(4);
    g.tut('next'); g.tut('openAC');
    g.tick(++t);
    expect(g.state.slots.some((s) => s.state === 2)).toBe(false); // arrivals only start at step 7
    g.tut('next');
    expect(g.state.tutorial).toBe(7);
    g.tick(++t);
    expect(g.state.slots[0].state).toBe(2);
    expect(g.rushArrival(0, t).ok).toBe(true);
    expect(g.state.tutorial).toBe(8);
    for (const a of ['tapPortrait', 'spliceMe', 'next', 'pickMayor', 'pickMechanic'] as const) expect(g.tut(a)).toBe(true);
    expect(g.startSplice(0, 'Mayor', 'Mechanic', t).ok).toBe(true);
    expect(g.state.slots[0].end - t).toBeLessThanOrEqual(7); // 7 s splicing in the tutorial
    expect(g.state.tutorial).toBe(14);
    for (let i = 0; i < 8; i++) g.tick(++t);
    expect(g.state.slots[0].state).toBe(5);
    expect(g.state.packets[0]).toMatchObject({ type: 0, id: 'Engineer' });
    g.tut('card');
    g.closePacket();
    g.tut('closeCard');
    expect(g.state.tutorial).toBe(16);
    const [mx, my] = g.findFreeSpot('Utopium Mine');
    const m = g.place('Utopium Mine', mx, my, false, t);
    expect(m.ok).toBe(true);
    expect(g.state.tutorial).toBe(17);
    g.rushConstruction(m.msg!, t);
    g.tut('openAC'); g.tut('tapPortrait');
    expect(g.assignClone(0, 'Utopium Mine').ok).toBe(true);
    expect(g.state.tutorial).toBe(21);
    g.tut('next');
    expect(g.tapWorkplace(m.msg!, t).ok).toBe(true);
    expect(g.state.tutorial).toBe(23);
    g.tut('next'); g.tut('next');
    expect(g.tutorialActive()).toBe(true);
    g.tut('next');
    expect(g.state.tutorial).toBe(-1);
    expect(g.state.utopium).toBe(25); // "UTOPIUM WILL RESET AFTER TUTORIAL"
  });

  it('blocks the daily reset, hearts and tree rewards while active', () => {
    const g = game(1, T0, true);
    g.state.landUsed = 30;
    g.state.dailyUtopium = false;
    for (let i = 0; i < 200; i++) g.tick(T0 + i);
    expect(g.state.dailyResetTime).toBe(0);
    expect(g.state.dailyUtopium).toBe(false);
    expect(g.state.hearts.on).toBeNull();
    expect(g.trees().some((t) => t.treeReady)).toBe(false);
    expect(g.splicingDuration()).toBeLessThanOrEqual(7);
    expect(g.skipTutorial().ok).toBe(true);
    expect(g.state.tutorial).toBe(-1);
    g.tick(T0 + 201);
    expect(g.state.dailyUtopium).toBe(true);
  });
});

// ------------------------------------------------------------------ calendar
describe('calendar (04 §5)', () => {
  const at = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h) / 1000;

  it('Halloween forces Harvest for the week holding 31/10', () => {
    // 2027-10-31 is a Sunday: the event week runs Mon 25/10 .. Sun 31/10
    const plain = seasonAt(at(2027, 10, 27));
    expect(realEventAt(at(2027, 10, 27))?.name).toBe('Halloween');
    expect(calendarAt(at(2027, 10, 27)).season).toBe(2);
    expect(plain).not.toBe(2);
    expect(realEventAt(at(2027, 11, 1))).toBeNull();
    expect(realEventAt(at(2027, 10, 24))).toBeNull();
  });

  it('Christmas forces Frost for two weeks from the week of 9/12', () => {
    // 2027-12-09 is a Thursday: Mon 6/12 .. Sun 19/12
    expect(calendarAt(at(2027, 12, 6, 0)).season).toBe(3);
    expect(calendarAt(at(2027, 12, 19, 23)).season).toBe(3);
    expect(realEventAt(at(2027, 12, 20))).toBeNull();
    expect(realEventAt(at(2027, 12, 12))?.weekOf).toBe(0);
    expect(realEventAt(at(2027, 12, 13))?.weekOf).toBe(1);
  });

  it('reward cycles are 4-week blocks and events move the cycle on', () => {
    expect(calendarAt(CAL_EPOCH).cycle).toBe(0);
    expect(calendarAt(CAL_EPOCH + 4 * WEEK).cycle).toBe(1);
    expect(calendarAt(CAL_EPOCH + 7 * 4 * WEEK).cycle).toBe(0); // 7 cycles in calendar.tsv
    const ev = at(2027, 12, 13);
    const plainCycle = Math.floor((ev - CAL_EPOCH) / (4 * WEEK)) % 7;
    expect(calendarAt(ev).cycle).toBe((plainCycle + 2) % 7);
    expect(layoutFor(3, 0)).toBe(4);
    // Frost layout: Chroma 10, Gift, Utopium 1, Chroma 10, Gift, Utopium 1, Gift
    const fr = weekRewards(at(2027, 12, 13))!;
    expect(fr.map((r) => r.kind)).toEqual(['chroma', 'gift', 'utopium', 'chroma', 'gift', 'utopium', 'gift']);
    expect(dailyReward(at(2027, 12, 14))).toEqual({ kind: 'gift', n: 1 });
    expect(weekday(at(2027, 12, 14))).toBe(1);
  });

  it('collecting marks the day, feeds the Calendar mini-quest and works once a day', () => {
    const g = game();
    g.state.level = 5;
    g.tick(T0);
    expect(g.collectCalendar(T0).ok).toBe(true);
    expect(g.state.calendarCollected).toEqual([Math.floor(T0 / 86400)]);
    expect(g.miniquests.isFulfilled(MQ.CALENDAR)).toBe(true);
    expect(g.collectCalendar(T0).ok).toBe(false);
    g.tick(DAY0 + 86400 + 10);
    expect(g.state.dailyGift).toBe(true);
    // a new week clears the ticks
    g.tick(DAY0 + 4 * 86400);
    expect(g.state.calendarCollected).toEqual([]);
  });

  it('seasonal unique missions and animals follow the forced season', () => {
    const g = game();
    expect(g.season(at(2027, 10, 27))).toBe(2);
    const pool = g.missions.eligible(4, 2);
    expect(pool.every((m) => !m.season || m.season === 'HARVEST')).toBe(true);
  });
});

// ------------------------------------------------------------------ mini-quests
describe('mini-quests (04 §3)', () => {
  it('Park: build 3 decor, collect U-2, then SpiritDiscount needs one level up', () => {
    const g = game();
    add(g, 'Park');
    expect(g.miniquests.available(T0)).toContain(MQ.PARK);
    g.state.coins = 1e7;
    for (let i = 0; i < 3; i++) {
      const [x, y] = g.findFreeSpot('Bush1');
      expect(g.place('Bush1', x, y, false, T0).ok).toBe(true);
    }
    expect(g.miniquests.isFulfilled(MQ.PARK)).toBe(true);
    expect(g.miniquests.collect(MQ.PARK, T0).ok).toBe(true);
    expect(g.state.packets.slice(-1)[0]).toMatchObject({ type: 5, value: 2 });
    expect(g.miniquests.isReady(MQ.SPIRIT, T0)).toBe(false);
    g.expandLand();
    while (g.state.packets.length) g.closePacket();
    expect(g.miniquests.isReady(MQ.SPIRIT, T0)).toBe(true);
    g.state.spirit = 1000;
    expect(g.miniquests.isFulfilled(MQ.SPIRIT)).toBe(true);
  });

  it('Altar: welcome gift, any splice, then tier 3 and tier 5 only', () => {
    const g = game();
    add(g, 'Altar');
    expect(g.miniquests.isFulfilled(MQ.ALTAR)).toBe(true); // "-" requirement
    g.miniquests.collect(MQ.ALTAR, T0);
    expect(g.state.packets.slice(-1)[0].type).toBe(10);
    g.miniquests.increment(MQ.ALTAR, T0, 1);
    expect(g.miniquests.collect(MQ.ALTAR, T0).ok).toBe(true);
    g.miniquests.increment(MQ.ALTAR, T0, 2);
    expect(g.miniquests.isFulfilled(MQ.ALTAR)).toBe(false);
    g.miniquests.increment(MQ.ALTAR, T0, 3);
    expect(g.miniquests.isFulfilled(MQ.ALTAR)).toBe(true);
  });

  it('weekly quests: Calendar needs land level 5 and one stage per week; Town Hall needs level 8', () => {
    const g = game();
    expect(g.miniquests.isReady(MQ.CALENDAR, T0)).toBe(false);
    g.state.level = 5;
    g.miniquests.increment(MQ.CALENDAR, T0);
    g.miniquests.collect(MQ.CALENDAR, T0);
    expect(g.miniquests.isReady(MQ.CALENDAR, T0 + 3600)).toBe(false);
    expect(g.miniquests.isReady(MQ.CALENDAR, T0 + 7 * 86400)).toBe(true);
    expect(g.miniquests.isReady(MQ.TOWNHALL, T0)).toBe(false);
    g.state.level = 8;
    g.manualSave(T0);
    expect(g.miniquests.collect(MQ.TOWNHALL, T0).ok).toBe(true);
  });

  it('Bank counts full workplaces; Utopia HQ counts missions from 0 at each stage', () => {
    const g = game();
    add(g, 'Bank');
    expect(g.miniquests.qty(MQ.BANK)).toBe(0);
    add(g, 'MissionControl');
    g.miniquests.increment(MQ.MISSION, T0);
    g.miniquests.collect(MQ.MISSION, T0);
    expect(g.miniquests.stage(MQ.MISSION)!.req).toBe(5);
    expect(g.miniquests.qty(MQ.MISSION)).toBe(0);
  });

  it('the 2005 guest appears while some mini-quest is available', () => {
    const g = game();
    expect(g.guests(T0).some((x) => x.code === 2005)).toBe(false);
    add(g, 'TV Station');
    expect(g.guests(T0).some((x) => x.code === 2005)).toBe(true);
  });
});

// ------------------------------------------------------------------ special genes / guest 2001
describe('special-gene guests (02 §3.8, 04 §4)', () => {
  it('processUnlockSpecialJobs hands out Dreamer/Salesman/Explorer at 10/30/60 jobs', () => {
    const g = game();
    g.processUnlockSpecialJobs();
    expect(g.state.unclaimedJobs).toEqual([]);
    while (g.state.unlockedJobs.length < 10) g.state.unlockedJobs.push(`J${g.state.unlockedJobs.length}`);
    g.processUnlockSpecialJobs();
    expect(g.state.unclaimedJobs).toHaveLength(1);
    expect(SPECIAL_GENE_POOL).toContain(g.state.unclaimedJobs[0]);
    while (g.state.unlockedJobs.length < 60) g.state.unlockedJobs.push(`J${g.state.unlockedJobs.length}`);
    g.processUnlockSpecialJobs();
    expect([...g.state.unclaimedJobs].sort()).toEqual(['Bureaucrat', 'Dreamer', 'Explorer', 'Salesman']);
    expect(g.guests(T0).filter((x) => x.code === 2001)).toHaveLength(4);
    g.claimSpecialGene('Dreamer');
    g.closePacket();
    expect(g.state.unlockedJobs).toContain('Dreamer');
    expect(g.state.unclaimedJobs).not.toContain('Dreamer');
    g.processUnlockSpecialJobs();
    expect(g.state.unclaimedJobs).not.toContain('Dreamer');
  });
});

// ------------------------------------------------------------------ achievements
describe('achievements (04 §6)', () => {
  it('index 1 is FoundingFathers and job pages are 20 ids long', () => {
    expect(ACHIEVEMENTS[0]).toMatchObject({ index: 1, id: 'Ach_FoundingFathers', sprite: 'ac1' });
    expect(pageJobs(1)).toContain('Mayor');
    expect(pageJobs(1).length).toBeLessThanOrEqual(20);
  });

  it('checks thresholds, fires direct events and pays utopium on a card', () => {
    const g = game();
    g.state.coins = 1e7;
    add(g, 'Park');
    for (let i = 0; i < 5; i++) { const [x, y] = g.findFreeSpot('Bush1'); g.place('Bush1', x, y, false, T0); }
    g.tick(T0);
    expect(g.achievements.isDone(13)).toBe(true);  // Decorator
    expect(g.achievements.isDone(14)).toBe(false);
    const bush = g.state.buildings.filter((b) => b.type === 'Bush1')[1];
    g.moveBuilding(bush.id, 30, 30);
    expect(g.achievements.isDone(ACH.MOVER)).toBe(true);
    g.deleteBuilding(bush.id);
    expect(g.achievements.isDone(ACH.DONT_PANIC)).toBe(true);
    g.state.stats.mining = 1;
    g.tick(T0 + 1);
    expect(g.achievements.isDone(29)).toBe(true);
    const r = g.achievements.collect(13);
    expect(r.ok).toBe(true);
    expect(g.state.packets.slice(-1)[0]).toMatchObject({ type: 5, value: 1 });
    expect(g.achievements.collect(13).ok).toBe(false);
    expect(g.achievements.collect(22).ok).toBe(true); // MoverAndShaker: 1 u
    g.achievements.complete(25);                      // Omit = Y: never completes
    expect(g.achievements.isDone(25)).toBe(false);
  });

  it('adoptions, research and the Hotel', () => {
    const g = game();
    g.state.stats.adoptions = 20;
    g.state.researchLevel = 6;
    g.tick(T0);
    for (const i of [36, 37, 38, 39]) expect(g.achievements.isDone(i)).toBe(true);
    g.state.hotel = ['a', 'b', 'c', 'd', 'e', 'f'];
    g.achievements.check();
    expect(g.achievements.isDone(ACH.CHECKED_IN)).toBe(true);
    expect(g.achievements.isDone(ACH.NO_VACANCY)).toBe(true);
  });
});

// ------------------------------------------------------------------ Altar
describe('Altar (02 §6)', () => {
  it('two base cats give another base cat; two base dogs another dog; recipes in any order', () => {
    expect(BASE_CATS).toEqual(['Tabby Cat', 'Tom Cat', 'Tuxedo Cat', 'Siamese Cat', 'Calico', 'Box Cat']);
    expect(BASE_DOGS).toHaveLength(8);
    const r = altarResult('Tabby Cat', 'Tom Cat');
    expect(r.kind).toBe('cat');
    if (r.kind === 'cat') expect(r.pool).not.toContain('Tabby Cat');
    expect(altarResult('Horse', 'Hippopotamus')).toEqual({ kind: 'recipe', animal: 'Pig' });
    expect(altarResult('Hippopotamus', 'Horse')).toEqual({ kind: 'recipe', animal: 'Pig' });
    expect(altarResult('Tabby Cat', 'Pug').kind).toBe('none');
  });

  it('costs getFractionOfLevelUpExpense(Cost, 50000), consumes both parents, instant result', () => {
    const g = game();
    add(g, 'Altar');
    g.state.animals = { Horse: 1, Hippopotamus: 1, 'Tabby Cat': 1 };
    const base = Math.trunc((1 - g.discount()) * landRow(LAND, 1).cost / 100);
    expect(g.shop.altarCost('Horse', 'Hippopotamus')).toBe(Math.trunc(0.45 * base));
    g.state.level = 42;
    expect(g.shop.altarCost('Horse', 'Hippopotamus')).toBe(50000);
    g.state.level = 1;
    const before = g.state.coins;
    expect(g.shop.altarIndicator('Horse', 'Hippopotamus')).toBe('new');
    const r = g.shop.altarSplice('Horse', 'Hippopotamus', T0);
    expect(r.ok).toBe(true);
    expect(g.state.coins).toBe(before - Math.trunc(0.45 * base));
    expect(g.state.animals.Horse).toBeUndefined();
    expect(g.state.packets.slice(-1)[0]).toMatchObject({ type: 14, id: 'Pig' });
    g.closePacket();
    expect(g.state.animals.Pig).toBe(1);
    expect(g.shop.altarIndicator('Horse', 'Hippopotamus')).toBe('old');
    expect(g.shop.altarSplice('Tabby Cat', 'Tabby Cat', T0).ok).toBe(false); // needs 2
    g.state.animals['Tabby Cat'] = 2;
    expect(g.shop.altarSplice('Tabby Cat', 'Tabby Cat', T0).ok).toBe(true);
    const out = g.state.packets.slice(-1)[0].id;
    expect(BASE_CATS).toContain(out);
    expect(out).not.toBe('Tabby Cat');
    expect(ANIMAL.get(out)!.tier).toBe(1);
  });
});

// ------------------------------------------------------------------ Arcade, skins, paint
describe('Arcade "The Claw", skins and paint (05 §1, §3.5)', () => {
  it('50 u or 300 chroma for a random locked skin, never a duplicate', () => {
    const g = game();
    add(g, 'Arcade');
    g.state.utopium = 50;
    g.state.chroma = 300;
    expect(g.shop.playClaw('utopium').ok).toBe(true);
    expect(g.state.utopium).toBe(0);
    expect(g.shop.playClaw('chroma').ok).toBe(true);
    expect(g.state.chroma).toBe(0);
    while (g.state.packets.length) g.closePacket();
    expect(new Set(g.state.skins).size).toBe(2);
    g.state.skins = OFFERS.skins.slice(1).map((s) => s.skin);
    g.state.utopium = 100;
    g.shop.playClaw('utopium');
    expect(g.state.packets.slice(-1)[0].id.split('~')[0]).toBe(OFFERS.skins[0].skin);
    g.closePacket();
    const r = g.shop.playClaw('utopium');
    expect(r.ok).toBe(false); // all unlocked: no charge
    expect(g.state.utopium).toBe(50);
  });

  it('skins switch only to unlocked ones of the same building; paint uses two random colours', () => {
    const g = game();
    const bank = add(g, 'Bank');
    expect(g.shop.setSkin(bank.id, 'BankSkinA').ok).toBe(false);
    g.state.skins.push('BankSkinA');
    expect(g.shop.skinsFor('Bank')).toEqual(['BankSkinA']);
    expect(g.shop.setSkin(bank.id, 'BankSkinA').ok).toBe(true);
    expect(bank.skin).toBe('BankSkinA');
    expect(g.shop.setSkin(bank.id, 'MarketSkinA').ok).toBe(false);
    g.shop.setSkin(bank.id, null);
    expect(bank.skin).toBeUndefined();
    const house = g.state.buildings.find((b) => b.type === 'Residence1')!;
    g.shop.paint(house.id);
    expect(house.paint).toHaveLength(2);
    expect(house.paint!.every((c) => c >= 0 && c <= 0xffffff)).toBe(true);
    g.shop.resetPaint(house.id);
    expect(house.paint).toBeUndefined();
  });
});

// ------------------------------------------------------------------ TV Station
describe('TV Station (05 §3.3, §5.1)', () => {
  it('daily catalogue: one offer per tier, utopium or chroma, out of stock after one', () => {
    const g = game();
    add(g, 'TV Station');
    g.tick(T0);
    expect(g.state.deals.map((d) => CATALOGUE.find((c) => c.id === d.id)!.tier)).toEqual([1, 2, 3]);
    const p = dealPrice(g.state.deals[0].id)!;
    g.state.chroma = 1000;
    expect(g.shop.buyDeal(0, 'chroma', T0).ok).toBe(true);
    expect(g.state.chroma).toBe(1000 - p.chroma);
    expect(g.shop.buyDeal(0, 'utopium', T0).msg).toBe('OUT OF STOCK');
    expect(g.state.inventory.slice(-1)[0].type).toBe(g.state.deals[0].id);
    expect(g.miniquests.isFulfilled(MQ.TV)).toBe(true);
    g.state.utopium = 5;
    expect(g.shop.refreshDeals().ok).toBe(true);
    expect(g.state.utopium).toBe(0);
    expect(dealPrice('iapDecorCarousel')).toEqual({ utopium: 28, chroma: 200 });
    expect(dealPrice('noniapHouseTent1')).toEqual({ utopium: 6, chroma: 50 });
  });

  it('the 24 pack-only items are sold for chroma (inferido rule) and unlock them for building', () => {
    expect(PACK_ITEMS).toHaveLength(24);
    expect(packItemChroma('SpecialDecor1')).toBe(120);
    expect(packItemChroma('SpecialResidence1')).toBe(200);
    expect(packItemChroma('SpecialResidence4')).toBe(100);
    expect(packItemChroma('SpecialTree1')).toBe(20);
    const g = game();
    g.state.coins = 1e7; g.state.utopium = 100;
    add(g, 'Park');
    const [x, y] = g.findFreeSpot('SpecialDecor1');
    expect(g.place('SpecialDecor1', x, y, false, T0).ok).toBe(false);
    add(g, 'TV Station');
    g.state.chroma = 120;
    expect(g.shop.buyPackItem('SpecialDecor1', T0).ok).toBe(true);
    expect(g.state.chroma).toBe(0);
    expect(g.state.inventory.slice(-1)[0].type).toBe('SpecialDecor1');
    expect(g.place('SpecialDecor1', x, y, false, T0).ok).toBe(true);
    expect(g.shop.buyPackItem('SpecialDecor1', T0).ok).toBe(false);
  });

  it('utopium -> coins exchange: fixed below land level 9, formula from 9', () => {
    expect([0, 1, 2, 3].map((i) => exchangeCoins(i, 8))).toEqual([50000, 275000, 1525000, 3050000]);
    const C = landRow(LAND, 9).cost;
    expect(exchangeCoins(0, 9)).toBe(Math.trunc(Math.trunc(C / 40) * 0.8));
    expect(exchangeCoins(1, 9)).toBe(Math.trunc(Math.trunc(C / 8) * 0.9));
    expect(exchangeCoins(2, 9)).toBe(C / 2);
    expect(exchangeCoins(3, 9)).toBe(C);
    const g = game();
    g.state.utopium = 30;
    expect(g.shop.exchange(1).ok).toBe(true);
    expect(g.state.utopium).toBe(5);
    expect(g.state.coins).toBe(14000 + 275000);
    expect(g.shop.exchange(2).ok).toBe(false);
  });
});

// ------------------------------------------------------------------ special buttons
describe('special buttons (02 §4, 03 §3.2)', () => {
  it('Observatory, Funeral Parlor and News Agency', () => {
    const g = game();
    expect(g.changeBackground().ok).toBe(false);
    add(g, 'Observatory'); add(g, 'Funeral Parlor'); add(g, 'News Bureau');
    for (let i = 0; i < 10; i++) {
      const before = g.state.spaceBg;
      g.changeBackground();
      expect(g.state.spaceBg).not.toBe(before);
      expect(g.state.spaceBg).toBeGreaterThanOrEqual(1);
      expect(g.state.spaceBg).toBeLessThanOrEqual(6);
    }
    expect(g.achievements.isDone(ACH.WARP_SPEED)).toBe(true);
    g.toggleSpiritWatch();
    expect(g.state.spiritWatch).toBe(true);
    g.toggleNewsFeed();
    expect(g.state.newsFeed).toBe(false);
    expect(g.achievements.isDone(ACH.IGNORANCE)).toBe(true);
  });

  it('Mothership deletes a clone for 1 u, never the Mayor, the Mechanic or a special', () => {
    const g = game();
    expect(g.deleteClone('Clone_1').msg).toBe('CANNOT DELETE UNIQUE CHARACTER');
    g.state.peeps.push({ id: 'Clone_77', female: false, job: 'Engineer', home: 'Residence1_1', work: null, cps: 1 });
    g.state.peeps.push({ id: 'Clone_78', female: false, job: 'Dreamer', home: 'Residence1_1', work: null, cps: 1 });
    expect(g.canDeletePeep('Clone_78')).toBe(false);
    const u = g.state.utopium;
    expect(g.deleteClone('Clone_77').ok).toBe(true);
    expect(g.state.utopium).toBe(u - 1);
    expect(g.peep('Clone_77')).toBeUndefined();
  });

  it('reveal formula costs 5 u once; credits pay their reward once', () => {
    const g = game();
    g.state.utopium = 6;
    expect(g.revealFormula('Engineer')).toEqual({ ok: true, msg: 'Mayor + Mechanic' });
    expect(g.state.utopium).toBe(1);
    expect(g.revealFormula('Engineer').ok).toBe(true);
    expect(g.state.utopium).toBe(1);
    expect(g.collectCredit(5).ok).toBe(true);
    expect(g.state.packets.slice(-1)[0]).toMatchObject({ type: 5, value: 1 });
    expect(g.collectCredit(5).ok).toBe(false);
    expect(g.collectCredit(6).ok).toBe(false);
  });
});

// ------------------------------------------------------------------ local notifications
describe('local notifications (04 §7)', () => {
  it('daily reset announces the mine and the shelter, splices and builds announce themselves', () => {
    const g = game();
    add(g, 'Utopium Mine'); add(g, 'Animal Shelter');
    g.tick(T0);
    g.drainEvents();
    g.collectMine();
    g.collectShelter(T0);
    g.tick(DAY0 + 12 * 3600);
    const ev = g.drainEvents().map((e) => e.type);
    expect(ev).toContain('mineReady');
    expect(ev).toContain('shelterReady');
  });
});

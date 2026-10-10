import { describe, expect, it } from 'vitest';
import { Game } from '../src/logic/game';
import { seeded } from '../src/logic/rng';
import { ANIMAL, JOB, LAND, MISSION } from '../src/logic/data';
import {
  getGiftPacketReward, getHeartReward, getRandomAnimal, heartEarnedCoin, nineAnimalsPacket, treeDrop,
} from '../src/logic/rewards';
import { CAL_EPOCH, calendarReward, seasonAt, weekday } from '../src/logic/calendar';
import { MISSION_COIN_FLOOR, parseReq } from '../src/logic/missions';
import { MISSION_SLOT_TYPES, migrate } from '../src/logic/state';
import { timeTillNoon } from '../src/logic/formulas';

// 2027-01-15 is a Friday. T0 is 09:00 UTC, and the tests use UTC as "local" time.
const DAY0 = Date.UTC(2027, 0, 15) / 1000;
const T0 = DAY0 + 9 * 3600;

function game(seed = 1, now = T0): Game {
  const g = Game.fresh(now);
  g.rng = seeded(seed);
  g.localOffset = () => 0;
  return g;
}

let n = 0;
function add(g: Game, type: string, x?: number, y?: number) {
  n++;
  const b = { id: `${type}_t${n}`, type, x: x ?? 40 + n * 3, y: y ?? 40, flip: false, buildStart: -1, buildEnd: -1, shiftStart: -1, level: 1 };
  g.state.buildings.push(b);
  return b;
}

describe('calendar', () => {
  it('rotates the season every week from the 2019-10-07 epoch', () => {
    expect(seasonAt(CAL_EPOCH)).toBe(0);
    expect(seasonAt(CAL_EPOCH + 7 * 86400)).toBe(1);
    expect(seasonAt(CAL_EPOCH + 4 * 7 * 86400 + 5)).toBe(0);
    expect(seasonAt(CAL_EPOCH - 1)).toBe(-1);
    expect(weekday(CAL_EPOCH)).toBe(0); // Monday
    expect(calendarReward(CAL_EPOCH)).toEqual({ kind: 'utopium', n: 1 });
    expect(calendarReward(CAL_EPOCH + 3 * 7 * 86400 + 86400)).toEqual({ kind: 'gift', n: 1 }); // Frost Tuesday
  });
});

describe('daily reset at 12:00 local (01 §4.3)', () => {
  it('runs on the first tick, then at the next noon', () => {
    const g = game();
    g.state.dailyUtopium = false;
    g.state.dailyAnimal = false;
    g.state.treeUtopiumToday = 7;
    g.state.missions.refreshesUsed = 3;
    g.tick(T0);
    expect(g.state.dailyResetTime).toBe(DAY0 + 12 * 3600);
    expect([g.state.dailyUtopium, g.state.dailyAnimal, g.state.treeUtopiumToday, g.state.missions.refreshesUsed])
      .toEqual([true, true, 0, 0]);
    g.state.dailyUtopium = false;
    g.tick(DAY0 + 12 * 3600 - 1);
    expect(g.state.dailyUtopium).toBe(false);
    g.tick(DAY0 + 12 * 3600);
    expect(g.state.dailyUtopium).toBe(true);
    expect(g.state.dailyResetTime).toBe(DAY0 + 36 * 3600);
  });
  it('timeTillNoon counts to the next 12:00', () => {
    expect(timeTillNoon(DAY0)).toBe(43200);
    expect(timeTillNoon(DAY0 + 13 * 3600)).toBe(23 * 3600);
  });
});

describe('Utopium Mine and Animal Shelter', () => {
  it('mine gives U(1,2) once per day', () => {
    const g = game(7);
    add(g, 'Utopium Mine');
    g.tick(T0);
    const u = g.state.utopium;
    const r = g.collectMine();
    expect(r.ok).toBe(true);
    expect([1, 2]).toContain(g.state.utopium - u);
    expect(g.collectMine().ok).toBe(false);
    g.tick(DAY0 + 12 * 3600);
    expect(g.collectMine().ok).toBe(true);
    expect(g.state.stats.mining).toBe(2);
  });
  it('mine draws are 1 or 2 about half the time each', () => {
    const g = game(3);
    add(g, 'Utopium Mine');
    const seen = { 1: 0, 2: 0 } as Record<number, number>;
    for (let i = 0; i < 400; i++) {
      g.state.dailyUtopium = true;
      const u = g.state.utopium;
      g.collectMine();
      seen[g.state.utopium - u]++;
    }
    expect(seen[1] + seen[2]).toBe(400);
    expect(seen[1]).toBeGreaterThan(150);
    expect(seen[2]).toBeGreaterThan(150);
  });
  it('shelter queues one droppable tier 1/2 animal per day', () => {
    const g = game(11);
    add(g, 'Animal Shelter');
    g.tick(T0);
    expect(g.collectShelter(T0).ok).toBe(true);
    expect(g.collectShelter(T0).ok).toBe(false);
    const p = g.state.packets[0];
    expect(p.type).toBe(3);
    expect([1, 2]).toContain(ANIMAL.get(p.id)!.tier);
    g.closePacket();
    expect(g.state.animals[p.id]).toBe(1);
  });
  it('getRandomAnimal(0) is tier 1 about 20% of the time', () => {
    const rng = seeded(5);
    let t1 = 0;
    for (let i = 0; i < 5000; i++) if (ANIMAL.get(getRandomAnimal(rng, 0, -1))!.tier === 1) t1++;
    expect(t1 / 5000).toBeGreaterThan(0.17);
    expect(t1 / 5000).toBeLessThan(0.23);
    const nine = nineAnimalsPacket(seeded(1), 2);
    expect(nine.type).toBe(10);
    expect(nine.id.split('+').length).toBe(9);
  });
});

describe('hearts (notes.md)', () => {
  it('only spawn with 22+ land used: first after 3 s, then U(5,10) s after collecting', () => {
    const g = game(2);
    g.tick(T0);
    g.tick(T0 + 5);
    expect(g.state.hearts.on).toBeNull(); // 15 land used
    g.state.landUsed = 22;
    g.tick(T0 + 5);
    expect(g.state.hearts.on).toBe('Residence1_1');
    expect(g.tapHeart(T0 + 6).ok).toBe(true);
    expect(g.state.heartCount).toBe(1);
    expect(g.heartNext - (T0 + 6)).toBeGreaterThanOrEqual(5);
    expect(g.heartNext - (T0 + 6)).toBeLessThanOrEqual(10);
    g.tick(T0 + 6 + 4);
    expect(g.state.hearts.on).toBeNull();
    g.tick(T0 + 6 + 10);
    expect(g.state.hearts.on).not.toBeNull();
  });
  it('the first one waits 3 s after loading', () => {
    const g = game(2);
    g.state.landUsed = 22;
    g.tick(T0);
    expect(g.state.hearts.on).toBeNull();
    g.tick(T0 + 3);
    expect(g.state.hearts.on).not.toBeNull();
  });
  it('stores at most 10 and opening one queues getHeartReward', () => {
    const g = game(4);
    g.state.landUsed = 30;
    g.state.heartCount = 10;
    g.tick(T0); g.tick(T0 + 20);
    expect(g.state.hearts.on).toBeNull(); // storage full
    expect(g.openHeart(T0 + 20).ok).toBe(true);
    expect(g.state.heartCount).toBe(9);
    expect([3, 4]).toContain(g.state.packets[0].type);
  });
  it('after the First Wonder a tapped heart opens at once', () => {
    const g = game(4);
    g.state.missions.wonderMap.Monument = 9;
    g.state.hearts.on = 'Residence1_1';
    g.tapHeart(T0);
    expect(g.state.heartCount).toBe(0);
    expect(g.state.packets.length).toBe(1);
  });
  it('getHeartReward: coins only below land level 4, ranges per heartEarnedCoin', () => {
    const rng = seeded(9);
    let coins = 0;
    for (let i = 0; i < 2000; i++) {
      const p = getHeartReward(rng, 1, -1);
      if (p.type === 4) { coins++; expect(p.value).toBeGreaterThanOrEqual(5000); expect(p.value).toBeLessThanOrEqual(50000); }
      else expect(p.type).toBe(3);
    }
    expect(coins / 2000).toBeGreaterThan(0.29); // 26/76
    expect(coins / 2000).toBeLessThan(0.39);
    for (let i = 0; i < 300; i++) expect(getHeartReward(rng, 4, -1).type).toBe(3);
    expect(heartEarnedCoin(seeded(1), 97).value).toBeGreaterThan(40000);
    const low = heartEarnedCoin(seeded(1), 10).value;
    expect(low >= 5000 && low <= 8000).toBe(true);
    const mid = heartEarnedCoin(seeded(1), 80).value;
    expect(mid >= 10001 && mid <= 20000).toBe(true);
  });
});

describe('tree rewards (03 §4)', () => {
  it('one tree at a time: ready for U(20,40) ticks, then U(30,120) of rest', () => {
    const g = game(6);
    for (let t = 0; t < 400; t++) {
      g.tick(T0 + t);
      expect(g.trees().filter((b) => b.treeReady).length).toBeLessThanOrEqual(1);
    }
    expect(g.trees().some((b) => b.treeReady) || g.trees().every((b) => (b.treeTimer ?? 0) !== 0)).toBe(true);
  });
  it('loot table: 90% 100 coins, 5% 1000, 4% 1u, 1% 3u; capped days re-roll utopium', () => {
    const rng = seeded(8);
    const c: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) { const d = treeDrop(rng, false); c[d.kind + d.n] = (c[d.kind + d.n] ?? 0) + 1; }
    expect(c.coins100 / 20000).toBeCloseTo(0.9, 1);
    expect(c.utopium1 / 20000).toBeGreaterThan(0.03);
    expect(c.utopium3 / 20000).toBeGreaterThan(0.005);
    for (let i = 0; i < 2000; i++) expect(treeDrop(rng, true).kind).toBe('coins');
  });
  it('daily tree utopium cap: 25, or 50 with Monument4 in Thaw', () => {
    const g = game();
    const thaw = CAL_EPOCH + 4 * 7 * 86400 * 30 + 3600; // a Thaw week
    const swell = thaw + 7 * 86400;
    expect(g.treeDailyUtopium(thaw)).toBe(25);
    g.state.missions.wonderMap.Monument4 = 4;
    expect(g.treeDailyUtopium(thaw)).toBe(50);
    expect(g.treeDailyUtopium(swell)).toBe(25);
  });
  it('tapping a ready tree pays and stops paying utopium at the cap', () => {
    const g = game(12);
    g.tick(T0);
    const tree = g.trees()[0];
    g.state.treeUtopiumToday = 25;
    for (let i = 0; i < 300; i++) {
      tree.treeReady = true;
      const u = g.state.utopium;
      expect(g.tapTree(tree.id, T0).ok).toBe(true);
      expect(g.state.utopium).toBe(u);
    }
    expect(g.tapTree(tree.id, T0).ok).toBe(false);
  });
});

describe('gifts and the reward card queue (01 §6)', () => {
  it('getGiftPacketReward branches', () => {
    const rng = seeded(21);
    const kinds: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const ps = getGiftPacketReward(rng, -1);
      const k = ps.map((p) => p.type).join(',') || 'none';
      kinds[k] = (kinds[k] ?? 0) + 1;
      for (const p of ps) {
        if (p.type === 4) expect([500000, 600000, 700000, 800000]).toContain(p.value);
        if (p.type === 5) { expect(p.value).toBeGreaterThanOrEqual(5); expect(p.value).toBeLessThanOrEqual(15); }
      }
    }
    expect(kinds['4'] / 4000).toBeCloseTo(41 / 101, 1);
    expect(kinds['5'] / 4000).toBeCloseTo(35 / 101, 1);
    expect(kinds['10'] / 4000).toBeCloseTo(15 / 101, 1);
    expect(kinds['6,10']).toBeGreaterThan(0);
    expect(kinds.none).toBeGreaterThan(0);
  });
  it('applies each packet only when its card is closed, in order; type 1 is not duplicated', () => {
    const g = game();
    g.queuePacket({ type: 4, id: 'x', value: 1000 });
    g.queuePacket({ type: 5, id: 'x', value: 3 });
    g.queuePacket({ type: 1, id: 'Musician', value: 1 });
    g.queuePacket({ type: 1, id: 'Musician', value: 1 });
    expect(g.state.packets.length).toBe(3);
    expect(g.state.coins).toBe(14000);
    g.closePacket();
    expect([g.state.coins, g.state.utopium]).toEqual([15000, 25]);
    g.closePacket();
    expect(g.state.utopium).toBe(28);
    g.closePacket();
    expect(g.state.unlockedJobs).toContain('Musician');
  });
  it('a calendar day gives one reward', () => {
    const g = game(3);
    g.tick(T0);
    expect(g.state.dailyGift).toBe(true);
    expect(g.collectCalendar(T0).ok).toBe(true);
    expect(g.collectCalendar(T0).ok).toBe(false);
    g.tick(DAY0 + 86400 + 10);
    expect(g.state.dailyGift).toBe(true);
  });
  it('old saves move discovery cards into the queue', () => {
    const g = game();
    const s = JSON.parse(JSON.stringify(g.state));
    delete s.packets; s.discoveries = ['Engineer'];
    expect(migrate(s).packets).toEqual([{ type: 0, id: 'Engineer', value: 0 }]);
  });
});

function withMissions(seed = 1) {
  const g = game(seed);
  add(g, 'MissionControl');
  g.tick(T0);
  return g;
}

describe('missions (04 §1)', () => {
  it('stay closed until Utopia HQ exists, then fill 6 slots [4,4,3,3,2,2] for free', () => {
    const g0 = game();
    g0.tick(T0);
    expect(g0.state.missions.started).toBe(false);
    const g = withMissions();
    const m = g.state.missions;
    expect(m.started).toBe(true);
    expect(MISSION_SLOT_TYPES).toEqual([4, 4, 3, 3, 2, 2]);
    m.slots.forEach((a, i) => { if (a) expect(MISSION.get(a.id)!.type).toBe(MISSION_SLOT_TYPES[i]); });
    expect(m.refreshesUsed).toBe(0);
    expect(m.wonder?.id).toBe('MonumentPart1');
  });
  it('getRandomMission filters: jobs unlocked, need-jobs, season, unique done', () => {
    const g = withMissions();
    const ms = g.missions;
    for (const md of ms.eligible(2, 0)) {
      expect(ms.haveAllJobsRequired(md)).toBe(true);
      expect(md.needJobs).toBeLessThan(g.jobsUnlocked);
      expect(md.discontinued).toBe(false);
    }
    expect(ms.eligible(2, 0).map((x) => x.id)).not.toContain('STEMPack'); // needs J-14...
    const uniques = ms.eligible(4, 0).map((x) => x.id);
    expect(uniques).toContain('HappyEverAfter');       // Thaw only
    expect(ms.eligible(4, 1).map((x) => x.id)).not.toContain('HappyEverAfter');
    // a seasonal SP unique is preferred when eligible
    for (let i = 0; i < 20; i++) expect(ms.getRandomMission(4, 0)!.id).toBe('HappyEverAfter');
    g.state.missions.uniquesDone.push('HappyEverAfter');
    expect(ms.eligible(4, 0).map((x) => x.id)).not.toContain('HappyEverAfter');
  });
  it('coin requirements scale with the land cost but never go below 500 000 (max, not min)', () => {
    const g = withMissions();
    expect(g.coinScaledToCity(10, MISSION_COIN_FLOOR)).toBe(500000);
    g.state.level = 30;
    const cost = LAND[29].cost;
    const v = Math.trunc(0.5 * Math.trunc((1 - g.discount()) * cost));
    expect(v).toBeGreaterThan(500000);
    expect(g.coinScaledToCity(50, MISSION_COIN_FLOOR)).toBe(v);
  });
  it('delivers a spliced clone to the Mission Pod and completes the mission', () => {
    const g = withMissions(3);
    const m = g.state.missions;
    // put a known mission in a Normal slot: STEMPack needs jobs; use AClowder (9 cats) + a J mission made by hand
    const idx = m.slots.findIndex((_, i) => MISSION_SLOT_TYPES[i] === 2);
    m.slots[idx] = g.missions.create(MISSION.get('AClowder')!);
    const a = m.slots[idx]!;
    expect(g.missions.canComplete(a)).toBe(false);
    g.addAnimal('Tabby Cat', 5);
    g.addAnimal('Tom Cat', 4);
    expect(g.missions.autoAssignAnimals('AClowder')).toBe(9);
    expect(g.missions.canComplete(a)).toBe(true);
    const r = g.missions.complete('AClowder', T0);
    expect(r.ok).toBe(true);
    expect(g.state.animals['Tabby Cat']).toBeUndefined();
    expect(g.state.packets[g.state.packets.length - 1]).toEqual({ type: 15, id: 'mission:AClowder', value: 40 });
    expect(m.completed).toBe(1);
    expect(m.slots[idx]).not.toBe(a); // the slot was refilled (Normal missions repeat)
    expect(m.refreshesUsed).toBe(1); // refilling the slot used a refresh
  });
  it('J requirements: clones go into the pod, no housing, and leave with the rocket', () => {
    const g = withMissions(3);
    const m = g.state.missions;
    const idx = m.slots.findIndex((_, i) => MISSION_SLOT_TYPES[i] === 2);
    // AClowder with its requirements swapped for J-0 (any job), like FoolsGold (Omit=Y in 4.20)
    m.slots[idx] = { ...g.missions.create(MISSION.get('AClowder')!), reqs: ['U-15', ...Array(8).fill('J-0')].map((code) => ({ code, acq: null })) };
    // a spliced Engineer waits in slot 0
    g.state.peeps.push({ id: 'Clone_99', female: false, job: 'Engineer', home: 'Residence1_1', work: null, cps: 1 });
    g.state.slots[0] = { state: 5, start: -1, end: -1, peep: 'Clone_99', job: 'Engineer' };
    expect(g.missions.deliverClone(0).msg).toBe('NO JOB VACANCY IN MISSION PODS'); // no pod yet
    expect(g.placePod('AClowder', 10, 10).ok).toBe(true);
    expect(g.missions.deliverClone(0).ok).toBe(true);
    expect(g.state.slots[0].state).toBe(0);
    const pod = g.missions.hostOf(m.slots[idx]!)!;
    expect(g.peep('Clone_99')!.home).toBe(pod.id);
    expect(g.deleteBuilding(pod.id).msg).toBe('YOU CANNOT DELETE OCCUPIED BUILDINGS');
    // skip: clones are not refunded and the pod is demolished
    g.state.unlockedJobs = [...JOB.keys()];
    expect(g.missions.skip('AClowder', T0).ok).toBe(true);
    expect(g.peep('Clone_99')).toBeUndefined();
    expect(g.building(pod.id)).toBeUndefined();
  });
  it('4 free refreshes a day, then 1 utopium replenishes them', () => {
    const g = withMissions(5);
    g.state.unlockedJobs = [...JOB.keys()];
    const m = g.state.missions;
    const id = () => m.slots[4]!.id;
    for (let i = 0; i < 4; i++) expect(g.missions.skip(id(), T0).ok).toBe(true);
    expect(g.missions.skip(id(), T0).msg).toBe('NO_REFRESHES');
    const u = g.state.utopium;
    expect(g.missions.replenish().ok).toBe(true);
    expect([g.state.utopium, m.refreshesUsed]).toEqual([u - 1, 0]);
    expect(g.missions.skip(id(), T0).ok).toBe(true);
    expect(g.missions.skip('MonumentPart1', T0).ok).toBe(false); // wonders cannot be skipped
  });
  it('the daily refresh tops each type back up to 2', () => {
    const g = withMissions(5);
    const m = g.state.missions;
    m.slots[0] = null; m.slots[2] = null;
    m.refreshesUsed = 4;
    g.tick(DAY0 + 12 * 3600);
    expect(m.slots[0]).not.toBeNull();
    expect(m.slots[2]).not.toBeNull();
    expect(m.refreshesUsed).toBe(2);
  });
  it('BaseCPS / BaseLand targets are relative to the recorded best', () => {
    const g = withMissions();
    g.state.missions.baseLand = 15;
    const a = g.missions.create(MISSION.get('WreckingBall')!); // BaseLand-5
    expect(a.targetLand).toBe(20);
    expect(parseReq('BaseLand-5')).toEqual({ kind: 'BaseLand', value: '5', n: 5 });
  });
});

describe('wonders (04 §2)', () => {
  it('chain MonumentPart1..9 -> Monument3 -> Monument4 with their effects', () => {
    const g = withMissions();
    const m = g.state.missions;
    expect(g.placeWonder(12, 12).ok).toBe(true);
    const part = g.state.buildings.find((b) => b.type === 'MonumentPart1')!;
    expect(g.missions.wonderPartDone('MonumentPart1')).toBe(false);
    // fill MonumentPart1 by hand: 6 clones + 3 x M-10 (500 000 each with the floor)
    m.wonder!.reqs.forEach((r) => { if (r.code.startsWith('J-')) r.acq = 'x'; });
    g.state.coins = 1_500_000;
    expect(g.missions.complete('MonumentPart1', T0).ok).toBe(true);
    expect(g.state.coins).toBe(0);
    expect(m.wonderMap.Monument).toBe(1);
    expect(m.wonder!.id).toBe('MonumentPart2');
    expect(g.missions.wonderPartDone(part.type)).toBe(true);
    m.wonderMap = { Monument: 9 };
    m.wonder = null;
    g.missions.refreshWonderMission();
    expect(m.wonder!.id).toBe('Monument3Part1');
    expect(g.instantHearts()).toBe(true);
    const d0 = g.discount();
    m.wonderMap.Monument3 = 4;
    m.wonder = null;
    g.missions.refreshWonderMission();
    expect(m.wonder!.id).toBe('Monument4Part1');
    expect(g.spiritWonderBonus()).toBe(100);
    expect(g.discount()).toBeGreaterThan(d0);
    m.wonderMap.Monument4 = 4;
    m.wonder = null;
    g.missions.refreshWonderMission();
    expect(m.wonder).toBeNull(); // Monument2 is omitted in 4.20
  });
});

describe('editing buildings (03 §1.5)', () => {
  it('delete: no refund, frees land, removes decor spirit; occupied and first buildings stay', () => {
    const g = game();
    const [coins, land, spirit] = [g.state.coins, g.state.landUsed, g.state.spirit];
    expect(g.deleteBuilding('Fountain3_1').ok).toBe(true);
    expect(g.state.coins).toBe(coins);
    expect(g.state.landUsed).toBe(land - 1);
    expect(g.state.spirit).toBe(spirit - 2);
    expect(g.deleteBuilding('Residence1_1').msg).toBe('YOU CANNOT DELETE OCCUPIED BUILDINGS');
    const mine = add(g, 'Utopium Mine');
    expect(g.deleteBuilding(mine.id).msg).toBe('YOU CANNOT DELETE UNIQUE BUILDINGS');
    expect(g.deleteBuilding('Tree3_1').ok).toBe(true);
  });
  it('store keeps the building for a free re-placement; move and flip check the footprint', () => {
    const g = game();
    expect(g.storeBuilding('Fountain3_1').ok).toBe(true);
    expect(g.state.inventory).toEqual([{ type: 'Fountain3', level: 1 }]);
    const coins = g.state.coins;
    expect(g.placeFromInventory(0, 6, 6, false).ok).toBe(true);
    expect(g.state.coins).toBe(coins);
    expect(g.state.spirit).toBe(2);
    expect(g.moveBuilding('Tree3_1', 0, 0).msg).toBe('SPACE OCCUPIED');
    expect(g.moveBuilding('Tree3_1', 9, 9).ok).toBe(true);
    expect(g.flipBuilding('SpacePort_1').ok).toBe(false); // needs the School of Magic
    add(g, 'School of Magic');
    expect(g.flipBuilding('SpacePort_1').ok).toBe(true);
  });
  it('upgrades cost 3 x level utopium up to level 6 and lengthen the shift', () => {
    const g = game();
    const th = g.building('Town Hall_1')!;
    expect(g.upgradeWorkplace(th.id).ok).toBe(false);
    add(g, 'IT Services');
    g.state.utopium = 100;
    const w1 = g.buildingWorkingTime(th);
    for (let lvl = 1; lvl <= 5; lvl++) {
      const u = g.state.utopium;
      expect(g.upgradeWorkplace(th.id).ok).toBe(true);
      expect(u - g.state.utopium).toBe(3 * lvl);
    }
    expect(th.level).toBe(6);
    expect(g.buildingWorkingTime(th)).toBe(6 * w1);
    expect(g.upgradeWorkplace(th.id).msg).toBe('MAX LEVEL');
  });
  it('duplicates need the Building Firm: 20 utopium plus land', () => {
    const g = game();
    add(g, 'Utopium Mine', 50, 50);
    expect(g.place('Utopium Mine', 5, 5, false, T0).ok).toBe(false);
    add(g, 'Building Firm', 52, 52);
    const [u, land] = [g.state.utopium, g.state.landUsed];
    expect(g.place('Utopium Mine', 5, 5, false, T0).ok).toBe(true);
    expect([u - g.state.utopium, g.state.landUsed - land]).toEqual([20, 1]);
  });
});

describe('features and special buildings (03 §3.2, §5)', () => {
  it('unlock by building name', () => {
    const g = game();
    expect(g.typeUnlocked('Tree1')).toBe(false);
    expect(g.typeUnlocked('PlainR')).toBe(false);
    expect(g.typeUnlocked('Residence1')).toBe(true);
    add(g, 'Nursery'); add(g, 'Construction Yard');
    expect(g.typeUnlocked('Tree1')).toBe(true);
    expect(g.typeUnlocked('PlainR')).toBe(true);
    expect(g.typeUnlocked('PlainW')).toBe(false);
    add(g, 'Lake');
    expect(g.typeUnlocked('PlainW')).toBe(true);
  });
  it('Business Center restarts every idle shift for 1 u', () => {
    const g = game();
    add(g, 'Financial Center');
    const u = g.state.utopium;
    expect(g.businessCenterBoost(T0).ok).toBe(true);
    expect(g.state.utopium).toBe(u - 1);
    expect(g.building('Town Hall_1')!.shiftStart).toBe(T0);
    expect(g.businessCenterBoost(T0).ok).toBe(false);
  });
  it('Law Firm expands for 40 u through the level-up packet', () => {
    const g = game();
    expect(g.expandWithUtopium().ok).toBe(false);
    add(g, 'Law Firm');
    g.state.utopium = 45;
    expect(g.expandWithUtopium().ok).toBe(true);
    expect(g.expandWithUtopium().ok).toBe(false); // one level-up at a time
    g.closePacket();
    expect([g.state.utopium, g.state.level, g.state.landLimit]).toEqual([6, 2, 40]);
  });
  it('Enterprise doubles the hours of shifts started afterwards for 100 u', () => {
    const g = game();
    add(g, 'Enterprise');
    g.state.utopium = 100;
    const th = g.building('Town Hall_1')!;
    const w = g.buildingWorkingTime(th);
    expect(g.buyDoubleHours(T0).ok).toBe(true);
    expect(g.buildingWorkingTime(th)).toBe(2 * w);
    expect(g.buyDoubleHours(T0).ok).toBe(false);
  });
  it('Pet Store: 9 animals for 8 u; Research Lab levels', () => {
    const g = game(4);
    add(g, 'Pet Store'); add(g, 'Research Facility');
    expect(g.buyNineAnimals(T0).ok).toBe(true);
    expect(g.state.utopium).toBe(17);
    g.closePacket();
    expect(Object.values(g.state.animals).reduce((a, b) => a + b, 0)).toBe(9);
    expect(g.researchUpgrade().ok).toBe(true);
    expect([g.state.utopium, g.state.researchLevel, g.state.spiritLimit, g.state.heartCount]).toEqual([7, 1, 9, 1]);
  });
  it('Hotel: check-in 1 u, check-out needs a free bed and refunds 0-2 u', () => {
    const g = game(2);
    add(g, 'Hotel');
    expect(g.hotelCheckIn('Clone_2').ok).toBe(true);
    expect(g.peep('Clone_2')!.work).toBeNull();
    expect(g.state.hotel).toEqual(['Clone_2']);
    const u = g.state.utopium;
    const r = g.hotelCheckOut('Clone_2');
    expect(r.ok).toBe(true);
    expect(g.state.utopium - u).toBeGreaterThanOrEqual(0);
    expect(g.state.utopium - u).toBeLessThanOrEqual(2);
    expect(g.state.slots.some((s) => s.state === 5 && s.peep === 'Clone_2')).toBe(true);
    expect(JOB.get('Mayor')).toBeTruthy();
  });
});

import { describe, expect, it } from 'vitest';
import { Game, FREE_COOLDOWN } from '../src/logic/game';

const T0 = 1_800_000_000;

function withHouse(g: Game, now = T0): string {
  const r = g.place('Residence4', 3, 0, false, now);
  expect(r.ok).toBe(true);
  g.rushConstruction(r.msg!, now);
  return r.msg!;
}

describe('new game (01 §2)', () => {
  const g = Game.fresh(T0);
  it('has the post-tutorial-step-0 currencies and counters', () => {
    const s = g.state;
    expect([s.coins, s.utopium, s.chroma]).toEqual([14000, 25, 100]);
    expect([s.landUsed, s.landLimit, s.spirit, s.spiritLimit, s.level]).toEqual([15, 30, 2, 8, 1]);
    expect(s.unlockedJobs).toEqual(['Mayor', 'Mechanic']);
  });
  it('places the starting city', () => {
    const at = Object.fromEntries(g.state.buildings.map((b) => [b.id, [b.type, b.x, b.y]]));
    expect(at['SpacePort_1']).toEqual(['SpacePort', 0, 0]);
    expect(at['Residence1_1']).toEqual(['Residence1', -2, 3]);
    expect(at['Town Hall_1']).toEqual(['Town Hall', 0, 3]);
    expect(at['Fountain3_1']).toEqual(['Fountain3', -1, 1]);
    expect(g.state.buildings.filter((b) => b.type === 'PlainR').length).toBe(3);
    expect(g.population()).toBe(2);
    expect(g.populationLimit()).toBe(2);
  });
});

describe('workplace shifts', () => {
  it('restarts on tap and pays cps each tick until the shift ends', () => {
    const g = Game.fresh(T0);
    expect(g.tapWorkplace('Town Hall_1', T0).ok).toBe(true);
    g.tick(T0 + 1);
    expect(g.state.coins).toBe(14001); // Town Hall: multiplier 1, one Mayor
    // close the app for 2 hours: pays up to the end of the 30 min shift only
    const g2 = new (Game as any)(JSON.parse(JSON.stringify(g.state))) as Game;
    g2.tick(T0 + 7200);
    expect(g2.state.coins).toBe(14001 + (T0 + 1800 - (T0 + 1)) - 1);
    expect(g2.building('Town Hall_1')!.shiftStart).toBe(-1);
  });
  it('does not start without workers or for the Arrival Center', () => {
    const g = Game.fresh(T0);
    expect(g.tapWorkplace('SpacePort_1', T0).ok).toBe(false);
  });
});

describe('arrival center and splicer (02)', () => {
  it('needs housing before a clone arrives', () => {
    const g = Game.fresh(T0);
    g.tick(T0 + 1);
    expect(g.state.slots.every((s) => s.state === 0)).toBe(true);
  });

  it('runs a clone through arrival, splice, discovery and assignment', () => {
    const g = Game.fresh(T0);
    withHouse(g);                          // 4 more beds
    g.tick(T0 + 1);
    const arriving = g.state.slots.filter((s) => s.state === 2);
    expect(arriving.length).toBe(1);       // only one at a time
    expect(g.state.slots.filter((s) => s.state === 1).length).toBe(2);
    expect(arriving[0].end - arriving[0].start).toBe(g.arrivalTime());
    expect(g.arrivalTime()).toBe(48);      // n=2: base 60, d=0.1875 -> int(48.75)

    g.tick(arriving[0].end + 1);
    const idx = g.state.slots.findIndex((s) => s.state === 3);
    expect(idx).toBeGreaterThanOrEqual(0);

    expect(g.combo('Mayor', 'Mayor').job).toBe('Sheriff');
    expect(g.combo('Mayor', 'Pilot').kind).toBe('none');
    const c = g.combo('Mechanic', 'Mayor');
    expect(c).toEqual({ kind: 'new', job: 'Engineer', landRequired: 1 });
    expect(g.startSplice(idx, 'Mechanic', 'Mayor', T0 + 100).ok).toBe(true);
    const s = g.state.slots[idx];
    expect(s.end - s.start).toBe(Math.trunc((1 - g.discount()) * 30));

    g.tick(s.end);
    expect(g.state.unlockedJobs).toContain('Engineer');
    expect(g.state.pendingWorkplaces).toEqual(['Utopium Mine']);
    expect(s.state).toBe(5);
    // same job cannot be spliced while one waits for assignment
    expect(g.combo('Mayor', 'Mechanic').kind).toBe('old');

    const used = g.state.landUsed;
    const coins = g.state.coins;
    const placed = g.place('Utopium Mine', 3, 3, false, T0 + 200);
    expect(placed.ok).toBe(true);
    expect(g.state.landUsed).toBe(used + 1);
    expect(g.state.coins).toBe(coins);   // first workplace is free
    expect(g.assignClone(idx, 'Utopium Mine').ok).toBe(false); // still under construction
    g.tick(T0 + 200 + 61);
    expect(g.assignClone(idx, 'Utopium Mine').ok).toBe(true);
    expect(g.state.slots[idx].state).toBe(0);
  });

  it('refuses a new job when there is not enough free land', () => {
    const g = Game.fresh(T0);
    withHouse(g);
    g.state.landUsed = g.state.landLimit;
    g.tick(T0 + 1);
    g.tick(T0 + 100);
    const idx = g.state.slots.findIndex((s) => s.state === 3);
    expect(g.startSplice(idx, 'Mayor', 'Mechanic', T0 + 100)).toEqual({ ok: false, msg: 'UTOPIA NEEDS MORE LAND' });
  });

  it('chains arrivals while offline', () => {
    const g = Game.fresh(T0);
    withHouse(g);
    g.tick(T0 + 1);
    g.tick(T0 + 10000);
    expect(g.state.slots.filter((s) => s.state === 3).length).toBe(3);
  });
});

describe('rushing and the free buttons', () => {
  it('rushes construction for max(1, ceil(s/1800)) utopium', () => {
    const g = Game.fresh(T0);
    const r = g.place('Residence1', 3, 0, false, T0);
    expect(g.building(r.msg!)!.buildEnd - T0).toBe(60);
    const u = g.state.utopium;
    expect(g.rushConstruction(r.msg!, T0).ok).toBe(true);
    expect(g.state.utopium).toBe(u - 1);
  });
  it('free construction button: -1 h or finish, then 24 h cooldown', () => {
    const g = Game.fresh(T0);
    const r = g.place('Residence1', 3, 0, false, T0);
    expect(g.freeConstruction(r.msg!, T0).ok).toBe(true);
    expect(g.building(r.msg!)!.buildEnd).toBe(-1);
    const r2 = g.place('Residence1', 4, 0, false, T0);
    expect(g.freeConstruction(r2.msg!, T0 + 10).ok).toBe(false);
    expect(g.freeConstruction(r2.msg!, T0 + FREE_COOLDOWN).ok).toBe(true);
  });
});

describe('building and land', () => {
  it('only checks that footprint cells are free', () => {
    const g = Game.fresh(T0);
    expect(g.place('Residence1', 0, 0, false, T0).msg).toBe('SPACE OCCUPIED'); // Arrival Center
    expect(g.place('Residence1', 1, 1, false, T0).msg).toBe('SPACE OCCUPIED'); // its 2x2 footprint
    expect(g.place('Residence1', 30, 30, false, T0).ok).toBe(true);
  });
  it('decor adds spirit and land; paths use no land', () => {
    const g = Game.fresh(T0);
    // milestone 2: decor needs the Park (feature 0) and roads the Construction Yard (feature 5)
    expect(g.place('Bush1', 5, 5, false, T0).msg).toBe('LOCKED');
    g.state.buildings.push({ id: 'Park_x', type: 'Park', x: 20, y: 20, flip: false, buildStart: -1, buildEnd: -1, shiftStart: -1, level: 1 });
    g.state.buildings.push({ id: 'CY_x', type: 'Construction Yard', x: 25, y: 25, flip: false, buildStart: -1, buildEnd: -1, shiftStart: -1, level: 1 });
    g.place('Bush1', 5, 5, false, T0);
    expect([g.state.spirit, g.state.landUsed, g.state.coins]).toEqual([3, 16, 4000]);
    g.place('PlainR', 6, 6, false, T0);
    expect(g.state.landUsed).toBe(16);
  });
  it('expands land: discounted cost, +10 land, utopium, spirit limit', () => {
    const g = Game.fresh(T0);
    const cost = g.landUpgradeCost();
    expect(cost).toBe(8124);
    expect(g.expandLand().ok).toBe(true);
    g.closePacket(); // milestone 2: the level-up packet (type 2) applies when its card closes
    expect([g.state.coins, g.state.landLimit, g.state.utopium, g.state.spiritLimit, g.state.level])
      .toEqual([14000 - 8124, 40, 26, 12, 2]);
  });
});

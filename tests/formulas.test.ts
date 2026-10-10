import { describe, expect, it } from 'vitest';
import {
  arrivalBase, arrivalTime, buildingTime, coinGen, constructionRushCost, landRow, landUpgradeCost,
  maxSpirit, spiritDiscount, splicingTime, timeRushCost, workingTime, buildingCps, timeTillNoon,
} from '../src/logic/formulas';
import { LAND } from '../src/logic/data';

describe('splicing time = clamp(10*jobs, 30, 1800)', () => {
  it('uses the floor of 30 s', () => {
    expect(splicingTime(2)).toBe(30);
    expect(splicingTime(3)).toBe(30);
  });
  it('is 10 s per unlocked job in the middle', () => {
    expect(splicingTime(4)).toBe(40);
    expect(splicingTime(100)).toBe(1000);
  });
  it('caps at 1800 s', () => {
    expect(splicingTime(180)).toBe(1800);
    expect(splicingTime(450)).toBe(1800);
  });
  it('is 7 s during the tutorial', () => expect(splicingTime(50, true)).toBe(7));
});

describe('arrival time', () => {
  it('base by number of unlocked jobs', () => {
    expect(arrivalBase(2)).toBe(60);    // 2n+56
    expect(arrivalBase(3)).toBe(26);    // 3n+17
    expect(arrivalBase(21)).toBe(80);
    expect(arrivalBase(22)).toBe(100);  // 15n-230
    expect(arrivalBase(49)).toBe(505);
    expect(arrivalBase(50)).toBe(596);  // 12n-4
    expect(arrivalBase(200)).toBe(2396);
  });
  it('applies the spirit discount and the 1800 s cap', () => {
    expect(arrivalTime(2, 0)).toBe(60);
    expect(arrivalTime(2, 0.5)).toBe(30);
    expect(arrivalTime(200, 0)).toBe(1800);
    expect(arrivalTime(200, 0.75)).toBe(450);
    expect(arrivalTime(22, 0.1875)).toBe(81); // int(0.8125*100)
  });
});

describe('max spirit', () => {
  it('follows getMaxSpirit by land level', () => {
    expect(maxSpirit(1)).toBe(12);
    expect(maxSpirit(4)).toBe(18);
    expect(maxSpirit(5)).toBe(21);
    expect(maxSpirit(9)).toBe(33);
    expect(maxSpirit(10)).toBe(39);
    expect(maxSpirit(15)).toBe(75);
    expect(maxSpirit(20)).toBe(141);
    expect(maxSpirit(24)).toBe(213);
    expect(maxSpirit(42)).toBe(645);
  });
});

describe('spirit discount', () => {
  it('starts at spirit 2 / limit 8', () => {
    expect(spiritDiscount(2, 8)).toBeCloseTo(0.1875, 5);
  });
  it('is capped at 0.75', () => {
    expect(spiritDiscount(8, 8)).toBe(0.75);
    expect(spiritDiscount(50, 8)).toBe(0.75);
  });
  it('is 0 without spirit', () => expect(spiritDiscount(0, 8)).toBe(0));
});

describe('land upgrade cost', () => {
  it('reads the table by current level', () => {
    expect(landRow(LAND, 1).cost).toBe(10000);
    expect(landRow(LAND, 12)).toEqual({ level: 12, cost: 14000000, land: 10, utopium: 2 });
    expect(landRow(LAND, 99).cost).toBe(600000000); // last row above 42
  });
  it('applies the spirit discount and truncates', () => {
    // d = 2/8/1.333333 = 0.18750005 (the game divides by 1.333333, not 4/3), so 10000*(1-d) = 8124.9995
    expect(landUpgradeCost(10000, spiritDiscount(2, 8))).toBe(8124);
    expect(landUpgradeCost(25000, 0)).toBe(25000);
    expect(landUpgradeCost(80000, 0.75)).toBe(20000);
  });
});

describe('rush costs', () => {
  it('time rush = int(s/600)+1', () => {
    expect(timeRushCost(1)).toBe(1);
    expect(timeRushCost(599)).toBe(1);
    expect(timeRushCost(600)).toBe(2);
    expect(timeRushCost(1800)).toBe(4);
  });
  it('construction rush = max(1, ceil(s/1800))', () => {
    expect(constructionRushCost(1)).toBe(1);
    expect(constructionRushCost(1800)).toBe(1);
    expect(constructionRushCost(1801)).toBe(2);
    expect(constructionRushCost(172800)).toBe(96);
  });
});

describe('construction time', () => {
  it('has a 60 s minimum and 0 for instant objects', () => {
    expect(buildingTime(240, 2, 0.1875)).toBe(60);
    expect(buildingTime(0, 50, 0)).toBe(0);
  });
  it('scales with unlocked jobs', () => {
    expect(buildingTime(172800, 103, 0)).toBe(172800);
    expect(buildingTime(172800, 43, 0)).toBe(10368); // f(43) = 0.0045 + 0.0024130435*23 = 0.06
    expect(buildingTime(43200, 10, 0.1875)).toBe(63); // 43200*0.00180769*0.8125 = 63.4
    expect(buildingTime(100000, 30, 0)).toBe(Math.trunc(100000 * (0.0045 + 0.0024130435 * 10)));
  });
});

describe('workplace production', () => {
  it('working time is minutes*60*level', () => {
    expect(workingTime(30)).toBe(1800);
    expect(workingTime(30, 2)).toBe(3600);
    expect(workingTime(30, 1, true)).toBe(3600);
  });
  it('cps = multiplier * clones * bank bonus', () => {
    expect(buildingCps(2, [1, 1], false)).toBe(4);
    expect(buildingCps(2, [1, 1], true)).toBe(8);
  });
});

describe('offline coin catch-up (updateCoinGen)', () => {
  const base = { start: 1000, W: 1800, cps: 3, firstTickDone: true };
  it('pays cps each normal tick while the shift runs', () => {
    expect(coinGen({ ...base, now: 1500, last: 1499, downtime: false })).toEqual({ coins: 3, start: 1000 });
  });
  it('pays cps x elapsed after a gap inside the shift', () => {
    expect(coinGen({ ...base, now: 2000, last: 1500, downtime: true })).toEqual({ coins: 1500, start: 1000 });
  });
  it('pays only until the end of the shift, then stops', () => {
    // shift ends at 2800; last tick 2000; back at 9000
    expect(coinGen({ ...base, now: 9000, last: 2000, downtime: true })).toEqual({ coins: 3 * 800, start: -1 });
  });
  it('on the first tick after loading pays one second less', () => {
    expect(coinGen({ ...base, firstTickDone: false, now: 9000, last: 2000, downtime: true }))
      .toEqual({ coins: 3 * 799, start: -1 });
  });
  it('stops without paying when the shift ended between two normal ticks', () => {
    expect(coinGen({ ...base, now: 2801, last: 2800, downtime: false })).toEqual({ coins: 0, start: -1 });
  });
  it('cancels a shift that starts in the future (clock went back)', () => {
    expect(coinGen({ ...base, start: 5000, now: 4000, last: 3999, downtime: false })).toEqual({ coins: 0, start: -1 });
  });
  it('does nothing for stopped buildings', () => {
    expect(coinGen({ ...base, start: -1, now: 4000, last: 10, downtime: true })).toEqual({ coins: 0, start: -1 });
  });
});

describe('daily reset helper', () => {
  it('counts seconds to the next noon', () => {
    expect(timeTillNoon(0)).toBe(43200);            // midnight -> 12 h
    expect(timeTillNoon(43200)).toBe(86400);        // noon -> next noon
    expect(timeTillNoon(50000)).toBe(86400 - 6800);
  });
});

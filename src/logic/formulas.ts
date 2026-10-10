// Formulas read from libMyGame.so 4.20 (see re/notes.md and spec 01-03). Pure functions, no state.

/** Splicer duration before discount: clamp(10*jobsUnlocked, 30, 1800) s; 7 s during the tutorial. */
export function splicingTime(jobsUnlocked: number, inTutorial = false): number {
  if (inTutorial) return 7;
  return Math.min(1800, Math.max(30, 10 * jobsUnlocked));
}

/** Arrival base time by number of unlocked jobs (getArrivalTime, before discount). */
export function arrivalBase(n: number): number {
  if (n <= 2) return 2 * n + 56;
  if (n <= 21) return 3 * n + 17;
  if (n <= 49) return 15 * n - 230;
  return 12 * n - 4;
}

/** getArrivalTime = min(int((1-d)*base), int((1-d)*1800)). */
export function arrivalTime(n: number, d: number): number {
  return Math.min(Math.trunc((1 - d) * arrivalBase(n)), Math.trunc((1 - d) * 1800));
}

/** getMaxSpirit(L). */
export function maxSpirit(L: number): number {
  if (L < 5) return 2 * L + 10;
  if (L < 10) return 3 * L + 6;
  if (L < 15) return 6 * L - 21;
  if (L < 20) return 12 * L - 105;
  if (L < 24) return 18 * L - 219;
  return 24 * L - 363;
}

/** SpiritDiscountMult d = min((spirit + wonderBonus) / spiritLimit / 1.333333, 0.75). */
export function spiritDiscount(spirit: number, spiritLimit: number, wonderBonus = 0): number {
  if (spiritLimit <= 0) return 0;
  return Math.min((spirit + wonderBonus) / spiritLimit / 1.333333, 0.75);
}

/** Land upgrade row for level L (uses the last row above the table). */
export function landRow<T extends { level: number }>(table: T[], L: number): T {
  const i = Math.max(1, Math.min(L, table.length));
  return table[i - 1];
}

/** getLandUpgradeCost = int(cost[L] * (1 - d)). */
export function landUpgradeCost(baseCost: number, d: number): number {
  return Math.trunc(baseCost * (1 - d));
}

/** getTimeRushCost(s) = int(s/600) + 1 utopium (arrival, splicing). */
export function timeRushCost(seconds: number): number {
  return Math.trunc(Math.max(0, seconds) / 600) + 1;
}

/** getConstructionRushCost(s) = max(1, ceil(s/1800)) utopium. */
export function constructionRushCost(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 1800));
}

/** Construction-time factor by number of unlocked jobs (getBuildingTime). */
export function buildTimeFactor(n: number): number {
  if (n < 8) return 0.001;
  if (n <= 20) return 0.001 + 0.00026923 * (n - 7);
  if (n <= 43) return 0.0045 + 0.0024130435 * (n - 20);
  if (n <= 89) return 0.06 + 0.0060869567 * (n - 43);
  if (n <= 102) return 0.34 + 0.050769232 * (n - 89);
  return 1.0;
}

/** getBuildingTime: int(max(base*f*(1-d), 60)); 0 if base is 0. */
export function buildingTime(base: number, jobsUnlocked: number, d: number): number {
  if (!base) return 0;
  return Math.trunc(Math.max(base * buildTimeFactor(jobsUnlocked) * (1 - d), 60));
}

/** getCurrentWorkingTime = WorkingTime(min)*60 * level * 2^double1 * 2^double2 (seconds). */
export function workingTime(workingTimeMin: number, level = 1, double1 = false, double2 = false): number {
  return workingTimeMin * 60 * level * (double1 ? 2 : 1) * (double2 ? 2 : 1);
}

/** getCurrentCPS = multiplier * sum(clone cps) * (2 if Bank exists and building full). */
export function buildingCps(multiplier: number, cloneCps: number[], bankBonus: boolean): number {
  const sum = cloneCps.reduce((a, b) => a + b, 0);
  return multiplier * sum * (bankBonus ? 2 : 1);
}

export interface CoinGenInput { start: number; W: number; cps: number; now: number; last: number; downtime: boolean; firstTickDone: boolean }
export interface CoinGenResult { coins: number; start: number }

/**
 * cGameManager::updateCoinGen for one workplace (01 §4.4, exact).
 * Returns coins to add and the new shift start (-1 = stopped).
 */
export function coinGen(i: CoinGenInput): CoinGenResult {
  const { start, W, cps, now, last, downtime } = i;
  if (start === -1) return { coins: 0, start };
  if (start > now) return { coins: 0, start: -1 };
  if (cps !== 0 && start + W >= now) {
    return { coins: downtime ? cps * (now - last) : cps, start };
  }
  // shift over (or cps 0): stop, and pay the part of the offline gap that was still inside the shift.
  let coins = 0;
  if (downtime) {
    coins = cps * (start + W - last + (i.firstTickDone ? 1 : 0) - 1);
    if (coins < 0) coins = 0; // the game would subtract here (int32); we never take coins away
  }
  return { coins, start: -1 };
}

/** GetTimeTillEndOfNoon: seconds until the next 12:00 (t in shifted local seconds). */
export function timeTillNoon(t: number): number {
  const h = Math.floor(t / 43200);
  const r = t - h * 43200;
  return h % 2 === 0 ? 43200 - r : 86400 - r;
}

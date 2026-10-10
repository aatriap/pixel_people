// Random rewards (re/notes.md, spec 01 §6, 05 §2). Pure functions: every draw goes through the Rng.
import { ANIMALS, MISSIONS } from './data';
import { SEASONS } from './calendar';
import { Rng, pick, uniform } from './rng';
import { Packet } from './state';

/**
 * getRandomAnimal(tier): tier 1/2 is used as given; anything else becomes tier 1 (20%) or 2 (80%)
 * [U(1,5) >= 2 -> tier 2]. Only Droppable animals are drawn.
 * Season priority: r = U(1,20); r < 10 restricts the draw to animals of the current season.
 * inferido: notes.md marks the seasonal detail "revisar"; we keep the plain pool when no animal matches.
 */
export function getRandomAnimal(rng: Rng, tier: number, season: number): string {
  if (tier !== 1 && tier !== 2) tier = uniform(rng, 1, 5) >= 2 ? 2 : 1;
  let pool = ANIMALS.filter((a) => a.droppable && !a.omit && a.tier === tier);
  if (season >= 0) {
    const r = uniform(rng, 1, 20);
    if (r < 10) {
      const s = pool.filter((a) => a.seasons.includes(SEASONS[season]));
      if (s.length) pool = s;
    }
  }
  return pick(rng, pool)!.name;
}

/** randomAddAnimal(t): a packet (type 3) with one animal. */
export function randomAnimalPacket(rng: Rng, tier: number, season: number): Packet {
  return { type: 3, id: getRandomAnimal(rng, tier, season), value: 1 };
}

/** getNineAnimalRewardStr: 9 x getRandomAnimal(0) joined with "+" (packet type 10). */
export function nineAnimalsPacket(rng: Rng, season: number): Packet {
  const names: string[] = [];
  for (let i = 0; i < 9; i++) names.push(getRandomAnimal(rng, 0, season));
  return { type: 10, id: names.join('+'), value: 9 };
}

/** heartEarnedCoin(r): coin packet (type 4). */
export function heartEarnedCoin(rng: Rng, r: number): Packet {
  let v: number;
  if (r >= 97) v = uniform(rng, 40001, 50000);
  else if (r >= 87) v = uniform(rng, 20001, 40000);
  else if (r >= 75) v = uniform(rng, 10001, 20000);
  else if (r >= 50) v = uniform(rng, 8001, 10000);
  else v = uniform(rng, 5000, 8000);
  return { type: 4, id: 'heart', value: v };
}

/**
 * getHeartReward(L), L = land level.
 * L >= 4: r = U(0,50): <=20 animal(1), <=30 (2), <=40 (3), <=45 (4), else (5).
 * L < 4:  r = U(0,75): <=25 heartEarnedCoin(U(1,100)), <=45 animal(1), <=55 (2), <=65 (3), <=70 (4), else (5).
 */
export function getHeartReward(rng: Rng, level: number, season: number): Packet {
  if (level >= 4) {
    const r = uniform(rng, 0, 50);
    const t = r <= 20 ? 1 : r <= 30 ? 2 : r <= 40 ? 3 : r <= 45 ? 4 : 5;
    return randomAnimalPacket(rng, t, season);
  }
  const r = uniform(rng, 0, 75);
  if (r <= 25) return heartEarnedCoin(rng, uniform(rng, 1, 100));
  const t = r <= 45 ? 1 : r <= 55 ? 2 : r <= 65 ? 3 : r <= 70 ? 4 : 5;
  return randomAnimalPacket(rng, t, season);
}

/** Building rewards of Epic (type 3) missions: the pool for the gift's type-6 branch. */
export const EPIC_BUILDING_REWARDS = MISSIONS
  .filter((m) => m.type === 3 && /^(DE|RE|TR)-/.test(m.reward))
  .map((m) => m.reward.slice(3))
  .filter((v, i, a) => a.indexOf(v) === i);

/**
 * getGiftPacketReward, r = U(0,100):
 * <=40 coins U(5,8)*100000 (type 4); 41-75 utopium U(5,15) (type 5); 76-90 nine animals (type 10);
 * 91-95 a random type-3 mission building reward (type 6) plus nine animals; > 95 nothing.
 */
export function getGiftPacketReward(rng: Rng, season: number): Packet[] {
  const r = uniform(rng, 0, 100);
  if (r <= 40) return [{ type: 4, id: 'gift', value: uniform(rng, 5, 8) * 100000 }];
  if (r <= 75) return [{ type: 5, id: 'gift', value: uniform(rng, 5, 15) }];
  if (r <= 90) return [nineAnimalsPacket(rng, season)];
  if (r <= 95) return [{ type: 6, id: pick(rng, EPIC_BUILDING_REWARDS)!, value: 1 }, nineAnimalsPacket(rng, season)];
  return [];
}

/** cLootBag::getTreeDrop: (90, 100 coins) (5, 1000 coins) (4, 1 u) (1, 3 u). noUtopium re-rolls utopium results. */
export const TREE_LOOT: { w: number; kind: 'coins' | 'utopium'; n: number }[] = [
  { w: 90, kind: 'coins', n: 100 },
  { w: 5, kind: 'coins', n: 1000 },
  { w: 4, kind: 'utopium', n: 1 },
  { w: 1, kind: 'utopium', n: 3 },
];

export function treeDrop(rng: Rng, noUtopium: boolean): { kind: 'coins' | 'utopium'; n: number } {
  for (;;) {
    let r = Math.floor(rng() * 100);
    for (const e of TREE_LOOT) {
      if (r < e.w) {
        if (noUtopium && e.kind === 'utopium') break;
        return { kind: e.kind, n: e.n };
      }
      r -= e.w;
    }
  }
}

// cAchievementsManager (04 §6). Indexes are 1-based in the order of achievements_static_data.tsv
// (1 = FoundingFathers). Rows with Omit = Y are not used.
import { ACHIEVEMENTS, ANIMALS, JOBS, PATH, WORKPLACE, kindOf } from './data';
import type { Game, Result } from './game';

export const ACH = {
  DONT_PANIC: 21, MOVER: 22, WORKER_HOLIC: 23, WARP_SPEED: 24, IGNORANCE: 31, BOUNTY_HUNTER: 32, MEDAL_OF_HONOR: 33,
  HIGH_SPIRITS: 45, CHECKED_IN: 52, NO_VACANCY: 53,
} as const;

export const ACH_BY_INDEX = new Map(ACHIEVEMENTS.map((a) => [a.index, a]));
export const ACTIVE_ACHIEVEMENTS = ACHIEVEMENTS.filter((a) => !a.omit);

/** isProfessionInPageUnlocked: the 20 job ids starting at 20*idx-19. */
export function pageJobs(idx: number): string[] {
  const lo = 20 * idx - 19, hi = 20 * idx;
  return JOBS.filter((j) => j.id >= lo && j.id <= hi).map((j) => j.name);
}

export class Achievements {
  constructor(private g: Game) {}

  private get a() { return this.g.state.achievements; }

  isDone(i: number): boolean { return this.a.done.includes(i); }
  isCollected(i: number): boolean { return this.a.collected.includes(i); }

  private count(pred: (type: string) => boolean): number {
    return this.g.state.buildings.filter((b) => this.g.isBuilt(b) && pred(b.type)).length;
  }

  /** areAnimalsOfTierUnlocked(t): every animal of the tier has been owned at some point. */
  tierUnlocked(t: number): boolean {
    const seen = new Set(this.g.state.animalsSeen);
    return ANIMALS.filter((a) => a.tier === t && !a.omit).every((a) => seen.has(a.name));
  }

  /** checkConditions: the switch of conditions that are checked rather than triggered (04 §6). */
  condition(i: number): boolean {
    const g = this.g, s = g.state;
    const roads = (t: string) => kindOf(t) === 'path' && PATH.get(t)!.pathType !== 'Waterways';
    const water = (t: string) => kindOf(t) === 'path' && PATH.get(t)!.pathType === 'Waterways';
    if (i >= 1 && i <= 7) return pageJobs(i).every((j) => s.unlockedJobs.includes(j));
    switch (i) {
      case 8: return g.jobsUnlocked >= 150;
      case 9: case 10: case 11: case 12: return this.tierUnlocked(i - 8);
      case 13: return this.count((t) => kindOf(t) === 'decor') >= 5;
      case 14: return this.count((t) => kindOf(t) === 'decor') >= 30;
      case 15: return this.count(roads) >= 5;
      case 16: return this.count(roads) >= 30;
      case 17: return this.count(water) >= 5;
      case 18: return this.count(water) >= 30; // the text says 50, the code uses 30
      case 19: return this.count((t) => kindOf(t) === 'tree') >= 5;
      case 20: return this.count((t) => kindOf(t) === 'tree') >= 30;
      // isAnyWorkplaceFull; inferido: a 6-slot building, as the description says
      case 23: return s.buildings.some((b) => {
        const w = WORKPLACE.get(b.type);
        return !!w && w.maxOccupancy >= 6 && g.workers(b).length >= w.maxOccupancy;
      });
      case 27: return s.stats.upgrades >= 1;
      case 28: return s.stats.upgrades >= 50;
      case 29: return s.stats.mining >= 1;
      case 30: return s.stats.mining >= 20;
      case 36: return s.stats.adoptions >= 1;
      case 37: return s.stats.adoptions >= 20;
      case 38: return s.researchLevel >= 1;
      case 39: return s.researchLevel >= 6;
      case 43: return this.tierUnlocked(5);
      case 45: return s.spiritLimit > 0 && s.spirit >= s.spiritLimit; // addSpirit
      case 52: return s.hotel.length >= 1;                             // movePeepToHotel (inferido)
      case 53: return s.hotel.length >= 6;                             // movePeepToHotel, cmp 6
      default: return false;
    }
  }

  /** completeAchievement: mark it and show the "breaking news" banner. */
  complete(i: number): void {
    const d = ACH_BY_INDEX.get(i);
    if (!d || d.omit || this.isDone(i)) return;
    this.a.done.push(i);
    this.g.events.push({ type: 'achievement', index: i });
  }

  check(): void {
    for (const d of ACTIVE_ACHIEVEMENTS) if (!this.isDone(d.index) && this.condition(d.index)) this.complete(d.index);
  }

  /** collectAchievement: the Reward column, paid in utopium (inferido in 04, exact in 05 §4.1) on a card. */
  collect(i: number): Result {
    const d = ACH_BY_INDEX.get(i);
    if (!d || !this.isDone(i)) return { ok: false, msg: 'NOT UNLOCKED YET' };
    if (this.isCollected(i)) return { ok: false, msg: 'ALREADY COLLECTED' };
    this.a.collected.push(i);
    if (d.reward > 0) this.g.queuePacket({ type: 5, id: `achievement:${i}`, value: d.reward });
    return { ok: true, msg: d.reward > 0 ? `+${d.reward} UTOPIUM` : 'COLLECTED' };
  }

  pendingCount(): number { return this.a.done.filter((i) => !this.isCollected(i)).length; }
}

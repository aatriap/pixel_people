// cMiniQuestSystem / cMiniQuest (04 §3, miniquest.tsv). Each quest belongs to a building and has stages
// (requirement, reward). The mini-quest guest (2005, "Mothership Alert") shows the ones that are ready.
import { WORKPLACE } from './data';
import { hadWeekChange } from './calendar';
import { MISSION_COIN_FLOOR, parseReward } from './missions';
import { nineAnimalsPacket } from './rewards';
import type { MiniQuestSave, Packet } from './state';
import type { Game, Result } from './game';

/** convertBuildingRelatedToID. */
export const MQ = { PARK: 0, ALTAR: 1, MISSION: 2, CALENDAR: 3, TV: 4, BANK: 5, TOWNHALL: 6, SPIRIT: 7 } as const;

export interface MiniStage { req: number; reward: string; tier?: number }
export interface MiniQuestDef {
  id: number; key: string; building: string | null; banner: string; weekly: boolean; stages: MiniStage[];
}

/** Rows of miniquest.tsv in file order ("S: " quests need no building). */
export const MINIQUESTS: MiniQuestDef[] = [
  { id: MQ.TOWNHALL, key: 'Town Hall', building: 'Town Hall', banner: 'MiniquestBanner_TownHall', weekly: true,
    stages: [{ req: 1, reward: 'U-2' }] },
  { id: MQ.CALENDAR, key: 'Calendar', building: null, banner: 'MiniquestBanner_Calendar', weekly: true,
    stages: [1, 2, 3, 4].map(() => ({ req: 1, reward: 'U-2' })) },
  { id: MQ.PARK, key: 'Park', building: 'Park', banner: 'MiniquestBanner_Park', weekly: false,
    stages: [{ req: 3, reward: 'U-2' }] },
  { id: MQ.SPIRIT, key: 'SpiritDiscount', building: null, banner: 'MiniquestBanner_Park', weekly: false,
    stages: [{ req: 75, reward: 'U-5' }] },
  { id: MQ.ALTAR, key: 'Altar', building: 'Altar', banner: 'MiniquestBanner_Altar', weekly: false,
    // "-" (welcome gift), Any-1, L3-1, L5-1
    stages: [{ req: 0, reward: 'A-1' }, { req: 1, reward: 'U-2' }, { req: 1, tier: 3, reward: 'U-5' }, { req: 1, tier: 5, reward: 'U-10' }] },
  { id: MQ.MISSION, key: 'MissionControl', building: 'MissionControl', banner: 'MiniquestBanner_UtopiaHQ', weekly: false,
    stages: [{ req: 1, reward: 'U-5' }, { req: 5, reward: 'U-10' }] },
  { id: MQ.TV, key: 'TV Station', building: 'TV Station', banner: 'MiniquestBanner_TVStation', weekly: false,
    stages: [{ req: 1, reward: 'U-2' }] },
  { id: MQ.BANK, key: 'Bank', building: 'Bank', banner: 'MiniquestBanner_Bank', weekly: false,
    stages: [{ req: 3, reward: 'U-5' }] },
];
export const MINIQUEST = new Map(MINIQUESTS.map((q) => [q.id, q]));

export class MiniQuests {
  constructor(private g: Game) {}

  save(id: number): MiniQuestSave {
    const m = this.g.state.miniquests;
    return (m[id] ??= { stage: 0, qty: 0, stamp: -1 });
  }

  stage(id: number): MiniStage | undefined { return MINIQUEST.get(id)!.stages[this.save(id).stage]; }

  done(id: number): boolean { return !this.stage(id); }

  /** isWeeklyReady: an empty stamp, or a week change since the stamp (which clears it). */
  private weeklyReady(id: number, local: number): boolean {
    const s = this.save(id);
    if (s.stamp < 0) return true;
    if (hadWeekChange(s.stamp, local)) { s.stamp = -1; return true; }
    return false;
  }

  /** cMiniQuest::isReady (04 §3.3). */
  isReady(id: number, local: number): boolean {
    if (this.done(id)) return false;
    const g = this.g, L = g.state.level;
    const q = MINIQUEST.get(id)!;
    switch (id) {
      case MQ.TOWNHALL: return g.doesBuildingExist('Town Hall') && L >= 8 && this.weeklyReady(id, local);
      case MQ.CALENDAR: return L >= 5 && this.weeklyReady(id, local);
      case MQ.SPIRIT: return g.doesBuildingExist('Park') && this.done(MQ.PARK) && g.state.parkLevelUp;
      default: return !!q.building && g.doesBuildingExist(q.building);
    }
  }

  /** getNoOfFullWorkplaces, without the Arrival Center (inferido: the game's count is 1 higher, see 04 §3.3). */
  fullWorkplaces(): number {
    const g = this.g;
    return g.state.buildings.filter((b) => {
      const w = WORKPLACE.get(b.type);
      return w && b.type !== 'SpacePort' && g.isBuilt(b) && w.maxOccupancy > 0 && g.workers(b).length >= w.maxOccupancy;
    }).length;
  }

  /** Progress shown as "%i / req". */
  qty(id: number): number {
    const st = this.stage(id);
    if (!st) return 0;
    const s = this.save(id);
    if (id === MQ.BANK) return Math.min(this.fullWorkplaces(), st.req);
    if (id === MQ.SPIRIT) { s.qty = Math.max(s.qty, Math.trunc(this.g.discount() * 100)); return s.qty; }
    return s.qty;
  }

  isFulfilled(id: number): boolean {
    const st = this.stage(id);
    return !!st && this.qty(id) >= st.req;
  }

  /** incrementQty: only while the quest is ready; Altar stages may ask for a tier. */
  increment(id: number, local: number, tier?: number): void {
    const st = this.stage(id);
    if (!st || !this.isReady(id, local)) return;
    if (st.tier && st.tier !== tier) return;
    const s = this.save(id);
    s.qty = Math.min(s.qty + 1, st.req);
  }

  available(local: number): number[] {
    return MINIQUESTS.map((q) => q.id).filter((id) => this.isReady(id, local));
  }

  rewardPackets(code: string, local: number): Packet[] {
    const r = parseReward(code);
    switch (r.kind) {
      case 'U': return [{ type: 5, id: 'miniquest', value: r.n }];
      case 'Chr': return [{ type: 15, id: 'miniquest', value: r.n }];
      case 'C': return [{ type: 4, id: 'miniquest', value: this.g.coinScaledToCity(r.n, MISSION_COIN_FLOOR) }];
      case 'A': return [nineAnimalsPacket(this.g.rng, this.g.season(local))];
      default: return [];
    }
  }

  /** collect(): the stage reward as a packet, then the next stage (qty back to 0, inferido). */
  collect(id: number, local: number): Result {
    const st = this.stage(id);
    if (!st || !this.isReady(id, local)) return { ok: false, msg: 'NOT AVAILABLE' };
    if (!this.isFulfilled(id)) return { ok: false, msg: 'NOT DONE YET' };
    for (const p of this.rewardPackets(st.reward, local)) this.g.queuePacket(p);
    const s = this.save(id);
    s.stage += 1;
    s.qty = 0;
    if (MINIQUEST.get(id)!.weekly) s.stamp = local;
    return { ok: true };
  }
}

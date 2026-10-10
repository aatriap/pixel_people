// cMissionSystem (spec 04 §1-2): Utopia HQ mission list, Mission Pods and the wonder chain.
import { ANIMAL, JOB, JOB_BY_ID, MISSION, MISSIONS, MissionData, POD } from './data';
import { pick } from './rng';
import { nineAnimalsPacket } from './rewards';
import { ActiveMission, Building, MISSION_SLOT_TYPES, Packet } from './state';
import type { Game, Result } from './game';

export const MISSION_COIN_FLOOR = 500000;
export const FREE_REFRESHES = 4;
export const WONDER_ORDER = ['Monument2', 'Monument4', 'Monument3', 'Monument'];
export const WONDER_PARTS: Record<string, number> = { Monument: 9, Monument3: 4, Monument4: 4 };

export type ReqKind = 'NONE' | 'M' | 'U' | 'J' | 'A' | 'C' | 'T' | 'Chr' | 'BaseCPS' | 'BaseLand';
export interface ParsedReq { kind: ReqKind; value: string; n: number }

/** convertMissionReq: "PREFIX-value". */
export function parseReq(code: string): ParsedReq {
  if (!code || code === 'NONE') return { kind: 'NONE', value: '', n: 0 };
  const i = code.indexOf('-');
  const kind = code.slice(0, i) as ReqKind;
  const value = code.slice(i + 1);
  return { kind, value, n: Number(value) || 0 };
}

export type RewardKind = 'C' | 'U' | 'SP' | 'BLD' | 'CB' | 'A' | 'W' | 'Chr' | 'NONE';
export function parseReward(code: string): { kind: RewardKind; value: string; n: number } {
  const i = code.indexOf('-');
  if (i < 0) return { kind: 'NONE', value: '', n: 0 };
  const p = code.slice(0, i);
  const value = code.slice(i + 1);
  const kind: RewardKind = p === 'DE' || p === 'RE' || p === 'TR' || p === 'B' ? 'BLD'
    : (['C', 'U', 'SP', 'CB', 'A', 'W', 'Chr'] as string[]).includes(p) ? p as RewardKind : 'NONE';
  return { kind, value, n: Number(value) || 0 };
}

/** Wonder key and part number of "Monument3Part2". */
export function wonderOf(id: string): { key: string; part: number } {
  const [key, n] = id.split('Part');
  return { key, part: Number(n) };
}

export class Missions {
  constructor(private g: Game) {}

  private get m() { return this.g.state.missions; }

  /** inferido: the mission list (and the wonder) only run once Utopia HQ ("MissionControl") exists. */
  unlocked(): boolean { return this.g.doesBuildingExist('MissionControl'); }

  active(): ActiveMission[] {
    return [...this.m.slots.filter((x): x is ActiveMission => !!x), ...(this.m.wonder ? [this.m.wonder] : [])];
  }

  find(id: string): ActiveMission | undefined { return this.active().find((a) => a.id === id); }

  countOfType(t: number): number {
    return this.m.slots.filter((x, i) => x && MISSION_SLOT_TYPES[i] === t).length;
  }

  hasRefreshes(): boolean { return this.m.refreshesUsed < FREE_REFRESHES; }

  // ------------------------------------------------------------ eligibility (04 §1.4)
  /** haveAllJobsRequired: every J requirement's job is already unlocked (J-0 = any job). */
  haveAllJobsRequired(md: MissionData): boolean {
    return md.reqs.every((r) => {
      const p = parseReq(r);
      if (p.kind !== 'J' || p.n === 0) return true;
      const j = JOB_BY_ID.get(p.n);
      return !!j && this.g.state.unlockedJobs.includes(j.name);
    });
  }

  /** repeatableMissionFilter: Normal/Epic need the Altar if marked, and Need No. of Jobs < unlocked jobs. */
  repeatableFilter(md: MissionData): boolean {
    if (md.type === 4 || md.type === 5) return true;
    if (md.needAltar && !this.g.doesBuildingExist('Altar')) return false;
    return md.needJobs < this.g.jobsUnlocked;
  }

  eligible(type: number, season: number): MissionData[] {
    const activeIds = new Set(this.active().map((a) => a.id));
    const seasonName = season >= 0 ? ['THAW', 'SWELL', 'HARVEST', 'FROST'][season] : '';
    return MISSIONS.filter((md) => md.type === type && !md.discontinued && !activeIds.has(md.id)
      && !(md.type === 4 && this.m.uniquesDone.includes(md.id))
      // inferido: missions with a Season column only show up in that season
      && (!md.season || md.season === seasonName)
      && this.haveAllJobsRequired(md) && this.repeatableFilter(md));
  }

  /** getRandomMission(type). Uniques prefer this season's SP missions. */
  getRandomMission(type: number, season: number): MissionData | undefined {
    const pool = this.eligible(type, season);
    if (type === 4) {
      const sp = pool.filter((md) => md.season && md.reward.startsWith('SP-'));
      if (sp.length) return pick(this.g.rng, sp);
    }
    return pick(this.g.rng, pool);
  }

  /** cMissionSaveData + processBaseValues (BaseCPS/BaseLand targets are relative to the recorded best). */
  create(md: MissionData): ActiveMission {
    const st = this.m;
    if (st.baseCps <= 0) st.baseCps = this.g.maxCps();
    if (st.baseLand <= 0) st.baseLand = this.g.state.landUsed;
    let cps = 0, land = 0;
    for (const r of md.reqs) {
      const p = parseReq(r);
      if (p.kind === 'BaseCPS') cps = Math.max(cps, p.n);
      if (p.kind === 'BaseLand') land = Math.max(land, p.n);
    }
    return {
      id: md.id, reqs: md.reqs.map((code) => ({ code, acq: null })),
      targetCps: st.baseCps + cps, targetLand: st.baseLand + land,
    };
  }

  private add(type: number, md: MissionData): void {
    const i = this.m.slots.findIndex((x, k) => !x && MISSION_SLOT_TYPES[k] === type);
    if (i >= 0) this.m.slots[i] = this.create(md);
  }

  /** First opening: fill all 6 slots for free. */
  initialFill(local: number): void {
    const season = this.g.season(local);
    for (const t of MISSION_SLOT_TYPES) {
      const md = this.getRandomMission(t, season);
      if (md) this.add(t, md);
      this.m.refreshesUsed = 0;
    }
    this.m.started = true;
  }

  /** refreshMissionListIndex(type): with <= 1 listed, add one if refreshes used <= 3 (consumes one). */
  refreshIndex(type: number, local: number): void {
    if (this.countOfType(type) > 1) return;
    const md = this.getRandomMission(type, this.g.season(local));
    if (md && this.m.refreshesUsed <= 3) {
      this.add(type, md);
      this.m.refreshesUsed += 1;
    }
  }

  /** dailyAutoRefresh: types 4, 3, 2; top each up to 2 while refreshes used <= 3. */
  dailyAutoRefresh(local: number): void {
    if (!this.m.started) return;
    for (const t of [4, 3, 2]) {
      while (this.countOfType(t) < 2 && this.m.refreshesUsed <= 3) {
        const md = this.getRandomMission(t, this.g.season(local));
        if (!md) break;
        this.add(t, md);
        this.m.refreshesUsed += 1;
      }
    }
  }

  // ------------------------------------------------------------ wonders (04 §2)
  lastWonderMissionDone(): string | null {
    for (const k of WONDER_ORDER) {
      const n = this.m.wonderMap[k];
      if (n) return `${k}Part${n}`;
    }
    return null;
  }

  wonderPartDone(type: string): boolean {
    const { key, part } = wonderOf(type);
    return (this.m.wonderMap[key] ?? 0) >= part;
  }

  wondersDoneCount(): number { return Object.values(this.m.wonderMap).reduce((a, b) => a + b, 0); }

  refreshWonderMission(): void {
    if (this.m.wonder) return;
    const last = this.lastWonderMissionDone();
    const next = last ? MISSIONS.find((md) => md.type === 5 && md.prerequisite === last) : MISSION.get('MonumentPart1');
    if (next && !this.wonderPartDone(next.id)) this.m.wonder = this.create(next);
  }

  /** Called every tick. */
  update(local: number): void {
    if (!this.unlocked()) return;
    if (!this.m.started) this.initialFill(local);
    this.refreshWonderMission();
    // checkForDiscontinuedMissions
    this.m.slots.forEach((x, i) => {
      if (x && MISSION.get(x.id)?.discontinued) { this.reset(x); this.m.slots[i] = null; this.refreshIndex(MISSION_SLOT_TYPES[i], local); }
    });
  }

  // ------------------------------------------------------------ requirements
  /** The pod (or the wonder part building) that hosts this mission's clones. */
  hostOf(a: ActiveMission): Building | undefined {
    const md = MISSION.get(a.id)!;
    if (md.type === 5) return this.g.state.buildings.find((b) => b.type === a.id);
    return this.g.state.buildings.find((b) => b.type === POD && b.mission === a.id);
  }

  jobOf(code: string): string | null {
    const p = parseReq(code);
    if (p.kind !== 'J') return null;
    return p.n === 0 ? '*' : JOB_BY_ID.get(p.n)?.name ?? null;
  }

  /** Does this animal fit an A/C/T requirement? */
  animalFits(code: string, animal: string): boolean {
    const p = parseReq(code);
    const a = ANIMAL.get(animal);
    if (!a) return false;
    if (p.kind === 'A') return a.name === p.value;
    if (p.kind === 'C') return a.categories.includes(p.value);
    if (p.kind === 'T') return p.n === 0 || a.tier === p.n;
    return false;
  }

  /** Money-like totals of a mission (U and Chr are accumulated; M too, inferido). */
  totals(a: ActiveMission): { coins: number; utopium: number; chroma: number } {
    const t = { coins: 0, utopium: 0, chroma: 0 };
    for (const r of a.reqs) {
      const p = parseReq(r.code);
      if (p.kind === 'M') t.coins += this.g.coinScaledToCity(p.n, MISSION_COIN_FLOOR);
      if (p.kind === 'U') t.utopium += p.n;
      if (p.kind === 'Chr') t.chroma += p.n;
    }
    return t;
  }

  animalUse(a: ActiveMission): Map<string, number> {
    const use = new Map<string, number>();
    for (const r of a.reqs) {
      const k = parseReq(r.code).kind;
      if ((k === 'A' || k === 'C' || k === 'T') && r.acq) use.set(r.acq, (use.get(r.acq) ?? 0) + 1);
    }
    return use;
  }

  /** Requirement i is met right now (canComplete, per requirement). */
  reqMet(a: ActiveMission, i: number): boolean {
    const r = a.reqs[i];
    const p = parseReq(r.code);
    const s = this.g.state;
    const t = this.totals(a);
    switch (p.kind) {
      case 'NONE': return true;
      case 'M': return s.coins >= t.coins;
      case 'U': return s.utopium >= t.utopium;
      case 'Chr': return s.chroma >= t.chroma;
      case 'J': return !!r.acq;
      case 'BaseCPS': return this.g.maxCps() >= a.targetCps;
      case 'BaseLand': return s.landUsed >= a.targetLand;
      case 'A': case 'C': case 'T': {
        if (!r.acq || !this.animalFits(r.code, r.acq)) return false;
        return (s.animals[r.acq] ?? 0) >= (this.animalUse(a).get(r.acq) ?? 0);
      }
    }
  }

  canComplete(a: ActiveMission): boolean { return a.reqs.every((_, i) => this.reqMet(a, i)); }

  /** J requirements still open that this job can fill. */
  vacancyFor(job: string): { mission: ActiveMission; index: number } | undefined {
    for (const a of this.active()) {
      if (!this.hostOf(a)) continue;
      const i = a.reqs.findIndex((r) => !r.acq && (this.jobOf(r.code) === job || this.jobOf(r.code) === '*'));
      if (i >= 0) return { mission: a, index: i };
    }
    return undefined;
  }

  clonesNeeded(a: ActiveMission): number { return a.reqs.filter((r) => parseReq(r.code).kind === 'J').length; }

  // ------------------------------------------------------------ actions
  /** deliverCloneToMissionPod: the clone moves into the pod (no housing needed). */
  deliverClone(slotIdx: number): Result {
    const s = this.g.state.slots[slotIdx];
    if (!s || s.state !== 5 || !s.peep || !s.job) return { ok: false, msg: 'NO CLONE WAITING' };
    const v = this.vacancyFor(s.job);
    if (!v) return { ok: false, msg: 'NO JOB VACANCY IN MISSION PODS' };
    const host = this.hostOf(v.mission)!;
    const p = this.g.peep(s.peep)!;
    p.home = host.id;
    p.work = host.id;
    v.mission.reqs[v.index].acq = p.id;
    this.g.clearSlot(slotIdx);
    return { ok: true, msg: `${JOB.get(s.job)?.displayName.toUpperCase() ?? 'CLONE'} HAS VOLUNTEERED` };
  }

  assignAnimal(id: string, index: number, animal: string | null): Result {
    const a = this.find(id);
    if (!a) return { ok: false, msg: 'NO SUCH MISSION' };
    const r = a.reqs[index];
    if (!r) return { ok: false, msg: '' };
    if (animal && !this.animalFits(r.code, animal)) return { ok: false, msg: 'WRONG ANIMAL' };
    r.acq = animal;
    return { ok: true };
  }

  /** Helper for the UI: fill every empty animal requirement with owned animals, rarest constraint first. */
  autoAssignAnimals(id: string): number {
    const a = this.find(id);
    if (!a) return 0;
    const left = { ...this.g.state.animals };
    for (const [k, n] of this.animalUse(a)) left[k] = (left[k] ?? 0) - n;
    let filled = 0;
    const order = a.reqs.map((r, i) => ({ r, i, k: parseReq(r.code).kind }))
      .filter((x) => !x.r.acq && (x.k === 'A' || x.k === 'C' || x.k === 'T'))
      .sort((x, y) => 'ACT'.indexOf(x.k) - 'ACT'.indexOf(y.k));
    for (const { r } of order) {
      const cands = Object.keys(left).filter((n) => left[n] > 0 && this.animalFits(r.code, n))
        .sort((x, y) => (ANIMAL.get(x)!.tier - ANIMAL.get(y)!.tier) || left[y] - left[x]);
      if (cands.length) { r.acq = cands[0]; left[cands[0]] -= 1; filled++; }
    }
    return filled;
  }

  /** resetMission: delivered clones are lost and the pod is demolished. Wonder buildings stay. */
  private reset(a: ActiveMission): void {
    const s = this.g.state;
    const ids = new Set(a.reqs.filter((r) => parseReq(r.code).kind === 'J' && r.acq).map((r) => r.acq!));
    s.peeps = s.peeps.filter((p) => !ids.has(p.id));
    s.buildings = s.buildings.filter((b) => !(b.type === POD && b.mission === a.id));
  }

  rewardPackets(md: MissionData, local: number): Packet[] {
    const r = parseReward(md.reward);
    const season = this.g.season(local);
    const src = `mission:${md.id}`;
    switch (r.kind) {
      case 'C': return [{ type: 4, id: src, value: this.g.coinScaledToCity(r.n, MISSION_COIN_FLOOR) }];
      case 'U': return [{ type: 5, id: src, value: r.n }];
      case 'Chr': return [{ type: 15, id: src, value: r.n }];
      case 'SP': return [{ type: 1, id: r.value, value: 1 }];
      case 'BLD': return [{ type: 6, id: r.value, value: 1 }];
      case 'CB': return [{ type: 9, id: md.id, value: r.n }];
      case 'A': return [nineAnimalsPacket(this.g.rng, season)];
      case 'W': return [{ type: 16, id: md.id, value: 0 }]; // card only (types 16-49 have no effect)
      default: return [];
    }
  }

  /** completeMission (04 §1.6.4). */
  complete(id: string, local: number): Result {
    const a = this.find(id);
    if (!a) return { ok: false, msg: 'NO SUCH MISSION' };
    if (!this.canComplete(a)) return { ok: false, msg: 'NOT ALL REQUIREMENTS ACQUIRED' };
    const md = MISSION.get(id)!;
    const s = this.g.state;
    const st = this.m;
    const kinds = a.reqs.map((r) => parseReq(r.code).kind);
    if (kinds.includes('BaseCPS')) st.baseCps = Math.max(st.baseCps, a.targetCps, this.g.maxCps());
    if (kinds.includes('BaseLand')) st.baseLand = Math.max(st.baseLand, a.targetLand, s.landUsed);
    for (const [name, n] of this.animalUse(a)) {
      s.animals[name] = (s.animals[name] ?? 0) - n;
      if (s.animals[name] <= 0) delete s.animals[name];
    }
    if (md.type === 4) st.uniquesDone.push(md.id);
    for (const p of this.rewardPackets(md, local)) this.g.queuePacket(p);
    const t = this.totals(a);
    s.coins -= t.coins;
    s.utopium -= t.utopium;
    s.chroma -= t.chroma;
    this.reset(a);
    st.completed += 1;
    this.g.miniquests.increment(2, local); // cMiniQuestSystem::incrementQty(2): MissionControl
    if (md.type === 5) {
      const w = wonderOf(md.id);
      st.wonderMap[w.key] = w.part;
      // the clones that worked on the wonder leave with the vessel (inferido)
      const ids = new Set(a.reqs.map((r) => r.acq));
      s.peeps = s.peeps.filter((p) => !ids.has(p.id));
      st.wonder = null;
      this.refreshWonderMission();
    } else {
      const i = st.slots.findIndex((x) => x?.id === id);
      st.slots[i] = null;
      this.refreshIndex(md.type, local);
    }
    this.g.events.push({ type: 'missionComplete', mission: md.id });
    return { ok: true, msg: `MISSION "${md.name.toUpperCase()}" COMPLETE!` };
  }

  /** skipMission ("REFRESH MISSION"). Returns msg 'NO_REFRESHES' when the 1 u prompt is needed. */
  skip(id: string, local: number): Result {
    const st = this.m;
    const i = st.slots.findIndex((x) => x?.id === id);
    if (i < 0) return { ok: false, msg: 'CANNOT REFRESH THIS MISSION' };
    if (!this.hasRefreshes()) return { ok: false, msg: 'NO_REFRESHES' };
    const type = MISSION_SLOT_TYPES[i];
    const next = this.getRandomMission(type, this.g.season(local));
    if (!next) return { ok: false, msg: 'NO MISSION OF THIS TYPE TO SKIP TO' };
    this.reset(st.slots[i]!);
    st.slots[i] = this.create(next);
    st.refreshesUsed += 1;
    return { ok: true, msg: 'MISSION REFRESHED' };
  }

  /** replenishRefreshesPrompt: 1 utopium resets the refresh counter. */
  replenish(): Result {
    if (this.g.state.utopium < 1) return { ok: false, msg: 'NOT ENOUGH UTOPIUM' };
    this.g.state.utopium -= 1;
    this.m.refreshesUsed = 0;
    return { ok: true, msg: 'MISSION REFRESHES REPLENISHED' };
  }
}

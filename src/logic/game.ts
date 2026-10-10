// Game rules on top of GameState. No Phaser here: everything is plain TS and unit-testable.
import {
  JOB, JOBS, WORKPLACE, RESIDENCE, DECOR_BY, PATH, TREE, LAND, Cost,
  kindOf, footprint, landUse,
} from './data';
import {
  arrivalTime, buildingCps, buildingTime, coinGen, constructionRushCost, landRow, landUpgradeCost,
  maxSpirit, spiritDiscount, splicingTime, timeRushCost, workingTime,
} from './formulas';
import { Building, GameState, Peep, Slot, emptySlot, newGame } from './state';

export const FREE_COOLDOWN = 24 * 3600;

export type GameEvent =
  | { type: 'coins'; building: string; amount: number }
  | { type: 'built'; building: string }
  | { type: 'arrived'; peep: string }
  | { type: 'spliced'; peep: string; job: string; isNew: boolean }
  | { type: 'shiftEnded'; building: string };

export interface Result { ok: boolean; msg?: string }
const ok = (msg?: string): Result => ({ ok: true, msg });
const fail = (msg: string): Result => ({ ok: false, msg });

export type ComboKind = 'none' | 'old' | 'new' | 'evil';
export interface ComboInfo { kind: ComboKind; job: string | null; landRequired: number }

export class Game {
  state: GameState;
  /** gm+596: false on the first tick after loading (affects the offline catch-up of finished shifts). */
  firstTickDone = false;
  events: GameEvent[] = [];

  constructor(state: GameState) {
    this.state = state;
  }

  static fresh(now: number): Game {
    return new Game(newGame(now));
  }

  // ---------------------------------------------------------------- queries
  get jobsUnlocked(): number { return this.state.unlockedJobs.length; }

  discount(): number { return spiritDiscount(this.state.spirit, this.state.spiritLimit); }

  building(id: string): Building | undefined { return this.state.buildings.find((b) => b.id === id); }
  peep(id: string): Peep | undefined { return this.state.peeps.find((p) => p.id === id); }

  isBuilt(b: Building): boolean { return b.buildEnd < 0; }

  workers(b: Building): Peep[] { return this.state.peeps.filter((p) => p.work === b.id); }
  residents(b: Building): Peep[] { return this.state.peeps.filter((p) => p.home === b.id); }

  doesBuildingExist(type: string): boolean { return this.state.buildings.some((b) => b.type === type); }

  /** Feature 1 (Bank): full workplaces produce x2. */
  hasBank(): boolean { return this.doesBuildingExist('Bank'); }

  buildingWorkingTime(b: Building): number {
    const w = WORKPLACE.get(b.type);
    return w ? workingTime(w.workingTimeMin, b.level) : -1;
  }

  buildingCps(b: Building): number {
    const w = WORKPLACE.get(b.type);
    if (!w) return 0;
    const ws = this.workers(b);
    const full = ws.length > 0 && ws.length === w.maxOccupancy;
    return buildingCps(w.multiplier, ws.map((p) => p.cps), this.hasBank() && full);
  }

  /** Total coins per second of the shifts that are running. */
  totalCps(): number {
    return this.state.buildings
      .filter((b) => b.shiftStart >= 0)
      .reduce((a, b) => a + this.buildingCps(b), 0);
  }

  population(): number { return this.state.peeps.length; }

  populationLimit(): number {
    return this.state.buildings
      .filter((b) => RESIDENCE.has(b.type) && this.isBuilt(b))
      .reduce((a, b) => a + RESIDENCE.get(b.type)!.population, 0);
  }

  totalResidenceVacancy(): number {
    return this.state.buildings
      .filter((b) => RESIDENCE.has(b.type) && this.isBuilt(b))
      .reduce((a, b) => a + Math.max(0, RESIDENCE.get(b.type)!.population - this.residents(b).length), 0);
  }

  firstVacantResidence(): Building | undefined {
    return this.state.buildings.find((b) => RESIDENCE.has(b.type) && this.isBuilt(b)
      && this.residents(b).length < RESIDENCE.get(b.type)!.population);
  }

  freeLand(): number { return this.state.landLimit - this.state.landUsed; }

  occupied(): Map<string, string> {
    const m = new Map<string, string>();
    for (const b of this.state.buildings) {
      for (const [dx, dy] of footprint(b.type, b.flip)) m.set(`${b.x + dx},${b.y + dy}`, b.id);
    }
    return m;
  }

  /** cBuildManager::canPlaceTileAt: only checks that every footprint cell is free. */
  canPlaceAt(type: string, x: number, y: number, flip = false, ignore?: string): boolean {
    const occ = this.occupied();
    return footprint(type, flip).every(([dx, dy]) => {
      const o = occ.get(`${x + dx},${y + dy}`);
      return o === undefined || o === ignore;
    });
  }

  landUpgradeCost(): number {
    return landUpgradeCost(landRow(LAND, this.state.level).cost, this.discount());
  }

  arrivalTime(): number { return arrivalTime(this.jobsUnlocked, this.discount()); }

  splicingDuration(): number { return Math.trunc((1 - this.discount()) * splicingTime(this.jobsUnlocked)); }

  buildTime(type: string): number {
    const base = WORKPLACE.get(type)?.baseConstructionSec ?? RESIDENCE.get(type)?.baseConstructionSec ?? 0;
    return buildingTime(base, this.jobsUnlocked, this.discount());
  }

  // ---------------------------------------------------------------- splicer
  /** cSplicerSystem::validateSplicingCombination: recipe match in either order. */
  validate(a: string, b: string): string | null {
    for (const j of JOBS) {
      if ((j.parent1 === a && j.parent2 === b) || (j.parent1 === b && j.parent2 === a)) {
        const req = j.requires.split('_');
        if (req.length === 2 && req[0] === 'MI') return null; // mission-locked; missions are not in this milestone
        return j.name;
      }
    }
    return null;
  }

  /** landLimitReached(job): only Workplace 1 matters, and only if none exists yet. */
  landLimitReached(job: string): boolean {
    const wp = JOB.get(job)?.workplaces[0];
    if (!wp) return true;
    if (this.doesBuildingExist(wp)) return false;
    const st = WORKPLACE.get(wp);
    if (!st) return true;
    return this.freeLand() < st.size;
  }

  combo(a: string | null, b: string | null): ComboInfo {
    if (!a || !b) return { kind: 'none', job: null, landRequired: 0 };
    const job = this.validate(a, b);
    if (!job) return { kind: 'none', job: null, landRequired: 0 };
    const jd = JOB.get(job)!;
    if (this.state.unlockedJobs.includes(job)) return { kind: 'old', job, landRequired: 0 };
    const wp = jd.workplaces[0];
    const landRequired = wp && !this.doesBuildingExist(wp) ? WORKPLACE.get(wp)?.size ?? 0 : 0;
    return { kind: jd.group === 'Evil' ? 'evil' : 'new', job, landRequired };
  }

  startSplice(slotIdx: number, a: string, b: string, now: number): Result {
    const s = this.state.slots[slotIdx];
    if (!s || s.state !== 3) return fail('NO CLONE READY TO SPLICE');
    if (!this.state.unlockedJobs.includes(a) || !this.state.unlockedJobs.includes(b)) return fail('UNKNOWN GENE');
    const job = this.validate(a, b);
    if (!job) return fail('NO GENETIC MATCH');
    if (this.state.slots.some((x) => x.state === 4 && x.job === job)) return fail('JOB IS STILL SPLICING');
    if (this.state.slots.some((x) => x.state === 5 && x.job === job)) return fail('THIS JOB IS WAITING FOR ASSIGNMENT');
    if (this.landLimitReached(job)) return fail('UTOPIA NEEDS MORE LAND');
    const dur = this.splicingDuration();
    s.state = 4; s.start = now; s.end = now + dur; s.job = job;
    return ok();
  }

  private completeSplice(s: Slot): void {
    const job = s.job!;
    const peep = this.peep(s.peep!);
    const isNew = !this.state.unlockedJobs.includes(job);
    if (isNew) {
      this.state.unlockedJobs.push(job);
      this.state.discoveries.push(job);
      const wp = JOB.get(job)?.workplaces[0];
      if (wp && !this.doesBuildingExist(wp) && !this.state.pendingWorkplaces.includes(wp)) {
        this.state.pendingWorkplaces.push(wp);
      }
    }
    if (peep) { peep.job = job; peep.cps = 1; }
    s.state = 5; s.end = -1;
    this.events.push({ type: 'spliced', peep: s.peep!, job, isNew });
  }

  rushSplice(slotIdx: number, now: number): Result {
    const s = this.state.slots[slotIdx];
    if (!s || s.state !== 4) return fail('NOTHING TO RUSH');
    const cost = timeRushCost(s.end - now);
    if (this.state.utopium < cost) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= cost;
    this.completeSplice(s);
    return ok();
  }

  freeSplice(slotIdx: number, now: number): Result {
    const s = this.state.slots[slotIdx];
    if (!s || s.state !== 4) return fail('NOTHING TO SPEED UP');
    if (now < this.state.freeSpliceReadyAt) return fail('FREE BUTTON IS COOLING DOWN');
    this.state.freeSpliceReadyAt = now + FREE_COOLDOWN;
    this.completeSplice(s);
    return ok();
  }

  /** Workplace buildings where this clone could go: first one of each type without that job (isWorkplaceVacant). */
  vacantWorkplace(type: string, job: string): Building | undefined {
    return this.state.buildings.find((b) => b.type === type && this.isBuilt(b)
      && !this.workers(b).some((p) => p.job === job));
  }

  assignClone(slotIdx: number, workplaceType: string): Result {
    const s = this.state.slots[slotIdx];
    if (!s || s.state !== 5 || !s.peep || !s.job) return fail('NO CLONE WAITING');
    const jd = JOB.get(s.job);
    if (!jd || !jd.workplaces.includes(workplaceType)) return fail('WRONG WORKPLACE');
    const b = this.vacantWorkplace(workplaceType, s.job);
    if (!b) return fail('NO VACANCY');
    const p = this.peep(s.peep)!;
    p.work = b.id;
    this.state.slots[slotIdx] = emptySlot();
    return ok();
  }

  // ---------------------------------------------------------------- arrival center
  private shouldSpawnFemale(): boolean {
    const f = this.state.peeps.filter((p) => p.female).length;
    const m = this.state.peeps.length - f;
    if (m > f) return true;
    if (m < f) return false;
    return Math.random() < 0.5;
  }

  /** scheduleCloneArrival (02 §2.2). `startAt` lets offline catch-up chain arrivals. */
  private scheduleArrivals(startAt: number): void {
    const slots = this.state.slots;
    if (!this.firstVacantResidence()) {
      for (const s of slots) if (s.state === 1 || s.state === 2) { s.state = 0; s.start = -1; s.end = -1; }
      return;
    }
    let vac = this.totalResidenceVacancy();
    let arriving = false;
    for (const s of slots) if (s.state === 2) { vac -= 1; arriving = true; }
    for (const s of slots) {
      if (s.state !== 0 && s.state !== 1) continue;
      if (vac < 1) { s.state = 0; s.start = -1; s.end = -1; }
      else if (!arriving) {
        s.state = 2; s.start = startAt; s.end = startAt + this.arrivalTime(); vac -= 1; arriving = true;
      } else { s.state = 1; vac -= 1; }
    }
  }

  private cloneArrived(s: Slot): void {
    const home = this.firstVacantResidence();
    if (!home) { s.state = 0; s.start = -1; s.end = -1; return; }
    const id = `Clone_${++this.state.counter}`;
    this.state.peeps.push({ id, female: this.shouldSpawnFemale(), job: null, home: home.id, work: null, cps: 1 });
    s.state = 3; s.end = -1; s.peep = id; s.job = null;
    this.events.push({ type: 'arrived', peep: id });
  }

  rushArrival(slotIdx: number, now: number): Result {
    const s = this.state.slots[slotIdx];
    if (!s || s.state !== 2) return fail('NOTHING TO RUSH');
    const cost = timeRushCost(s.end - now);
    if (this.state.utopium < cost) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= cost;
    this.cloneArrived(s);
    this.scheduleArrivals(now);
    return ok();
  }

  private arrivalUpdate(now: number): void {
    let startAt = now;
    for (let guard = 0; guard < 10; guard++) {
      this.scheduleArrivals(startAt);
      const s = this.state.slots.find((x) => x.state === 2);
      if (!s || s.end >= now) break;
      startAt = s.end; // offline: the next clone starts when this one arrived
      this.cloneArrived(s);
    }
    for (const s of this.state.slots) if (s.state === 4 && s.end <= now) this.completeSplice(s);
  }

  // ---------------------------------------------------------------- buildings
  /** Cost to place one object of this type (null = cannot be bought here). */
  placementCost(type: string): Cost | null {
    switch (kindOf(type)) {
      case 'workplace': return { coins: 0, utopium: 0, chroma: 0 }; // first workplace of a job: land only
      case 'residence': return RESIDENCE.get(type)!.cost;
      case 'decor': return DECOR_BY.get(type)!.cost;
      case 'path': return PATH.get(type)!.cost;
      case 'tree': return TREE.get(type)?.cost ?? null;
    }
  }

  canAfford(c: Cost): boolean {
    return this.state.coins >= c.coins && this.state.utopium >= c.utopium && this.state.chroma >= c.chroma;
  }

  place(type: string, x: number, y: number, flip: boolean, now: number): Result {
    const kind = kindOf(type);
    if (kind === 'workplace' && !this.state.pendingWorkplaces.includes(type)) return fail('NOT AVAILABLE');
    const cost = this.placementCost(type);
    if (!cost) return fail('NOT AVAILABLE');
    if (!this.canPlaceAt(type, x, y, flip)) return fail('SPACE OCCUPIED');
    const land = landUse(type);
    if (land > this.freeLand()) return fail('EXPAND TO BUILD MORE');
    if (!this.canAfford(cost)) {
      return fail(this.state.coins < cost.coins ? 'NOT ENOUGH COINS'
        : this.state.utopium < cost.utopium ? 'NOT ENOUGH UTOPIUM' : 'NOT ENOUGH CHROMA');
    }
    this.state.coins -= cost.coins;
    this.state.utopium -= cost.utopium;
    this.state.chroma -= cost.chroma;
    this.state.landUsed += land;
    if (kind === 'decor') this.state.spirit += DECOR_BY.get(type)!.spirit;
    if (kind === 'workplace') {
      this.state.pendingWorkplaces = this.state.pendingWorkplaces.filter((w) => w !== type);
    }
    const t = kind === 'workplace' || kind === 'residence' ? this.buildTime(type) : 0;
    const id = `${type}_${++this.state.counter}`;
    this.state.buildings.push({
      id, type, x, y, flip, buildStart: t > 0 ? now : -1, buildEnd: t > 0 ? now + t : -1, shiftStart: -1, level: 1,
    });
    return { ok: true, msg: id };
  }

  rushConstruction(id: string, now: number): Result {
    const b = this.building(id);
    if (!b || this.isBuilt(b)) return fail('NOTHING TO RUSH');
    const cost = constructionRushCost(b.buildEnd - now);
    if (this.state.utopium < cost) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= cost;
    this.finishConstruction(b);
    return ok();
  }

  /** Replaces the ad: -1 h, or finish if less than an hour is left. Once, then 24 h cooldown. */
  freeConstruction(id: string, now: number): Result {
    const b = this.building(id);
    if (!b || this.isBuilt(b)) return fail('NOTHING TO SPEED UP');
    if (now < this.state.freeBuildReadyAt) return fail('FREE BUTTON IS COOLING DOWN');
    this.state.freeBuildReadyAt = now + FREE_COOLDOWN;
    if (b.buildEnd - now > 3599) b.buildEnd -= 3600;
    else this.finishConstruction(b);
    return ok();
  }

  private finishConstruction(b: Building): void {
    b.buildEnd = -1;
    this.events.push({ type: 'built', building: b.id });
  }

  /** Tap on a workplace: restart a stopped shift for free if it has at least one worker. */
  tapWorkplace(id: string, now: number): Result {
    const b = this.building(id);
    if (!b || !WORKPLACE.has(b.type) || !this.isBuilt(b)) return fail('');
    if (b.type === 'SpacePort') return fail('');
    if (b.shiftStart >= 0) return fail('ALREADY WORKING');
    if (this.workers(b).length < 1) return fail('NO WORKERS');
    b.shiftStart = now;
    return ok();
  }

  needsRestart(b: Building): boolean {
    return WORKPLACE.has(b.type) && b.type !== 'SpacePort' && this.isBuilt(b) && b.shiftStart < 0
      && this.workers(b).length > 0;
  }

  // ---------------------------------------------------------------- land
  expandLand(): Result {
    const cost = this.landUpgradeCost();
    if (this.state.coins < cost) return fail('NOT ENOUGH COINS');
    this.state.coins -= cost;
    const row = landRow(LAND, this.state.level);
    this.state.utopium += row.utopium;
    this.state.lifetimeUtopium += row.utopium;
    this.state.landLimit += row.land;
    this.state.spiritLimit = maxSpirit(this.state.level);
    this.state.level += 1;
    return ok();
  }

  // ---------------------------------------------------------------- tick
  /** cGameManager::timeUpdate(now) — one logical tick (01 §4.2). */
  tick(now: number): void {
    const st = this.state;
    st.playTime += 1;
    if (st.lastTick < now) {
      const downtime = now - st.lastTick > 1;
      // construction that finished (also while offline) before paying coins
      for (const b of st.buildings) if (b.buildEnd >= 0 && b.buildEnd <= now) this.finishConstruction(b);
      for (const b of st.buildings) {
        const w = WORKPLACE.get(b.type);
        if (!w || b.shiftStart === -1) continue;
        const r = coinGen({
          start: b.shiftStart, W: this.buildingWorkingTime(b), cps: this.buildingCps(b),
          now, last: st.lastTick, downtime, firstTickDone: this.firstTickDone,
        });
        if (r.coins > 0) {
          st.coins += r.coins;
          st.lifetimeCoins += r.coins;
          this.events.push({ type: 'coins', building: b.id, amount: r.coins });
        }
        if (r.start === -1) this.events.push({ type: 'shiftEnded', building: b.id });
        b.shiftStart = r.start;
      }
    }
    this.arrivalUpdate(now);
    st.lastTick = now;
    st.latestTime = Math.max(st.latestTime, now);
    this.firstTickDone = true;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

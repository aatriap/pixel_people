// Game rules on top of GameState. No Phaser here: everything is plain TS and unit-testable.
import {
  JOB, JOBS, WORKPLACE, RESIDENCE, DECOR_BY, PATH, TREE, LAND, Cost, POD, TERRAIN_BY, CREDITS,
  kindOf, footprint, landUse,
} from './data';
import {
  arrivalTime, buildingCps, buildingTime, coinGen, constructionRushCost, landRow, landUpgradeCost,
  maxSpirit, spiritDiscount, splicingTime, timeRushCost, timeTillNoon, workingTime,
} from './formulas';
import { Building, GameState, Packet, Peep, Slot, emptySlot, newGame } from './state';
import { Rng, uniform } from './rng';
import { calendarAt, dailyReward, dayNumber, weekStart } from './calendar';
import { getGiftPacketReward, getHeartReward, nineAnimalsPacket, randomAnimalPacket, treeDrop } from './rewards';
import { Missions } from './missions';
import { MiniQuests, MQ } from './miniquests';
import { Achievements, ACH } from './achievements';
import { PACK_ITEM, Shop } from './shop';
import { TUTORIAL, TUTORIAL_UTOPIUM, TutAction } from './tutorial';

export const FREE_COOLDOWN = 24 * 3600;
/** How far (in tiles) from existing buildings the grid reaches. */
export const BUILD_REACH = 2;
/** Tutorial steps that only show something; a later real action may pass them (web). */
const SOFT_TUT = new Set<TutAction>(['next', 'openSite', 'openAC', 'tapPortrait', 'spliceMe', 'card']);

export type GameEvent =
  | { type: 'coins'; building: string; amount: number }
  | { type: 'built'; building: string }
  | { type: 'arrived'; peep: string }
  | { type: 'spliced'; peep: string; job: string; isNew: boolean }
  | { type: 'shiftEnded'; building: string }
  | { type: 'heart'; building: string }
  | { type: 'treeReady'; building: string }
  | { type: 'tree'; building: string; kind: 'coins' | 'utopium'; amount: number }
  | { type: 'dailyReset' }
  | { type: 'missionComplete'; mission: string }
  | { type: 'achievement'; index: number }
  | { type: 'mineReady' }
  | { type: 'shelterReady' }
  | { type: 'tutorial'; step: number };

/** cFeatureBlocker (03 §5): feature id -> building whose existence unlocks it. 16 is bought at the Enterprise. */
export const FEATURES: Record<number, string> = {
  0: 'Park', 1: 'Bank', 2: 'Court', 5: 'Construction Yard', 6: 'Greenhouse', 7: 'Lake', 8: 'Nursery', 9: 'Docks',
  10: 'Law Firm', 11: 'School of Magic', 12: 'IT Services', 13: 'Hotel', 14: 'Research Facility',
  15: 'Building Firm', 17: 'Beach House', 18: 'Oil Rig', 21: 'Ski Lodge', 22: 'TrainStation', 23: 'ParkEstate',
  24: 'Winter Fort', 25: 'Arcade',
};
export const F = {
  DECOR: 0, BANK: 1, ROADS: 5, WATERWAYS: 7, TREES: 8, LAW_FIRM: 10, FLIP: 11, UPGRADE: 12, HOTEL: 13,
  RESEARCH: 14, DUPLICATE: 15, DOUBLE_HOURS: 16, RAIL: 22, SKYROAD: 23, WINTER: 24,
} as const;
/** Path type -> feature that unlocks it in the Landscape menu. Dirtroad and IceWall: inferido. */
const PATH_FEATURE: Record<string, number> = {
  Road: F.ROADS, Dirtroad: F.ROADS, Waterways: F.WATERWAYS, Railroad: F.RAIL, Skyroad: F.SKYROAD, IceWall: F.WINTER,
};

export const RESEARCH_COST = [10, 20, 30, 50, 80, 90, 120];
export const HEART_MAX = 10;
export const HOTEL_ROOMS = 6;
export const DUPLICATE_UTOPIUM = 20;
export const LAW_FIRM_UTOPIUM = 40;
export const ENTERPRISE_UTOPIUM = 100;
export const PET_STORE_UTOPIUM = 8;
export const MOTHERSHIP_UTOPIUM = 1;
export const REVEAL_UTOPIUM = 5;
export const SPACE_BGS = 6;
/** Special genes handed out by processUnlockSpecialJobs (02 §3.8). */
export const SPECIAL_GENE_POOL = ['Dreamer', 'Salesman', 'Explorer'];
/** Pumps needed to open a stored heart (inferido: the residence heart had to be "pumped" until full). */
export const HEART_PUMPS = 5;

export interface Result { ok: boolean; msg?: string }
const tzOffset = (now: number) => -new Date(now * 1000).getTimezoneOffset() * 60;
const ok = (msg?: string): Result => ({ ok: true, msg });
const fail = (msg: string): Result => ({ ok: false, msg });

export type ComboKind = 'none' | 'old' | 'new' | 'evil';
export interface ComboInfo { kind: ComboKind; job: string | null; landRequired: number }

export class Game {
  state: GameState;
  /** gm+596: false on the first tick after loading (affects the offline catch-up of finished shifts). */
  firstTickDone = false;
  events: GameEvent[] = [];
  /** Random source; tests replace it with a seeded one. */
  rng: Rng = Math.random;
  /** Seconds to add to epoch time to get "shifted local" time (timegm(localtime(t))). */
  localOffset: (now: number) => number = tzOffset;
  /** gm+488: next heart spawn time (-2 = not started since load, 0 = waiting for the shown heart). Not saved. */
  heartNext = -2;
  missions: Missions;
  miniquests: MiniQuests;
  achievements: Achievements;
  shop: Shop;

  constructor(state: GameState) {
    this.state = state;
    this.missions = new Missions(this);
    this.miniquests = new MiniQuests(this);
    this.achievements = new Achievements(this);
    this.shop = new Shop(this);
  }

  local(now: number): number { return now + this.localOffset(now); }
  /** Current season with real events (Halloween forces Harvest, Christmas Frost). */
  season(local: number): number { return calendarAt(local).season; }

  /** A new game; `tutorial` starts it at tutorial step 0 (the app does), otherwise the tutorial counts as done. */
  static fresh(now: number, tutorial = false): Game {
    return new Game(newGame(now, tutorial));
  }

  // ---------------------------------------------------------------- tutorial (01 §5)
  /** checkTutorial() != -1: the tutorial runs while user+696 is 0..26. */
  tutorialActive(): boolean { return this.state.tutorial >= 0 && this.state.tutorial < TUTORIAL.length; }

  /** cTutorialManager::advanceTutorial when the action matches the current step. Returns true if it advanced. */
  tut(action: TutAction): boolean {
    if (!this.tutorialActive()) return false;
    // web: if the player already did the next real action, the "soft" steps in between (narration,
    // opening a popup, tapping a portrait) are passed too, so the tutorial can never get stuck.
    let k = this.state.tutorial;
    while (TUTORIAL[k] && TUTORIAL[k].action !== action && SOFT_TUT.has(TUTORIAL[k].action) && k - this.state.tutorial < 2) k++;
    if (!TUTORIAL[k] || TUTORIAL[k].action !== action) return false;
    this.state.tutorial = k + 1;
    if (this.state.tutorial >= TUTORIAL.length) this.finishTutorial();
    this.events.push({ type: 'tutorial', step: this.state.tutorial });
    return true;
  }

  /** The startTutorial lambda: CURRENT_TUTORIAL = -1 and utopium back to 25 (coins are kept). */
  finishTutorial(): void {
    const s = this.state;
    s.tutorial = -1;
    s.utopium = TUTORIAL_UTOPIUM;
  }

  /** Settings "skip tutorial" (web only): ends the tutorial the same way. */
  skipTutorial(): Result {
    if (!this.tutorialActive()) return fail('THE TUTORIAL IS OVER');
    this.finishTutorial();
    this.events.push({ type: 'tutorial', step: -1 });
    return ok('TUTORIAL SKIPPED');
  }

  /** First free spot for a building, searching rings around the Arrival Center (tutorial flashing squares). */
  findFreeSpot(type: string, from: [number, number] = [1, 1]): [number, number] {
    for (let r = 0; r < 30; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dy of [-r, r]) {
          for (const [x, y] of [[from[0] + dx, from[1] + dy], [from[0] + dy, from[1] + dx]]) {
            if (this.canPlaceAt(type, x, y)) return [x, y];
          }
        }
      }
    }
    return [from[0] + 30, from[1]];
  }

  // ---------------------------------------------------------------- queries
  get jobsUnlocked(): number { return this.state.unlockedJobs.length; }

  /** getSpiritWonderBonus: +100 spirit for the discount once Monument3 (2nd Wonder) is complete. */
  spiritWonderBonus(): number { return this.state.missions.wonderMap['Monument3'] === 4 ? 100 : 0; }

  discount(): number { return spiritDiscount(this.state.spirit, this.state.spiritLimit, this.spiritWonderBonus()); }

  /** getCoinScaledToCity(pct, floor) = max(int(pct/100 * int((1-d) * landCost[L])), floor). */
  coinScaledToCity(pct: number, floor: number): number {
    const v = Math.trunc((pct / 100) * Math.trunc((1 - this.discount()) * landRow(LAND, this.state.level).cost));
    return Math.max(v, floor);
  }

  /** getMaxCPS (inferido): what every built workplace would produce with its current workers. */
  maxCps(): number {
    return this.state.buildings.filter((b) => WORKPLACE.has(b.type) && b.type !== 'SpacePort' && this.isBuilt(b))
      .reduce((a, b) => a + this.buildingCps(b), 0);
  }

  featureUnlocked(id: number): boolean {
    if (id === F.DOUBLE_HOURS) return this.state.doubleHours;
    const name = FEATURES[id];
    return !!name && this.doesBuildingExist(name);
  }

  /** Landscape gates: decor needs the Park, paths their building, trees the Nursery. Houses are always open. */
  typeUnlocked(type: string): boolean {
    switch (kindOf(type)) {
      case 'decor': return this.featureUnlocked(F.DECOR);
      case 'path': return this.featureUnlocked(PATH_FEATURE[PATH.get(type)!.pathType] ?? F.ROADS);
      case 'tree': return this.featureUnlocked(F.TREES);
      default: return true;
    }
  }

  /** getTreeDailyUtopium: 25, or 50 with Monument4 complete during Thaw. */
  treeDailyUtopium(local: number): number {
    return this.state.missions.wonderMap['Monument4'] === 4 && this.season(local) === 0 ? 50 : 25;
  }

  building(id: string): Building | undefined { return this.state.buildings.find((b) => b.id === id); }
  peep(id: string): Peep | undefined { return this.state.peeps.find((p) => p.id === id); }

  isBuilt(b: Building): boolean { return b.buildEnd < 0; }

  workers(b: Building): Peep[] { return this.state.peeps.filter((p) => p.work === b.id); }
  residents(b: Building): Peep[] { return this.state.peeps.filter((p) => p.home === b.id); }

  doesBuildingExist(type: string): boolean { return this.state.buildings.some((b) => b.type === type); }

  /** Feature 1 (Bank): full workplaces produce x2. */
  hasBank(): boolean { return this.doesBuildingExist('Bank'); }

  /** getCurrentWorkingTime = base * level * 2^b296 (Enterprise double hours when the shift started). */
  buildingWorkingTime(b: Building): number {
    const w = WORKPLACE.get(b.type);
    return w ? workingTime(w.workingTimeMin, b.level, !!b.doubled) : -1;
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

  /** cBuildManager::canPlaceTileAt: every footprint cell is free and within reach of the city. */
  canPlaceAt(type: string, x: number, y: number, flip = false, ignore?: string): boolean {
    const occ = this.occupied();
    const cells = footprint(type, flip).map(([dx, dy]) => [x + dx, y + dy] as [number, number]);
    if (!cells.every(([i, j]) => { const o = occ.get(`${i},${j}`); return o === undefined || o === ignore; })) return false;
    return !this.reachRule || cells.every(([i, j]) => this.inReach(i, j, occ, ignore));
  }

  /** Why canPlaceAt said no. */
  placeError(type: string, x: number, y: number, flip = false, ignore?: string): string {
    const occ = this.occupied();
    const free = footprint(type, flip).every(([dx, dy]) => { const o = occ.get(`${x + dx},${y + dy}`); return o === undefined || o === ignore; });
    return free ? 'TOO FAR FROM THE CITY' : 'SPACE OCCUPIED';
  }

  /** Tests that lay out scattered cities turn the reach rule off. */
  reachRule = true;

  /**
   * The buildable grid only reaches BUILD_REACH cells around what is already built (4.20: the grid lines stop
   * two tiles away from the city and farther spots can't be tapped). An empty map is all in reach.
   */
  inReach(i: number, j: number, occ = this.occupied(), ignore?: string): boolean {
    let any = false;
    for (const id of occ.values()) if (id !== ignore) { any = true; break; }
    if (!any) return true;
    for (let di = -BUILD_REACH; di <= BUILD_REACH; di++) {
      for (let dj = -BUILD_REACH; dj <= BUILD_REACH; dj++) {
        const o = occ.get(`${i + di},${j + dj}`);
        if (o !== undefined && o !== ignore) return true;
      }
    }
    return false;
  }

  landUpgradeCost(): number {
    return landUpgradeCost(landRow(LAND, this.state.level).cost, this.discount());
  }

  arrivalTime(): number { return arrivalTime(this.jobsUnlocked, this.discount()); }

  splicingDuration(): number {
    return Math.trunc((1 - this.discount()) * splicingTime(this.jobsUnlocked, this.tutorialActive()));
  }

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
        if (req.length === 2 && req[0] === 'MI' && !this.state.recipes.includes(req[1])) return null; // CB-n reward
        return j.name;
      }
    }
    return null;
  }

  /**
   * Splicer list fading (web, inferido): true while some job not discovered yet can still be spliced from this gene
   * and another known gene. Known genes with nothing left to discover are drawn faded.
   */
  hasNewRecipes(gene: string): boolean {
    const known = new Set(this.state.unlockedJobs);
    return JOBS.some((j) => !known.has(j.name)
      && ((j.parent1 === gene && known.has(j.parent2)) || (j.parent2 === gene && known.has(j.parent1)))
      && this.validate(j.parent1, j.parent2) === j.name);
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
    // web: the tutorial only goes on with the Mechanic gene (the mine), so any other pair would leave it stuck
    if (this.tutorialActive() && !((a === 'Mayor' && b === 'Mechanic') || (a === 'Mechanic' && b === 'Mayor'))) {
      return fail('SPLICE THE MAYOR WITH THE MECHANIC');
    }
    const job = this.validate(a, b);
    if (!job) return fail('NO GENETIC MATCH');
    if (this.state.slots.some((x) => x.state === 4 && x.job === job)) return fail('JOB IS STILL SPLICING');
    if (this.state.slots.some((x) => x.state === 5 && x.job === job)) return fail('THIS JOB IS WAITING FOR ASSIGNMENT');
    if (this.landLimitReached(job)) return fail('UTOPIA NEEDS MORE LAND');
    const dur = this.splicingDuration();
    s.state = 4; s.start = now; s.end = now + dur; s.job = job;
    this.tut('startSplice');
    return ok();
  }

  private completeSplice(s: Slot): void {
    const job = s.job!;
    const peep = this.peep(s.peep!);
    const isNew = !this.state.unlockedJobs.includes(job);
    if (isNew) {
      this.state.unlockedJobs.push(job);
      this.queuePacket({ type: 0, id: job, value: 0 });
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
    this.clearSlot(slotIdx);
    this.tut('assign');
    return ok();
  }

  clearSlot(slotIdx: number): void { this.state.slots[slotIdx] = emptySlot(); }

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
    // only at tutorial step 7 ("let's rush their arrival") or with the tutorial done
    if (this.state.tutorial !== 7 && this.state.tutorial !== -1) return;
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
    this.tut('rushArrival');
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
      case 'workplace':
        // first workplace of a job: land only; a duplicate (Building Firm): 20 u + land (static+112 coins = 0)
        if (this.state.pendingWorkplaces.includes(type)) return { coins: 0, utopium: 0, chroma: 0 };
        return { coins: 0, utopium: DUPLICATE_UTOPIUM, chroma: 0 };
      case 'pod': case 'wonder': return { coins: 0, utopium: 0, chroma: 0 };
      case 'residence': return RESIDENCE.get(type)!.cost;
      case 'decor': return DECOR_BY.get(type)!.cost;
      case 'path': return PATH.get(type)!.cost;
      case 'tree': return TREE.get(type)?.cost ?? null;
      case 'terrain': return TERRAIN_BY.get(type)!.cost;
    }
  }

  canAfford(c: Cost): boolean {
    return this.state.coins >= c.coins && this.state.utopium >= c.utopium && this.state.chroma >= c.chroma;
  }

  /** Can this workplace be duplicated (Building Firm, first one already built)? */
  canDuplicate(type: string): boolean {
    return WORKPLACE.has(type) && type !== 'SpacePort' && type !== 'Town Hall' && this.featureUnlocked(F.DUPLICATE)
      && this.doesBuildingExist(type) && !!WORKPLACE.get(type)!.buildable;
  }

  place(type: string, x: number, y: number, flip: boolean, now: number): Result {
    const kind = kindOf(type);
    if (kind === 'pod' || kind === 'wonder') return fail('NOT AVAILABLE');
    if (kind === 'workplace' && !this.state.pendingWorkplaces.includes(type) && !this.canDuplicate(type)) return fail('NOT AVAILABLE');
    if (!this.typeUnlocked(type)) return fail('LOCKED');
    if (PACK_ITEM.has(type) && !this.shop.packUnlocked(type)) return fail('BUY IT AT THE TV STATION FIRST');
    const cost = this.placementCost(type);
    if (!cost) return fail('NOT AVAILABLE');
    if (!this.canPlaceAt(type, x, y, flip)) return fail(this.placeError(type, x, y, flip));
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
    const id = this.newBuilding(type, x, y, flip, t > 0 ? now : -1, t > 0 ? now + t : -1).id;
    if (kind === 'decor') this.miniquests.increment(MQ.PARK, this.local(now));
    if (kind === 'residence') this.tut('placeHouse');
    if (kind === 'workplace') this.tut('placeWorkplace');
    return { ok: true, msg: id };
  }

  private newBuilding(type: string, x: number, y: number, flip: boolean, start = -1, end = -1, level = 1): Building {
    const b: Building = { id: `${type}_${++this.state.counter}`, type, x, y, flip, buildStart: start, buildEnd: end, shiftStart: -1, level };
    this.state.buildings.push(b);
    return b;
  }

  /** Place a stored or reward building: free and instant (inferido), uses land as usual. */
  placeFromInventory(index: number, x: number, y: number, flip: boolean, now = Math.floor(Date.now() / 1000)): Result {
    const it = this.state.inventory[index];
    if (!it) return fail('NOT AVAILABLE');
    if (!this.canPlaceAt(it.type, x, y, flip)) return fail(this.placeError(it.type, x, y, flip));
    const land = landUse(it.type);
    if (land > this.freeLand()) return fail('EXPAND TO BUILD MORE');
    this.state.landUsed += land;
    if (kindOf(it.type) === 'decor') {
      this.state.spirit += DECOR_BY.get(it.type)!.spirit;
      this.miniquests.increment(MQ.PARK, this.local(now));
    }
    this.state.inventory.splice(index, 1);
    return { ok: true, msg: this.newBuilding(it.type, x, y, flip, -1, -1, it.level).id };
  }

  /** "BUILD MISSION POD" (04 §1.6.1): free, instant, no land (inferido). */
  placePod(missionId: string, x: number, y: number): Result {
    const a = this.missions.find(missionId);
    if (!a || this.missions.hostOf(a)) return fail('NOT AVAILABLE');
    if (!this.canPlaceAt(POD, x, y)) return fail('SPACE OCCUPIED');
    const b = this.newBuilding(POD, x, y, false);
    b.mission = missionId;
    return { ok: true, msg: b.id };
  }

  /** "SEND VESSEL": place the active wonder part (one 1x1 tile, no land, inferido). */
  placeWonder(x: number, y: number): Result {
    const a = this.state.missions.wonder;
    if (!a || this.missions.hostOf(a)) return fail('NOT AVAILABLE');
    if (!this.canPlaceAt(a.id, x, y)) return fail('SPACE OCCUPIED');
    return { ok: true, msg: this.newBuilding(a.id, x, y, false).id };
  }

  // ---------------------------------------------------------------- edit mode (03 §1.5)
  /** isFirstBuildingOfType, applied to workplaces (inferido: decor/houses/trees have no "unique" first). */
  isFirstOfType(b: Building): boolean {
    if (!WORKPLACE.has(b.type)) return false;
    return this.state.buildings.find((x) => x.type === b.type) === b;
  }

  isOccupied(b: Building): boolean {
    return this.state.peeps.some((p) => p.home === b.id || p.work === b.id);
  }

  /** Why a building cannot be deleted or stored, or null. */
  removeBlocker(b: Building): string | null {
    if (this.isOccupied(b)) return 'YOU CANNOT DELETE OCCUPIED BUILDINGS';
    if (b.type === POD) return 'YOU CAN ONLY DELETE MISSION POD FROM INSIDE';
    if (kindOf(b.type) === 'wonder') return 'YOU CANNOT DELETE UNIQUE BUILDINGS'; // inferido
    if (this.isFirstOfType(b)) return 'YOU CANNOT DELETE UNIQUE BUILDINGS';
    return null;
  }

  private removeBuilding(b: Building): void {
    this.state.landUsed = Math.max(0, this.state.landUsed - landUse(b.type));
    if (kindOf(b.type) === 'decor') this.state.spirit = Math.max(0, this.state.spirit - DECOR_BY.get(b.type)!.spirit);
    this.state.buildings = this.state.buildings.filter((x) => x !== b);
  }

  /** Delete: no refund; frees land; decor takes its spirit away. */
  deleteBuilding(id: string): Result {
    const b = this.building(id);
    if (!b) return fail('');
    const why = this.removeBlocker(b);
    if (why) return fail(why);
    this.removeBuilding(b);
    this.achievements.complete(ACH.DONT_PANIC);
    return ok('DEMOLISHED');
  }

  /** Store: like delete but the building goes to the inventory to be placed again for free (inferido). */
  storeBuilding(id: string): Result {
    const b = this.building(id);
    if (!b) return fail('');
    const why = this.removeBlocker(b);
    if (why) return fail(why.replace('DELETE', 'STORE'));
    if (!this.isBuilt(b)) return fail('FINISH CONSTRUCTION FIRST');
    this.removeBuilding(b);
    this.state.inventory.push({ type: b.type, level: b.level });
    return ok('STORED');
  }

  /** Move: same footprint check as placing, no cost. */
  moveBuilding(id: string, x: number, y: number): Result {
    const b = this.building(id);
    if (!b) return fail('');
    if (!this.canPlaceAt(b.type, x, y, b.flip, b.id)) return fail(this.placeError(b.type, x, y, b.flip, b.id));
    const moved = b.x !== x || b.y !== y;
    b.x = x; b.y = y;
    if (moved) this.achievements.complete(ACH.MOVER);
    return ok();
  }

  /** Flip (School of Magic): the flipped footprint must be free or the building's own. */
  flipBuilding(id: string): Result {
    const b = this.building(id);
    if (!b) return fail('');
    if (!this.featureUnlocked(F.FLIP)) return fail('BUILD THE SCHOOL OF MAGIC TO FLIP');
    if (!this.canPlaceAt(b.type, b.x, b.y, !b.flip, b.id)) return fail('SPACE OCCUPIED');
    b.flip = !b.flip;
    return ok();
  }

  /** Workplace upgrade (IT Services): 3 x level utopium, up to level 6. */
  upgradeCost(b: Building): number { return 3 * b.level; }

  upgradeWorkplace(id: string): Result {
    const b = this.building(id);
    if (!b || !WORKPLACE.has(b.type) || b.type === 'SpacePort' || !this.isBuilt(b)) return fail('CANNOT UPGRADE');
    if (!this.featureUnlocked(F.UPGRADE)) return fail('BUILD TECH SUPPORT TO UPGRADE');
    if (b.level > 5) return fail('MAX LEVEL');
    const cost = this.upgradeCost(b);
    if (this.state.utopium < cost) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= cost;
    b.level += 1;
    this.state.stats.upgrades += 1;
    return ok(`LEVEL ${b.level}!`);
  }

  rushConstruction(id: string, now: number): Result {
    const b = this.building(id);
    if (!b || this.isBuilt(b)) return fail('NOTHING TO RUSH');
    const cost = constructionRushCost(b.buildEnd - now);
    if (this.state.utopium < cost) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= cost;
    this.finishConstruction(b);
    this.tut('rushBuild');
    return ok();
  }

  /** Replaces the ad: -1 h, or finish if less than an hour is left. Once, then 24 h cooldown. */
  freeConstruction(id: string, now: number): Result {
    const b = this.building(id);
    if (!b || this.isBuilt(b)) return fail('NOTHING TO SPEED UP');
    if (now < this.state.freeBuildReadyAt) return fail('FREE BUTTON IS COOLING DOWN');
    this.state.freeBuildReadyAt = now + FREE_COOLDOWN;
    if (b.buildEnd - now > 3599) b.buildEnd -= 3600;
    else { this.finishConstruction(b); this.tut('rushBuild'); }
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
    this.startShift(b, now);
    if (b.type === 'Utopium Mine') this.tut('tapMine');
    return ok();
  }

  /** startCoinGeneration: b[152] = now, b[296] = feature 16, b[297] = 0. */
  private startShift(b: Building, now: number): void {
    b.shiftStart = now;
    b.doubled = this.state.doubleHours;
  }

  needsRestart(b: Building): boolean {
    return WORKPLACE.has(b.type) && b.type !== 'SpacePort' && this.isBuilt(b) && b.shiftStart < 0
      && this.workers(b).length > 0;
  }

  // ---------------------------------------------------------------- land
  /** Expand popup: pay coins, then the level-up packet (type 2) applies the land when its card closes. */
  expandLand(): Result {
    if (this.levelUpPending()) return fail('OPEN YOUR LEVEL UP FIRST');
    const cost = this.landUpgradeCost();
    if (this.state.coins < cost) return fail('NOT ENOUGH COINS');
    this.state.coins -= cost;
    this.queuePacket({ type: 2, id: 'level', value: this.state.level });
    return ok();
  }

  /** Law Firm (feature 10): expand for 40 utopium. */
  expandWithUtopium(): Result {
    if (!this.featureUnlocked(F.LAW_FIRM)) return fail('BUILD THE LAW FIRM FIRST');
    if (this.levelUpPending()) return fail('OPEN YOUR LEVEL UP FIRST');
    if (this.state.utopium < LAW_FIRM_UTOPIUM) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= LAW_FIRM_UTOPIUM;
    this.queuePacket({ type: 2, id: 'level', value: this.state.level });
    return ok();
  }

  /** inferido: one pending level-up at a time (gm+480 is set while the expansion runs). */
  levelUpPending(): boolean { return this.state.packets.some((p) => p.type === 2); }

  /** expandLand() proper, run when the level-up card is closed. */
  private levelUp(): void {
    const row = landRow(LAND, this.state.level);
    this.state.utopium += row.utopium;
    this.state.lifetimeUtopium += row.utopium;
    this.state.landLimit += row.land;
    this.state.spiritLimit = maxSpirit(this.state.level);
    this.state.level += 1;
    if (this.miniquests.done(MQ.PARK)) this.state.parkLevelUp = true; // SpiritDiscount gate ("level up one time")
  }

  // ---------------------------------------------------------------- packets (01 §6)
  queuePacket(p: Packet): void {
    if (p.type === 1 && this.state.packets.some((q) => q.type === 1 && q.id === p.id)) return;
    this.state.packets.push(p);
  }

  /** cCardPopup::exitButtonPressed: apply the first packet and drop it. */
  closePacket(): Packet | undefined {
    const p = this.state.packets.shift();
    if (p) this.applyPacket(p);
    return p;
  }

  addAnimal(name: string, n = 1): void {
    this.state.animals[name] = (this.state.animals[name] ?? 0) + n;
    if (!this.state.animalsSeen.includes(name)) this.state.animalsSeen.push(name);
  }

  removeAnimal(name: string, n = 1): void {
    const left = (this.state.animals[name] ?? 0) - n;
    if (left > 0) this.state.animals[name] = left; else delete this.state.animals[name];
  }

  private applyPacket(p: Packet): void {
    const s = this.state;
    switch (p.type) {
      case 0: break; // new job: unlocked when the splice finished
      case 1: {      // special gene (SP- reward or guest 2001): removeUnclaimedJobID + addUnlockedJobID
        s.unclaimedJobs = s.unclaimedJobs.filter((j) => j !== p.id);
        if (!s.unlockedJobs.includes(p.id)) s.unlockedJobs.push(p.id);
        const wp = JOB.get(p.id)?.workplaces[0];
        if (wp && !this.doesBuildingExist(wp) && !s.pendingWorkplaces.includes(wp)) s.pendingWorkplaces.push(wp);
        break;
      }
      case 2: this.levelUp(); break;
      case 3: this.addAnimal(p.id, 1); break;
      case 14:       // Altar result: the recipe is known once its card is closed (unlockAnimalRecipe)
        this.addAnimal(p.id, 1);
        if (!s.animalRecipes.includes(p.id)) s.animalRecipes.push(p.id);
        break;
      case 4: s.coins += p.value; s.lifetimeCoins += p.value; break;
      case 5: s.utopium += p.value; s.lifetimeUtopium += p.value; break;
      case 6: case 7: s.inventory.push({ type: p.id, level: 1 }); break;
      case 9: if (!s.recipes.includes(p.id)) s.recipes.push(p.id); break;
      case 10: for (const a of p.id.split('+')) this.addAnimal(a, 1); break;
      case 15: s.chroma += p.value; break;
      case 50: {     // Arcade skin "<Skin>~<Building>~arcade"
        const skin = p.id.split('~')[0];
        if (!s.skins.includes(skin)) s.skins.push(skin);
        break;
      }
      default: break; // 16-49: no effect
    }
  }

  // ---------------------------------------------------------------- special buildings (03 §3.2)
  hasBuilt(type: string): boolean {
    return this.state.buildings.some((b) => b.type === type && this.isBuilt(b));
  }

  /** Utopium Mine: once a day, U(1,2) utopium. */
  collectMine(): Result {
    if (!this.hasBuilt('Utopium Mine')) return fail('NO UTOPIUM MINE');
    if (!this.state.dailyUtopium) return fail('COME BACK AFTER 12:00');
    const n = uniform(this.rng, 1, 2);
    this.state.utopium += n;
    this.state.lifetimeUtopium += n;
    this.state.dailyUtopium = false;
    this.state.stats.mining += 1;
    return ok(`+${n} UTOPIUM`);
  }

  /** Animal Shelter: once a day, randomAddAnimal(0) (tier 1 20%, tier 2 80%). */
  collectShelter(now: number): Result {
    if (!this.hasBuilt('Animal Shelter')) return fail('NO ANIMAL SHELTER');
    if (!this.state.dailyAnimal) return fail('COME BACK AFTER 12:00');
    this.queuePacket(randomAnimalPacket(this.rng, 0, this.season(this.local(now))));
    this.state.dailyAnimal = false;
    this.state.stats.adoptions += 1;
    return ok();
  }

  /** ActivateBusinessCenterBoost: restart every stopped workplace that has workers. */
  private restartAll(now: number): number {
    let n = 0;
    for (const b of this.state.buildings) if (this.needsRestart(b)) { this.startShift(b, now); n++; }
    return n;
  }

  /** Business Center ("Financial Center"): 1 u restarts every idle shift. */
  businessCenterBoost(now: number): Result {
    if (!this.hasBuilt('Financial Center')) return fail('NO BUSINESS CENTER');
    if (!this.state.buildings.some((b) => this.needsRestart(b))) return fail('EVERYONE IS ALREADY WORKING'); // inferido: no charge
    if (this.state.utopium < 1) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= 1;
    return ok(`${this.restartAll(now)} BUILDINGS BACK TO WORK`);
  }

  /** Enterprise: 100 u once, feature 16 (double working hours for shifts started from now on). */
  buyDoubleHours(now: number): Result {
    if (!this.hasBuilt('Enterprise')) return fail('NO ENTERPRISE');
    if (this.state.doubleHours) return fail('ALREADY PURCHASED');
    if (this.state.utopium < ENTERPRISE_UTOPIUM) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= ENTERPRISE_UTOPIUM;
    this.state.doubleHours = true;
    this.restartAll(now);
    return ok('WORKING HOURS DOUBLED!');
  }

  /** Pet Store: 8 u for a packet of 9 animals. */
  buyNineAnimals(now: number): Result {
    if (!this.hasBuilt('Pet Store')) return fail('NO PET STORE');
    if (this.state.utopium < PET_STORE_UTOPIUM) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= PET_STORE_UTOPIUM;
    this.queuePacket(nineAnimalsPacket(this.rng, this.season(this.local(now))));
    return ok();
  }

  /** Research Lab: [10,20,30,50,80,90,120] u per level; each level +1 spirit limit and +1 heart. */
  researchCost(): number { return RESEARCH_COST[this.state.researchLevel] ?? 0; }

  researchUpgrade(): Result {
    if (!this.hasBuilt('Research Facility')) return fail('NO RESEARCH LAB');
    const cost = this.researchCost();
    if (!cost) return fail('MAX LEVEL');
    if (this.state.utopium < cost) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= cost;
    this.state.researchLevel += 1;
    this.state.spiritLimit += 1;
    this.state.heartCount = Math.min(HEART_MAX, this.state.heartCount + 1);
    return ok(`RESEARCH LEVEL ${this.state.researchLevel}`);
  }

  /** Hotel check-in: 1 u; the clone leaves home and work (6 rooms). */
  hotelCheckIn(peepId: string): Result {
    const p = this.peep(peepId);
    if (!this.hasBuilt('Hotel') || !p) return fail('');
    if (!p.job || !p.work || this.state.buildings.find((b) => b.id === p.home && !RESIDENCE.has(b.type))) return fail('THIS CLONE CANNOT VACATION');
    if (this.state.hotel.length >= HOTEL_ROOMS) return fail('NO VACANCY IN HOTEL');
    if (this.state.utopium < 1) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= 1;
    p.home = 'HOTEL';
    p.work = null;
    this.state.hotel.push(p.id);
    this.achievements.check(); // CheckedIn, NoVacancy (movePeepToHotel)
    return ok('HOTEL CHECK-IN SUCCESSFUL');
  }

  /**
   * Hotel check-out: needs a vacant residence; r = U(1,4) refunds r utopium when r is 1 or 2.
   * inferido: the clone goes back to a free Arrival Center slot to be assigned a workplace again.
   */
  hotelCheckOut(peepId: string): Result {
    const p = this.peep(peepId);
    if (!p || !this.state.hotel.includes(peepId)) return fail('');
    const home = this.firstVacantResidence();
    if (!home) return fail('NO EMPTY HOUSE SLOT. CANNOT CHECK OUT');
    const slot = this.state.slots.findIndex((s) => s.state === 0 || s.state === 1);
    if (slot < 0) return fail('THE ARRIVAL CENTER IS FULL');
    p.home = home.id;
    this.state.hotel = this.state.hotel.filter((x) => x !== peepId);
    this.state.slots[slot] = { state: 5, start: -1, end: -1, peep: p.id, job: p.job };
    const r = uniform(this.rng, 1, 4);
    if (r <= 2) { this.state.utopium += r; return ok(`CHECK-OUT SUCCESSFUL!! ${r}u REFUNDED!`); }
    return ok('HOTEL CHECK-OUT SUCCESSFUL');
  }

  // ---------------------------------------------------------------- hearts (notes.md)
  residencesBuilt(): Building[] {
    return this.state.buildings.filter((b) => RESIDENCE.has(b.type) && this.isBuilt(b));
  }

  /** First Wonder: hearts no longer need pumping. */
  instantHearts(): boolean { return (this.state.missions.wonderMap['Monument'] ?? 0) >= 9; }

  private startHeartCooldown(now: number, first: boolean): void {
    this.heartNext = now + (first ? 3 : uniform(this.rng, 5, 10));
  }

  /** updateHeartTimer: needs land used >= 22; one heart on screen at a time. */
  private heartUpdate(now: number): void {
    const s = this.state;
    if (this.heartNext === -2) this.startHeartCooldown(now, true);
    if (s.hearts.on && !this.building(s.hearts.on)) s.hearts.on = null;
    if (s.landUsed < 22 || s.hearts.on || this.heartNext < 0 || now < this.heartNext) return;
    if (s.heartCount >= HEART_MAX && !this.instantHearts()) return; // inferido: storage full, no new hearts
    const homes = this.residencesBuilt();
    if (!homes.length) return;
    const b = homes[Math.floor(this.rng() * homes.length)];
    s.hearts.on = b.id;
    this.heartNext = 0;
    this.events.push({ type: 'heart', building: b.id });
  }

  /** Tap the heart above a house: stored (max 10), or opened at once after the First Wonder. */
  tapHeart(now: number): Result {
    const s = this.state;
    if (!s.hearts.on) return fail('');
    s.hearts.on = null;
    this.startHeartCooldown(now, false);
    if (this.instantHearts()) {
      this.queuePacket(getHeartReward(this.rng, s.level, this.season(this.local(now))));
      return ok();
    }
    s.heartCount = Math.min(HEART_MAX, s.heartCount + 1);
    return ok('+1 HEART');
  }

  /** Open a stored heart (after pumping it): getHeartReward. */
  openHeart(now: number): Result {
    const s = this.state;
    if (s.heartCount < 1) return fail('NO HEARTS');
    s.heartCount -= 1;
    this.queuePacket(getHeartReward(this.rng, s.level, this.season(this.local(now))));
    return ok();
  }

  // ---------------------------------------------------------------- trees (03 §4)
  trees(): Building[] { return this.state.buildings.filter((b) => kindOf(b.type) === 'tree' && this.isBuilt(b)); }

  private treeUpdate(): void {
    const trees = this.trees();
    for (const t of trees) {
      const timer = t.treeTimer ?? -1;
      if (timer > 0) t.treeTimer = timer - 1;
      else if (timer === 0) {
        const active = trees.find((x) => x.treeReady);
        if (!active) {
          t.treeReady = true;
          t.treeTimer = uniform(this.rng, 20, 40);
          this.events.push({ type: 'treeReady', building: t.id });
        } else if (active === t) {
          t.treeReady = false;
          t.treeTimer = uniform(this.rng, 30, 120);
        } else t.treeTimer = -1;
      } else t.treeTimer = uniform(this.rng, 30, 120);
    }
  }

  tapTree(id: string, now: number): Result {
    const t = this.building(id);
    if (!t || !t.treeReady) return fail('');
    t.treeReady = false;
    const s = this.state;
    const room = this.treeDailyUtopium(this.local(now)) - s.treeUtopiumToday;
    const d = treeDrop(this.rng, !(room > 0));
    if (d.kind === 'coins') { s.coins += d.n; s.lifetimeCoins += d.n; }
    else { s.utopium += d.n; s.lifetimeUtopium += d.n; s.treeUtopiumToday += d.n; }
    this.events.push({ type: 'tree', building: id, kind: d.kind, amount: d.n });
    return ok();
  }

  // ---------------------------------------------------------------- daily reset (01 §4.3) and calendar (04 §5.2)
  private dailyUpdate(now: number): void {
    const s = this.state;
    const local = this.local(now);
    // no daily reset during the tutorial (timeUpdate checks checkTutorial)
    if (s.dailyResetTime <= local && !this.tutorialActive()) {
      const wasMine = s.dailyUtopium, wasShelter = s.dailyAnimal;
      s.dailyResetTime = local + timeTillNoon(local);
      s.treeUtopiumToday = 0;
      s.dailyUtopium = true;
      s.dailyAnimal = true;
      s.missions.refreshesUsed = 0;
      this.missions.dailyAutoRefresh(local);
      this.shop.scrambleDeals(); // scrambleHousesDecorDeals
      this.events.push({ type: 'dailyReset' });
      // local notifications (cUtopiumMineReadyNotification / cAnimalShelterReadyNotification)
      if (!wasMine && this.hasBuilt('Utopium Mine')) this.events.push({ type: 'mineReady' });
      if (!wasShelter && this.hasBuilt('Animal Shelter')) this.events.push({ type: 'shelterReady' });
    }
    // cCalendarSystem::update: one gift per calendar day (it runs during the tutorial too)
    const day = dayNumber(local);
    if (s.calendarDay !== day) { s.calendarDay = day; s.dailyGift = true; }
    const monday = dayNumber(weekStart(local));
    s.calendarCollected = s.calendarCollected.filter((d) => d >= monday);
  }

  /**
   * Calendar daily reward. Gift days use getGiftPacketReward (05 §2; 04 §5.2 reads them as one random animal).
   */
  collectCalendar(now: number): Result {
    const s = this.state;
    if (!s.dailyGift) return fail('COME BACK TOMORROW');
    const local = this.local(now);
    const r = dailyReward(local);
    if (!r) return fail('');
    s.calendarCollected.push(dayNumber(local));
    this.miniquests.increment(MQ.CALENDAR, local);
    if (r.kind === 'utopium') this.queuePacket({ type: 5, id: 'calendar', value: r.n });
    else if (r.kind === 'coins') this.queuePacket({ type: 4, id: 'calendar', value: r.n });
    else if (r.kind === 'chroma') this.queuePacket({ type: 15, id: 'calendar', value: r.n });
    else {
      const ps = getGiftPacketReward(this.rng, this.season(local));
      for (const p of ps) this.queuePacket({ ...p, id: p.type === 4 || p.type === 5 ? 'gift' : p.id });
      if (!ps.length) { s.dailyGift = false; return ok('THE GIFT WAS EMPTY...'); }
    }
    s.dailyGift = false;
    return ok();
  }

  // ---------------------------------------------------------------- special genes and guests (02 §3.8, 04 §4)
  /** processUnlockSpecialJobs: Dreamer/Salesman/Explorer at 10/30/60 jobs, Bureaucrat at 50, Mutant at 149. */
  processUnlockSpecialJobs(): void {
    const s = this.state;
    const n = this.jobsUnlocked;
    const has = (j: string) => s.unlockedJobs.includes(j) || s.unclaimedJobs.includes(j);
    const pool = () => SPECIAL_GENE_POOL.filter((j) => !has(j));
    const take = () => { const p = pool(); s.unclaimedJobs.push(p[Math.floor(this.rng() * p.length)]); };
    if (pool().length >= 3 && n >= 10) take();
    if (pool().length >= 2 && n >= 30) take();
    if (pool().length >= 1 && n >= 60) take();
    if (n >= 50 && !has('Bureaucrat')) s.unclaimedJobs.push('Bureaucrat');
    if (n >= 149 && !has('Mutant')) s.unclaimedJobs.push('Mutant');
  }

  /** Guests walking on the roads: one 2001 per unclaimed special gene, one 2005 while mini-quests are available. */
  guests(local: number): { code: 2001 | 2005; job?: string }[] {
    if (this.tutorialActive()) return [];
    const out: { code: 2001 | 2005; job?: string }[] = this.state.unclaimedJobs.map((job) => ({ code: 2001 as const, job }));
    if (this.miniquests.available(local).length) out.push({ code: 2005 });
    return out;
  }

  /** cGuestPopup big button (special gene): free; the card (packet type 1) unlocks the job. */
  claimSpecialGene(job: string): Result {
    if (!this.state.unclaimedJobs.includes(job)) return fail('');
    this.queuePacket({ type: 1, id: job, value: 1 });
    return ok();
  }

  // ---------------------------------------------------------------- more special buttons (03 §3.2, 05 §5.1)
  /** Observatory: randomBGSprite, another of the 6 space backgrounds (inferido: never the same one). WarpSpeed. */
  changeBackground(): Result {
    if (!this.hasBuilt('Observatory')) return fail('NO OBSERVATORY');
    const cur = this.state.spaceBg;
    let n = cur;
    while (n === cur) n = uniform(this.rng, 1, SPACE_BGS);
    this.state.spaceBg = n;
    this.achievements.complete(ACH.WARP_SPEED);
    return ok('TO INFINITY AND BEYOND!');
  }

  /** Funeral Parlor: show or hide the spirit counter (DISPLAY_SPIRIT_WATCH). */
  toggleSpiritWatch(): Result {
    if (!this.hasBuilt('Funeral Parlor')) return fail('NO FUNERAL PARLOR');
    this.state.spiritWatch = !this.state.spiritWatch;
    return ok(this.state.spiritWatch ? 'SPIRIT WATCH ON' : 'SPIRIT WATCH OFF');
  }

  /** News Agency: enable or disable the live news feed. Turning it off gives IgnoranceIsBliss. */
  toggleNewsFeed(): Result {
    if (!this.hasBuilt('News Bureau')) return fail('NO NEWS AGENCY');
    this.state.newsFeed = !this.state.newsFeed;
    if (!this.state.newsFeed) this.achievements.complete(ACH.IGNORANCE);
    return ok(this.state.newsFeed ? 'NEWS FEED ON' : 'NEWS FEED OFF');
  }

  /** Sheriff's Office "most wanted" list: 1 u for the 5 entries with a Reward Amount, once each. */
  collectCredit(id: number): Result {
    const c = CREDITS.find((x) => x.id === id);
    if (!c || !c.reward) return fail('NOTHING HERE');
    if (this.state.creditsCollected.includes(id)) return fail('ALREADY COLLECTED');
    this.state.creditsCollected.push(id);
    this.queuePacket({ type: 5, id: 'credits', value: c.reward });
    return ok();
  }

  /** canPeepBeDeleted: not the Mayor, the Mechanic or a unique (Special) character. */
  canDeletePeep(id: string): boolean {
    const p = this.peep(id);
    if (!p || !p.job) return false;
    if (p.job === 'Mayor' || p.job === 'Mechanic') return false;
    return JOB.get(p.job)?.type !== 'Special';
  }

  /** Mothership: "SPEND 1u TO DELETE THIS CLONE?" — gone for good, frees its bed and job. */
  deleteClone(id: string): Result {
    const p = this.peep(id);
    if (!p) return fail('');
    if (!this.canDeletePeep(id)) return fail('CANNOT DELETE UNIQUE CHARACTER');
    if (this.state.utopium < MOTHERSHIP_UTOPIUM) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= MOTHERSHIP_UTOPIUM;
    this.state.peeps = this.state.peeps.filter((x) => x !== p);
    this.state.hotel = this.state.hotel.filter((x) => x !== id);
    return ok('CLONE SENT TO THE MOTHERSHIP');
  }

  /** cVacantSlotPopup "REVEAL FORMULA?": 5 u shows the parents of a vacant job (kept, inferido). */
  revealFormula(job: string): Result {
    const jd = JOB.get(job);
    if (!jd || !jd.parent1) return fail('NO FORMULA');
    if (this.state.revealed.includes(job)) return ok(`${jd.parent1} + ${jd.parent2}`);
    if (this.state.utopium < REVEAL_UTOPIUM) return fail('NOT ENOUGH UTOPIUM');
    this.state.utopium -= REVEAL_UTOPIUM;
    this.state.revealed.push(job);
    return ok(`${jd.parent1} + ${jd.parent2}`);
  }

  /** Mission that must be complete before this job can be spliced (Requires = MI_x), or null. */
  requiredMission(job: string): string | null {
    const r = JOB.get(job)?.requires.split('_') ?? [];
    return r.length === 2 && r[0] === 'MI' && !this.state.recipes.includes(r[1]) ? r[1] : null;
  }

  /** Town Hall manual save (cSaveManagerPopup): the Town Hall mini-quest counts it. */
  manualSave(now: number): void {
    this.miniquests.increment(MQ.TOWNHALL, this.local(now));
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
    this.dailyUpdate(now);
    if (!this.tutorialActive()) {
      // hearts and tree rewards are off during the tutorial (01 §5.3)
      this.missions.update(this.local(now));
      this.heartUpdate(now);
      this.treeUpdate();
      this.processUnlockSpecialJobs();
      if (this.shop.hasTv() && !st.deals.length) this.shop.scrambleDeals();
      this.achievements.check();
    }
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

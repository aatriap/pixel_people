// Saved game state and the new-game setup (spec 01 §2).
export type SlotState = 0 | 1 | 2 | 3 | 4 | 5;

export interface Building {
  id: string;
  type: string;          // static id: workplace Name, residence Name, decor/path/tree Internal Name
  x: number; y: number;  // anchor cell (TileCell)
  flip: boolean;
  buildStart: number;    // construction start (epoch s)
  buildEnd: number;      // construction end; -1 = built
  shiftStart: number;    // workplace shift start; -1 = stopped
  level: number;         // workplace level 1..6
  doubled?: boolean;     // b[296]: Enterprise double hours were active when this shift started
  treeTimer?: number;    // trees: b[152] countdown in ticks (-1 = pick U(30,120) next tick)
  treeReady?: boolean;   // trees: b[168] reward visible
  mission?: string;      // Mission Pod: id of the mission it serves
  skin?: string;         // Arcade skin shown instead of the original sprite (cycleTileSkin, cosmetic)
  paint?: [number, number]; // residence paint: two 0xRRGGBB colours for _Layer1/_Layer2 (cPaintPopup)
}

/** cMiniQuest save: current stage (+4), counter (+8) and weekly stamp (+16, -1 = empty). */
export interface MiniQuestSave { stage: number; qty: number; stamp: number }

/** One TV Station catalogue offer (scrambleHousesDecorDeals). */
export interface Deal { id: string; stock: number }

export interface Peep {
  id: string;
  female: boolean;
  job: string | null;    // null = jobless clone that just arrived
  home: string;          // residence building id
  work: string | null;   // workplace building id
  cps: number;           // always 1 in 4.20
}

/** sArrivalCenterSlot (02 §2.1). */
export interface Slot {
  state: SlotState;      // 0 empty, 1 queued, 2 arriving, 3 arrived (jobless), 4 splicing, 5 waiting for assignment
  start: number;
  end: number;
  peep: string | null;
  job: string | null;
}

/** sPacketItem (01 §6): a reward waiting for its card. Applied when the card is closed. */
export interface Packet { type: number; id: string; value: number; love?: boolean } // love: heart-bar surprise

/** One requirement of an active mission (04 §1.2). acq = peep id (J) or animal name (A/C/T). */
export interface MissionReq { code: string; acq: string | null }

/** cMissionSaveData. */
export interface ActiveMission {
  id: string;
  reqs: MissionReq[];
  targetCps: number;     // processBaseValues: baseCps + max(BaseCPS-n)
  targetLand: number;    // baseLand + max(BaseLand-n)
}

export interface MissionState {
  started: boolean;               // user+576 != "-": the list was filled once
  slots: (ActiveMission | null)[]; // 6 slots, types [4,4,3,3,2,2]
  wonder: ActiveMission | null;
  refreshesUsed: number;          // user+244
  baseCps: number;                // user+248
  baseLand: number;               // user+252
  uniquesDone: string[];
  wonderMap: Record<string, number>;
  completed: number;
}

export interface StoredItem { type: string; level: number }

export interface GameState {
  version: 1;
  coins: number;
  utopium: number;
  chroma: number;
  lifetimeCoins: number;
  lifetimeUtopium: number;
  landUsed: number;       // CURRENT_LAND_COUNT
  landLimit: number;      // CURRENT_LAND_LIMIT
  spirit: number;         // CURRENT_SPIRIT_COUNT
  spiritLimit: number;    // CURRENT_SPIRIT_LIMIT
  level: number;          // CURRENT_LEVEL (land level)
  unlockedJobs: string[]; // CURRENT_UNLOCKED_JOBS
  buildings: Building[];
  peeps: Peep[];
  slots: Slot[];
  lastTick: number;       // LAST_TICK_TIME
  latestTime: number;     // LATEST_TIME
  playTime: number;       // PLAY_TIME
  counter: number;        // id counter (CURRENT_PEEP_IDENTIFIER + building ids)
  freeBuildReadyAt: number;   // free "ad replacement" button, construction (00_indice decision)
  freeSpliceReadyAt: number;  // free "ad replacement" button, Splicer
  pendingWorkplaces: string[]; // discovered jobs' free first workplaces still to be placed
  discoveries: string[];       // milestone 1 only; migrated into packets (type 0)
  // ---- milestone 2
  packets: Packet[];           // CURRENT_PACKET_QUEUE
  animals: Record<string, number>; // city+272: animal id -> count
  heartCount: number;          // CURRENT_HEART_COUNT: hearts filled on the HUD bar (HEART_BAR)
  hearts: { on: string | null };   // residence showing a heart (gm+496)
  dailyResetTime: number;      // DAILY_RESET_TIME (shifted local seconds)
  dailyUtopium: boolean;       // DAILY_UTOPIUM (Utopium Mine)
  dailyAnimal: boolean;        // DAILY_ANIMAL (Animal Shelter)
  treeUtopiumToday: number;    // CURRENT_UTOPIUM_EARNED_FROM_TREES
  calendarDay: number;         // last local day seen by cCalendarSystem::update
  dailyGift: boolean;          // DAILY_BONUS (+442): calendar gift ready
  missions: MissionState;
  doubleHours: boolean;        // feature 16 (Enterprise, 100 u)
  researchLevel: number;       // RESEARCH_LAB_LEVEL
  inventory: StoredItem[];     // stored buildings and reward buildings waiting to be placed
  hotel: string[];             // peep ids staying at the Hotel (max 6)
  recipes: string[];           // missions whose CB-n reward unlocked their MI_ recipes
  musicMuted: boolean;
  stats: { mining: number; adoptions: number; upgrades: number };
  // ---- milestone 3
  tutorial: number;            // CURRENT_TUTORIAL (user+696): current step, -1 = done
  soundMuted: boolean;
  calendarCollected: number[]; // local day numbers whose calendar gift was collected (current week only)
  unclaimedJobs: string[];     // special genes waiting for their guest (addUnclaimedJobID)
  miniquests: Record<string, MiniQuestSave>;
  parkLevelUp: boolean;        // the Decor mini-quest was done and the land level went up afterwards
  achievements: { done: number[]; collected: number[] }; // 1-based TSV indexes
  animalsSeen: string[];       // isAnimalUnlocked: animals owned at some point
  animalRecipes: string[];     // Altar recipes unlocked when the result card was closed
  skins: string[];             // Arcade skins unlocked (The Claw)
  spaceBg: number;             // SPACE_BG_INDEX 1..6 (Observatory)
  spiritWatch: boolean;        // DISPLAY_SPIRIT_WATCH (Funeral Parlor)
  newsFeed: boolean;           // !NEWS_FEED_DISABLED (News Agency)
  revealed: string[];          // jobs whose formula was revealed for 5 u (inferido: kept for good)
  deals: Deal[];               // HOUSES_DECOR_DEALS (TV Station)
  packUnlocks: string[];       // pack-only items bought with chroma at the TV Station (Agustin's decision)
  creditsCollected: number[];  // Sheriff's Office rewards already taken
  altarSplices: number;
}

export const MISSION_SLOT_TYPES = [4, 4, 3, 3, 2, 2];

export function emptyMissions(): MissionState {
  return {
    started: false, slots: MISSION_SLOT_TYPES.map(() => null), wonder: null, refreshesUsed: 0,
    baseCps: 0, baseLand: 0, uniquesDone: [], wonderMap: {}, completed: 0,
  };
}

/** Fill fields added after milestone 1 so old saves keep loading. */
export function migrate(s: GameState): GameState {
  const d: Partial<GameState> = {
    packets: [], animals: {}, heartCount: 0, hearts: { on: null }, dailyResetTime: 0, dailyUtopium: true,
    dailyAnimal: true, treeUtopiumToday: 0, calendarDay: -1, dailyGift: false, missions: emptyMissions(),
    doubleHours: false, researchLevel: 0, inventory: [], hotel: [], recipes: [], musicMuted: false,
    stats: { mining: 0, adoptions: 0, upgrades: 0 }, discoveries: [],
    // milestone 3. Saves made before it count as having finished the tutorial.
    tutorial: -1, soundMuted: false, calendarCollected: [], unclaimedJobs: [], miniquests: {}, parkLevelUp: false,
    achievements: { done: [], collected: [] }, animalsSeen: [], animalRecipes: [], skins: [], spaceBg: 1,
    spiritWatch: false, newsFeed: true, revealed: [], deals: [], packUnlocks: [], creditsCollected: [], altarSplices: 0,
  };
  for (const [k, v] of Object.entries(d)) {
    if ((s as unknown as Record<string, unknown>)[k] === undefined) (s as unknown as Record<string, unknown>)[k] = v;
  }
  // milestone 1 discovery cards become type 0 packets
  for (const job of s.discoveries) s.packets.push({ type: 0, id: job, value: 0 });
  s.discoveries = [];
  for (const a of Object.keys(s.animals)) if (!s.animalsSeen.includes(a)) s.animalsSeen.push(a);
  return s;
}

export function emptySlot(): Slot {
  return { state: 0, start: -1, end: -1, peep: null, job: null };
}

function b(id: string, type: string, x: number, y: number): Building {
  return { id, type, x, y, flip: false, buildStart: -1, buildEnd: -1, shiftStart: -1, level: 1 };
}

/**
 * New game as it stands after tutorial step 0 (01 §2): 14000 coins, 25 utopium, 100 chroma,
 * land 15/30, spirit 2/8, land level 1, and cBuildTerrain::spawnFirstTimeBuilts.
 * `tutorial` = true starts at tutorial step 0 (the app); false gives a city with the tutorial done (tests).
 */
export function newGame(now: number, tutorial = false): GameState {
  const buildings: Building[] = [
    b('SpacePort_1', 'SpacePort', 0, 0),
    b('Residence1_1', 'Residence1', -2, 3),
    b('Town Hall_1', 'Town Hall', 0, 3),
    b('Fountain3_1', 'Fountain3', -1, 1),
    b('PlainR_1', 'PlainR', 0, 2),
    b('PlainR_2', 'PlainR', 1, 2),
    b('PlainR_3', 'PlainR', 2, 2),
    b('Tree3_1', 'Tree3', 2, 3),
    b('Tree4_1', 'Tree4', -1, 3),
    b('Tree5_1', 'Tree5', -1, 4),
  ];
  const peeps: Peep[] = [
    { id: 'Clone_1', female: false, job: 'Mechanic', home: 'Residence1_1', work: 'SpacePort_1', cps: 1 },
    { id: 'Clone_2', female: true, job: 'Mayor', home: 'Residence1_1', work: 'Town Hall_1', cps: 1 },
  ];
  return migrate({
    version: 1,
    coins: 14000,
    utopium: 25,
    chroma: 100,
    lifetimeCoins: 0,
    lifetimeUtopium: 0,
    landUsed: 15,
    landLimit: 30,
    spirit: 2,
    spiritLimit: 8,
    level: 1,
    unlockedJobs: ['Mayor', 'Mechanic'],
    buildings,
    peeps,
    slots: [emptySlot(), emptySlot(), emptySlot()],
    lastTick: now,
    latestTime: now,
    playTime: 0,
    counter: 10,
    freeBuildReadyAt: 0,
    freeSpliceReadyAt: 0,
    pendingWorkplaces: [],
    discoveries: [],
    tutorial: tutorial ? 0 : -1,
  } as unknown as GameState);
}

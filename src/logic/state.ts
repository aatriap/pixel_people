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
}

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
  discoveries: string[];       // newly discovered jobs whose card has not been shown yet
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
 */
export function newGame(now: number): GameState {
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
  return {
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
  };
}

// cCalendarSystem (04 §5, calendar.tsv). All times here are "shifted local" seconds (GetLocalTimeInLocalTimeZone).
import { CALENDAR } from './data';

export const CAL_EPOCH = 1570406400; // Monday 2019-10-07 00:00
export const WEEK = 604800;
export const CYCLE = 2419200; // 4 weeks: one reward cycle
export const SEASONS = ['THAW', 'SWELL', 'HARVEST', 'FROST'] as const;
export type Season = (typeof SEASONS)[number];

/** Plain weekly rotation: week mod 4 (0 Thaw, 1 Swell, 2 Harvest, 3 Frost); -1 before the epoch. No real events. */
export function seasonAt(local: number): number {
  if (local < CAL_EPOCH) return -1;
  return Math.floor((local - CAL_EPOCH) / WEEK) % 4;
}

export function seasonName(local: number): Season | null {
  const s = calendarAt(local).season;
  return s < 0 ? null : SEASONS[s];
}

/** Calendar day number (changes at local midnight). */
export function dayNumber(local: number): number {
  return Math.floor(local / 86400);
}

/** 0 = Monday ... 6 = Sunday (1970-01-01 was a Thursday). */
export function weekday(local: number): number {
  return (dayNumber(local) + 3) % 7;
}

/** Calendar week index since the epoch (hadWeekChange compares these). */
export function weekIndex(local: number): number {
  return Math.floor((local - CAL_EPOCH) / WEEK);
}

export function hadWeekChange(a: number, b: number): boolean {
  return weekIndex(a) !== weekIndex(b);
}

/** Monday 00:00 of the week that contains `local`. */
export function weekStart(local: number): number {
  return (dayNumber(local) - weekday(local)) * 86400;
}

export interface RealEvent { name: string; season: number; start: number; end: number; weekOf: number }

/**
 * Real events (Halloween forces Harvest for 1 week from 31/10, Christmas forces Frost for 2 weeks from 9/12).
 * processRealEvent: the event covers whole calendar weeks, from the Monday of the week holding the start date
 * of the current year (inferido: exact week rounding).
 */
export function realEventAt(local: number): RealEvent | null {
  const year = new Date(local * 1000).getUTCFullYear();
  for (const y of [year - 1, year]) {
    for (const e of CALENDAR.events) {
      const start = weekStart(Date.UTC(y, e.month - 1, e.day) / 1000);
      const end = start + e.weeks * WEEK;
      if (local >= start && local < end) {
        return { name: e.name, season: SEASONS.indexOf(e.season as Season), start, end, weekOf: Math.floor((local - start) / WEEK) };
      }
    }
  }
  return null;
}

export interface CalendarInfo { season: number; cycle: number; event: RealEvent | null }

/**
 * Season and reward cycle (findSeasonAt / findRewardCycleAt): cycle = floor((t - E) / 4 weeks) mod nCycles.
 * During a real event the season is forced and the cycle moves on by one for every event week
 * ("temporarily incrementing off current Reward Cycle every RealEvent week"; inferido: +1 already in the first week).
 */
export function calendarAt(local: number): CalendarInfo {
  const base = seasonAt(local);
  if (base < 0) return { season: -1, cycle: 0, event: null };
  const n = CALENDAR.seasons.THAW.length;
  let cycle = Math.floor((local - CAL_EPOCH) / CYCLE);
  let season = base;
  const event = realEventAt(local);
  if (event) { season = event.season; cycle += event.weekOf + 1; }
  return { season, cycle: cycle % n, event };
}

export type CalReward = { kind: 'utopium' | 'chroma' | 'gift' | 'coins'; n: number };

/** Layout number (Reward Layout row) for a season and cycle ("Seasons" section of calendar.tsv). */
export function layoutFor(season: number, cycle: number): number {
  return CALENDAR.seasons[SEASONS[season]][cycle];
}

/** The 7 rewards (Monday..Sunday) of a Reward Layout row. */
export function layoutRewards(layout: number): CalReward[] {
  return CALENDAR.layouts[String(layout)].map((d) => ({ kind: d.kind as CalReward['kind'], n: d.n }));
}

/** Reward layouts in the order Thaw=1, Swell=2, Harvest=3, Frost=4 (cycle 0). */
export const CAL_LAYOUT: CalReward[][] = SEASONS.map((_, s) => layoutRewards(layoutFor(s, 0)));

/** This week's rewards with real events and reward cycles applied. */
export function weekRewards(local: number): CalReward[] | null {
  const c = calendarAt(local);
  return c.season < 0 ? null : layoutRewards(layoutFor(c.season, c.cycle));
}

/** Today's reward, real events included. */
export function dailyReward(local: number): CalReward | null {
  return weekRewards(local)?.[weekday(local)] ?? null;
}

/** Plain-rotation reward (no real events), kept for milestone 2 callers. */
export function calendarReward(local: number): CalReward | null {
  const s = seasonAt(local);
  return s < 0 ? null : CAL_LAYOUT[s][weekday(local)];
}

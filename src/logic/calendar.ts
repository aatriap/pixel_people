// cCalendarSystem (04 §5). All times here are "shifted local" seconds (GetLocalTimeInLocalTimeZone).
export const CAL_EPOCH = 1570406400; // Monday 2019-10-07 00:00
export const SEASONS = ['THAW', 'SWELL', 'HARVEST', 'FROST'] as const;
export type Season = (typeof SEASONS)[number];

/** Season index: week mod 4 (0 Thaw, 1 Swell, 2 Harvest, 3 Frost); -1 before the epoch. Real events are not modelled. */
export function seasonAt(local: number): number {
  if (local < CAL_EPOCH) return -1;
  return Math.floor((local - CAL_EPOCH) / 604800) % 4;
}

export function seasonName(local: number): Season | null {
  const s = seasonAt(local);
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

export type CalReward = { kind: 'utopium' | 'chroma' | 'gift'; n: number };
const U1: CalReward = { kind: 'utopium', n: 1 };
const GIFT: CalReward = { kind: 'gift', n: 1 };
const C10: CalReward = { kind: 'chroma', n: 10 };
/** Reward layouts of calendar.tsv (Thaw=1, Swell=2, Harvest=3, Frost=4), Monday..Sunday. */
export const CAL_LAYOUT: CalReward[][] = [
  [U1, U1, U1, U1, U1, U1, U1],
  [GIFT, GIFT, GIFT, GIFT, GIFT, GIFT, GIFT],
  [C10, C10, C10, C10, C10, C10, C10],
  [C10, GIFT, U1, C10, GIFT, U1, GIFT],
];

export function calendarReward(local: number): CalReward | null {
  const s = seasonAt(local);
  return s < 0 ? null : CAL_LAYOUT[s][weekday(local)];
}

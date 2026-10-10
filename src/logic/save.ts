// localStorage persistence. The whole GameState is one JSON document.
import { GameState, migrate } from './state';

export const SAVE_KEY = 'pixelpeople.save.v1';

export interface Storage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export function load(storage: Storage | undefined): GameState | null {
  try {
    const raw = storage?.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    if (s.version !== 1 || !Array.isArray(s.buildings)) return null;
    return migrate(s);
  } catch {
    return null;
  }
}

export function save(storage: Storage | undefined, s: GameState): void {
  try {
    storage?.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode or quota: keep playing without saving */
  }
}

export function wipe(storage: Storage | undefined): void {
  try { storage?.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export const nowSec = (): number => Math.floor(Date.now() / 1000);

/** Save file format for moving a city between devices (Settings > EXPORT / IMPORT). */
export const SAVE_FILE_APP = 'pixel-people-web';

export function exportSave(s: GameState, now = nowSec()): string {
  return JSON.stringify({ app: SAVE_FILE_APP, format: 1, exportedAt: now, state: s });
}

/** Reads an exported file (or a bare state, as kept in localStorage). Returns null if it is not a city save. */
export function importSave(text: string): GameState | null {
  try {
    const raw = JSON.parse(text) as { app?: string; state?: GameState } & Partial<GameState>;
    const s = (raw && raw.app === SAVE_FILE_APP ? raw.state : raw) as GameState | undefined;
    if (!s || s.version !== 1 || !Array.isArray(s.buildings) || !Array.isArray(s.peeps)
      || typeof s.coins !== 'number' || !Array.isArray(s.slots)) return null;
    return migrate(s);
  } catch {
    return null;
  }
}

/** File name for an export, e.g. pixel-people-2026-10-10.json. */
export function saveFileName(now = nowSec()): string {
  return `pixel-people-${new Date(now * 1000).toISOString().slice(0, 10)}.json`;
}

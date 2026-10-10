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

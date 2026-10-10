// Isometric helpers. cTerrain::init uses X = -61.5*i + 61.5*j, Y = 30.75*(i+j) (Y up, cocos).
// Here Y points down, so +i goes up-left and +j up-right on screen, like the game.
import { footprint } from '../logic/data';

export const TILE_W = 123;
export const TILE_H = 61.5;
const HW = TILE_W / 2;   // 61.5
const HH = TILE_H / 2;   // 30.75

/** World position of the centre of cell (i, j). */
export function cellCenter(i: number, j: number): { x: number; y: number } {
  return { x: (j - i) * HW, y: -(i + j + 1) * HH };
}

/** Cell under a world point (inverse transform + floor, like getTileCoordTouched). */
export function worldToCell(x: number, y: number): { i: number; j: number } {
  const u = x / HW;          // j - i
  const v = -y / HH;         // i + j (corner based)
  return { i: Math.floor((v - u) / 2), j: Math.floor((v + u) / 2) };
}

/** Bounding box of an object's footprint in cell coordinates. */
export function footprintBox(type: string, x: number, y: number, flip: boolean) {
  const cells = footprint(type, flip).map(([dx, dy]) => [x + dx, y + dy] as [number, number]);
  const is = cells.map((c) => c[0]);
  const js = cells.map((c) => c[1]);
  return { cells, minI: Math.min(...is), minJ: Math.min(...js), maxI: Math.max(...is), maxJ: Math.max(...js) };
}

/**
 * Sprite origin (0..1) for the game's canvases, so that the bottom cell of the footprint box
 * (minI, minJ) sits at the sprite's origin. Measured from the 4.20 sprites:
 *  - 131x200 (one tile): diamond centre at (65.5, 166)
 *  - 262x300 (2x2 box): box centre at (131, 194) -> bottom cell centre at (131, 224.75)
 *  - 123x100 paths: diamond centre at (61.5, 59)
 */
export function originFor(w: number, h: number): { ox: number; oy: number } {
  if (w === 262 && h === 300) return { ox: 0.5, oy: 224.75 / 300 };
  if (w === 131 && h === 200) return { ox: 0.5, oy: 166 / 200 };
  if (w === 123 && h === 100) return { ox: 0.5, oy: 59 / 100 };
  if (w === 118 && h === 121) return { ox: 0.5, oy: 92 / 121 };
  return { ox: 0.5, oy: (h - HH - 4) / h };
}

/** Draw order: lower on screen (smaller i+j) is drawn later. */
export function depthFor(minI: number, minJ: number, extra = 0): number {
  return 10000 - (minI + minJ) * 10 + extra;
}

/** Road auto-tiling by neighbours (frame suffix + whether to mirror). See render notes in README. */
export function roadVariant(ul: boolean, ur: boolean, dl: boolean, dr: boolean): { suffix: string; flip: boolean } {
  const key = `${+ul}${+ur}${+dl}${+dr}`;
  const table: Record<string, [string, boolean]> = {
    '0000': ['', false],
    '1001': ['1', false], '0110': ['1', true],
    '0001': ['1A', false], '0010': ['1A', true],
    '1000': ['1C', false], '0100': ['1C', true],
    '0101': ['2', false], '1010': ['2', true],
    '0011': ['3A', false],
    '1100': ['3B', false],
    '1111': ['4', false],
    '1011': ['5A', false], '0111': ['5A', true],
    '1101': ['5B', false], '1110': ['5B', true],
  };
  const [suffix, flip] = table[key];
  return { suffix, flip };
}

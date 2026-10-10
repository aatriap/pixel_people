// Small DOM helpers shared by the HTML overlay (HUD, menus, popups).
import type { Cost } from '../logic/data';
import { sfx } from './sound';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export function h(tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string | null | undefined)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else el.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(k));
  return el;
}

// Buttons are matched by a stable key between pointerdown and pointerup, so a press still works
// when a panel re-renders under the finger (panels refresh every second for their timers).
const handlers = new Map<string, () => void>();
let pressedKey: string | null = null;
/** Panels refresh every second; skip that while a finger or the mouse is down so taps are never lost. */
export const ptr = { down: false };
document.addEventListener('pointerdown', () => { ptr.down = true; }, true);
document.addEventListener('pointerup', () => { ptr.down = false; }, true);
document.addEventListener('pointercancel', () => { ptr.down = false; }, true);
const keyOf = (e: Event) => {
  const b = (e.target as Element | null)?.closest?.('button[data-k]') as HTMLButtonElement | null;
  return b && !b.disabled ? b.dataset.k! : null;
};
document.addEventListener('pointerdown', (e) => { pressedKey = keyOf(e); }, true);
document.addEventListener('pointerup', (e) => {
  const k = keyOf(e);
  if (k && k === pressedKey) {
    pressedKey = null;
    e.preventDefault();
    sfx('tap_01');
    handlers.get(k)?.();
  }
}, true);

export function btn(label: string, cls: string, onClick: () => void, disabled = false, key = ''): HTMLButtonElement {
  const b = h('button', { class: `btn ${cls}` }, label) as HTMLButtonElement;
  b.disabled = disabled;
  const k = key || `${label}|${cls}`;
  b.dataset.k = k;
  handlers.set(k, onClick);
  return b;
}

export function fmtNum(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

export function fmtTime(s: number): string {
  s = Math.max(0, Math.ceil(s));
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d ${hh}h`;
  if (hh) return `${hh}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function costLine(c: Cost | null, land = 0, spirit = 0): HTMLElement {
  const el = h('span', { class: 'cost' });
  if (!c) return el;
  if (c.coins) el.append(h('img', { src: 'assets/ui/Coin.png', class: 'ic' }), fmtNum(c.coins), ' ');
  if (c.utopium) el.append(h('img', { src: 'assets/ui/Utopium.png', class: 'ic' }), `${c.utopium}`, ' ');
  if (c.chroma) el.append(h('img', { src: 'assets/ui/Chroma.png', class: 'ic' }), `${c.chroma}`, ' ');
  if (!c.coins && !c.utopium && !c.chroma) el.append('FREE ');
  if (land) el.append(h('span', { class: 'land' }, `${land} LAND`), ' ');
  if (spirit) el.append(h('span', { class: 'spirit' }, `+${spirit} SPIRIT`));
  return el;
}

export function fmtShort(n: number): string {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${Math.floor(n / 1000)}K`;
  return fmtNum(n);
}

export function handlersSet(k: string, f: () => void) { handlers.set(k, f); }


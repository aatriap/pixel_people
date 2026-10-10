// Altar (02 §6), Arcade "The Claw" and skins (05 §1, §3.4), residence paint (05 §3.5),
// TV Station catalogue and chroma shop (05 §3.3, §5.1, Agustin's decision) and the utopium -> coins exchange (05 §3.2).
import {
  ANIMAL, ANIMALS, AnimalData, Cost, DECOR_BY, HOUSES_DECOR, LAND, OFFERS, RESIDENCE, TREE, kindOf,
} from './data';
import { landRow } from './formulas';
import { uniform, pick } from './rng';
import { MQ } from './miniquests';
import type { Game, Result } from './game';

const ok = (msg?: string): Result => ({ ok: true, msg });
const fail = (msg: string): Result => ({ ok: false, msg });

// ------------------------------------------------------------------ Altar
export const ALTAR_COIN_CAP = 50000;

const noParents = (a: AnimalData) => !a.parent1 && !a.parent2;
export const BASE_CATS = ANIMALS.filter((a) => a.categories.includes('Cat') && noParents(a)).map((a) => a.name);
export const BASE_DOGS = ANIMALS.filter((a) => a.categories.includes('Dog') && noParents(a)).map((a) => a.name);

export type AltarResult =
  | { kind: 'none' }
  | { kind: 'cat' | 'dog'; pool: string[] }  // random base cat / dog other than both parents
  | { kind: 'recipe'; animal: string };

/** cSplicerSystem::isAnimalPairSplicable. */
export function altarResult(a: string, b: string): AltarResult {
  for (const [kind, base] of [['cat', BASE_CATS], ['dog', BASE_DOGS]] as const) {
    if (base.includes(a) && base.includes(b)) return { kind, pool: base.filter((x) => x !== a && x !== b) };
  }
  const x = ANIMALS.find((r) => r.parent1 && ((r.parent1 === a && r.parent2 === b) || (r.parent1 === b && r.parent2 === a)));
  return x ? { kind: 'recipe', animal: x.name } : { kind: 'none' };
}

/** Cost column used by getAnimalSplicingCost: the result's; for the random base pairs, the base animals' (8). */
export function altarCostPct(r: AltarResult): number {
  if (r.kind === 'recipe') return ANIMAL.get(r.animal)!.cost;
  if (r.kind === 'cat' || r.kind === 'dog') return ANIMAL.get(r.pool[0] ?? BASE_CATS[0])!.cost;
  return 0;
}

// ------------------------------------------------------------------ Arcade
export const CLAW_UTOPIUM = 50;
export const CLAW_CHROMA = 300;
export const SKIN = new Map(OFFERS.skins.map((s) => [s.skin, s]));

// ------------------------------------------------------------------ TV Station
export const CATALOGUE_REFRESH_UTOPIUM = 5;
/** inferido: each catalogue offer can be bought once until the next scramble ("Out of Stock" afterwards). */
export const DEAL_STOCK = 1;

/** Price of a catalogue item: "Xu,Yc" = X utopium OR Y chroma (cBuildingPreviewPopup::altButtonPressed). */
export function dealPrice(type: string): { utopium: number; chroma: number } | null {
  let c: Cost | null | undefined;
  switch (kindOf(type)) {
    case 'residence': c = RESIDENCE.get(type)!.costType === 'UtopiumChroma' ? RESIDENCE.get(type)!.cost : null; break;
    case 'decor': c = DECOR_BY.get(type)!.cost; break;
    case 'tree': c = TREE.get(type)?.cost; break;
    default: c = null;
  }
  return c && c.utopium > 0 && c.chroma > 0 ? { utopium: c.utopium, chroma: c.chroma } : null;
}

export const CATALOGUE = HOUSES_DECOR.filter((x) => dealPrice(x.id));

/**
 * Chroma price of the 24 pack-only items (UnlockTile rows of shop_offers.tsv) at the TV Station.
 * inferido (Agustin's decision, 2026-10-05): priced like the comparable chroma items of the TSVs:
 * - decor: 20 chroma per spirit point, as the "Chroma (Normal)" decor (1 spirit 20c, 2 spirit 40c, 3 spirit 60c),
 *   so the 6-spirit SpecialDecor cost 120c;
 * - residences: by beds, as the UtopiumChroma houses (2 beds 50c, 4 beds 100c, 6 beds 200c);
 * - trees, paths and terrain (no spirit, no beds): 20c, the cheapest chroma price in the TSVs.
 * Buying one unlocks the item for good, like the non-consumable pack did: the first one goes to storage for free
 * and more can be built from the BUILD menu at their normal TSV cost.
 */
export function packItemChroma(tile: string): number {
  const k = kindOf(tile);
  if (k === 'decor') return 20 * DECOR_BY.get(tile)!.spirit;
  if (k === 'residence') {
    const beds = RESIDENCE.get(tile)!.population;
    return beds >= 6 ? 200 : beds >= 4 ? 100 : 50;
  }
  return 20;
}
export const PACK_ITEMS = OFFERS.packItems.map((p) => ({ ...p, chroma: packItemChroma(p.tile) }));
export const PACK_ITEM = new Map(PACK_ITEMS.map((p) => [p.tile, p]));

// ------------------------------------------------------------------ exchange (cShopPopup idx 4..7)
export const EXCHANGE_UTOPIUM = [5, 25, 100, 200];

/** getConversionRateForIndex(i): coins for 5/25/100/200 u. C = land upgrade base cost of level L, no discount. */
export function exchangeCoins(i: number, level: number): number {
  const C = landRow(LAND, level).cost;
  if (level < 9) return [50000, 275000, 1525000, 3050000][i];
  switch (i) {
    case 0: return Math.trunc(Math.trunc(C / 40) * 0.8);
    case 1: return Math.trunc(Math.trunc(C / 8) * 0.9);
    case 2: return Math.trunc(C / 2);
    default: return C;
  }
}

export class Shop {
  constructor(private g: Game) {}

  private get s() { return this.g.state; }

  // ---------------------------------------------------------------- Altar
  hasAltar(): boolean { return this.g.hasBuilt('Altar'); }

  /** getFractionOfLevelUpExpense(Cost, 50000) = min(cap, int(Cost/100 * int((1-d) * landCost[L] / 100))). */
  altarCost(a: string, b: string): number {
    const pct = altarCostPct(altarResult(a, b));
    const base = Math.trunc((1 - this.g.discount()) * landRow(LAND, this.s.level).cost / 100);
    return Math.min(ALTAR_COIN_CAP, Math.trunc((pct / 100) * base));
  }

  /** Splice indicator: none, a known recipe (old) or a new one. Random base pairs count as known once tried. */
  altarIndicator(a: string, b: string): 'none' | 'old' | 'new' {
    const r = altarResult(a, b);
    if (r.kind === 'none') return 'none';
    if (r.kind === 'recipe') return this.s.animalRecipes.includes(r.animal) ? 'old' : 'new';
    return 'old';
  }

  /** cAnimalSplicingPopup::spliceButtonPressed: instant, consumes both parents, packet type 14. */
  altarSplice(a: string, b: string, local: number): Result {
    if (!this.hasAltar()) return fail('BUILD THE ALTAR FIRST');
    const r = altarResult(a, b);
    if (r.kind === 'none') return fail('NO GENETIC MATCH');
    const have = (n: string) => this.s.animals[n] ?? 0;
    if (a === b ? have(a) < 2 : have(a) < 1 || have(b) < 1) return fail('INSUFFICIENT ANIMALS');
    const cost = this.altarCost(a, b);
    if (this.s.coins < cost) return fail('NOT ENOUGH COINS');
    this.s.coins -= cost;
    this.g.removeAnimal(a);
    this.g.removeAnimal(b);
    const result = r.kind === 'recipe' ? r.animal : pick(this.g.rng, r.pool)!;
    this.g.queuePacket({ type: 14, id: result, value: 1 });
    this.s.altarSplices += 1;
    this.g.miniquests.increment(MQ.ALTAR, local, ANIMAL.get(result)!.tier);
    return { ok: true, msg: result };
  }

  // ---------------------------------------------------------------- Arcade
  lockedSkins() { return OFFERS.skins.filter((s) => !this.s.skins.includes(s.skin)); }

  /** cGachaPopup: 50 u or 300 chroma for one random locked skin (uniform, no duplicates). */
  playClaw(currency: 'utopium' | 'chroma'): Result {
    if (!this.g.hasBuilt('Arcade')) return fail('BUILD THE ARCADE FIRST');
    const locked = this.lockedSkins();
    if (!locked.length) return fail('ALL SKINS UNLOCKED!'); // no charge
    const price = currency === 'utopium' ? CLAW_UTOPIUM : CLAW_CHROMA;
    if ((currency === 'utopium' ? this.s.utopium : this.s.chroma) < price) {
      return fail(currency === 'utopium' ? 'NOT ENOUGH UTOPIUM' : 'NOT ENOUGH CHROMA');
    }
    const skin = locked[uniform(this.g.rng, 0, locked.length - 1)];
    if (currency === 'utopium') this.s.utopium -= price; else this.s.chroma -= price;
    this.g.queuePacket({ type: 50, id: `${skin.skin}~${skin.building}~arcade`, value: 1 });
    return ok(skin.skin);
  }

  /** Skins unlocked for this building type. */
  skinsFor(type: string): string[] {
    return OFFERS.skins.filter((s) => s.building === type && this.s.skins.includes(s.skin)).map((s) => s.skin);
  }

  /** cycleTileSkin: original (null) or an unlocked skin of this building's type. */
  setSkin(id: string, skin: string | null): Result {
    const b = this.g.building(id);
    if (!b) return fail('');
    if (skin && !this.skinsFor(b.type).includes(skin)) return fail('SKIN LOCKED');
    if (skin) b.skin = skin; else delete b.skin;
    return ok();
  }

  // ---------------------------------------------------------------- paint
  /** paintResidence: two random colours Color3B(U(0,255) x 3); free. */
  paint(id: string): Result {
    const b = this.g.building(id);
    if (!b || kindOf(b.type) !== 'residence') return fail('');
    const rgb = () => (uniform(this.g.rng, 0, 255) << 16) | (uniform(this.g.rng, 0, 255) << 8) | uniform(this.g.rng, 0, 255);
    b.paint = [rgb(), rgb()];
    return ok();
  }

  resetPaint(id: string): Result {
    const b = this.g.building(id);
    if (!b) return fail('');
    delete b.paint;
    return ok();
  }

  // ---------------------------------------------------------------- TV Station
  hasTv(): boolean { return this.g.hasBuilt('TV Station'); }

  /** scrambleHousesDecorDeals: one offer of each tier (the popup's 1, 2 and 3 star boxes). */
  scrambleDeals(): void {
    this.s.deals = [1, 2, 3].map((t) => pick(this.g.rng, CATALOGUE.filter((x) => x.tier === t)))
      .filter((x) => !!x).map((x) => ({ id: x!.id, stock: DEAL_STOCK }));
  }

  /** "REFRESH NOW": 5 utopium for a new catalogue. */
  refreshDeals(): Result {
    if (!this.hasTv()) return fail('BUILD THE TV STATION FIRST');
    if (this.s.utopium < CATALOGUE_REFRESH_UTOPIUM) return fail('NOT ENOUGH UTOPIUM');
    this.s.utopium -= CATALOGUE_REFRESH_UTOPIUM;
    this.scrambleDeals();
    return ok('NEW OPTIONS!');
  }

  /** Buy a catalogue offer with utopium or chroma; it goes to storage and is placed for free. */
  buyDeal(index: number, currency: 'utopium' | 'chroma', local: number): Result {
    if (!this.hasTv()) return fail('BUILD THE TV STATION FIRST');
    const d = this.s.deals[index];
    if (!d) return fail('');
    if (d.stock < 1) return fail('OUT OF STOCK');
    const p = dealPrice(d.id)!;
    const price = currency === 'utopium' ? p.utopium : p.chroma;
    if ((currency === 'utopium' ? this.s.utopium : this.s.chroma) < price) {
      return fail(currency === 'utopium' ? 'NOT ENOUGH UTOPIUM' : 'NOT ENOUGH CHROMA');
    }
    if (currency === 'utopium') this.s.utopium -= price; else this.s.chroma -= price;
    d.stock -= 1;
    this.s.inventory.push({ type: d.id, level: 1 });
    this.g.miniquests.increment(MQ.TV, local);
    return ok('SENT TO STORAGE');
  }

  packUnlocked(tile: string): boolean { return this.s.packUnlocks.includes(tile); }

  /** TV Station chroma shop for the pack-only items (see packItemChroma). */
  buyPackItem(tile: string, local: number): Result {
    if (!this.hasTv()) return fail('BUILD THE TV STATION FIRST');
    const it = PACK_ITEM.get(tile);
    if (!it) return fail('');
    if (this.packUnlocked(tile)) return fail('ALREADY UNLOCKED');
    if (this.s.chroma < it.chroma) return fail('NOT ENOUGH CHROMA');
    this.s.chroma -= it.chroma;
    this.s.packUnlocks.push(tile);
    this.s.inventory.push({ type: tile, level: 1 });
    this.g.miniquests.increment(MQ.TV, local);
    return ok('UNLOCKED! THE FIRST ONE IS IN STORAGE');
  }

  // ---------------------------------------------------------------- exchange
  exchange(i: number): Result {
    const u = EXCHANGE_UTOPIUM[i];
    if (u === undefined) return fail('');
    if (this.s.utopium < u) return fail('NOT ENOUGH UTOPIUM');
    const coins = exchangeCoins(i, this.s.level);
    this.s.utopium -= u;
    this.s.coins += coins;
    this.s.lifetimeCoins += coins;
    return ok(`+${coins.toLocaleString('en-US')} COINS`);
  }
}

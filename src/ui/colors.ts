// Colours of the 4.20 UI. The game tints grey sprites in native code, so these were matched to screenshots (inferido),
// except ADMINISTRATION, which the Arrival Center layout stores (arrivalcenter.csb: PlainBg colour 226,212,2).
/** Splicer button colour per gene group (inferido: the 4.20 colours are in native code; matched to screenshots). */
export const GROUP_COLORS: Record<string, string> = {
  Academic: '#c8169a', Administration: '#7cc81a', Business: '#2a9a5a', Creative: '#e0a814', Curious: '#a84c8a',
  Enchanted: '#7a3cc8', Evil: '#444450', Explorers: '#5f7a22', Hospitality: '#16967a', Law: '#2a6ad8',
  Media: '#d82a2a', Medical: '#8a3cd0', Music: '#d0602a', Performers: '#d03c8a', Production: '#a8961a',
  Resident: '#3d6e3d', Services: '#2a8ab0', Special: '#e01e1e', Sports: '#6a2ca0', Technical: '#b0124a',
  Transport: '#5a6a7a',
};
export function groupColor(group: string): string { return GROUP_COLORS[group] ?? '#5a4a8a'; }

/** Build menu colours (BuildMenu_Category_0..7, Landscape_Category_0..3), matched to the 4.20 screenshots (inferido). */
export const CAT_COLORS: Record<string, string> = {
  RESIDENTIAL: '#12b4c8', ADMINISTRATION: '#bdb810', BUSINESS: '#86b414', CREATIVE: '#c8105a', ENTERTAINMENT: '#e0880a',
  'F&B': '#c8b20c', SCIENCE: '#14a88c', SERVICES: '#3c78d8', TREE: '#3d9a2a', DECOR: '#c8509a', PATH: '#6a6a7a',
  STORAGE: '#8a6a3a',
};


/** Popup frame tint per building category (PlainBg / JobAvailableBG multiplied by this colour). */
export const FRAME_TINT: Record<string, string> = {
  ADMINISTRATION: '#e2d402', SCIENCE: '#0ad6a0', BUSINESS: '#8cd21c', SERVICES: '#3c90f0', ENTERTAINMENT: '#f2921c',
  CREATIVE: '#e8287a', 'F&B': '#f0c010', RESIDENTIAL: '#76b8e8', VACANT: '#6e6e6e', '': '#a0a0b0', EMPTY: '#a0a0b0',
};

/** Clone card (JobAvailableBG) tint: a brighter version of the gene group colour. */
export function cloneTint(group: string): string {
  return `color-mix(in srgb, ${groupColor(group)} 70%, #ffffff)`;
}

/** Gallery card colour of an animal tier (inferido from the 4.20 gallery: tier 1 teal, tier 2 olive). */
export const TIER_COLORS = ['#888', '#127f86', '#8a8a12', '#7a3cb0', '#a8204a', '#2a4ab0', '#c08a10'];

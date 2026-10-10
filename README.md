# Pixel People (4.20) web remake: milestone 3

Personal preservation project. It runs in a desktop browser and on iPhone (Safari, "Add to Home Screen").
Stack: Vite, TypeScript, Phaser 3 and Vitest.

## Run it (Windows, macOS or Linux)

You need Node.js 20 or newer.

```
npm install
npm run dev        # http://localhost:5173 (also reachable from a phone on the same Wi-Fi)
npm test           # formula and rule tests
npm run build      # production build in dist/
npx vite preview   # serve dist/
```

To install it on an iPhone, open the dev or preview URL in Safari, then choose Share > Add to Home Screen.
The save lives in the browser's localStorage. **⚙ Settings** has music and sound, SKIP TUTORIAL, EXPORT / IMPORT
(a `.json` file, to move a city between a PC and an iPhone: on iPhone EXPORT opens the share sheet, choose "Save to Files")
and RESET GAME (asks for confirmation). A new game starts in the tutorial; nothing is saved until the tutorial ends,
as in the original. Saves from milestones 1 and 2 load with the tutorial already done.

## Controls

- Drag to pan the city. Use the mouse wheel or pinch to zoom.
- Tap a building to open it. Tapping an idle workplace that has workers restarts its shift for free.
- **CLONES** opens the Arrival Center, which has 3 slots. From there you rush arrivals, splice and assign jobs.
- **BUILD** lists houses, decor, paths and trees. Tap the map to place one.
- **EXPAND** buys +10 land (the level-up card applies it). With the Law Firm you can also expand for 40 utopium.
- Side buttons: **hearts** (stored hearts; pump one to open it), **HQ** (missions, once Utopia HQ is built), **DAY** (calendar reward),
  **animals**, **ACH** (achievements), **EDIT** (tap a building, then MOVE / FLIP / STORE / DELETE) and **MUSIC** (mute is saved).
- Tap the coins counter to trade utopium for coins (also at the Town Hall and the TV Station).
- Guests walk on the roads: the one with the gene icon gives a special gene, the "?" one shows the mini-quests (COLLECT when done).
- Rewards (hearts, gifts, missions, the shelter, level-ups) arrive as cards, one at a time; the reward is applied when the card closes.
- Tap the bubbles on the map: hearts over houses, tree rewards, the Utopium Mine and the Animal Shelter (once a day, reset at 12:00 local).

## Milestone 2 rules (spec 01/03/04/05)

Daily reset at 12:00 local, Utopium Mine U(1,2), Animal Shelter (tier 1 20 % / tier 2 80 %), hearts (22+ land, 3 s then U(5,10) s,
max 10, getHeartReward / heartEarnedCoin), tree rewards (one at a time, U(20,40) / U(30,120), loot table, 25 or 50 daily cap),
gifts (getGiftPacketReward, from calendar gift days), the packet queue, missions (6 slots [4,4,3,3,2,2] + the wonder, pods,
4 free refreshes then 1 u, daily refresh, coin requirements = max(scaled, 500 000)), wonders MonumentPart1-9 → Monument3 → Monument4,
editing (no refund, frees land and decor spirit, occupied / first-of-type / mission pods protected), workplace upgrades
(3 × level u, up to 6), duplicates (20 u + land), features unlocked by building name, and the special buttons of the Bank,
Business Center, Law Firm, Enterprise, Pet Store, Hotel, Research Lab, Utopium Mine and Animal Shelter.
Guesses are marked `inferido` in the code.

## Milestone 3 rules (spec 01/02/04/05)

Tutorial: the 24 steps with the `Tutorial_Desc_1..26` texts, 14000 coins / 25 u / 100 chroma, 7 s splicing, arrivals only from
step 7, no daily reset, hearts or tree rewards, footer locked except where a step needs it, utopium back to 25 at the end.
Calendar: season = week mod 4 from 07-10-2019, Halloween (31/10, 1 week) forces Harvest and Christmas (9/12, 2 weeks) forces
Frost, 4-week reward cycles (+1 per event week), one gift per local day, seasonal unique missions and animals in the popup.
Mini-quests: the 8 quests of miniquest.tsv with their gates (land level 5/8, weekly stamps, Park then a level up) and rewards;
guests 2001 (one per unclaimed special gene: Dreamer/Salesman/Explorer at 10/30/60 jobs, Bureaucrat 50, Mutant 149) and 2005.
Achievements: the code thresholds and direct events, utopium rewards on a card (inferido), "breaking news" banner.
Altar: base cat + base cat / base dog + base dog give another random base animal, other pairs by recipe in any order, cost
`min(50000, int(Cost/100 · int((1−d)·landCost/100)))`, instant, both parents consumed, recipe known when its card closes.
Arcade "The Claw": 50 u or 300 chroma, one random locked skin, no duplicates; skin selector in the building popup; residence
PAINT (two random RGB colours) and RESET. TV Station: daily catalogue (u or chroma, 5 u refresh), the chroma shop for the 24
pack-only items (inferido prices: decor 20 c per spirit, houses 50/100/200 c by beds, trees 200 c, path/terrain 20 c) and the
utopium → coins exchange. Observatory (background), Funeral Parlor (spirit watch), News Agency (news feed), Police Station
(achievements), Sheriff's Office (credits), Mothership (delete a clone for 1 u), REVEAL formula (5 u). Toasts when a splice,
a construction or the mine is ready.

## Layout

| Path | What |
|---|---|
| `src/logic/` | Game rules in plain TS with no Phaser imports: `formulas.ts`, `state.ts` (new game, save migration), `game.ts` (tick, splicer, arrival center, building, editing, land, packets, hearts, trees, daily reset, special buildings, tutorial, guests), `missions.ts`, `miniquests.ts`, `achievements.ts`, `shop.ts` (Altar, Arcade, skins, paint, TV Station, exchange), `tutorial.ts`, `rewards.ts` (random rewards), `calendar.ts`, `rng.ts`, `save.ts` (localStorage, export/import) |
| `src/render/` | Phaser scene (`CityScene.ts`) and isometric maths (`iso.ts`) |
| `src/ui/` | HTML overlay: `ui.ts` (HUD, menus, popups, tutorial narrator), `m3.ts` (milestone 3 popups), `dom.ts` (helpers), sounds, music |
| `src/data/*.json` | Generated from the 4.20 TSVs by `scripts/build-data.py` |
| `public/assets/` | Only the assets the app uses, generated by `scripts/build-assets.py` (repacked atlases ≤2048 px, UI PNGs, 04b03 font, a few SFX, icons) |
| `scripts/screenshots.mjs` | Playwright run that plays the core loop and saves screenshots |
| `scripts/screenshots2.mjs` | Milestone 2 screenshots (hearts, missions, mission card, wonder, pod, edit mode, mine) |
| `scripts/screenshots3.mjs` | Milestone 3: plays the tutorial through the UI, then calendar, mini-quest, achievements, Altar, Arcade, TV Station, settings |
| `tests/` | Vitest tests |

The generated JSON and assets are committed, so Python is only needed to regenerate them:
`python3 scripts/build-data.py <datos/apk_moderna>` and `python3 scripts/build-assets.py <assets_moderna>` (needs Pillow).

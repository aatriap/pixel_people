// HTML overlay: HUD, menus and popups. Uses the game's UI sprites and the 04b03 font.
import {
  Game, ComboKind, F, HEART_BAR, HOTEL_ROOMS, DUPLICATE_UTOPIUM, LAW_FIRM_UTOPIUM,
  ENTERPRISE_UTOPIUM, PET_STORE_UTOPIUM,
} from '../logic/game';
import {
  ANIMAL, DECOR, JOB, JOBS, JOB_BY_ID, MISSION, PATHS, RESIDENCES, STRINGS, TREES, WORKPLACE, Cost, POD,
  displayName, jobDisplay, kindOf, landUse,
} from '../logic/data';
import { constructionRushCost, landRow, timeTillNoon, timeRushCost } from '../logic/formulas';
import { LAND, RESIDENCE, WORKPLACES } from '../logic/data';
import type { CityScene } from '../render/CityScene';
import { nowSec } from '../logic/save';
import { sfx } from './sound';
import { $, ptr, h, btn, fmtNum, fmtTime, costLine, fmtShort, handlersSet } from './dom';
export { fmtNum, fmtTime } from './dom';
import type { Music } from './music';
import { SEASONS, calendarAt } from '../logic/calendar';
import { Extras } from './m3';
import { CAT_COLORS, groupColor } from './colors';
import { Classic } from './classic';
import { footprintBox } from '../render/iso';
const footprintCells = (t: string, x: number, y: number, f: boolean) => footprintBox(t, x, y, f).cells as [number, number][];
import { TUTORIAL } from '../logic/tutorial';
import { PACK_ITEM } from '../logic/shop';
import { MISSION_COIN_FLOOR, WONDER_PARTS, parseReq, parseReward, wonderOf } from '../logic/missions';
import type { ActiveMission, Packet } from '../logic/state';
import { MISSION_SLOT_TYPES } from '../logic/state';

const TYPE_NAME: Record<number, string> = { 2: 'NORMAL', 3: 'EPIC', 4: 'UNIQUE', 5: 'WONDER' };

type PlaceMode =
  | { kind: 'buy' }
  | { kind: 'inventory'; index: number }
  | { kind: 'pod'; mission: string }
  | { kind: 'wonder' }
  | { kind: 'move'; id: string };

/** HeaderTop "78/450": discovered jobs out of the professions (the 23 special genes are not counted). */
const JOB_TOTAL = JOBS.filter((j) => j.group !== 'Special').length;

const COMBO_IMG: Record<ComboKind, string> = {
  none: 'Splice_NoCombo', old: 'Splice_OldCombo', new: 'Splice_NewCombo', evil: 'Splice_EvilCombo',
};

export class UI {
  panel: HTMLElement | null = null;
  panelKind = '';
  private panelRefresh: (() => void) | null = null;
  private onPanelClose: (() => void) | null = null;
  private toastTimer = 0;
  buildType: string | null = null;
  private placeMode: PlaceMode = { kind: 'buy' };
  editing = false;
  private moveFromPopup = false;
  private editSel: string | null = null;
  private confirmDelete = false;

  x: Extras;
  c: Classic;
  private tutShown = -2;
  private newsAt = 0;

  constructor(public game: Game, public scene: CityScene, public onChange: () => void, public music: Music) {
    this.x = new Extras(this);
    this.c = new Classic(this);
    this.buildHud();
  }

  get s() { return this.game.state; }

  // ---------------------------------------------------------------- HUD
  private buildHud() {
    const root = $('#ui');
    root.innerHTML = `
      <div class="hud">
        <div class="topbar">
          <div class="tb-left" title="Utopium"><button class="tb-plus" id="p-plus" title="Get coins"></button><img src="assets/ui/Utopium.png"><span id="h-uto"></span></div>
          <button class="tb-mid" id="p-jobs" title="Gallery"><span id="h-jobs"></span></button>
          <div class="tb-right" title="Coins" id="p-coins"><span id="h-coins"></span><img src="assets/ui/Coin.png"></div>
        </div>
        <div class="hudrow"><button class="hearts-row" id="s-heart" title="Hearts"></button></div>
      </div>
      <div id="pending"></div>
      <div class="footer420">
        <button class="cbtn cal" id="s-cal" title="Calendar"></button>
        <div class="fbar">
          <button class="cbtn home" id="f-home" title="Back to the Town Hall"></button>
          <img class="nb" src="assets/ui/UNNewsbar.png">
          <div id="news" class="track"><span id="news-text"></span></div>
          <div class="watches">
            <div id="spiritwatch" class="watch spirit hidden"><span id="h-sw"></span></div>
            <button class="watch land" id="f-land" title="Land used / limit"><span id="h-land"></span></button>
          </div>
        </div>
      </div>
      <div id="breaking" class="hidden"></div>
      <div id="buildbar" class="hidden"></div>
      <div id="toast" class="hidden"></div>
      <div id="tut" class="hidden"></div>
      <div id="modal" class="hidden"></div>`;
    const on = (id: string, f: () => void) => { $(id).onclick = () => { sfx('tap_01'); f(); }; };
    on('#p-coins', () => { if (!this.game.tutorialActive()) this.x.openExchange(); });
    on('#p-plus', () => { if (!this.game.tutorialActive()) this.x.openExchange(); });
    on('#p-jobs', () => { if (!this.game.tutorialActive()) this.c.openGallery(); });
    on('#s-heart', () => { const on = this.s.hearts.on; if (on) this.scene.focusOn(on); });
    on('#s-cal', () => this.x.openCalendar());
    on('#f-home', () => { const th = this.s.buildings.find((b) => b.type === 'Town Hall'); if (th) this.scene.focusOn(th.id); });
    on('#f-land', () => { if (!this.game.tutorialActive()) this.openExpand(); });
    $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal') && this.panelKind !== 'envelope') this.close(); });
  }

  update() {
    const s = this.s, g = this.game;
    const now = nowSec();
    $('#h-coins').textContent = fmtNum(s.coins);
    $('#h-uto').textContent = fmtNum(s.utopium);
    $('#h-land').textContent = `${s.landUsed}/${s.landLimit}`;
    $('#h-land').classList.toggle('warn', g.freeLand() <= 3);
    $('#h-jobs').textContent = `${s.unlockedJobs.length}/${JOB_TOTAL}`;
    // the heart bar: permanent Research Lab hearts first, then the ones collected from houses
    const hearts = $('#s-heart');
    const hk = `${s.heartCount}|${s.researchLevel}`;
    if (hearts.dataset.n !== hk) {
      hearts.dataset.n = hk;
      hearts.innerHTML = '';
      for (let k = 0; k < HEART_BAR; k++) {
        const img = k < Math.min(s.researchLevel, s.heartCount) ? 'HUDHeartupgrade' : k < s.heartCount ? 'HUDHeart' : 'HUDHeartmissing';
        hearts.append(h('img', { src: `assets/ui/${img}.png` }));
      }
    }
    hearts.classList.toggle('glow', !!s.hearts.on);
    $('#s-cal').classList.toggle('glow', s.dailyGift);
    const pend = $('#pending');
    pend.innerHTML = '';
    if (!this.buildType && !this.editing) {
      for (const wp of s.pendingWorkplaces) {
        pend.append(btn(`PLACE ${displayName(wp).toUpperCase()} (FREE)`, 'b-green small', () => this.startBuild(wp)));
      }
      // reward card queue: one card at a time, only when nothing else is open (cGameManager::forceUIProc)
      // (a new-job card may replace the Arrival Center, as in milestone 1)
      if (s.packets.length && (!this.panel || (this.panelKind === 'ARRIVAL CENTER' && s.packets[0].type === 0))) this.showPacket(s.packets[0]);
    }
    // Funeral Parlor: spirit watch
    $('#spiritwatch').classList.toggle('hidden', !s.spiritWatch || g.tutorialActive());
    $('#h-sw').textContent = `${s.spirit}/${s.spiritLimit}`;
    // Observatory background
    const bg = `url("assets/ui/bg${s.spaceBg}.png")`;
    if ($('#game').style.backgroundImage !== bg) $('#game').style.backgroundImage = bg;
    // News Agency: live news feed
    document.body.classList.toggle('placing', !!this.buildType || this.editing);
    $('#news-text').classList.toggle('hidden', !s.newsFeed || g.tutorialActive());
    if (s.newsFeed && now >= this.newsAt) {
      this.newsAt = now + 16;
      const t = $('#news-text');
      t.textContent = this.x.newsText();
      t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    }
    if (!ptr.down) this.panelRefresh?.();
    this.renderTutorial();
  }

  // ---------------------------------------------------------------- tutorial (01 §5)
  /** Spot for the tutorial's flashing square (Residence1 at step 1, the new workplace at step 16). */
  private tutSpot(type: string): [number, number] { return this.game.findFreeSpot(type, [1, -1]); }

  private tutSite(): string | undefined {
    return this.s.buildings.find((b) => b.buildEnd >= 0)?.id;
  }

  renderTutorial() {
    const g = this.game, s = this.s;
    const on = g.tutorialActive();
    document.body.classList.toggle('tutorial', on);
    const el = $('#tut');
    document.querySelectorAll('.tut-target').forEach((e) => e.classList.remove('tut-target'));
    if (!on) {
      if (this.tutShown !== -1) {
        el.classList.add('hidden');
        this.scene.setMarker(null);
        this.tutShown = -1;
      }
      return;
    }
    const step = s.tutorial;
    const st = TUTORIAL[step];
    if (step !== this.tutShown) {
      this.tutShown = step;
      el.innerHTML = '';
      el.append(h('img', { class: 'narrator', src: this.scene.clonePortrait('Mechanic', false, 64) }),
        h('div', { class: 'ttext' }, this.x.tutorialText(step),
          step === 0 ? h('div', { class: 'hint' }, STRINGS.Tutorial_UtopiumWillResetAfter ?? '') : null));
      if (st.action === 'next') el.append(btn('', 'b-tutnext', () => { if (g.tut('next')) { sfx('tap_01'); this.onChange(); } }, false, 'tut-next'));
      el.classList.remove('hidden');
    }
    // the action each step waits for
    const tutBuild = (type: string) => { this.startBuild(type); this.scene.panToCell(...this.tutSpot(type)); };
    if (step === 1 && !this.buildType && !this.panel) tutBuild('Residence1');
    if (step === 16 && !this.buildType && !this.panel && s.pendingWorkplaces.length && !s.packets.length) tutBuild(s.pendingWorkplaces[0]);
    const cells = (id?: string) => {
      const b = id ? g.building(id) : undefined;
      return b ? footprintCells(b.type, b.x, b.y, b.flip) : null;
    };
    let mark: [number, number][] | null = null;
    if ((step === 1 || step === 16) && this.buildType) {
      const [x, y] = this.tutSpot(this.buildType);
      mark = footprintCells(this.buildType, x, y, false);
    } else if ((step === 2 || step === 3 || step === 17) && !this.panel) mark = cells(this.tutSite());
    else if ((step === 5 || step === 18) && !this.panel) mark = cells('SpacePort_1');
    else if (step === 22 && !this.panel) mark = cells(s.buildings.find((b) => b.type === 'Utopium Mine')?.id);
    this.scene.setMarker(mark, !!st.hand || step === 1 || step === 16 || step === 22);
    // highlight the control the step is about
    const sel: Record<number, string> = {
      3: 'button[data-k="bld-rush"]', 17: 'button[data-k="bld-rush"]', 7: 'button[data-k^="arr"]',
      8: '.acslot.tap', 19: '.acslot.tap', 9: 'button[data-k^="spl"]', 11: '.spcol.l .gene[data-job="Mayor"]',
      12: '.spcol.r .gene[data-job="Mechanic"]', 13: 'button[data-k="splice-go"]', 20: 'button[data-k^="as"][data-k$="Utopium Mine"]',
      14: '.env-handle', 15: 'button[data-k="disc-place"]',
    };
    if (sel[step]) document.querySelectorAll(sel[step]).forEach((e) => e.classList.add('tut-target'));
  }

  toast(msg: string, bad = false) {
    if (!msg) return;
    const t = $('#toast');
    t.textContent = msg;
    t.className = bad ? 'bad' : '';
    if (bad) sfx('nega_tap_02');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.add('hidden'), 2200);
  }

  // ---------------------------------------------------------------- modal plumbing
  open(title: string, body: HTMLElement, refresh?: () => void, cls = '', onClose?: () => void, kind = '') {
    const m = $('#modal');
    m.innerHTML = '';
    const close = h('button', { class: 'close', title: 'Close' });
    close.addEventListener('click', () => { sfx('tap_01'); this.close(); });
    const p = h('div', { class: `panel ${cls}` }, h('div', { class: 'title' }, title), close, body);
    m.append(p);
    m.classList.remove('hidden');
    this.panel = p;
    this.panelKind = kind || (cls.includes('envelope') ? 'envelope' : cls.includes('card') ? 'card' : cls.includes('splicer') ? 'splicer' : title);
    this.panelRefresh = refresh ?? null;
    this.onPanelClose = onClose ?? null;
    refresh?.();
    this.renderTutorial();
  }

  close() {
    const cb = this.onPanelClose;
    this.onPanelClose = null;
    $('#modal').classList.add('hidden');
    $('#modal').innerHTML = '';
    this.panel = null;
    this.panelKind = '';
    this.panelRefresh = null;
    cb?.();
  }

  act(r: { ok: boolean; msg?: string }, okMsg?: string) {
    // success messages are upper-case game texts; placement results carry the new building id instead
    const msg = okMsg ?? (r.msg && !/[a-z]/.test(r.msg) ? r.msg : '');
    if (!r.ok) this.toast(r.msg ?? '', true);
    else if (msg) this.toast(msg);
    this.onChange();
    return r.ok;
  }

  animalImg(name: string, size = 40): HTMLElement {
    const id = ANIMAL.get(name)?.id;
    return h('img', { class: 'aimg', src: id ? this.scene.thumb([`A${id}`], size, size) : 'assets/ui/AnimalSilhouette.png' });
  }

  // ---------------------------------------------------------------- reward cards (01 §6)
  private packetArt(p: Packet): string {
    if (p.id.startsWith('mission:') || p.type === 9 || p.type === 16) return 'MissionPacket';
    if (p.id === 'gift') return 'GIFTpacket';
    if (p.love) return 'LOVEpacket'; // the full heart bar's "Special Delivery: With Love"
    switch (p.type) {
      case 0: return 'NewJobDiscovered';
      case 1: return 'SpecialPacket';
      case 2: return 'LevelUpPacket';
      case 3: case 14: return this.s.animals[p.id] ? 'LOVEpacket' : 'NewAnimalDiscovered';
      case 50: return 'ArcadePacket';
      case 10: return 'NineAnimalsPacket';
      default: return 'LOVEpacket';
    }
  }

  /** A packet arrives as the envelope itself: slide the scissors along "cut here to open" to tear it, then the card shows. */
  showPacket(p: Packet) {
    this.openEnvelope(this.packetArt(p), () => (p.type === 0 ? this.showDiscovery(p.id) : this.revealPacket(p)));
  }

  private openEnvelope(art: string, reveal: () => void) {
    const src = `assets/ui/packets/${art}.png`;
    const env = h('div', { class: 'env' },
      h('div', { class: 'env-top', style: `background-image:url('${src}')` }),
      h('div', { class: 'env-bot', style: `background-image:url('${src}')` }));
    const label = h('img', { class: 'env-label', src: 'assets/ui/packets/NewJobSlidetoReveal.png', draggable: 'false' });
    const handle = h('img', { class: 'env-handle', src: 'assets/ui/packets/NewJobSlider.png', draggable: 'false' });
    const cut = h('div', { class: 'env-cut' });
    env.append(cut, label, handle);
    const START = 0.169;
    let drag: { x0: number; w: number } | null = null;
    let done = false;
    const setPos = (f: number) => {
      handle.style.left = `${f * 100}%`;
      cut.style.width = `${Math.max(0, f - START) * 100}%`;
      label.style.opacity = `${1 - Math.min(1, (f - START) * 3)}`;
    };
    const open = () => {
      done = true;
      sfx('Rip.m4a');
      env.classList.add('torn');
      window.setTimeout(reveal, 420);
    };
    env.addEventListener('pointerdown', (e) => {
      if (done) return;
      const r = env.getBoundingClientRect();
      if (e.clientY < r.top + r.height * 0.72) return; // grab along the cut line only
      drag = { x0: e.clientX - (parseFloat(handle.style.left || `${START * 100}`) / 100) * r.width, w: r.width };
      env.setPointerCapture(e.pointerId);
      handle.classList.add('held');
      e.preventDefault();
    });
    env.addEventListener('pointermove', (e) => {
      if (!drag || done) return;
      const f = Math.max(START, Math.min(0.95, (e.clientX - drag.x0) / drag.w));
      setPos(f);
      if (f >= 0.8) { drag = null; handle.classList.remove('held'); setPos(0.95); open(); }
    });
    const release = () => {
      if (!drag || done) return;
      drag = null;
      handle.classList.remove('held');
      handle.classList.add('back');
      setPos(START);
      window.setTimeout(() => handle.classList.remove('back'), 250);
    };
    env.addEventListener('pointerup', release);
    env.addEventListener('pointercancel', release);
    setPos(START);
    this.open('', h('div', { class: 'envwrap' }, env), undefined, 'envelope');
  }

  /** The card frame of 4.20 (CharacterSplicingFrame tinted per card): top line, dark window, foot line. */
  private cardFrame(color: string, top: (HTMLElement | string)[], win: (HTMLElement | string)[], foot: string, corner?: HTMLElement): HTMLElement {
    const f = h('div', { class: 'cframe', style: `--fc:${color}` },
      h('div', { class: 'ctop' }, ...top), h('div', { class: 'cwin' }, ...win), h('div', { class: 'cfoot' }, foot));
    if (corner) f.append(corner);
    return f;
  }

  private jobCard(job: string, head: string, color: string): HTMLElement {
    const jd = JOB.get(job)!;
    const peep = this.s.peeps.find((q) => q.job === job);
    return this.cardFrame(color, [], [
      h('div', { class: 'chead' }, head),
      h('img', { class: 'cimg job', src: this.scene.clonePortrait(job, !!peep?.female, 108) }),
      h('div', { class: 'cname' }, jobDisplay(job)),
      h('div', { class: 'csub' }, peep?.female ? jd.femaleName : jd.maleName),
    ], (jd.quote ?? '').toUpperCase(), h('img', { class: 'ccorner', src: 'assets/ui/Level1-Corner.png' }));
  }

  private animalCard(name: string, head: string): HTMLElement {
    const a = ANIMAL.get(name);
    const seasons = (a?.seasons ?? []).filter((x) => x !== 'NONE');
    const when = !seasons.length || seasons.length >= 4 ? (STRINGS.Card_AnimalAnySeason ?? 'ANY SEASON')
      : (STRINGS.Card_AnimalSeason ?? 'MORE FREQUENT DURING %s').replace('%s', seasons.join(' & '));
    const img = this.animalImg(name, 120);
    img.classList.add('cimg');
    return this.cardFrame('#e6dc10', [h('div', { class: 'cseason' }, when), h('div', { class: 'ctier' }, `${STRINGS.Card_Tier ?? 'Tier '}${a?.tier ?? '?'}`)], [
      h('div', { class: 'cx' }, `x${this.s.animals[name] ?? 1}`),
      h('div', { class: 'chead' }, head),
      img,
      h('div', { class: 'cname' }, name),
      h('div', { class: 'csub' }, a?.latin ?? ''),
    ], (STRINGS.Card_AnimalCategory ?? 'CATEGORY: %s').replace('%s', (a?.categories ?? []).join(', ')));
  }

  private revealPacket(p: Packet) {
    const g = this.game;
    const body = h('div', { class: 'card2' });
    let title = 'YOU GOT A PRESENT!';
    if (p.id.startsWith('mission:')) {
      const md = MISSION.get(p.id.slice(8));
      title = `MISSION "${(md?.name ?? '').toUpperCase()}" COMPLETE!`;
    } else if (p.id === 'heart') title = STRINGS[`Heart_Quote${Math.abs(p.value) % 6}`] ?? 'LOVE!';
    else if (p.id === 'gift') title = 'A GIFT!';
    const big = (icon: string, text: string) => h('div', { class: 'bigreward' }, h('img', { src: icon }), text);
    const win: (HTMLElement | string)[] = [];
    let color = '#3cb4e6';
    let foot = (STRINGS.Card_Congrats ?? 'CONGRATULATIONS!');
    let frame: HTMLElement | null = null;
    switch (p.type) {
      case 1:
        frame = this.jobCard(p.id, (STRINGS.Card_SpecialGeneFound_Sub ?? 'SPECIAL GENE FOUND').toUpperCase(), '#e0283c');
        break;
      case 2: {
        const row = landRow(LAND, this.s.level);
        title = 'LEVEL UP!'; color = '#9a5ae0';
        win.push(h('img', { class: 'cimg land', src: 'assets/ui/LandscapeMenuIcon.png' }), h('div', { class: 'cname' }, `LEVEL ${this.s.level + 1}`),
          h('div', { class: 'csub' }, `+${row.land} ${STRINGS.Card_Expand_Land ?? 'LAND'} · +${row.utopium} ${STRINGS.Card_Expand_Utopium ?? 'UTOPIUM'}`));
        foot = STRINGS.Card_Expand_Quote ?? foot;
        break;
      }
      case 3: case 14: {
        const head = p.type === 14 ? (this.s.animalRecipes.includes(p.id) ? (STRINGS.Card_AnimalSplicedAtTheAltar ?? 'SPLICED AT THE ALTAR') : 'NEW RECIPE!')
          : (STRINGS.Card_SpecialDelivery ?? 'SPECIAL DELIVERY').replace(/\\n/g, ' ');
        frame = this.animalCard(p.id, head);
        break;
      }
      case 50: {
        const [skin, bld] = p.id.split('~');
        title = (STRINGS.Card_Gacha_Title ?? 'NEW SKIN UNLOCKED').toUpperCase(); color = '#e07a1e';
        win.push(h('img', { class: 'cimg', src: this.scene.workplaceThumb(skin, 120) }), h('div', { class: 'cname' }, displayName(bld)));
        foot = (STRINGS.Card_Gacha_Desc ?? '').toUpperCase();
        break;
      }
      case 4: color = '#e6b41e'; win.push(big('assets/ui/Coin.png', `+${fmtNum(p.value)} COINS`)); break;
      case 5: color = '#e0409a'; win.push(big('assets/ui/Utopium.png', `+${p.value} UTOPIUM`)); break;
      case 15: color = '#40c8e0'; win.push(big('assets/ui/Chroma.png', `+${p.value} CHROMA`)); break;
      case 6: case 7:
        title = 'NEW BUILDING!'; color = '#3cc85a';
        win.push(h('img', { class: 'cimg', src: this.scene.workplaceThumb(p.id, 120) }), h('div', { class: 'cname' }, displayName(p.id)));
        break;
      case 9: win.push(h('div', { class: 'cname' }, 'NEW COMBOS!'), h('div', { class: 'csub' }, `${p.value} NEW RECIPES IN THE SPLICER`)); break;
      case 10: {
        title = '9 ANIMALS PACK!'; color = '#e6dc10';
        const grid = h('div', { class: 'agrid' });
        for (const a of p.id.split('+')) grid.append(h('div', {}, this.animalImg(a, 44), h('small', {}, a.toUpperCase())));
        win.push(grid);
        break;
      }
      case 16: {
        const w = wonderOf(p.id);
        const name = (STRINGS[`${w.key}_DisplayName`] ?? w.key).toUpperCase();
        const last = w.part === WONDER_PARTS[w.key];
        title = last ? 'WONDER COMPLETE!' : `${name} PART ${w.part}`; color = '#e6b41e';
        win.push(h('img', { class: 'cimg', src: this.scene.workplaceThumb(p.id, 120) }),
          h('div', { class: 'csub' }, last
            ? (STRINGS.Wonder_Completed ?? '%s %s').replace('%s', name).replace('%s', STRINGS[`${w.key}_Completed`] ?? '')
            : `PART ${w.part} OF ${WONDER_PARTS[w.key]} COMPLETE!`));
        break;
      }
    }
    body.append(frame ?? this.cardFrame(color, [], [h('div', { class: 'chead' }, title), ...win], foot));
    const apply = () => {
      const q = g.closePacket();
      sfx('correct_03');
      this.onChange();
      if (q && (q.type === 6 || q.type === 7)) this.startInventoryPlace(this.s.inventory.length - 1);
    };
    body.append(btn(p.type === 6 || p.type === 7 ? 'PLACE IT' : 'COLLECT', 'b-green', () => this.close(), false, 'pkt-collect'));
    this.open('', body, undefined, 'card', apply);
  }

  // ---------------------------------------------------------------- arrival center + splicer
  openArrivalCenter() { this.c.openArrivalCenter(); }

  progress(f: number): HTMLElement {
    const bar = h('div', { class: 'progress' });
    bar.append(h('div', { style: `width:${Math.max(0, Math.min(1, f)) * 100}%` }));
    return bar;
  }

  private freeButton(readyAt: number, onUse: () => void, key = 'free'): HTMLElement {
    const left = readyAt - nowSec();
    if (left > 0) return btn(`FREE IN ${fmtTime(left)}`, 'b-grey small', () => {}, true);
    return btn('FREE?', 'b-free small', onUse, false, key);
  }

  /**
   * cSplicerPopup: one gene list on each side. Each list shows the gene groups first; tapping a group
   * lists its genes (with BACK). Genes with nothing new left to discover are faded (web, inferido).
   */
  openSplicer(slotIdx: number) {
    const g = this.game;
    const sel: (string | null)[] = [null, null];
    const tut = g.tutorialActive();
    const groups = new Map<string, string[]>();
    for (const j of this.s.unlockedJobs) {
      const grp = JOB.get(j)?.group ?? 'Other';
      groups.set(grp, [...(groups.get(grp) ?? []), j]);
    }
    const fresh = new Map(this.s.unlockedJobs.map((j) => [j, g.hasNewRecipes(j)] as [string, boolean]));
    // in the tutorial the left list is the Mayor and the right one the Mechanic (the mine is the next step)
    const only: (string | null)[] = tut ? ['Mayor', 'Mechanic'] : [null, null];
    const open: (string | null)[] = only.map((j) => (j ? JOB.get(j)?.group ?? null : null));
    const body = h('div', { class: 'splicer2' });
    const top = h('div', { class: 'sp-top' });
    const info = h('div', { class: 'sp-info' });
    const cols = [h('div', { class: 'spcol l' }), h('div', { class: 'spcol r' })];
    const color = (j: string | null) => groupColor(j ? JOB.get(j)?.group ?? '' : '');
    const renderTop = () => {
      top.innerHTML = '';
      const box = (k: 0 | 1) => {
        const j = sel[k];
        const d = h('div', { class: `sp-box ${j ? 'on' : ''}`, style: j ? `background:${color(j)}` : '' });
        if (j) d.append(h('img', { src: this.scene.clonePortrait(j, false, 72) }));
        d.addEventListener('click', () => { if (sel[k]) { sel[k] = null; render(); } });
        return d;
      };
      const c = g.combo(sel[0], sel[1]);
      const vial = h('button', { class: 'sp-vial', 'data-k': 'splice-go' }, h('img', { src: `assets/ui/${COMBO_IMG[c.kind]}.png` })) as HTMLButtonElement;
      vial.disabled = c.kind === 'none';
      handlersSet('splice-go', () => {
        if (this.act(g.startSplice(slotIdx, sel[0]!, sel[1]!, nowSec()))) { sfx('extra_05'); this.openArrivalCenter(); }
      });
      top.append(box(0), vial, box(1));
      info.innerHTML = '';
      const text = c.kind === 'none' ? (sel[0] && sel[1] ? 'NO GENETIC MATCH' : '')
        : c.kind === 'old' ? `KNOWN: ${jobDisplay(c.job!).toUpperCase()}` : 'NEW GENETIC MATCH FOUND!';
      if (c.landRequired) info.append(h('div', { class: 'land' }, `LAND REQUIRED: ${c.landRequired}`));
      if (text) info.append(h('div', {}, text));
      if (c.kind !== 'none') info.append(h('div', { class: 'time' }, `TAP THE VIAL TO SPLICE (${fmtTime(g.splicingDuration())})`));
      info.append(h('div', { class: 'sp-title' }, 'SELECT GENETIC MATERIAL'));
    };
    const renderCol = (k: 0 | 1) => {
      const col = cols[k];
      col.innerHTML = '';
      const list = h('div', { class: 'sp-list' });
      const grp = open[k];
      if (!grp) {
        // groups that still hold something to discover go first, faded ones last; alphabetical within each part
        const live = (jobs: string[]) => jobs.some((j) => fresh.get(j));
        const sorted = [...groups.entries()].sort(([a, ja], [b, jb]) => Number(live(jb)) - Number(live(ja)) || a.localeCompare(b));
        for (const [name, jobs] of sorted) {
          const b = h('button', { class: `sp-btn grp ${live(jobs) ? '' : 'dim'}`, style: `background:${groupColor(name)}`, 'data-grp': name }, name.toUpperCase());
          b.addEventListener('click', () => { sfx('tap_01'); open[k] = name; renderCol(k); });
          list.append(b);
        }
      } else {
        const back = h('button', { class: 'sp-btn back', style: `color:${groupColor(grp)}` }, 'BACK');
        back.addEventListener('click', () => { sfx('tap_01'); open[k] = null; renderCol(k); });
        if (!only[k]) list.append(back);
        const genes = [...(groups.get(grp) ?? [])]
          .sort((x, y) => Number(!!fresh.get(y)) - Number(!!fresh.get(x)) || jobDisplay(x).localeCompare(jobDisplay(y)));
        for (const j of genes) {
          const b = h('button', {
            class: `sp-btn gene ${fresh.get(j) ? '' : 'dim'} ${sel[k] === j ? 'on' : ''}`,
            style: `background:${groupColor(grp)}`, 'data-job': j,
          }, jobDisplay(j).toUpperCase()) as HTMLButtonElement;
          b.disabled = !!only[k] && only[k] !== j;
          b.addEventListener('click', () => {
            sfx('tap_01');
            sel[k] = j;
            if (tut) {
              let changed = false;
              if (sel.includes('Mayor')) changed = g.tut('pickMayor') || changed;
              if (sel.includes('Mechanic')) changed = g.tut('pickMechanic') || changed;
              if (changed) this.onChange();
            }
            render();
          });
          list.append(b);
        }
      }
      col.append(list);
    };
    const render = () => { renderTop(); renderCol(0); renderCol(1); };
    body.append(this.backButton(() => this.openArrivalCenter()), top, info, h('div', { class: 'sp-cols' }, ...cols),
      h('div', { class: 'hint' }, 'TIP: TRY SPLICING TWO OF THE SAME TYPE OF GENE'));
    this.open('SPLICER', body, undefined, 'splicer');
    render();
  }

  /** Card of packet type 0 (new job discovered). Closing it consumes the packet. */
  showDiscovery(job: string) {
    const wp = JOB.get(job)!.workplaces[0];
    const body = h('div', { class: 'card2' }, this.jobCard(job, (STRINGS.Card_JobFound ?? 'GENETIC MATCH FOUND').toUpperCase(), '#1ec88c'));
    let placeAfter = false;
    const tut = this.game.tutorialActive();
    this.game.tut('card');
    const done = () => {
      this.game.closePacket();
      this.game.tut('closeCard');
      this.onChange();
      if (placeAfter && !tut) this.startBuild(wp); // in the tutorial, step 16 starts it on the flashing square
    };
    if (wp && this.s.pendingWorkplaces.includes(wp)) {
      body.append(h('div', { class: 'cnote' }, `FREE ${displayName(wp).toUpperCase()}! IT ONLY NEEDS ${WORKPLACE.get(wp)?.size ?? 1} LAND.`));
      body.append(btn('PLACE IT NOW', 'b-green', () => { placeAfter = true; this.close(); }, false, 'disc-place'));
      if (!tut) body.append(btn('LATER', 'b-grey small', () => this.close()));
    } else {
      body.append(btn('OK', 'b-green', () => this.close()));
    }
    sfx('discovery_04');
    this.open('', body, undefined, 'card', done);
  }

  // ---------------------------------------------------------------- building popups
  openBuilding(id: string) {
    const g = this.game;
    const b = g.building(id);
    if (!b) return;
    if (b.type === 'SpacePort') return this.openArrivalCenter();
    if (b.type === POD && b.mission) return this.openMission(b.mission);
    const kind = kindOf(b.type);
    if (kind === 'wonder' && g.state.missions.wonder?.id === b.type) return this.openMission(b.type);
    if (b.buildEnd >= 0 && g.tut('openSite')) this.onChange();
    if (b.buildEnd < 0 && kind === 'workplace') return this.c.openWorkplace(id);
    if (b.buildEnd < 0 && kind === 'residence') return this.c.openResidence(id);
    const body = h('div', { class: 'bldg' });
    const refresh = () => {
      const now = nowSec();
      body.innerHTML = '';
      const b2 = g.building(id);
      if (!b2) { this.close(); return; }
      body.append(h('img', { class: 'wp', src: this.scene.workplaceThumb(b2.type, 120) }));
      if (b2.buildEnd >= 0) {
        const left = b2.buildEnd - now;
        body.append(h('b', {}, 'UNDER CONSTRUCTION'), h('div', {}, `TIME LEFT ${fmtTime(left)}`),
          this.progress(1 - left / Math.max(1, b2.buildEnd - b2.buildStart)));
        body.append(btn(`RUSH ${constructionRushCost(left)}u`, 'b-pink', () => { if (this.act(g.rushConstruction(id, nowSec()))) sfx('Construction_sound'); }, false, 'bld-rush'));
        const free = this.freeButton(this.s.freeBuildReadyAt, () => this.act(g.freeConstruction(id, nowSec())));
        body.append(free, h('div', { class: 'hint' }, left > 3599 ? 'FREE: REDUCES TIME BY 1H (ONCE EVERY 24H)' : 'FREE: FINISHES NOW (ONCE EVERY 24H)'));
        return;
      }
      if (kind === 'workplace') {
        const w = WORKPLACE.get(b2.type)!;
        const workers = g.workers(b2);
        const W = g.buildingWorkingTime(b2);
        body.append(h('div', {}, `LEVEL ${b2.level} · ${g.buildingCps(b2)} COINS/SEC · SHIFT ${fmtTime(W)}`));
        if (b2.shiftStart >= 0) {
          const left = b2.shiftStart + W - now;
          body.append(h('b', { class: 'ok' }, 'WORKING'), h('div', {}, `SHIFT ENDS IN ${fmtTime(left)}`), this.progress(1 - left / Math.max(1, W)));
        } else if (workers.length) {
          body.append(h('b', { class: 'warn' }, 'IDLE'), btn('START WORKING', 'b-green', () => { this.act(g.tapWorkplace(id, nowSec())); }));
        } else {
          body.append(h('b', { class: 'warn' }, 'NO WORKERS YET'));
        }
        const sp = this.specialButtons(b2.type, id);
        this.x.specialButtons(b2.type, sp);
        body.append(sp);
        const skins = this.x.skinRow(b2);
        if (skins) body.append(skins);
        const tools = h('div', { class: 'row' });
        if (g.featureUnlocked(F.UPGRADE) && b2.type !== 'SpacePort') {
          tools.append(b2.level > 5 ? btn('MAX LEVEL', 'b-grey small', () => {}, true)
            : btn(`UPGRADE ${g.upgradeCost(b2)}u`, 'b-pink small', () => { if (this.act(g.upgradeWorkplace(id))) sfx('correct_03'); }, false, `up${id}`));
        }
        if (g.canDuplicate(b2.type)) tools.append(btn(`DUPLICATE ${DUPLICATE_UTOPIUM}u`, 'b-orange small', () => this.startBuild(b2.type), false, `dup${id}`));
        if (tools.childNodes.length) body.append(tools);
        const hotel = g.featureUnlocked(F.HOTEL) && this.s.buildings.some((x) => x.type === 'Hotel' && g.isBuilt(x));
        const list = h('div', { class: 'jobs' });
        for (const j of w.jobs) {
          const p = workers.find((x) => x.job === j);
          const known = this.s.unlockedJobs.includes(j);
          const cell = h('div', { class: `job ${p ? 'on' : ''}` },
            h('img', { src: p ? this.scene.clonePortrait(j, p.female) : 'assets/ui/status_lock.png' }),
            h('span', {}, known || this.s.revealed.includes(j) ? jobDisplay(j).toUpperCase() : '???'),
            h('small', {}, p ? (p.female ? JOB.get(j)!.femaleName : JOB.get(j)!.maleName).toUpperCase() : 'VACANT'));
          if (p && hotel) cell.append(btn('VACATION 1u', 'b-grey small', () => this.act(g.hotelCheckIn(p.id)), false, `vac${p.id}`));
          if (p) { const m = this.x.mothershipBtn(p.id); if (m) cell.append(m); }
          if (!p && !known) { const r = this.x.revealBtn(j); if (r) cell.append(r); }
          list.append(cell);
        }
        body.append(list);
      } else if (kind === 'residence') {
        const res = g.residents(b2);
        const cap = RESIDENCES.find((r) => r.name === b2.type)!.population;
        body.append(h('div', {}, `RESIDENTS ${res.length}/${cap}`));
        const paint = this.x.paintRow(b2);
        if (paint) body.append(paint);
        const list = h('div', { class: 'jobs' });
        for (const p of res) {
          const cell = h('div', { class: 'job on' }, h('img', { src: this.scene.clonePortrait(p.job, p.female) }), h('span', {}, p.job ? jobDisplay(p.job).toUpperCase() : 'CLONE'));
          const m = this.x.mothershipBtn(p.id);
          if (m) cell.append(m);
          list.append(cell);
        }
        body.append(list);
      } else if (kind === 'decor') {
        const d = DECOR.find((x) => x.name === b2.type)!;
        body.append(h('div', {}, `+${d.spirit} CIVIC SPIRIT`));
      } else if (kind === 'tree') {
        const local = g.local(now);
        body.append(h('div', {}, `TOTAL TREES: ${g.trees().length}`),
          h('div', {}, `TODAY'S UTOPIUM HARVEST: ${this.s.treeUtopiumToday}/${g.treeDailyUtopium(local)}`),
          h('div', {}, `HARVEST RESETS IN: ${fmtTime(timeTillNoon(local))}`),
          h('div', { class: 'hint' }, b2.treeReady ? 'THIS TREE HAS A REWARD: TAP IT ON THE MAP!' : 'ONE TREE AT A TIME SHOWS A REWARD.'));
      } else if (kind === 'wonder') {
        const w = wonderOf(b2.type);
        body.append(h('div', {}, `${(STRINGS[`${w.key}_DisplayName`] ?? w.key).toUpperCase()} · PART ${w.part}`),
          h('div', { class: 'hint' }, g.missions.wonderPartDone(b2.type) ? 'COMPLETE' : 'IN PROGRESS'));
      }
    };
    // the original popup's bottom bar: DELETE · MOVE (plus FLIP and STORE from edit mode)
    let sure = false;
    const withTools = () => {
      refresh();
      const b2 = g.building(id);
      if (!b2 || g.tutorialActive() || !this.panel) return;
      const blocker = g.removeBlocker(b2);
      const bar = h('div', { class: 'row popup-tools' });
      bar.append(
        btn(sure ? 'SURE?' : 'DELETE', 'b-pink small', () => {
          if (!sure) { sure = true; withTools(); return; }
          sure = false;
          if (this.act(g.deleteBuilding(id))) { sfx('Construction_sound'); this.close(); }
        }, !!blocker, `pt-del${id}`),
        btn('MOVE', 'b-green small', () => this.startMove(id), false, `pt-move${id}`));
      if (g.featureUnlocked(F.FLIP)) bar.append(btn('FLIP', 'b-orange small', () => this.act(g.flipBuilding(id)), false, `pt-flip${id}`));
      if (g.isBuilt(b2)) bar.append(btn('STORE', 'b-grey small', () => { if (this.act(g.storeBuilding(id))) this.close(); }, !!blocker, `pt-store${id}`));
      body.append(bar);
      if (blocker) body.append(h('div', { class: 'hint' }, blocker));
    };
    this.open(displayName(b.type).toUpperCase(), body, withTools);
  }

  /** MOVE from a building popup: tap the new spot (edit mode underneath, closed again once it moved). */
  startMove(id: string) {
    const b = this.game.building(id);
    if (!b) return;
    this.startEdit();
    this.editTap(id);
    this.moveFromPopup = true;
    this.beginMove(b);
  }

  private beginMove(b: { id: string; type: string; flip: boolean }) {
    this.buildType = b.type;
    this.placeMode = { kind: 'move', id: b.id };
    this.scene.setBuildMode(b.type, b.flip, b.id);
    const small = $('#buildbar').querySelector('small');
    if (small) small.textContent = 'TAP THE NEW SPOT';
  }

  /** Special buttons of a building, including the milestone 3 ones (shown under the popup's header text). */
  specialRow(type: string, id: string): HTMLElement {
    const sp = this.specialButtons(type, id);
    this.x.specialButtons(type, sp);
    return sp;
  }

  /** The special-function button of each special building (03 §3.2). */
  private specialButtons(type: string, id: string): HTMLElement {
    const g = this.game, s = this.s;
    const row = h('div', { class: 'row special' });
    const now = () => nowSec();
    const until = () => fmtTime(timeTillNoon(g.local(now())));
    switch (type) {
      case 'Utopium Mine':
        row.append(s.dailyUtopium
          ? btn('COLLECT UTOPIUM', 'b-special', () => { if (this.act(g.collectMine())) sfx('discovery_04'); }, false, 'mine')
          : btn(`READY IN ${until()}`, 'b-grey small', () => {}, true));
        row.append(h('div', { class: 'hint' }, 'MINES 1-2 UTOPIUM EVERY DAY AT 12:00'));
        break;
      case 'Animal Shelter':
        row.append(s.dailyAnimal
          ? btn('ADOPT AN ANIMAL', 'b-special', () => { this.act(g.collectShelter(now())); this.close(); }, false, 'shelter')
          : btn(`READY IN ${until()}`, 'b-grey small', () => {}, true));
        break;
      case 'Financial Center':
        row.append(btn('RESTART ALL 1u', 'b-special', () => { if (this.act(g.businessCenterBoost(now()))) sfx('recharge_10'); }, false, 'bizc'));
        row.append(h('div', { class: 'hint' }, `MAX CPS ${fmtNum(g.maxCps())}`));
        break;
      case 'Law Firm':
        row.append(btn(`LEVEL UP ${LAW_FIRM_UTOPIUM}u`, 'b-special', () => { if (this.act(g.expandWithUtopium())) this.close(); }, false, 'law'));
        break;
      case 'Enterprise':
        row.append(s.doubleHours ? h('b', { class: 'ok' }, 'DOUBLE HOURS ACTIVE')
          : btn(`DOUBLE HOURS ${ENTERPRISE_UTOPIUM}u`, 'b-special', () => this.act(g.buyDoubleHours(now())), false, 'ent'));
        break;
      case 'Pet Store':
        row.append(btn(`9 ANIMALS ${PET_STORE_UTOPIUM}u`, 'b-special', () => { if (this.act(g.buyNineAnimals(now()))) this.close(); }, false, 'pet'));
        break;
      case 'Research Facility':
        row.append(g.researchCost() ? btn(`RESEARCH ${g.researchCost()}u`, 'b-special', () => this.act(g.researchUpgrade()), false, 'lab')
          : h('b', {}, 'RESEARCH COMPLETE'), h('div', { class: 'hint' }, `LEVEL ${s.researchLevel}: +1 SPIRIT LIMIT AND +1 HEART PER LEVEL`));
        break;
      case 'Hotel':
        row.append(btn('ENTER', 'b-special', () => this.openHotel(), false, 'hotel'));
        break;
      case 'MissionControl':
        row.append(btn('MISSIONS', 'b-special', () => this.openMissions(), false, 'hq'));
        break;
    }
    return row;
  }

  openHotel() {
    const g = this.game;
    const body = h('div', { class: 'bldg' });
    const refresh = () => {
      body.innerHTML = '';
      body.append(h('div', {}, `GUEST LIST ${this.s.hotel.length}/${HOTEL_ROOMS}`),
        h('div', { class: 'hint' }, 'A VACATION REMOVES CLONES FROM THEIR RESIDENCE AND WORKPLACE. CHECK-OUT NEEDS A VACANT BED.'));
      const list = h('div', { class: 'jobs' });
      for (const pid of this.s.hotel) {
        const p = g.peep(pid);
        if (!p) continue;
        list.append(h('div', { class: 'job on' }, h('img', { src: this.scene.clonePortrait(p.job, p.female) }),
          h('span', {}, jobDisplay(p.job ?? '').toUpperCase()),
          btn('CHECK OUT', 'b-green small', () => this.act(g.hotelCheckOut(pid)), false, `co${pid}`)));
      }
      body.append(list);
    };
    this.open('HOTEL UTOPIA', body, refresh);
  }

  // ---------------------------------------------------------------- hearts
  /** A heart over a house was tapped: after the First Wonder it is collected at once, otherwise the house opens to HOLD it. */
  tapHeartOn(id: string) {
    const g = this.game;
    if (!g.instantHearts()) { this.openBuilding(id); return; }
    if (this.act(g.collectHeart(nowSec()))) sfx('recharge_10');
  }

  /** Gallery: a discovered job's card; closing it goes back to the gallery page. */
  showJobCard(job: string, back: () => void) {
    const body = h('div', { class: 'card2' }, this.jobCard(job, (STRINGS.Gallery_Title ?? 'GALLERY').toUpperCase(), groupColor(JOB.get(job)?.group ?? '')));
    body.append(btn('OK', 'b-green', () => this.close(), false, 'card-ok'));
    this.open('', body, undefined, 'card', back);
  }

  showAnimalCard(name: string, back: () => void) {
    const body = h('div', { class: 'card2' }, this.animalCard(name, (STRINGS.Gallery_Title ?? 'GALLERY').toUpperCase()));
    body.append(btn('OK', 'b-green', () => this.close(), false, 'card-ok'));
    this.open('', body, undefined, 'card', back);
  }

  // ---------------------------------------------------------------- missions (04 §1)
  private reqCell(a: ActiveMission, i: number): HTMLElement {
    const g = this.game;
    const r = a.reqs[i];
    const p = parseReq(r.code);
    const met = g.missions.reqMet(a, i);
    const cell = h('div', { class: `req ${met ? 'met' : ''}` });
    const label = (t: string) => h('small', {}, t);
    switch (p.kind) {
      case 'NONE': cell.append(h('img', { src: 'assets/ui/norequirement.png' }), label('—')); break;
      case 'M': cell.append(h('img', { src: 'assets/ui/Coin.png' }), label(fmtShort(g.coinScaledToCity(p.n, MISSION_COIN_FLOOR)))); break;
      case 'U': cell.append(h('img', { src: 'assets/ui/Utopium.png' }), label(`${p.n}u`)); break;
      case 'Chr': cell.append(h('img', { src: 'assets/ui/Chroma.png' }), label(`${p.n}`)); break;
      case 'J': {
        const job = p.n === 0 ? null : JOB_BY_ID.get(p.n)?.name ?? null;
        const peep = r.acq ? g.peep(r.acq) : undefined;
        cell.append(h('img', { src: peep ? this.scene.clonePortrait(peep.job, peep.female) : job ? this.scene.clonePortrait(job, false) : 'assets/ui/WaitingClone.png', class: peep ? '' : 'dim' }),
          label(job ? jobDisplay(job).toUpperCase() : 'ANY JOB'));
        break;
      }
      case 'A': case 'C': case 'T': {
        const what = p.kind === 'A' ? p.value : p.kind === 'C' ? p.value : p.n ? `TIER ${p.n}` : 'ANY';
        cell.append(r.acq ? this.animalImg(r.acq, 40) : p.kind === 'A' ? this.animalImg(p.value, 40) : h('img', { src: 'assets/ui/AnimalSilhouette.png', class: 'dim' }),
          label((r.acq ?? what).toUpperCase()));
        cell.classList.add('pick');
        cell.addEventListener('click', () => { sfx('tap_01'); this.chooseAnimal(a.id, i); });
        break;
      }
      case 'BaseCPS': cell.append(h('b', {}, 'CPS'), label(`${fmtNum(g.maxCps())}/${fmtNum(a.targetCps)}`)); break;
      case 'BaseLand': cell.append(h('b', {}, 'LAND'), label(`${this.s.landUsed}/${a.targetLand}`)); break;
    }
    return cell;
  }

  private rewardText(code: string): string {
    const r = parseReward(code);
    switch (r.kind) {
      case 'C': return `${fmtShort(this.game.coinScaledToCity(r.n, MISSION_COIN_FLOOR))} COINS`;
      case 'U': return `${r.n} UTOPIUM`;
      case 'Chr': return `${r.n} CHROMA`;
      case 'SP': return `SPECIAL: ${jobDisplay(r.value).toUpperCase()}`;
      case 'BLD': return displayName(r.value).toUpperCase();
      case 'CB': return 'NEW COMBOS!';
      case 'A': return '9 ANIMALS PACK!';
      case 'W': return 'WONDER PART';
      default: return '-';
    }
  }

  openMissions() {
    const g = this.game;
    const body = h('div', { class: 'missions' });
    const refresh = () => {
      body.innerHTML = '';
      const st = this.s.missions;
      if (!g.missions.unlocked()) { body.append(h('div', {}, 'BUILD UTOPIA HQ TO UNLOCK MISSIONS')); return; }
      body.append(h('div', { class: 'hint' }, `DAILY MISSION REFRESHES: ${Math.max(0, 4 - st.refreshesUsed)} · RESET IN ${fmtTime(timeTillNoon(g.local(nowSec())))}`));
      const row = (a: ActiveMission | null, type: number, key: string) => {
        const md = a ? MISSION.get(a.id)! : null;
        const el = h('div', { class: `mrow t${type} ${a && g.missions.canComplete(a) ? 'ready' : ''}` });
        if (!a || !md) {
          el.append(h('div', { class: 'mtype' }, TYPE_NAME[type]), h('div', { class: 'mname' }, 'NO MISSION'), h('div', { class: 'hint' }, 'SPLICE MORE JOBS TO UNLOCK MORE MISSIONS'));
        } else {
          const done = a.reqs.filter((_, i) => g.missions.reqMet(a, i)).length;
          el.append(h('div', { class: 'mtype' }, TYPE_NAME[type]), h('div', { class: 'mname' }, md.name.toUpperCase()),
            h('div', { class: 'mrew' }, `REWARD: ${this.rewardText(md.reward)}`), h('div', { class: 'mprog' }, `${done}/9`));
          el.dataset.k = key;
          el.addEventListener('click', () => { sfx('tap_01'); this.openMission(a.id); });
        }
        body.append(el);
      };
      if (st.wonder) row(st.wonder, 5, 'w');
      st.slots.forEach((a, i) => row(a, MISSION_SLOT_TYPES[i], `m${i}`));
    };
    this.open('UTOPIA HQ', body, refresh, 'wide');
  }

  openMission(id: string) {
    const g = this.game;
    const body = h('div', { class: 'mission' });
    const refresh = () => {
      const a = g.missions.find(id);
      if (!a) { this.openMissions(); return; }
      const md = MISSION.get(id)!;
      body.innerHTML = '';
      body.append(h('div', { class: 'mtype' }, TYPE_NAME[md.type]), h('div', { class: 'jobname' }, md.name.toUpperCase()));
      if (md.desc) body.append(h('div', { class: 'quote' }, md.desc));
      body.append(h('div', { class: 'mrew' }, 'REWARD: ', this.rewardText(md.reward)));
      const grid = h('div', { class: 'reqs' });
      a.reqs.forEach((_, i) => grid.append(this.reqCell(a, i)));
      body.append(grid);
      const host = g.missions.hostOf(a);
      const need = g.missions.clonesNeeded(a);
      const row = h('div', { class: 'row' });
      if (md.type === 5 && !host) {
        row.append(btn('SEND VESSEL', 'b-orange small', () => { this.close(); this.startSpecialPlace(id, { kind: 'wonder' }); }, false, 'vessel'));
      } else if (md.type !== 5 && need && !host) {
        row.append(btn('BUILD MISSION POD', 'b-orange small', () => { this.close(); this.startSpecialPlace(POD, { kind: 'pod', mission: id }); }, false, 'pod'));
      }
      if (a.reqs.some((r) => ['A', 'C', 'T'].includes(parseReq(r.code).kind) && !r.acq)) {
        row.append(btn('AUTO-FILL ANIMALS', 'b-grey small', () => { const n = g.missions.autoAssignAnimals(id); this.toast(n ? `${n} ANIMALS ASSIGNED` : 'NO MATCHING ANIMALS', !n); this.onChange(); }, false, 'auto'));
      }
      row.append(btn('COMPLETE', 'b-green', () => {
        const r = g.missions.complete(id, g.local(nowSec()));
        if (this.act(r)) { sfx('discovery_04'); this.close(); }
      }, !g.missions.canComplete(a), 'complete'));
      if (md.type !== 5) {
        row.append(btn(g.missions.hasRefreshes() ? 'REFRESH MISSION' : 'REFRESH 1u', 'b-pink small', () => {
          if (!g.missions.hasRefreshes()) {
            if (window.confirm('NO MISSION REFRESHES LEFT. SPEND 1 UTOPIUM TO REFRESH?')) this.act(g.missions.replenish());
            return;
          }
          const r = g.missions.skip(id, g.local(nowSec()));
          if (this.act(r)) this.openMissions();
        }, false, 'skip'));
      }
      body.append(row);
      if (need) body.append(h('div', { class: 'hint' }, md.type === 5
        ? 'SEND THE VESSEL, THEN SPLICE THE REQUIRED JOBS AND SEND THEM FROM THE ARRIVAL CENTER.'
        : 'MISSION CLONES RESIDE IN MISSION PODS AND DO NOT REQUIRE HOUSING. SEND SPLICED CLONES FROM THE ARRIVAL CENTER. CLONES ARE NOT REFUNDED IF THE MISSION IS REFRESHED.'));
    };
    this.open(md0Title(id), body, refresh, 'wide');
  }

  private chooseAnimal(id: string, index: number) {
    const g = this.game;
    const a = g.missions.find(id);
    if (!a) return;
    const code = a.reqs[index].code;
    const body = h('div', { class: 'animals' });
    const owned = Object.keys(this.s.animals).filter((n) => this.s.animals[n] > 0 && g.missions.animalFits(code, n));
    if (!owned.length) body.append(h('div', {}, 'YOU HAVE NO MATCHING ANIMAL. HEARTS, THE ANIMAL SHELTER, GIFTS AND THE PET STORE GIVE ANIMALS.'));
    const grid = h('div', { class: 'agrid' });
    for (const n of owned) {
      const cell = h('div', { class: 'acell' }, this.animalImg(n, 44), h('small', {}, `${n.toUpperCase()} x${this.s.animals[n]}`));
      cell.addEventListener('click', () => { sfx('tap_01'); g.missions.assignAnimal(id, index, n); this.onChange(); this.openMission(id); });
      grid.append(cell);
    }
    body.append(grid, btn('BACK', 'b-grey small', () => this.openMission(id)));
    this.open('CHOOSE AN ANIMAL', body, undefined, 'wide');
  }

  // ---------------------------------------------------------------- calendar + animals
  openAnimals() { this.c.openGallery('animals'); }

  // ---------------------------------------------------------------- land menu and build menus (4.20 layout)
  /** The free cell the player tapped; BUILD from the land menu places the item right there. */
  private buildCell: [number, number] | null = null;

  /** The scene reports a tap on a cell with no building: open the land menu when the spot is free and in reach. */
  tapLand(i: number, j: number) {
    const g = this.game;
    if (this.editing || this.buildType || this.panel || g.tutorialActive()) return;
    if (g.occupied().has(`${i},${j}`) || (g.reachRule && !g.inReach(i, j))) return;
    sfx('tap_01');
    this.openLandMenu([i, j]);
  }

  /** Tap on a free spot of the grid: LAND USAGE with BUILD / EXPAND / LANDSCAPE. */
  openLandMenu(cell: [number, number] | null) {
    this.buildCell = cell;
    const s = this.s;
    const body = h('div', { class: 'm2 landmenu' });
    body.append(h('div', { class: 'm2head' }, 'LAND USAGE:', h('br'), `${s.landUsed}/${s.landLimit}`),
      h('img', { class: 'landart', src: 'assets/ui/LandscapeMenuIcon.png' }),
      btn('BUILD', 'b-orange big', () => this.openBuildCats(), false, 'lm-build'),
      btn('EXPAND', 'b-yellow big', () => this.openExpand(), false, 'lm-expand'),
      btn('LANDSCAPE', 'b-green big', () => this.openLandscapeCats(), false, 'lm-land'));
    this.open('', body, undefined, 'm-olive');
  }

  /** Coloured list buttons, as in the 4.20 build menus. */
  private menuList(title: string, rows: { label: string; color: string; dim?: boolean; onClick: () => void }[],
    back: (() => void) | null, cls = 'm-olive') {
    const body = h('div', { class: 'm2' });
    body.append(h('div', { class: 'm2head' }, title));
    if (back) body.append(this.backButton(back));
    const list = h('div', { class: 'm2list' });
    for (const r of rows) {
      const b = h('button', { class: `m2btn ${r.dim ? 'dim' : ''}`, style: `--c:${r.color}` }, r.label);
      b.addEventListener('click', () => { sfx('tap_01'); r.onClick(); });
      list.append(b);
    }
    if (!rows.length) list.append(h('div', { class: 'hint' }, 'NOTHING HERE YET'));
    body.append(list);
    this.open('', body, undefined, cls);
  }

  private backButton(onBack: () => void): HTMLElement {
    const b = h('button', { class: 'backbtn', title: 'Back' });
    b.addEventListener('click', () => { sfx('tap_01'); onBack(); });
    return b;
  }

  /** BUILD: residential, the workplace categories once the Building Firm allows duplicates, and storage. */
  openBuildCats() {
    const g = this.game;
    const rows = [{ label: STRINGS.BuildMenu_Category_0 ?? 'RESIDENTIAL', color: CAT_COLORS.RESIDENTIAL, onClick: () => this.openItems('res') }];
    if (g.featureUnlocked(F.DUPLICATE)) {
      for (let k = 1; k <= 7; k++) {
        const cat = STRINGS[`BuildMenu_Category_${k}`];
        if (!cat || !this.buildItems(`wp:${cat}`).length) continue;
        rows.push({ label: cat, color: CAT_COLORS[cat] ?? '#5a4a8a', onClick: () => this.openItems(`wp:${cat}`) });
      }
    }
    if (this.s.inventory.length) rows.push({ label: 'STORAGE', color: CAT_COLORS.STORAGE, onClick: () => this.openStorage() });
    this.menuList('BUILDINGS', rows, () => this.openLandMenu(this.buildCell));
  }

  /** LANDSCAPE: trees, decor (by category) and paths, each behind its unlocking building. */
  openLandscapeCats() {
    const g = this.game;
    const lock = (f: number, msg: string, open: () => void) => () => (g.featureUnlocked(f) ? open() : this.toast(msg, true));
    this.menuList('LANDSCAPE', [
      { label: STRINGS.Landscape_Category_0 ?? 'TREE', color: CAT_COLORS.TREE, dim: !g.featureUnlocked(F.TREES),
        onClick: lock(F.TREES, 'BUILD A NURSERY TO UNLOCK TREES', () => this.openItems('tree')) },
      { label: STRINGS.Landscape_Category_1 ?? 'DECOR', color: CAT_COLORS.DECOR, dim: !g.featureUnlocked(F.DECOR),
        onClick: lock(F.DECOR, 'BUILD A PARK TO UNLOCK DECOR', () => this.openDecorCats()) },
      { label: STRINGS.Landscape_Category_2 ?? 'PATH', color: CAT_COLORS.PATH, onClick: () => this.openItems('path') },
    ], () => this.openLandMenu(this.buildCell));
  }

  private openDecorCats() {
    const cats = [...new Set(this.buildItems('decor').map((it) => it.group!))];
    this.menuList('DECOR', cats.map((c) => ({
      label: (STRINGS[`Landscape_Category_${c}`] ?? c).toUpperCase(), color: CAT_COLORS.DECOR, onClick: () => this.openItems(`decor:${c}`),
    })), () => this.openLandscapeCats());
  }

  private openStorage() {
    this.menuList('STORAGE', this.s.inventory.map((it, i) => ({
      label: displayName(it.type), color: CAT_COLORS.STORAGE, onClick: () => { this.close(); this.startInventoryPlace(i); },
    })), () => this.openBuildCats());
  }

  /** Items of a build list: 'res', 'wp:<CATEGORY>', 'decor', 'decor:<category>', 'path' or 'tree'. */
  private buildItems(t: string): { type: string; cost: Cost; group?: string }[] {
    const g = this.game;
    const items: { type: string; cost: Cost; group?: string }[] = [];
    if (t === 'res') {
      for (const r of RESIDENCES) {
        if (!this.scene.hasFrame(r.name)) continue;
        if (/^iap|^AGResidence|^Special/.test(r.name) && !(PACK_ITEM.has(r.name) && g.shop.packUnlocked(r.name))) continue;
        if (!r.cost.coins && !r.cost.utopium && !r.cost.chroma) continue;
        items.push({ type: r.name, cost: r.cost });
      }
    } else if (t.startsWith('wp:')) {
      const cat = t.slice(3);
      for (const w of WORKPLACES) {
        if (w.category === cat && g.canDuplicate(w.name) && this.scene.hasFrame(w.name)) items.push({ type: w.name, cost: g.placementCost(w.name)! });
      }
    } else if (t.startsWith('decor')) {
      const cats = ['Basic', 'Inspiring', 'Spectacular', 'Magnificent', 'Chroma (Normal)'];
      for (const d of DECOR) {
        const pack = PACK_ITEM.has(d.name);
        if ((pack ? !g.shop.packUnlocked(d.name) : !cats.includes(d.category)) || !d.cost || !this.scene.hasFrame(d.name)) continue;
        const group = pack ? 'Special' : d.category.replace(' (Normal)', '');
        if (t.includes(':') && t.slice(6) !== group) continue;
        items.push({ type: d.name, cost: d.cost, group });
      }
    } else if (t === 'path') {
      for (const p of PATHS) if (p.cost && this.scene.hasFrame(p.name) && g.typeUnlocked(p.name)) items.push({ type: p.name, cost: p.cost });
    } else if (t === 'tree') {
      for (const tr of TREES) {
        const pack = PACK_ITEM.has(tr.name) && g.shop.packUnlocked(tr.name);
        if (tr.cost && (/^Tree\d+$/.test(tr.name) || pack) && this.scene.hasFrame(tr.name)) items.push({ type: tr.name, cost: tr.cost });
      }
    }
    return items;
  }

  /** A list of item names; tapping one opens its card. Kept for callers that ask for a tab (Arrival Center: 'res'). */
  openBuildMenu(tab: 'res' | 'decor' | 'path' | 'tree' | 'store' = 'res') {
    this.buildCell = null;
    if (tab === 'store') this.openStorage(); else this.openItems(tab);
  }

  private openItems(t: string) {
    const g = this.game;
    const color = t === 'res' ? CAT_COLORS.RESIDENTIAL : t.startsWith('wp:') ? CAT_COLORS[t.slice(3)] ?? '#5a4a8a'
      : t.startsWith('decor') ? CAT_COLORS.DECOR : t === 'path' ? CAT_COLORS.PATH : CAT_COLORS.TREE;
    const title = t === 'res' || t.startsWith('wp:') ? 'BUILDINGS' : t.startsWith('decor') ? 'DECOR' : t === 'path' ? 'PATH' : 'TREE';
    const back = t === 'res' || t.startsWith('wp:') ? () => this.openBuildCats()
      : t.startsWith('decor:') ? () => this.openDecorCats() : () => this.openLandscapeCats();
    this.menuList(title, this.buildItems(t).map((it) => ({
      label: displayName(it.type), color, dim: !g.canAfford(it.cost) || landUse(it.type) > g.freeLand(),
      onClick: () => this.openItemCard(it.type, it.cost, color, () => this.openItems(t)),
    })), back);
  }

  /** The item card: picture, description, build time, capacity, land cost, price and BUILD. */
  private openItemCard(type: string, cost: Cost, color: string, back: () => void) {
    const g = this.game;
    const kind = kindOf(type);
    const body = h('div', { class: 'm2 itemcard' });
    const head = kind === 'residence' ? (STRINGS.BuildMenu_Category_0 ?? 'RESIDENTIAL') : kind === 'workplace'
      ? WORKPLACE.get(type)?.category ?? 'BUILDING' : kind.toUpperCase();
    body.append(h('div', { class: 'm2head dim' }, head), this.backButton(back),
      h('img', { class: 'bigthumb', src: this.scene.workplaceThumb(type, 200) }),
      h('div', { class: 'iname' }, displayName(type).toUpperCase()));
    const desc = buildPreview(type);
    if (desc) body.append(h('div', { class: 'desc' }, desc));
    const stats = h('div', { class: 'stats' });
    if (kind === 'residence' || kind === 'workplace') stats.append(h('div', {}, `Build Time: ${fmtTime(g.buildTime(type))}`));
    if (kind === 'residence') stats.append(h('div', {}, `Capacity: ${RESIDENCE.get(type)?.population ?? 0}`));
    if (kind === 'decor') stats.append(h('div', {}, `Civic Spirit: +${DECOR.find((d) => d.name === type)?.spirit ?? 0}`));
    stats.append(h('div', {}, `Land Cost: ${landUse(type)}`));
    if (cost.utopium) stats.append(h('div', { class: 'price' }, `${cost.utopium}U`));
    if (cost.chroma) stats.append(h('div', { class: 'price' }, `${cost.chroma} CHROMA`));
    if (cost.coins || (!cost.utopium && !cost.chroma)) stats.append(h('div', { class: 'price' }, cost.coins ? `${fmtNum(cost.coins)} COINS` : 'FREE'));
    body.append(stats, btn('BUILD', 'b-orange big', () => this.buildHere(type), false, 'ic-build'));
    this.open('', body, undefined, 'm-card');
    (this.panel as HTMLElement).style.setProperty('--c', color);
  }

  /** BUILD on the item card: straight onto the tapped spot when it fits, otherwise pick a spot on the map. */
  private buildHere(type: string) {
    const g = this.game;
    const cell = this.buildCell;
    this.close();
    const k = kindOf(type);
    if (cell && g.canPlaceAt(type, cell[0], cell[1])) {
      const r = g.place(type, cell[0], cell[1], false, nowSec());
      if (!this.act(r)) return;
      sfx(k === 'path' ? 'tap_01' : 'Construction_sound');
      this.buildCell = null;
      // paths, trees and decor keep the placing mode so a row can be laid tap after tap
      if (k === 'path' || k === 'tree' || k === 'decor') this.startBuild(type);
      return;
    }
    this.startBuild(type);
  }

  private showBar(type: string, text: string, cost: HTMLElement | null) {
    const bar = $('#buildbar');
    bar.classList.remove('hidden');
    bar.innerHTML = '';
    bar.append(h('img', { src: this.scene.workplaceThumb(type, 40) }),
      h('div', { class: 'bname' }, `${displayName(type).toUpperCase()}`, h('br'), h('small', {}, text)),
      cost ?? '', btn('DONE', 'b-grey small', () => this.endBuild(), false, 'bar-done'));
  }

  startBuild(type: string) {
    this.close();
    if (this.editing) this.endEdit(false);
    this.buildType = type;
    this.placeMode = { kind: 'buy' };
    this.scene.setBuildMode(type);
    this.showBar(type, kindOf(type) === 'path' ? 'TAP SPOTS TO LAY PATHS' : 'TAP A FREE SPOT TO PLACE',
      costLine(this.game.placementCost(type), landUse(type)));
    this.update();
  }

  startInventoryPlace(index: number) {
    const it = this.s.inventory[index];
    if (!it) return;
    this.close();
    this.buildType = it.type;
    this.placeMode = { kind: 'inventory', index };
    this.scene.setBuildMode(it.type);
    this.showBar(it.type, 'FROM STORAGE: TAP A FREE SPOT', costLine({ coins: 0, utopium: 0, chroma: 0 }, landUse(it.type)));
    this.update();
  }

  private startSpecialPlace(type: string, mode: PlaceMode) {
    this.buildType = type;
    this.placeMode = mode;
    this.scene.setBuildMode(type);
    this.showBar(type, mode.kind === 'pod' ? 'TAP A FREE SPOT FOR THE MISSION POD' : 'TAP A FREE SPOT FOR THE WONDER', null);
    this.update();
  }

  endBuild() {
    this.buildType = null;
    this.scene.setBuildMode(null);
    $('#buildbar').classList.add('hidden');
    if (this.editing) this.renderEditBar();
    this.update();
  }

  /** Called by the scene when the player taps a cell in build mode. */
  place(type: string, i: number, j: number) {
    const g = this.game;
    const mode = this.placeMode;
    if (mode.kind === 'move') {
      if (this.act(g.moveBuilding(mode.id, i, j))) {
        sfx('Construction_sound');
        this.buildType = null;
        this.placeMode = { kind: 'buy' };
        this.scene.setBuildMode(null);
        if (this.moveFromPopup) this.endEdit(); else this.renderEditBar();
      }
      return;
    }
    if (mode.kind === 'inventory') {
      if (this.act(g.placeFromInventory(mode.index, i, j, false))) { sfx('Construction_sound'); this.endBuild(); }
      return;
    }
    if (mode.kind === 'pod') {
      if (this.act(g.placePod(mode.mission, i, j))) { sfx('Construction_sound'); this.endBuild(); this.openMission(mode.mission); }
      return;
    }
    if (mode.kind === 'wonder') {
      if (this.act(g.placeWonder(i, j))) { sfx('discovery_04'); this.endBuild(); }
      return;
    }
    if (g.tutorialActive() && (this.s.tutorial === 1 || this.s.tutorial === 16)) [i, j] = this.tutSpot(type); // beam it down on the square
    const r = g.place(type, i, j, false, nowSec());
    if (!this.act(r)) return;
    sfx(kindOf(type) === 'path' ? 'tap_01' : 'Construction_sound');
    const k = kindOf(type);
    if (k === 'workplace' || k === 'residence') { this.endBuild(); }
    else if (!g.canAfford(g.placementCost(type)!) || landUse(type) > g.freeLand()) this.endBuild();
  }

  // ---------------------------------------------------------------- edit mode (03 §1.5)
  startEdit() {
    this.close();
    if (this.buildType) this.endBuild();
    this.editing = true;
    this.editSel = null;
    this.renderEditBar();
    this.update();
  }

  endEdit(refresh = true) {
    this.editing = false;
    this.moveFromPopup = false;
    this.editSel = null;
    this.scene.select(null);
    this.buildType = null;
    this.scene.setBuildMode(null);
    $('#buildbar').classList.add('hidden');
    if (refresh) this.update();
  }

  /** In edit mode a tap selects a building instead of opening it. */
  editTap(id: string) {
    this.editSel = id;
    this.confirmDelete = false;
    this.scene.select(id);
    this.renderEditBar();
  }

  private renderEditBar() {
    const g = this.game;
    const bar = $('#buildbar');
    bar.classList.remove('hidden');
    bar.innerHTML = '';
    const b = this.editSel ? g.building(this.editSel) : undefined;
    if (!b) {
      bar.append(h('div', { class: 'bname' }, 'EDIT MODE', h('br'), h('small', {}, 'TAP A BUILDING TO MOVE, FLIP, STORE OR DELETE IT')),
        btn('DONE', 'b-grey small', () => this.endEdit(), false, 'edit-done'));
      return;
    }
    const doMove = () => this.beginMove(b);
    const blocker = g.removeBlocker(b);
    bar.append(h('img', { src: this.scene.workplaceThumb(b.type, 40) }),
      h('div', { class: 'bname' }, displayName(b.type).toUpperCase(), h('br'), h('small', {}, blocker ? blocker.replace('YOU CANNOT DELETE ', 'CANNOT REMOVE ') : 'NO REFUNDS ON DELETE')));
    const tools = h('div', { class: 'tools' });
    tools.append(btn('MOVE', 'b-green small', doMove, false, 'ed-move'),
      btn('FLIP', 'b-orange small', () => { if (this.act(g.flipBuilding(b.id))) this.renderEditBar(); }, !g.featureUnlocked(F.FLIP), 'ed-flip'),
      btn('STORE', 'b-grey small', () => { if (this.act(g.storeBuilding(b.id))) { this.editSel = null; this.scene.select(null); this.renderEditBar(); } }, !!blocker, 'ed-store'),
      btn(this.confirmDelete ? 'SURE?' : 'DELETE', 'b-pink small', () => {
        if (!this.confirmDelete) { this.confirmDelete = true; this.renderEditBar(); return; }
        this.confirmDelete = false;
        if (this.act(g.deleteBuilding(b.id))) { sfx('Construction_sound'); this.editSel = null; this.scene.select(null); this.renderEditBar(); }
      }, !!blocker, 'ed-del'),
      btn('DONE', 'b-grey small', () => this.endEdit(), false, 'edit-done'));
    bar.append(tools);
  }

  // ---------------------------------------------------------------- land
  openExpand() {
    const body = h('div', { class: 'm2 expand2' });
    const refresh = () => {
      const g = this.game;
      const row = landRow(LAND, this.s.level);
      const cost = g.landUpgradeCost();
      const quotes = Object.keys(STRINGS).filter((k) => k.startsWith('TerrainUpgrade_Quote')).sort();
      const quote = quotes.length ? STRINGS[quotes[this.s.level % quotes.length]] : '';
      const blocked = g.levelUpPending();
      body.innerHTML = '';
      body.append(
        h('div', { class: 'm2head' }, 'LAND USAGE:', h('br'), `${this.s.landUsed}/${this.s.landLimit}`),
        h('img', { class: 'landart', src: 'assets/ui/LandscapeMenuIcon.png' }),
        h('div', { class: 'lvl' }, `LEVEL${this.s.level + 1}`),
        h('div', { class: 'quote' }, `"${quote}"`),
        h('div', { class: 'rewards' }, 'REWARDS:', h('br'), `+${row.land} LAND, +${row.utopium} UTOPIUM`),
      );
      const yb = h('button', { class: 'xbtn yellow', 'data-k': 'expand' },
        h('span', { class: 'xl' }, 'EXPAND'), h('span', { class: 'xp' }, h('img', { src: 'assets/ui/Coin.png' }), fmtNum(cost)),
        h('span', { class: 'xd' }, `DISCOUNT: ${(g.discount() * 100).toFixed(2)}%`)) as HTMLButtonElement;
      yb.disabled = this.s.coins < cost || blocked;
      handlersSet('expand', () => { if (this.act(g.expandLand())) { sfx('discovery_04'); this.close(); } });
      body.append(yb);
      if (g.featureUnlocked(F.LAW_FIRM)) {
        const pb = h('button', { class: 'xbtn pink', 'data-k': 'expand-u' },
          h('span', { class: 'xl' }, 'EXPAND'), h('span', { class: 'xp' }, h('img', { src: 'assets/ui/Utopium.png' }), `${LAW_FIRM_UTOPIUM}`),
          h('span', { class: 'xd' }, 'LEGAL LOOPHOLE')) as HTMLButtonElement;
        pb.disabled = this.s.utopium < LAW_FIRM_UTOPIUM || blocked;
        handlersSet('expand-u', () => { if (this.act(g.expandWithUtopium())) { sfx('discovery_04'); this.close(); } });
        body.append(pb);
      }
      if (blocked) body.append(h('div', { class: 'hint lt' }, 'LEVEL UP FIRST'));
    };
    this.open('', body, refresh, 'm-olive');
  }


}

/** "<Name>_BuildPreview" from text_english (the key's case differs for some buildings). */
function buildPreview(type: string): string {
  const k = `${type}_BuildPreview`.toLowerCase();
  for (const [key, v] of Object.entries(STRINGS)) if (key.toLowerCase() === k) return v;
  return '';
}

function md0Title(id: string): string {
  const md = MISSION.get(id);
  return md?.type === 5 ? 'WONDER' : 'MISSION';
}


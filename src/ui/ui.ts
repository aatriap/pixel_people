// HTML overlay: HUD, menus and popups. Uses the game's UI sprites and the 04b03 font.
import {
  Game, ComboKind, FREE_COOLDOWN, F, HEART_MAX, HEART_PUMPS, HOTEL_ROOMS, DUPLICATE_UTOPIUM, LAW_FIRM_UTOPIUM,
  ENTERPRISE_UTOPIUM, PET_STORE_UTOPIUM,
} from '../logic/game';
import {
  ANIMAL, DECOR, JOB, JOB_BY_ID, MISSION, PATHS, RESIDENCES, STRINGS, TREES, WORKPLACE, Cost, POD,
  displayName, jobDisplay, kindOf, landUse,
} from '../logic/data';
import { constructionRushCost, landRow, timeTillNoon, timeRushCost } from '../logic/formulas';
import { LAND } from '../logic/data';
import type { CityScene } from '../render/CityScene';
import { nowSec } from '../logic/save';
import { sfx } from './sound';
import { $, ptr, h, btn, fmtNum, fmtTime, costLine, fmtShort, handlersSet } from './dom';
export { fmtNum, fmtTime } from './dom';
import type { Music } from './music';
import { SEASONS, calendarAt } from '../logic/calendar';
import { Extras } from './m3';
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
  private editSel: string | null = null;
  private confirmDelete = false;

  x: Extras;
  private tutShown = -2;
  private newsAt = 0;

  constructor(public game: Game, public scene: CityScene, public onChange: () => void, public music: Music) {
    this.x = new Extras(this);
    this.buildHud();
  }

  get s() { return this.game.state; }

  // ---------------------------------------------------------------- HUD
  private buildHud() {
    const root = $('#ui');
    root.innerHTML = `
      <div class="hud">
        <div class="bar">
          <div class="pill" title="Utopium"><img src="assets/ui/Utopium.png"><span id="h-uto"></span></div>
          <div class="pill" title="Coins" id="p-coins"><img src="assets/ui/Coin.png"><span id="h-coins"></span></div>
          <div class="pill" title="Chroma"><img src="assets/ui/Chroma.png"><span id="h-chroma"></span></div>
        </div>
        <div class="bar small">
          <div class="pill" title="Land used / limit">LAND <span id="h-land"></span></div>
          <div class="pill" title="Civic spirit / limit">SPIRIT <span id="h-spirit"></span></div>
          <div class="pill" title="Population / housing">POP <span id="h-pop"></span></div>
          <div class="pill" title="Coins per second">CPS <span id="h-cps"></span></div>
        </div>
      </div>
      <div class="side">
        <button class="sidebtn" id="s-heart" title="Hearts"><img src="assets/ui/notif-heart.png"><span id="h-hearts"></span></button>
        <button class="sidebtn" id="s-missions" title="Missions"><img src="assets/ui/MissionBoxHighlight.png"><span>HQ</span></button>
        <button class="sidebtn" id="s-cal" title="Calendar"><img id="s-cal-img" src="assets/ui/SeasonArt_Thaw.png"><span>DAY</span></button>
        <button class="sidebtn" id="s-animals" title="Animals"><img src="assets/ui/AnimalSilhouette.png"><span id="h-animals"></span></button>
        <button class="sidebtn" id="s-ach" title="Achievements"><img src="assets/ui/ach/ac1.png"><span id="h-ach">ACH</span></button>
        <button class="sidebtn" id="s-edit" title="Edit"><img src="assets/ui/Movebtn.png"><span>EDIT</span></button>
        <button class="sidebtn" id="s-music" title="Music"><span id="h-music">BGM</span></button>
      </div>
      <div id="spiritwatch" class="hidden"><img src="assets/ui/SpiritWatch.png"><span id="h-sw"></span></div>
      <div id="pending"></div>
      <div id="news" class="hidden"><img src="assets/ui/NewsFeedBar.png" class="nb"><div class="track"><span id="news-text"></span></div></div>
      <div id="breaking" class="hidden"></div>
      <div id="buildbar" class="hidden"></div>
      <div class="footer">
        <button class="sprbtn b-build" id="f-build">BUILD</button>
        <button class="sprbtn b-splice" id="f-ac">CLONES</button>
        <button class="sprbtn b-expand" id="f-expand">EXPAND</button>
        <button class="iconbtn" id="f-menu" title="Settings">⚙</button>
      </div>
      <div id="toast" class="hidden"></div>
      <div id="tut" class="hidden"></div>
      <div id="modal" class="hidden"></div>`;
    const on = (id: string, f: () => void) => { $(id).onclick = () => { sfx('tap_01'); f(); }; };
    on('#f-build', () => this.openBuildMenu());
    on('#f-ac', () => this.openArrivalCenter());
    on('#f-expand', () => this.openExpand());
    on('#f-menu', () => this.x.openSettings());
    on('#s-ach', () => this.x.openAchievements());
    on('#p-coins', () => { if (!this.game.tutorialActive()) this.x.openExchange(); });
    on('#s-heart', () => this.openHearts());
    on('#s-missions', () => this.openMissions());
    on('#s-cal', () => this.x.openCalendar());
    on('#s-animals', () => this.openAnimals());
    on('#s-edit', () => (this.editing ? this.endEdit() : this.startEdit()));
    on('#s-music', () => { this.s.musicMuted = !this.s.musicMuted; this.music.setMuted(this.s.musicMuted); this.onChange(); });
    $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) this.close(); });
  }

  update() {
    const s = this.s, g = this.game;
    const now = nowSec();
    $('#h-coins').textContent = fmtNum(s.coins);
    $('#h-uto').textContent = fmtNum(s.utopium);
    $('#h-chroma').textContent = fmtNum(s.chroma);
    $('#h-land').textContent = `${s.landUsed}/${s.landLimit}`;
    $('#h-land').classList.toggle('warn', g.freeLand() <= 3);
    $('#h-spirit').textContent = `${s.spirit}/${s.spiritLimit}`;
    $('#h-pop').textContent = `${g.population()}/${g.populationLimit()}`;
    $('#h-cps').textContent = fmtNum(g.totalCps());
    $('#h-hearts').textContent = `${s.heartCount}/${HEART_MAX}`;
    $('#s-heart').classList.toggle('glow', s.heartCount > 0);
    $('#h-animals').textContent = `${Object.values(s.animals).reduce((a, b) => a + b, 0)}`;
    $('#h-music').textContent = s.musicMuted ? 'MUTED' : 'MUSIC';
    $('#s-music').classList.toggle('off', s.musicMuted);
    const ms = g.missions;
    $('#s-missions').classList.toggle('hidden', !ms.unlocked());
    $('#s-missions').classList.toggle('glow', ms.unlocked() && ms.active().some((a) => ms.canComplete(a)));
    $('#s-cal').classList.toggle('glow', s.dailyGift);
    const season = calendarAt(g.local(now)).season;
    ($('#s-cal-img') as HTMLImageElement).src = `assets/ui/SeasonArt_${season >= 0 ? SEASONS[season][0] + SEASONS[season].slice(1).toLowerCase() : 'Thaw'}.png`;
    $('#s-edit').classList.toggle('on', this.editing);
    const acReady = s.slots.some((x) => x.state === 3 || x.state === 5);
    $('#f-ac').classList.toggle('glow', acReady);
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
    $('#h-ach').textContent = `${g.achievements.pendingCount() || 'ACH'}`;
    $('#s-ach').classList.toggle('glow', g.achievements.pendingCount() > 0);
    // Funeral Parlor: spirit watch
    $('#spiritwatch').classList.toggle('hidden', !s.spiritWatch || g.tutorialActive());
    $('#h-sw').textContent = `${s.spirit}/${s.spiritLimit} · ${Math.trunc(g.discount() * 100)}% OFF`;
    // Observatory background
    const bg = `url("assets/ui/bg${s.spaceBg}.png")`;
    if ($('#game').style.backgroundImage !== bg) $('#game').style.backgroundImage = bg;
    // News Agency: live news feed
    $('#news').classList.toggle('hidden', !s.newsFeed || g.tutorialActive() || !!this.buildType || this.editing);
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
      if (this.tutShown !== -1) { el.classList.add('hidden'); this.scene.setMarker(null); this.tutShown = -1; }
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
    if (step === 1 && !this.buildType && !this.panel) this.startBuild('Residence1');
    if (step === 16 && !this.buildType && !this.panel && s.pendingWorkplaces.length && !s.packets.length) this.startBuild(s.pendingWorkplaces[0]);
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
      3: 'button[data-k="bld-rush"]', 17: 'button[data-k="bld-rush"]', 5: '#f-ac', 18: '#f-ac', 7: 'button[data-k^="arr"]',
      8: '.slot .portrait.tap', 19: '.slot .portrait.tap', 9: 'button[data-k^="spl"]', 11: '.gene[data-job="Mayor"]',
      12: '.gene[data-job="Mechanic"]', 13: 'button[data-k="splice-go"]', 20: 'button[data-k^="as"][data-k$="Utopium Mine"]',
      15: 'button[data-k="disc-place"]',
    };
    if (sel[step]) document.querySelectorAll(sel[step]).forEach((e) => e.classList.add('tut-target'));
    // gating: only the Arrival Center button and the settings stay usable
    const acSteps = [5, 6, 7, 8, 9, 10, 11, 12, 13, 18, 19, 20];
    ($('#f-ac') as HTMLButtonElement).disabled = !acSteps.includes(step);
    ($('#f-build') as HTMLButtonElement).disabled = true;
    ($('#f-expand') as HTMLButtonElement).disabled = true;
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
  open(title: string, body: HTMLElement, refresh?: () => void, cls = '', onClose?: () => void) {
    const m = $('#modal');
    m.innerHTML = '';
    const close = h('button', { class: 'close', title: 'Close' });
    close.addEventListener('click', () => { sfx('tap_01'); this.close(); });
    const p = h('div', { class: `panel ${cls}` }, h('div', { class: 'title' }, title), close, body);
    m.append(p);
    m.classList.remove('hidden');
    this.panel = p;
    this.panelKind = cls.includes('card') ? 'card' : cls.includes('splicer') ? 'splicer' : title;
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

  showPacket(p: Packet) {
    if (p.type === 0) { this.showDiscovery(p.id); return; }
    const g = this.game;
    const body = h('div', { class: 'card' });
    body.append(h('img', { class: 'packet', src: `assets/ui/packets/${this.packetArt(p)}.png` }));
    let title = 'YOU GOT A PRESENT!';
    if (p.id.startsWith('mission:')) {
      const md = MISSION.get(p.id.slice(8));
      title = `MISSION "${(md?.name ?? '').toUpperCase()}" COMPLETE!`;
    } else if (p.id === 'heart') title = STRINGS[`Heart_Quote${Math.abs(p.value) % 6}`] ?? 'LOVE!';
    else if (p.id === 'gift') title = 'A GIFT!';
    const big = (icon: string, text: string) => h('div', { class: 'bigreward' }, h('img', { src: icon }), text);
    switch (p.type) {
      case 1: body.append(h('img', { class: 'big', src: this.scene.clonePortrait(p.id, false, 108) }),
        h('div', { class: 'jobname' }, jobDisplay(p.id).toUpperCase()), h('div', {}, 'SPECIAL GENE UNLOCKED!')); title = 'SPECIAL GENE!'; break;
      case 2: {
        const row = landRow(LAND, this.s.level);
        title = 'LEVEL UP!';
        body.append(h('div', { class: 'jobname' }, `LAND LEVEL ${this.s.level + 1}`),
          h('div', {}, `+${row.land} LAND · +${row.utopium} UTOPIUM`));
        break;
      }
      case 3: case 14: {
        const a = ANIMAL.get(p.id);
        if (!this.s.animals[p.id]) title = 'NEW ANIMAL DISCOVERED!';
        if (p.type === 14) title = this.s.animalRecipes.includes(p.id) ? 'ALTAR SPLICE!' : 'NEW RECIPE!';
        body.append(this.animalImg(p.id, 96), h('div', { class: 'jobname' }, p.id.toUpperCase()),
          h('div', {}, `TIER ${a?.tier ?? '?'} · ${(a?.categories ?? []).join(', ').toUpperCase()}`));
        break;
      }
      case 50: {
        const [skin, bld] = p.id.split('~');
        title = (STRINGS.Card_Gacha_Title ?? 'NEW SKIN UNLOCKED').toUpperCase();
        body.append(h('img', { class: 'wp', src: this.scene.workplaceThumb(skin, 120) }),
          h('div', { class: 'jobname' }, displayName(bld).toUpperCase()), h('div', {}, (STRINGS.Card_Gacha_Desc ?? '').toUpperCase()));
        break;
      }
      case 4: body.append(big('assets/ui/Coin.png', `+${fmtNum(p.value)} COINS`)); break;
      case 5: body.append(big('assets/ui/Utopium.png', `+${p.value} UTOPIUM`)); break;
      case 15: body.append(big('assets/ui/Chroma.png', `+${p.value} CHROMA`)); break;
      case 6: case 7:
        title = 'NEW BUILDING!';
        body.append(h('img', { class: 'wp', src: this.scene.workplaceThumb(p.id, 120) }),
          h('div', { class: 'jobname' }, displayName(p.id).toUpperCase()));
        break;
      case 9: body.append(h('div', { class: 'jobname' }, 'NEW COMBOS!'), h('div', {}, `${p.value} NEW RECIPES IN THE SPLICER`)); break;
      case 10: {
        title = '9 ANIMALS PACK!';
        const grid = h('div', { class: 'agrid' });
        for (const a of p.id.split('+')) grid.append(h('div', {}, this.animalImg(a, 44), h('small', {}, a.toUpperCase())));
        body.append(grid);
        break;
      }
      case 16: {
        const w = wonderOf(p.id);
        const name = (STRINGS[`${w.key}_DisplayName`] ?? w.key).toUpperCase();
        const last = w.part === WONDER_PARTS[w.key];
        title = last ? 'WONDER COMPLETE!' : `${name} PART ${w.part}`;
        body.append(h('img', { class: 'wp', src: this.scene.workplaceThumb(p.id, 120) }),
          h('div', { class: 'jobname' }, last
            ? (STRINGS.Wonder_Completed ?? '%s %s').replace('%s', name).replace('%s', STRINGS[`${w.key}_Completed`] ?? '')
            : `PART ${w.part} OF ${WONDER_PARTS[w.key]} COMPLETE!`));
        break;
      }
    }
    const apply = () => {
      const q = g.closePacket();
      sfx('correct_03');
      this.onChange();
      if (q && (q.type === 6 || q.type === 7)) this.startInventoryPlace(this.s.inventory.length - 1);
    };
    body.append(btn(p.type === 6 || p.type === 7 ? 'PLACE IT' : 'COLLECT', 'b-green', () => this.close(), false, 'pkt-collect'));
    sfx('Rip.m4a');
    this.open(title, body, undefined, 'card', apply);
  }

  // ---------------------------------------------------------------- arrival center + splicer
  openArrivalCenter() {
    const body = h('div', { class: 'slots' });
    const refresh = () => {
      const now = nowSec();
      body.innerHTML = '';
      const g = this.game;
      body.append(h('div', { class: 'hint' },
        `ARRIVAL TIME ${fmtTime(g.arrivalTime())} · SPLICE TIME ${fmtTime(g.splicingDuration())} · ${g.jobsUnlocked} JOBS`));
      this.s.slots.forEach((slot, idx) => {
        const peep = slot.peep ? g.peep(slot.peep) : undefined;
        const row = h('div', { class: 'slot' });
        const port = h('div', { class: 'portrait' });
        const info = h('div', { class: 'info' });
        const actions = h('div', { class: 'actions' });
        switch (slot.state) {
          case 0:
          case 1:
            port.append(h('img', { src: 'assets/ui/build-moar-house.png' }));
            info.append(h('b', {}, slot.state === 1 ? 'IN QUEUE' : 'EMPTY'),
              h('div', {}, g.firstVacantResidence() ? 'WAITING FOR THE NEXT CLONE' : 'BUILD MORE HOUSES'));
            if (!g.firstVacantResidence()) actions.append(btn('BUILD', 'b-orange small', () => this.openBuildMenu('res')));
            break;
          case 2: {
            port.append(h('img', { src: 'assets/ui/WaitingClone.png' }));
            const left = slot.end - now;
            info.append(h('b', {}, 'CLONE ARRIVING'), h('div', {}, fmtTime(left)), this.progress(1 - left / Math.max(1, slot.end - slot.start)));
            actions.append(btn(`RUSH ${timeRushCost(left)}u`, 'b-pink small', () => this.act(g.rushArrival(idx, nowSec())), false, `arr${idx}`));
            break;
          }
          case 3:
            port.append(h('img', { src: this.scene.clonePortrait(null, !!peep?.female) }));
            info.append(h('b', {}, 'NEW CLONE'), h('div', {}, 'READY TO SPLICE'));
            port.classList.add('tap');
            port.addEventListener('click', () => { if (g.tut('tapPortrait')) { sfx('tap_01'); this.onChange(); } });
            actions.append(btn('SPLICE ME', 'b-green small', () => { g.tut('tapPortrait'); g.tut('spliceMe'); this.openSplicer(idx); }, false, `spl${idx}`));
            break;
          case 4: {
            port.append(h('img', { src: 'assets/ui/SplicingClone.png' }));
            const left = slot.end - now;
            info.append(h('b', {}, `SPLICING ${jobDisplay(slot.job!).toUpperCase()}`), h('div', {}, fmtTime(left)),
              this.progress(1 - left / Math.max(1, slot.end - slot.start)));
            actions.append(btn(`RUSH ${timeRushCost(left)}u`, 'b-pink small', () => this.act(g.rushSplice(idx, nowSec())), false, `rspl${idx}`));
            actions.append(this.freeButton(this.s.freeSpliceReadyAt, () => this.act(g.freeSplice(idx, nowSec())), `free${idx}`));
            break;
          }
          case 5: {
            port.append(h('img', { src: this.scene.clonePortrait(slot.job, !!peep?.female) }));
            const jd = JOB.get(slot.job!)!;
            info.append(h('b', {}, jobDisplay(slot.job!).toUpperCase()), h('div', {}, 'NEEDS A WORKPLACE'));
            port.classList.add('tap');
            port.addEventListener('click', () => { if (g.tut('tapPortrait')) { sfx('tap_01'); this.onChange(); } });
            const vac = g.missions.vacancyFor(slot.job!);
            if (vac) {
              actions.append(btn(`MISSION: ${MISSION.get(vac.mission.id)!.name.toUpperCase()}`, 'b-pink small',
                () => { if (this.act(g.missions.deliverClone(idx))) sfx('correct_03'); }, false, `mis${idx}`));
            }
            for (const wp of jd.workplaces) {
              const exists = g.doesBuildingExist(wp);
              const vacant = g.vacantWorkplace(wp, slot.job!);
              const pending = this.s.pendingWorkplaces.includes(wp);
              const label = displayName(wp).toUpperCase();
              if (vacant) actions.append(btn(label, 'b-green small', () => { if (this.act(g.assignClone(idx, wp), `${jobDisplay(slot.job!).toUpperCase()} HIRED`)) sfx('correct_03'); }, false, `as${idx}${wp}`));
              else if (pending) actions.append(btn(`PLACE ${label}`, 'b-orange small', () => this.startBuild(wp), false, `pl${idx}${wp}`));
              else actions.append(btn(exists ? `${label}: NO VACANCY` : `${label}: TO BE DISCOVERED`, 'b-grey small', () => {}, true));
            }
            break;
          }
        }
        row.append(port, info, actions);
        body.append(row);
      });
    };
    if (this.game.tut('openAC')) this.onChange();
    this.open('ARRIVAL CENTER', body, refresh);
  }

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

  openSplicer(slotIdx: number) {
    const sel: (string | null)[] = [null, null];
    const body = h('div', { class: 'splicer' });
    const g = this.game;
    const genes = h('div', { class: 'genes' });
    const top = h('div', { class: 'splicetop' });
    const groups = new Map<string, string[]>();
    for (const j of this.s.unlockedJobs) {
      const grp = JOB.get(j)?.group ?? 'Other';
      groups.set(grp, [...(groups.get(grp) ?? []), j]);
    }
    const render = () => {
      top.innerHTML = '';
      const pick = (k: 0 | 1) => {
        const j = sel[k];
        const d = h('div', { class: `pick ${j ? 'on' : ''}` });
        d.append(j ? h('img', { src: this.scene.clonePortrait(j, false) }) : h('span', {}, '?'), h('div', {}, j ? jobDisplay(j).toUpperCase() : 'GENE'));
        d.addEventListener('click', () => { sel[k] = null; render(); });
        return d;
      };
      const info = g.combo(sel[0], sel[1]);
      const mid = h('div', { class: 'combo' }, h('img', { src: `assets/ui/${COMBO_IMG[info.kind]}.png` }));
      const text = info.kind === 'none' ? (sel[0] && sel[1] ? 'NO GENETIC MATCH' : 'SELECT GENETIC MATERIAL')
        : info.kind === 'old' ? `KNOWN: ${jobDisplay(info.job!).toUpperCase()}` : 'NEW GENETIC MATCH FOUND!';
      const land = info.landRequired ? `LAND REQUIRED: ${info.landRequired}` : '';
      const spliceBtn = btn(`SPLICE (${fmtTime(g.splicingDuration())})`, 'b-green', () => {
        if (this.act(g.startSplice(slotIdx, sel[0]!, sel[1]!, nowSec()))) { sfx('extra_05'); this.openArrivalCenter(); }
      }, info.kind === 'none', 'splice-go');
      top.append(pick(0), mid, pick(1), h('div', { class: 'combotext' }, text, land ? h('div', { class: 'land' }, land) : null), spliceBtn);
      genes.querySelectorAll('.gene').forEach((el) => {
        const j = (el as HTMLElement).dataset.job!;
        el.classList.toggle('on', sel.includes(j));
      });
    };
    for (const [grp, jobs] of [...groups.entries()].sort()) {
      const sec = h('div', { class: 'group' }, h('div', { class: 'gname' }, grp.toUpperCase()));
      for (const j of jobs.sort()) {
        const el = h('div', { class: 'gene' }, h('img', { src: this.scene.clonePortrait(j, false) }), h('span', {}, jobDisplay(j).toUpperCase()));
        el.dataset.job = j;
        el.addEventListener('click', () => {
          sfx('tap_01');
          if (sel[0] === null) sel[0] = j; else if (sel[1] === null) sel[1] = j; else { sel[0] = sel[1]; sel[1] = j; }
          if (j === 'Mayor' && g.tut('pickMayor')) this.onChange();
          if (j === 'Mechanic' && g.tut('pickMechanic')) this.onChange();
          render();
        });
        sec.append(el);
      }
      genes.append(sec);
    }
    body.append(top, h('div', { class: 'hint' }, 'TIP: TRY SPLICING TWO OF THE SAME TYPE OF GENE'), genes);
    this.open('SPLICER', body, undefined, 'wide splicer');
    render();
  }

  /** Card of packet type 0 (new job discovered). Closing it consumes the packet. */
  showDiscovery(job: string) {
    const jd = JOB.get(job)!;
    const wp = jd.workplaces[0];
    const body = h('div', { class: 'card' },
      h('div', { class: 'eureka' }, 'NEW JOB DISCOVERED!'),
      h('img', { class: 'big', src: this.scene.clonePortrait(job, false, 108) }),
      h('div', { class: 'jobname' }, jobDisplay(job).toUpperCase()),
      h('div', { class: 'quote' }, `"${jd.quote}"`),
      h('div', {}, `${jd.group.toUpperCase()} · WORKS AT ${jd.workplaces.map((w) => displayName(w).toUpperCase()).join(', ')}`),
    );
    let placeAfter = false;
    const tut = this.game.tutorialActive();
    this.game.tut('card');
    const done = () => {
      this.game.closePacket();
      this.game.tut('closeCard');
      this.onChange();
      if (placeAfter || (tut && wp && this.s.pendingWorkplaces.includes(wp))) this.startBuild(wp);
    };
    if (wp && this.s.pendingWorkplaces.includes(wp)) {
      body.append(h('img', { class: 'wp', src: this.scene.workplaceThumb(wp, 120) }),
        h('div', {}, `FREE ${displayName(wp).toUpperCase()}! IT ONLY NEEDS ${WORKPLACE.get(wp)?.size ?? 1} LAND.`));
      body.append(btn('PLACE IT NOW', 'b-green', () => { placeAfter = true; this.close(); }, false, 'disc-place'));
      if (!tut) body.append(btn('LATER', 'b-grey small', () => this.close()));
    } else {
      body.append(btn('OK', 'b-green', () => this.close()));
    }
    sfx('discovery_04');
    this.open('EUREKA!', body, undefined, 'card', done);
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
        if (this.s.hearts.on === id) body.append(btn('COLLECT HEART', 'b-pink', () => { this.close(); this.tapHeartOn(); }));
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
    this.open(displayName(b.type).toUpperCase(), body, refresh);
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
  tapHeartOn() {
    const g = this.game;
    if (this.act(g.tapHeart(nowSec()))) sfx('recharge_10');
  }

  /** Stored hearts are opened by pumping them (inferido: HEART_PUMPS taps), instantly after the First Wonder. */
  openHearts() {
    const g = this.game;
    let pumps = 0;
    const body = h('div', { class: 'hearts' });
    const refresh = () => {
      body.innerHTML = '';
      body.append(h('div', {}, `STORED HEARTS: ${this.s.heartCount}/${HEART_MAX}`),
        h('div', { class: 'hint' }, this.s.landUsed < 22 ? 'HEARTS APPEAR OVER HOUSES ONCE YOUR CITY USES 22 LAND.'
          : 'TAP THE HEARTS THAT APPEAR OVER HOUSES TO STORE THEM.'));
      const need = g.instantHearts() ? 1 : HEART_PUMPS;
      const heart = h('button', { class: 'bigheart', 'data-k': 'pump' });
      heart.append(h('img', { src: 'assets/ui/notif-heart.png', style: `transform: scale(${1 + pumps * 0.12})` }));
      handlersSet('pump', () => {
        if (this.s.heartCount < 1) { this.toast('NO HEARTS', true); return; }
        pumps += 1;
        if (pumps >= need) { pumps = 0; this.act(g.openHeart(nowSec())); this.close(); return; }
        refresh();
      });
      body.append(heart, this.progress(pumps / need), h('div', { class: 'hint' }, need > 1 ? `PUMP THE HEART (${pumps}/${need})` : 'TAP TO OPEN'));
    };
    this.open('LOVE', body, undefined);
    refresh();
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
  openAnimals() {
    const body = h('div', { class: 'animals' });
    const names = Object.keys(this.s.animals).filter((n) => this.s.animals[n] > 0).sort();
    if (!names.length) body.append(h('div', {}, 'NO ANIMALS YET. COLLECT HEARTS, ADOPT AT THE ANIMAL SHELTER OR OPEN GIFTS.'));
    const grid = h('div', { class: 'agrid' });
    for (const n of names) grid.append(h('div', { class: 'acell' }, this.animalImg(n, 44), h('small', {}, `${n.toUpperCase()} x${this.s.animals[n]}`)));
    body.append(grid);
    this.open('ANIMALS', body, undefined, 'wide');
  }

  // ---------------------------------------------------------------- build menu
  openBuildMenu(tab: 'res' | 'decor' | 'path' | 'tree' | 'store' = 'res') {
    const g = this.game;
    const body = h('div', { class: 'buildmenu' });
    const tabs = h('div', { class: 'tabs' });
    const list = h('div', { class: 'items' });
    const tabsDef: [typeof tab, string][] = [['res', 'HOUSES'], ['decor', 'DECOR'], ['path', 'PATHS'], ['tree', 'TREES'], ['store', 'STORAGE']];
    const lockMsg: Record<string, [number, string]> = {
      decor: [F.DECOR, 'BUILD A PARK TO UNLOCK DECOR'], path: [F.ROADS, 'BUILD A CONSTRUCTION YARD TO UNLOCK ROADS'],
      tree: [F.TREES, 'BUILD A NURSERY TO UNLOCK TREES'],
    };
    const show = (t: typeof tab) => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === t));
      list.innerHTML = '';
      if (t === 'store') {
        if (!this.s.inventory.length) list.append(h('div', { class: 'hint' }, 'STORED AND REWARD BUILDINGS SHOW UP HERE.'));
        this.s.inventory.forEach((it, i) => {
          const card = h('div', { class: 'item' }, h('img', { src: this.scene.workplaceThumb(it.type, 72) }),
            h('div', { class: 'iname' }, displayName(it.type).toUpperCase()), costLine({ coins: 0, utopium: 0, chroma: 0 }, landUse(it.type)));
          card.addEventListener('click', () => { sfx('tap_01'); this.close(); this.startInventoryPlace(i); });
          list.append(card);
        });
        return;
      }
      const lock = lockMsg[t];
      if (lock && !g.featureUnlocked(lock[0])) {
        list.append(h('div', { class: 'locked' }, h('img', { src: 'assets/ui/status_lock.png' }), lock[1]));
        if (t !== 'path') return;
      }
      const items: { type: string; cost: Cost | null; extra?: string; spirit?: number }[] = [];
      if (t === 'res') {
        for (const r of RESIDENCES) {
          if (!this.scene.hasFrame(r.name)) continue;
          if (/^iap|^AGResidence|^Special/.test(r.name) && !(PACK_ITEM.has(r.name) && g.shop.packUnlocked(r.name))) continue;
          if (!r.cost.coins && !r.cost.utopium && !r.cost.chroma) continue;
          items.push({ type: r.name, cost: r.cost, extra: `${r.population} BEDS · ${fmtTime(g.buildTime(r.name))}` });
        }
      } else if (t === 'decor') {
        const cats = ['Basic', 'Inspiring', 'Spectacular', 'Magnificent', 'Chroma (Normal)'];
        for (const d of DECOR) {
          const pack = PACK_ITEM.has(d.name);
          if ((pack ? !g.shop.packUnlocked(d.name) : !cats.includes(d.category)) || !d.cost || !this.scene.hasFrame(d.name)) continue;
          items.push({ type: d.name, cost: d.cost, spirit: d.spirit, extra: d.category.toUpperCase() });
        }
      } else if (t === 'path') {
        for (const p of PATHS) if (p.cost && this.scene.hasFrame(p.name) && g.typeUnlocked(p.name)) items.push({ type: p.name, cost: p.cost, extra: p.pathType.toUpperCase() });
      } else {
        for (const tr of TREES) {
          const pack = PACK_ITEM.has(tr.name) && g.shop.packUnlocked(tr.name);
          if (tr.cost && (/^Tree\d+$/.test(tr.name) || pack) && this.scene.hasFrame(tr.name)) items.push({ type: tr.name, cost: tr.cost });
        }
      }
      for (const it of items) {
        const can = g.canAfford(it.cost!) && landUse(it.type) <= g.freeLand();
        const card = h('div', { class: `item ${can ? '' : 'dim'}` },
          h('img', { src: this.scene.workplaceThumb(it.type, 72) }),
          h('div', { class: 'iname' }, displayName(it.type).toUpperCase()),
          costLine(it.cost, landUse(it.type), it.spirit),
          it.extra ? h('small', {}, it.extra) : null);
        card.addEventListener('click', () => { sfx('tap_01'); this.close(); this.startBuild(it.type); });
        list.append(card);
      }
    };
    for (const [t, label] of tabsDef) {
      const b = btn(label, 'tab', () => show(t));
      b.dataset.t = t;
      tabs.append(b);
    }
    body.append(tabs, list);
    this.open('BUILD', body, undefined, 'wide');
    show(tab);
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
      if (this.act(g.moveBuilding(mode.id, i, j))) { sfx('Construction_sound'); this.buildType = null; this.scene.setBuildMode(null); this.renderEditBar(); }
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
    const doMove = () => {
      this.buildType = b.type;
      this.placeMode = { kind: 'move', id: b.id };
      this.scene.setBuildMode(b.type, b.flip, b.id);
      bar.querySelector('small')!.textContent = 'TAP THE NEW SPOT';
    };
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
    const body = h('div', { class: 'expand' });
    const refresh = () => {
      const g = this.game;
      const row = landRow(LAND, this.s.level);
      const cost = g.landUpgradeCost();
      body.innerHTML = '';
      body.append(
        h('div', {}, `LAND LEVEL ${this.s.level}`),
        h('div', {}, `LAND ${this.s.landUsed}/${this.s.landLimit} → ${this.s.landUsed}/${this.s.landLimit + row.land}`),
        h('div', {}, `REWARD: +${row.land} LAND, +${row.utopium} UTOPIUM`),
        h('div', { class: 'hint' }, `SPIRIT DISCOUNT ${(g.discount() * 100).toFixed(1)}% (BASE ${fmtNum(row.cost)})`),
        costLine({ coins: cost, utopium: 0, chroma: 0 }),
        btn('EXPAND', 'b-yellow', () => { if (this.act(g.expandLand())) { sfx('discovery_04'); this.close(); } }, this.s.coins < cost || g.levelUpPending(), 'expand'),
      );
      if (g.featureUnlocked(F.LAW_FIRM)) {
        body.append(h('div', { class: 'hint' }, 'LAW FIRM: LEGAL LOOPHOLES LET YOU LEVEL UP WITH UTOPIUM'),
          btn(`EXPAND FOR ${LAW_FIRM_UTOPIUM}u`, 'b-pink', () => { if (this.act(g.expandWithUtopium())) { sfx('discovery_04'); this.close(); } }, this.s.utopium < LAW_FIRM_UTOPIUM || g.levelUpPending(), 'expand-u'));
      }
    };
    this.open('EXPAND UTOPIA', body, refresh);
  }

}

function md0Title(id: string): string {
  const md = MISSION.get(id);
  return md?.type === 5 ? 'WONDER' : 'MISSION';
}


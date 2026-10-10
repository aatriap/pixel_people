// The 4.20 popups drawn like the original (266 x 401 design units, 1 unit = --u): workplace and Arrival Center
// (workplace_popup / arrivalcenter.csb), residence with the heart (residence_popup, heartButton), character card
// (clone_ui: JobAvailableBG), vacant slot (vacant_slot) and the gallery (gallery_ui). Texts come from text_english.
import { F, HEART_HOLD_SEC, HOTEL_ROOMS, MOTHERSHIP_UTOPIUM, REVEAL_UTOPIUM } from '../logic/game';
import { ANIMALS, JOB, JOBS, MISSION, MISSIONS, RESIDENCE, STRINGS, WORKPLACE, displayName, jobDisplay } from '../logic/data';
import type { Peep } from '../logic/state';
import { timeRushCost } from '../logic/formulas';
import { nowSec } from '../logic/save';
import { btn, fmtNum, fmtTime, h, handlersSet } from './dom';
import { sfx } from './sound';
import { FRAME_TINT, TIER_COLORS, cloneTint, groupColor } from './colors';
import type { UI } from './ui';

const T = (k: string, fb = '') => (STRINGS[k] ?? fb).replace(/\\n/g, '\n');
const fill = (t: string, ...v: (string | number)[]) => { for (const x of v) t = t.replace(/%[is]/, String(x)); return t; };
/** Absolutely placed box in design units. */
const at = (x: number, y: number, w: number, hh: number, extra = '') => `--x:${x};--y:${y};--w:${w};--h:${hh};${extra}`;
const div = (cls: string, style = '', ...kids: (Node | string | null | undefined)[]) => h('div', { class: cls, style }, ...kids);
const tap = (el: HTMLElement, f: () => void) => { el.addEventListener('click', () => { sfx('tap_01'); f(); }); el.classList.add('tappable'); return el; };

/** Normal professions in id order: the 450 the HeaderTop counts and the gallery pages through. */
const GALLERY_JOBS = JOBS.filter((j) => j.type === 'Normal').sort((a, b) => a.id - b.id);
const GALLERY_ANIMALS = [...ANIMALS].sort((a, b) => a.id - b.id);
const PER_PAGE = 20;

export class Classic {
  constructor(private ui: UI) {}
  private get g() { return this.ui.game; }
  private get s() { return this.ui.game.state; }

  // ---------------------------------------------------------------- shared pieces
  /** The popup skeleton: tinted frame (PlainBg or another frame sprite), close button, optional back button. */
  private frame(tint: string, kind: string, back?: () => void, img = 'PlainBg'): HTMLElement {
    const body = div(`pp ${kind}`, `--tc:${tint}`);
    body.append(div('pp-bg tint', `--img:url('/assets/ui/${img}.png')`));
    if (back) body.append(tap(div('pp-back ab', at(14, 13, 32, 32)), back));
    const close = tap(div('pp-close ab', at(221, 13, 32, 32)), () => this.ui.close());
    close.dataset.k = 'pp-close';
    body.append(close);
    return body;
  }

  /** Title tab of the workplace popups: skin name over the building name. */
  private titleTab(name: string, skin = T('Workplace_Classic', 'CLASSIC')): HTMLElement {
    return div('pp-tab ab', at(52, 2, 162, 34), div('pp-skin', '', skin), div('pp-name', '', name.toUpperCase()));
  }

  /** The bottom bar: three cells (STATS · timer · MOVE, or DELETE · PAINT · MOVE). */
  private bottomBar(cells: (HTMLElement | null)[]): HTMLElement {
    const bar = div('pp-bar ab', at(23, 357, 220, 36));
    for (const c of cells) bar.append(c ?? div('cell'));
    return bar;
  }

  private cell(label: string, f: (() => void) | null, key: string, cls = ''): HTMLElement {
    const c = div(`cell ${cls} ${f ? 'tappable' : ''}`, '', label);
    if (f) { c.dataset.k = key; tap(c, f); }
    return c;
  }

  private portrait(job: string | null, female: boolean, size = 54): HTMLElement {
    return h('img', { class: 'pix', src: this.ui.scene.clonePortrait(job, female, size), draggable: 'false' });
  }

  private personName(p: Peep | undefined, job: string): string {
    const jd = JOB.get(job);
    return (p?.female ? jd?.femaleName : jd?.maleName) ?? jobDisplay(job);
  }

  /** A worker row (CharacterJobBox tinted with the gene group): portrait, name and job. Empty rows show HINT. */
  private workerRow(job: string, p: Peep | undefined, onTap: () => void): HTMLElement {
    const jd = JOB.get(job);
    if (!p) {
      const row = div('wrow empty', '', h('img', { class: 'pix sil', src: 'assets/ui/HintPerson.png' }),
        div('wtag', '', T('Hint', 'HINT')));
      row.dataset.job = job;
      return tap(row, onTap);
    }
    const row = div('wrow', `--tc:${groupColor(jd?.group ?? '')}`, div('wrow-bg tint', `--img:url('/assets/ui/CharacterJobBox.png')`),
      this.portrait(job, p.female, 48), div('wname', '', this.personName(p, job)), div('wjob', '', jobDisplay(job).toUpperCase()));
    row.dataset.job = job;
    return tap(row, onTap);
  }

  // ---------------------------------------------------------------- workplaces
  openWorkplace(id: string) {
    const g = this.g;
    const b0 = g.building(id);
    if (!b0) return;
    const w = WORKPLACE.get(b0.type)!;
    let view: 'main' | 'stats' = 'main';
    let sure = false;
    const body = this.frame(FRAME_TINT[w.category] ?? FRAME_TINT[''], 'wp');
    const dyn = div('pp-dyn');
    body.append(this.titleTab(displayName(b0.type), b0.skin ? displayName(b0.skin) : undefined),
      div('pp-motto ab', at(20, 41, 226, 14), T(`${b0.type}_Motto`)), dyn);
    const refresh = () => {
      const b = g.building(id);
      if (!b) { this.ui.close(); return; }
      if (b.buildEnd >= 0) { this.ui.openBuilding(id); return; }
      const now = nowSec();
      dyn.innerHTML = '';
      const workers = g.workers(b);
      const rows = div('pp-rows ab', at(23, 58, 220, 140));
      for (const j of w.jobs) {
        const p = workers.find((x) => x.job === j);
        rows.append(this.workerRow(j, p, () => (p ? this.openClone({ peep: p.id, back: () => this.openWorkplace(id) })
          : this.openVacant(j, () => this.openWorkplace(id)))));
      }
      dyn.append(rows);
      const low = div('pp-low ab', at(18, 203, 230, 136));
      if (view === 'stats') {
        const W = g.buildingWorkingTime(b);
        low.append(div('pp-stats', '', fill(T('Workplace_Stats_Occupation', 'OCCUPANCY:\n%i/%i'), workers.length, w.jobs.length).replace('\n', ' '),
          '\n', `${T('Workplace_Stats_BuildingMult', 'BUILDING MULTIPLIER: ')}x${w.multiplier}`,
          '\n', fill(T('Workplace_Stats_WorkTime', 'WORKING TIME:\n%s'), fmtTime(W)).replace('\n', ' '),
          '\n', fill(T('Workplace_CurrentLevel', 'CURRENT LEVEL: %i'), b.level)));
        const tools = div('pp-tools');
        if (g.featureUnlocked(F.UPGRADE)) {
          tools.append(b.level > 5 ? btn(T('Workplace_FullyUpgraded', 'FULLY UPGRADED'), 'b-grey small', () => {}, true)
            : btn(`${T('Workplace_Upgrade', 'UPGRADE')} ${g.upgradeCost(b)}u`, 'b-pink small', () => { if (this.ui.act(g.upgradeWorkplace(id))) sfx('correct_03'); }, false, `up${id}`));
        }
        if (g.canDuplicate(b.type)) tools.append(btn('DUPLICATE 20u', 'b-orange small', () => this.ui.startBuild(b.type), false, `dup${id}`));
        if (g.featureUnlocked(F.FLIP)) tools.append(btn('FLIP', 'b-orange small', () => this.ui.act(g.flipBuilding(id)), false, `pt-flip${id}`));
        const blocker = g.removeBlocker(b);
        tools.append(btn('STORE', 'b-grey small', () => { if (this.ui.act(g.storeBuilding(id))) this.ui.close(); }, !!blocker, `pt-store${id}`),
          btn(sure ? 'SURE?' : 'DELETE', 'b-pink small', () => {
            if (!sure) { sure = true; refresh(); return; }
            sure = false;
            if (this.ui.act(g.deleteBuilding(id))) { sfx('Construction_sound'); this.ui.close(); }
          }, !!blocker, `pt-del${id}`));
        low.append(tools);
        const skins = this.ui.x.skinRow(b);
        if (skins) low.append(skins);
        if (blocker) low.append(div('pp-note', '', blocker));
      } else {
        const head = T(`${b.type}_Header`), spec = T(`${b.type}_Special`);
        if (head || spec) {
          const pop = g.population(), homes = this.s.buildings.filter((x) => RESIDENCE.has(x.type)).length;
          low.append(div('pp-head', '', fill(head, pop)), div('pp-spec', '', fill(spec, homes)));
        } else {
          low.append(div('pp-spec', '', T('Workplace_Production', 'PRODUCTION:')), div('pp-cps sins', '', `${fmtNum(g.buildingCps(b))} CPS`));
        }
        const sp = this.ui.specialRow(b.type, id);
        if (sp.childElementCount) low.append(sp);
      }
      dyn.append(low);
      // WORKING / IDLE tab and the shift timer in the bottom bar
      const W = g.buildingWorkingTime(b);
      const working = b.shiftStart >= 0;
      const state = div(`pp-state ab ${working ? 'on' : 'off'}`, at(86, 341, 94, 17), working ? T('Workplace_Working', 'WORKING') : workers.length ? 'IDLE' : '');
      if (!working && workers.length) { state.dataset.k = `wp-start${id}`; tap(state, () => this.ui.act(g.tapWorkplace(id, nowSec()))); }
      if (working || workers.length) dyn.append(state);
      const left = working ? fmtTime(b.shiftStart + W - now) : '';
      dyn.append(this.bottomBar([
        this.cell(view === 'stats' ? 'BACK' : 'STATS', () => { view = view === 'stats' ? 'main' : 'stats'; sure = false; refresh(); }, `pp-stats${id}`),
        this.cell(left, null, '', 'timer sins'),
        this.ui.game.tutorialActive() ? null : this.cell('MOVE', () => this.ui.startMove(id), `pt-move${id}`),
      ]));
    };
    this.ui.open('', body, refresh, 'classic');
  }

  // ---------------------------------------------------------------- Arrival Center
  private acFocus = -1;

  openArrivalCenter() {
    const g = this.g;
    const ac = this.s.buildings.find((b) => b.type === 'SpacePort');
    const body = this.frame(FRAME_TINT.ADMINISTRATION, 'wp ac');
    const dyn = div('pp-dyn');
    let stats = false;
    body.append(this.titleTab(displayName('SpacePort')), div('pp-motto ab', at(20, 41, 226, 14), T('SpacePort_Motto', 'WELCOME TO UTOPIA')), dyn);
    const refresh = () => {
      const now = nowSec();
      dyn.innerHTML = '';
      const rows = div('pp-rows ab', at(23, 58, 220, 140));
      const mech = ac ? g.workers(ac).find((p) => p.job === 'Mechanic') : this.s.peeps.find((p) => p.job === 'Mechanic');
      rows.append(this.workerRow('Mechanic', mech, () => (mech ? this.openClone({ peep: mech.id, back: () => this.openArrivalCenter() }) : undefined)));
      if (stats) rows.append(div('pp-nostats', '', T('SpacePort_NoStats')));
      dyn.append(rows);
      const slots = this.s.slots;
      const vacant = !!g.firstVacantResidence();
      slots.forEach((slot, idx) => {
        const peep = slot.peep ? g.peep(slot.peep) : undefined;
        const box = div(`acslot ab st${slot.state} ${idx === this.acFocus ? 'focus' : ''}`, at(25 + idx * 75, 214, 66, 66));
        box.dataset.idx = `${idx}`;
        switch (slot.state) {
          case 0: case 1:
            if (!vacant) box.append(h('img', { class: 'pix', src: 'assets/ui/build-moar-house.png' }));
            tap(box, () => { if (!vacant) this.ui.openBuildMenu('res'); });
            break;
          case 2:
            box.append(h('img', { class: 'pix', src: 'assets/ui/WaitingClone.png' }));
            tap(box, () => { this.acFocus = idx; refresh(); });
            break;
          case 3:
            box.append(this.portrait(null, !!peep?.female, 56));
            box.classList.add('tap', 'ready');
            tap(box, () => { g.tut('tapPortrait'); this.ui.onChange(); this.openClone({ slot: idx, back: () => this.openArrivalCenter() }); });
            break;
          case 4: {
            box.append(h('img', { class: 'pix', src: 'assets/ui/SplicingClone.png' }), div('acsl-time', '', fmtTime(slot.end - now)));
            tap(box, () => { this.acFocus = idx; refresh(); });
            break;
          }
          case 5:
            box.append(this.portrait(slot.job, !!peep?.female, 56));
            box.classList.add('tap', 'ready');
            tap(box, () => { g.tut('tapPortrait'); this.ui.onChange(); this.openClone({ slot: idx, back: () => this.openArrivalCenter() }); });
            break;
        }
        dyn.append(box);
      });
      // the info line: the focused (or first) arriving clone, then the splicing ones
      let f = this.acFocus;
      if (!(slots[f]?.state === 2 || slots[f]?.state === 4)) f = slots.findIndex((x) => x.state === 2);
      if (f < 0) f = slots.findIndex((x) => x.state === 4);
      const info = div('pp-acinfo ab', at(10, 290, 246, 22));
      const rush = div('ab', at(73, 330, 120, 26));
      if (f >= 0 && slots[f].state === 2) {
        const left = slots[f].end - now;
        info.append(fill(T('SpacePort_ArrivingDesc', 'CLONE ARRIVAL IN : %s'), fmtTime(left)));
        rush.append(btn(fill(T('SpacePort_SpeedUpCost', 'RUSH %iu'), timeRushCost(left)), 'b-pink pp-rush', () => this.ui.act(g.rushArrival(f, nowSec())), false, `arr${f}`));
      } else if (f >= 0 && slots[f].state === 4) {
        const left = slots[f].end - now;
        info.append(`SPLICING ${jobDisplay(slots[f].job!).toUpperCase()}: ${fmtTime(left)}`);
        const freeLeft = this.s.freeSpliceReadyAt - now;
        rush.append(btn(fill(T('SpacePort_SpeedUpCost', 'RUSH %iu'), timeRushCost(left)), 'b-pink pp-rush', () => this.ui.act(g.rushSplice(f, nowSec())), false, `rspl${f}`));
        if (freeLeft <= 0) rush.append(btn('FREE?', 'b-free small pp-free', () => this.ui.act(g.freeSplice(f, nowSec())), false, `free${f}`));
      } else if (!vacant && slots.some((x) => x.state <= 1)) info.append(T('SpacePort_BuildMore', 'BUILD MORE HOUSES'));
      else if (slots.every((x) => x.state >= 3)) info.append(T('SpacePort_Full', 'ARRIVAL CENTER IS FULL'));
      dyn.append(info, div('pp-disc ab sins', at(10, 310, 246, 18), `${T('SpacePort_Discount', 'DISCOUNT:')} ${(g.discount() * 100).toFixed(2)}%`), rush);
      dyn.append(this.bottomBar([
        this.cell(stats ? 'BACK' : 'STATS', () => { stats = !stats; refresh(); }, 'ac-stats'),
        null,
        ac && !g.tutorialActive() ? this.cell('MOVE', () => this.ui.startMove(ac.id), `pt-move${ac.id}`) : null,
      ]));
    };
    if (g.tut('openAC')) this.ui.onChange();
    this.ui.open('', body, refresh, 'classic', undefined, 'ARRIVAL CENTER');
  }

  // ---------------------------------------------------------------- character card (cCharacterPopup)
  /** A clone's card: from an Arrival Center slot (new or spliced clone) or any employed clone. */
  openClone(o: { peep?: string; slot?: number; back?: () => void }) {
    const g = this.g;
    const slot = o.slot != null ? this.s.slots[o.slot] : undefined;
    const pid = o.peep ?? slot?.peep ?? null;
    const p = pid ? g.peep(pid) : undefined;
    const job = slot ? (slot.state === 5 ? slot.job : null) : p?.job ?? null;
    const jd = job ? JOB.get(job) : undefined;
    const tint = jd ? cloneTint(jd.group) : '#9a9aa8';
    const body = this.frame(tint, 'clone', o.back, 'JobAvailableBG');
    const dyn = div('pp-dyn');
    body.append(dyn);
    const refresh = () => {
      dyn.innerHTML = '';
      const p2 = pid ? g.peep(pid) : undefined;
      if (p2 && job && (p2.work || p2.home) && (this.hotelOpen() || g.canDeletePeep(p2.id))) {
        const ev = div('pp-evac ab', at(52, 13, 32, 32));
        ev.dataset.k = 'evacuate';
        dyn.append(tap(ev, () => this.openRelocate(p2.id, () => this.openClone(o))));
      }
      dyn.append(div('cl-portrait ab', at(103, 14, 60, 60), this.portrait(job, !!p2?.female, 60)),
        div('cl-name ab sins', at(10, 84, 246, 18), job ? this.personName(p2, job) : T('Character_BlankClone', 'TABULA RASA')),
        div('cl-job ab', at(10, 104, 246, 16), job ? jobDisplay(job) : ''));
      const formula = jd && jd.parent1 && jd.parent1 !== 'DEFAULT' ? `${jobDisplay(jd.parent1)} + ${jobDisplay(jd.parent2)}` : jd?.group === 'Special' ? 'SPECIAL GENE' : '';
      dyn.append(div('cl-formula ab sins', at(10, 131, 246, 14), formula));
      const list = div('cl-list ab', at(23, 176, 220, 108));
      if (!job) {
        dyn.append(div('cl-head ab', at(10, 156, 246, 16), T('Character_ForeverAClone', 'FOREVER A CLONE')));
        if (slot && o.slot != null && slot.state === 3) {
          list.append(btn(T('Character_SpliceMe', 'SPLICE ME!'), 'cl-wp avail big', () => { g.tut('tapPortrait'); g.tut('spliceMe'); this.ui.openSplicer(o.slot!); }, false, `spl${o.slot}`));
        }
      } else {
        dyn.append(div('cl-head ab', at(10, 156, 246, 16), T('Character_PossibleWorkplaces', 'POSSIBLE WORKPLACES:')));
        if (slot && o.slot != null) {
          const idx = o.slot;
          const vac = g.missions.vacancyFor(job);
          if (vac) list.append(btn(`MISSION: ${MISSION.get(vac.mission.id)!.name.toUpperCase()}`, 'cl-wp pink', () => {
            if (this.ui.act(g.missions.deliverClone(idx))) { sfx('correct_03'); this.ui.close(); }
          }, false, `mis${idx}`));
          for (const wp of jd!.workplaces) {
            const label = displayName(wp);
            if (g.vacantWorkplace(wp, job)) {
              list.append(btn(label, 'cl-wp avail', () => {
                if (this.ui.act(g.assignClone(idx, wp), `${jobDisplay(job).toUpperCase()} HIRED`)) { sfx('correct_03'); o.back ? o.back() : this.ui.close(); }
              }, false, `as${idx}${wp}`));
            } else if (this.s.pendingWorkplaces.includes(wp)) {
              list.append(btn(`PLACE ${label}`, 'cl-wp orange', () => this.ui.startBuild(wp), false, `pl${idx}${wp}`));
            } else list.append(btn(label, 'cl-wp', () => this.ui.toast(g.doesBuildingExist(wp) ? 'NO VACANCY' : T('Character_RelocateToBeDiscovered', 'TO BE DISCOVERED!'), true), false, `cw${idx}${wp}`));
          }
        } else if (p2) {
          const cur = p2.work ? g.building(p2.work)?.type : undefined;
          for (const wp of jd!.workplaces) {
            const here = cur === wp;
            const free = !here && !!g.vacantWorkplace(wp, job);
            const b = btn(displayName(wp), `cl-wp ${here || free ? 'avail' : ''} ${here ? 'here' : ''}`, () => {
              if (here) return;
              if (free) { if (this.ui.act(g.relocateWorker(p2.id, wp))) { sfx('correct_03'); refresh(); } }
              else this.ui.toast(g.doesBuildingExist(wp) ? 'NO VACANCY' : T('Character_RelocateToBeDiscovered', 'TO BE DISCOVERED!'), true);
            }, false, `rw${p2.id}${wp}`);
            if (here) b.append(h('img', { class: 'pix here-ic', src: 'assets/ui/CurrentlyEmployed.png' }));
            list.append(b);
          }
        }
      }
      dyn.append(list, div('cl-prod ab', at(65, 297, 136, 17), fill(T('Character_Productivity', 'PRODUCTIVITY: %i CPS'), p2?.cps ?? 1)),
        div('cl-quote ab', at(24, 322, 218, 36), (jd?.quote ?? '').toUpperCase()));
    };
    this.ui.open('', body, refresh, 'classic');
  }

  private hotelOpen(): boolean {
    return this.g.featureUnlocked(F.HOTEL) && this.s.buildings.some((x) => x.type === 'Hotel' && this.g.isBuilt(x));
  }

  /** Evacuate button: RELOCATE TO the Hotel (vacation) or the Mothership (deletes the clone). */
  private openRelocate(pid: string, back: () => void) {
    const g = this.g;
    const p = g.peep(pid);
    if (!p) return;
    const body = this.frame('#e0c020', 'clone reloc', back, 'JobAvailableBG');
    body.append(div('cl-portrait ab', at(103, 14, 60, 60), this.portrait(p.job, p.female, 60)),
      div('cl-name ab sins', at(10, 84, 246, 18), p.job ? this.personName(p, p.job) : ''),
      div('cl-head ab', at(10, 156, 246, 16), T('Character_RelocateTo', 'RELOCATE TO:')));
    const list = div('cl-list ab', at(23, 176, 220, 108));
    if (this.hotelOpen()) {
      list.append(btn(`HOTEL 1u (${this.s.hotel.length}/${HOTEL_ROOMS})`, 'cl-wp avail', () => { if (this.ui.act(g.hotelCheckIn(pid))) this.ui.close(); }, false, `vac${pid}`));
    }
    if (g.canDeletePeep(pid)) {
      list.append(btn(`${T('Character_RelocateMothership', 'MOTHERSHIP')} ${MOTHERSHIP_UTOPIUM}u`, 'cl-wp pink', () => this.ui.x.confirm('MOTHERSHIP',
        fill(T('Character_ConfirmDelete', 'SPEND %iu TO DELETE THIS CLONE?'), MOTHERSHIP_UTOPIUM), () => { if (this.ui.act(g.deleteClone(pid))) sfx('recharge_10'); }, back), false, `ms${pid}`));
    }
    body.append(list, div('cl-quote ab', at(24, 310, 218, 50), T('Character_RelocateBottom', '').replace('%s', T('Character_RelocateHotel', ''))));
    this.ui.open('', body, undefined, 'classic');
  }

  // ---------------------------------------------------------------- vacant slot
  openVacant(job: string, back: () => void) {
    const g = this.g;
    const body = this.frame(FRAME_TINT.VACANT, 'vacant', back);
    const dyn = div('pp-dyn');
    body.append(div('vc-title ab', at(52, 14, 162, 30), T('Vacant_VacantPosition', 'VACANT POSITION')),
      div('vc-sil ab', at(103, 70, 60, 84), h('img', { class: 'pix', src: 'assets/ui/HintPerson.png' })),
      div('vc-help ab', at(20, 170, 226, 36), T('Vacant_HelpWantedAC', 'HELP WANTED. CREATE JOBS AT ARRIVAL CENTER.')), dyn);
    const refresh = () => {
      dyn.innerHTML = '';
      const box = div('vc-box ab', at(22, 214, 222, 150));
      box.append(div('vc-desc', '', T('VacantSlot_description', 'JOB DESCRIPTION:')), div('vc-job sins', '', jobDisplay(job)));
      const jd = JOB.get(job);
      const need = g.requiredMission(job);
      if (need) box.append(div('vc-note sins', '', fill(T('Vacant_NeedMissionDone', 'Unsplicable until "%s" Mission is Complete.'), MISSIONS.find((m) => m.id === need)?.name ?? need)));
      else if (jd && (this.s.unlockedJobs.includes(job) || this.s.revealed.includes(job))) {
        box.append(div('vc-formula sins', '', jd.parent1 && jd.parent1 !== 'DEFAULT' ? `${jobDisplay(jd.parent1)}\n+ ${jobDisplay(jd.parent2)}` : ''));
      } else {
        const rv = h('button', { class: 'vc-reveal', 'data-k': `rv${job}` }, h('span', {}, T('Vacant_RevealFormula', 'REVEAL FORMULA?')), h('b', { class: 'sins' }, `${REVEAL_UTOPIUM}u`));
        handlersSet(`rv${job}`, () => { if (this.ui.act(g.revealFormula(job), 'FORMULA REVEALED')) refresh(); });
        box.append(rv);
      }
      dyn.append(box);
    };
    this.ui.open('', body, refresh, 'classic');
  }

  // ---------------------------------------------------------------- residences and the heart
  openResidence(id: string) {
    const g = this.g;
    const b0 = g.building(id);
    if (!b0) return;
    const body = this.frame(FRAME_TINT.RESIDENTIAL, 'res');
    const dyn = div('pp-dyn');
    let view: 'main' | 'paint' = 'main';
    let sure = false;
    body.append(div('rs-title ab', at(40, 14, 186, 22), displayName(b0.type).toUpperCase()),
      div('pp-motto ab', at(20, 38, 226, 14), T(`${b0.type}_Motto`)), dyn);
    const heartLayer = div('rs-heart ab', at(70, 134, 126, 126));
    const quote = div('rs-quote ab', at(30, 180, 206, 30));
    let holding = 0, grown = 0, raf = 0, last = 0, done = false;
    const big = h('img', { class: 'pix rs-big', src: 'assets/ui/HUDHeart.png', draggable: 'false' });
    heartLayer.append(big);
    const grow = (t: number) => {
      const dt = last ? (t - last) / 1000 : 0;
      last = t;
      grown = Math.max(0, Math.min(1, grown + (holding ? dt / HEART_HOLD_SEC : -dt / 0.5)));
      big.style.transform = `scale(${0.5 + 0.5 * grown})`;
      if (grown >= 1 && !done) {
        done = true;
        const r = g.collectHeart(nowSec());
        sfx('recharge_10');
        quote.textContent = T(`Heart_Quote${Math.floor(Math.random() * 6)}`, 'LET LOVE GROW!');
        quote.classList.add('show');
        this.ui.onChange();
        window.setTimeout(() => { if (r.msg === 'FULL') this.ui.close(); else refresh(); }, 900);
        return;
      }
      if (holding || grown > 0) raf = requestAnimationFrame(grow); else { raf = 0; last = 0; }
    };
    const hold = (on: boolean) => {
      if (done) return;
      holding = on ? 1 : 0;
      holdBtn.classList.toggle('down', on);
      if (!raf) { last = 0; raf = requestAnimationFrame(grow); }
    };
    // heartButton.csb: a small HUDHeart behind the HeartFG frame ("PRESS"), HeartFGPressed ("HOLD") while held
    const holdBtn = div('rs-hold ab', at(196, 246, 56, 68));
    holdBtn.append(h('img', { class: 'pix rs-hold-heart', src: 'assets/ui/HUDHeart.png', draggable: 'false' }), div('rs-hold-fg'));
    holdBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); holdBtn.setPointerCapture(e.pointerId); hold(true); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) holdBtn.addEventListener(ev, () => hold(false));
    big.style.transform = 'scale(0.5)';
    const refresh = () => {
      const b = g.building(id);
      if (!b) { this.ui.close(); return; }
      if (b.buildEnd >= 0) { this.ui.openBuilding(id); return; }
      if (holding) return; // don't rebuild under the finger
      dyn.innerHTML = '';
      const res = g.residents(b);
      const cap = RESIDENCE.get(b.type)?.population ?? 0;
      if (view === 'paint') {
        const paint = this.ui.x.paintRow(b);
        dyn.append(div('pp-low ab', at(18, 70, 230, 260), paint ?? div('pp-note', '', 'THIS HOUSE CANNOT BE PAINTED')));
      } else {
        const grid = div('rs-grid ab', at(30, 80, 156, 240));
        for (let k = 0; k < Math.max(cap, res.length); k++) {
          const p = res[k];
          const jd = p?.job ? JOB.get(p.job) : undefined;
          const cell = div(`rs-cell ${p ? '' : 'empty'}`, p ? `--bc:${groupColor(jd?.group ?? '')}` : '');
          if (p) {
            cell.append(this.portrait(p.job, p.female, 48));
            tap(cell, () => this.openClone({ peep: p.id, back: () => this.openResidence(id) }));
          }
          grid.append(cell);
        }
        dyn.append(grid);
        if (this.s.hearts.on === id && !done) dyn.append(heartLayer, quote, holdBtn);
        else if (done) dyn.append(heartLayer, quote);
      }
      dyn.append(div('rs-bottom ab', at(10, 332, 246, 14), T('Residence_BottomLine', 'HOME IS WHERE THE HEART IS')));
      const blocker = g.removeBlocker(b);
      dyn.append(this.bottomBar(g.tutorialActive() ? [null, null, null] : [
        this.cell(sure ? 'SURE?' : 'DELETE', blocker ? () => this.ui.toast(blocker, true) : () => {
          if (!sure) { sure = true; refresh(); return; }
          sure = false;
          if (this.ui.act(g.deleteBuilding(id))) { sfx('Construction_sound'); this.ui.close(); }
        }, `pt-del${id}`, blocker ? 'dim' : ''),
        this.cell(view === 'paint' ? 'BACK' : 'PAINT', () => { view = view === 'paint' ? 'main' : 'paint'; refresh(); }, `rs-paint${id}`),
        this.cell('MOVE', () => this.ui.startMove(id), `pt-move${id}`),
      ]));
    };
    this.ui.open('', body, refresh, 'classic', () => { if (raf) cancelAnimationFrame(raf); });
  }

  // ---------------------------------------------------------------- gallery (tap the job counter)
  openGallery(kind: 'jobs' | 'animals' = 'jobs', page = 0) {
    const s = this.s;
    const total = kind === 'jobs' ? GALLERY_JOBS.length : GALLERY_ANIMALS.length;
    const pages = Math.ceil(total / PER_PAGE);
    page = Math.max(0, Math.min(pages - 1, page));
    const body = div(`gal ${kind}`);
    body.append(div('gal-title', '', T('Gallery_Title', 'GALLERY')));
    const grid = div('gal-grid');
    const count = new Map<string, number>();
    const female = new Map<string, boolean>();
    for (const p of s.peeps) if (p.job) { count.set(p.job, (count.get(p.job) ?? 0) + 1); if (!female.has(p.job)) female.set(p.job, p.female); }
    const start = page * PER_PAGE;
    for (let k = start; k < Math.min(total, start + PER_PAGE); k++) {
      if (kind === 'jobs') {
        const j = GALLERY_JOBS[k];
        const known = s.unlockedJobs.includes(j.name);
        const c = div(`gal-card ${known ? '' : 'unknown'}`, known ? `--bc:${groupColor(j.group)}` : '');
        if (known) {
          c.append(this.portrait(j.name, !!female.get(j.name), 54), div('gal-x', '', `x${count.get(j.name) ?? 0}`));
          c.dataset.k = `gal-${j.name}`;
          tap(c, () => this.ui.showJobCard(j.name, () => this.openGallery('jobs', page)));
        } else c.append(h('img', { class: 'pix sil', src: 'assets/ui/HintPerson.png' }), div('gal-q', '', '?'));
        grid.append(c);
      } else {
        const a = GALLERY_ANIMALS[k];
        const known = a.name in s.animals;
        const c = div(`gal-card ${known ? '' : 'unknown'}`, known ? `--bc:${TIER_COLORS[a.tier] ?? TIER_COLORS[0]}` : '');
        if (known) {
          const img = this.ui.animalImg(a.name, 54);
          img.classList.add('pix');
          c.append(img, div('gal-x', '', `x${s.animals[a.name] ?? 0}`));
          tap(c, () => this.ui.showAnimalCard(a.name, () => this.openGallery('animals', page)));
        } else c.append(h('img', { class: 'pix sil', src: 'assets/ui/AnimalSilhouette.png' }), div('gal-q', '', '?'));
        grid.append(c);
      }
    }
    const nav = div('gal-nav');
    const sw = div(`gal-btn ${kind === 'jobs' ? 'animals' : 'humans'}`);
    sw.dataset.k = 'gal-switch';
    tap(sw, () => this.openGallery(kind === 'jobs' ? 'animals' : 'jobs'));
    const prev = div(`gal-btn prev ${page > 0 ? '' : 'off'}`);
    if (page > 0) tap(prev, () => this.openGallery(kind, page - 1));
    const next = div(`gal-btn next ${page < pages - 1 ? '' : 'off'}`);
    next.dataset.k = 'gal-next';
    if (page < pages - 1) tap(next, () => this.openGallery(kind, page + 1));
    const close = div('gal-btn shut');
    tap(close, () => this.ui.close());
    nav.append(sw, prev, div('gal-page', '', `${page + 1}/${pages}`), next, close);
    body.append(grid, nav);
    this.ui.open('', body, undefined, 'gallery');
  }
}


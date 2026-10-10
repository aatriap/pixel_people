// HTML overlay: HUD, menus and popups. Uses the game's UI sprites and the 04b03 font.
import { Game, ComboKind, FREE_COOLDOWN } from '../logic/game';
import {
  DECOR, JOB, PATHS, RESIDENCES, TREES, WORKPLACE, Cost, displayName, jobDisplay, kindOf, landUse,
} from '../logic/data';
import { constructionRushCost, landRow, timeRushCost } from '../logic/formulas';
import { LAND } from '../logic/data';
import type { CityScene } from '../render/CityScene';
import { nowSec } from '../logic/save';
import { sfx } from './sound';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

function h(tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string | null | undefined)[]): HTMLElement {
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

function btn(label: string, cls: string, onClick: () => void, disabled = false, key = ''): HTMLButtonElement {
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

function costLine(c: Cost | null, land = 0, spirit = 0): HTMLElement {
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

const COMBO_IMG: Record<ComboKind, string> = {
  none: 'Splice_NoCombo', old: 'Splice_OldCombo', new: 'Splice_NewCombo', evil: 'Splice_EvilCombo',
};

export class UI {
  private panel: HTMLElement | null = null;
  private panelKind = '';
  private panelRefresh: (() => void) | null = null;
  private toastTimer = 0;
  buildType: string | null = null;

  constructor(private game: Game, private scene: CityScene, private onChange: () => void) {
    this.buildHud();
  }

  private get s() { return this.game.state; }

  // ---------------------------------------------------------------- HUD
  private buildHud() {
    const root = $('#ui');
    root.innerHTML = `
      <div class="hud">
        <div class="bar">
          <div class="pill" title="Utopium"><img src="assets/ui/Utopium.png"><span id="h-uto"></span></div>
          <div class="pill" title="Coins"><img src="assets/ui/Coin.png"><span id="h-coins"></span></div>
          <div class="pill" title="Chroma"><img src="assets/ui/Chroma.png"><span id="h-chroma"></span></div>
        </div>
        <div class="bar small">
          <div class="pill" title="Land used / limit">LAND <span id="h-land"></span></div>
          <div class="pill" title="Civic spirit / limit">SPIRIT <span id="h-spirit"></span></div>
          <div class="pill" title="Population / housing">POP <span id="h-pop"></span></div>
          <div class="pill" title="Coins per second">CPS <span id="h-cps"></span></div>
        </div>
      </div>
      <div id="pending"></div>
      <div id="buildbar" class="hidden"></div>
      <div class="footer">
        <button class="sprbtn b-build" id="f-build">BUILD</button>
        <button class="sprbtn b-splice" id="f-ac">CLONES</button>
        <button class="sprbtn b-expand" id="f-expand">EXPAND</button>
        <button class="iconbtn" id="f-menu" title="Menu">?</button>
      </div>
      <div id="toast" class="hidden"></div>
      <div id="modal" class="hidden"></div>`;
    $('#f-build').onclick = () => { sfx('tap_01'); this.openBuildMenu(); };
    $('#f-ac').onclick = () => { sfx('tap_01'); this.openArrivalCenter(); };
    $('#f-expand').onclick = () => { sfx('tap_01'); this.openExpand(); };
    $('#f-menu').onclick = () => { sfx('tap_01'); this.openMenu(); };
    $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) this.close(); });
  }

  update() {
    const s = this.s, g = this.game;
    $('#h-coins').textContent = fmtNum(s.coins);
    $('#h-uto').textContent = fmtNum(s.utopium);
    $('#h-chroma').textContent = fmtNum(s.chroma);
    $('#h-land').textContent = `${s.landUsed}/${s.landLimit}`;
    $('#h-land').classList.toggle('warn', g.freeLand() <= 3);
    $('#h-spirit').textContent = `${s.spirit}/${s.spiritLimit}`;
    $('#h-pop').textContent = `${g.population()}/${g.populationLimit()}`;
    $('#h-cps').textContent = fmtNum(g.totalCps());
    const acReady = s.slots.some((x) => x.state === 3 || x.state === 5);
    $('#f-ac').classList.toggle('glow', acReady);
    const pend = $('#pending');
    pend.innerHTML = '';
    if (!this.buildType) {
      for (const wp of s.pendingWorkplaces) {
        pend.append(btn(`PLACE ${displayName(wp).toUpperCase()} (FREE)`, 'b-green small', () => this.startBuild(wp)));
      }
      if (s.discoveries.length && this.panelKind !== 'card' && this.panelKind !== 'splicer') this.showDiscovery(s.discoveries[0]);
    }
    this.panelRefresh?.();
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
  private open(title: string, body: HTMLElement, refresh?: () => void, cls = '') {
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
    refresh?.();
  }

  close() {
    $('#modal').classList.add('hidden');
    $('#modal').innerHTML = '';
    this.panel = null;
    this.panelKind = '';
    this.panelRefresh = null;
  }

  private act(r: { ok: boolean; msg?: string }, okMsg?: string) {
    if (!r.ok) this.toast(r.msg ?? '', true);
    else if (okMsg) this.toast(okMsg);
    this.onChange();
    return r.ok;
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
            actions.append(btn('SPLICE', 'b-green small', () => this.openSplicer(idx), false, `spl${idx}`));
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
    this.open('ARRIVAL CENTER', body, refresh);
  }

  private progress(f: number): HTMLElement {
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
      }, info.kind === 'none');
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
    const done = () => { this.s.discoveries.shift(); this.onChange(); };
    if (wp && this.s.pendingWorkplaces.includes(wp)) {
      body.append(h('img', { class: 'wp', src: this.scene.workplaceThumb(wp, 120) }),
        h('div', {}, `FREE ${displayName(wp).toUpperCase()}! IT ONLY NEEDS ${WORKPLACE.get(wp)?.size ?? 1} LAND.`));
      body.append(btn('PLACE IT NOW', 'b-green', () => { done(); this.close(); this.startBuild(wp); }));
      body.append(btn('LATER', 'b-grey small', () => { done(); this.close(); }));
    } else {
      body.append(btn('OK', 'b-green', () => { done(); this.close(); }));
    }
    sfx('discovery_04');
    this.open('EUREKA!', body, undefined, 'card');
  }

  // ---------------------------------------------------------------- building popups
  openBuilding(id: string) {
    const g = this.game;
    const b = g.building(id);
    if (!b) return;
    if (b.type === 'SpacePort') return this.openArrivalCenter();
    const kind = kindOf(b.type);
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
        body.append(btn(`RUSH ${constructionRushCost(left)}u`, 'b-pink', () => { if (this.act(g.rushConstruction(id, nowSec()))) sfx('Construction_sound'); }));
        const free = this.freeButton(this.s.freeBuildReadyAt, () => this.act(g.freeConstruction(id, nowSec())));
        body.append(free, h('div', { class: 'hint' }, left > 3599 ? 'FREE: REDUCES TIME BY 1H (ONCE EVERY 24H)' : 'FREE: FINISHES NOW (ONCE EVERY 24H)'));
        return;
      }
      if (kind === 'workplace') {
        const w = WORKPLACE.get(b2.type)!;
        const workers = g.workers(b2);
        const W = g.buildingWorkingTime(b2);
        body.append(h('div', {}, `${g.buildingCps(b2)} COINS/SEC · SHIFT ${fmtTime(W)}`));
        if (b2.shiftStart >= 0) {
          const left = b2.shiftStart + W - now;
          body.append(h('b', { class: 'ok' }, 'WORKING'), h('div', {}, `SHIFT ENDS IN ${fmtTime(left)}`), this.progress(1 - left / Math.max(1, W)));
        } else if (workers.length) {
          body.append(h('b', { class: 'warn' }, 'IDLE'), btn('START WORKING', 'b-green', () => { this.act(g.tapWorkplace(id, nowSec())); }));
        } else {
          body.append(h('b', { class: 'warn' }, 'NO WORKERS YET'));
        }
        const list = h('div', { class: 'jobs' });
        for (const j of w.jobs) {
          const p = workers.find((x) => x.job === j);
          const known = this.s.unlockedJobs.includes(j);
          list.append(h('div', { class: `job ${p ? 'on' : ''}` },
            h('img', { src: p ? this.scene.clonePortrait(j, p.female) : 'assets/ui/status_lock.png' }),
            h('span', {}, known ? jobDisplay(j).toUpperCase() : '???'),
            h('small', {}, p ? (p.female ? JOB.get(j)!.femaleName : JOB.get(j)!.maleName).toUpperCase() : 'VACANT')));
        }
        body.append(list);
      } else if (kind === 'residence') {
        const res = g.residents(b2);
        const cap = RESIDENCES.find((r) => r.name === b2.type)!.population;
        body.append(h('div', {}, `RESIDENTS ${res.length}/${cap}`));
        const list = h('div', { class: 'jobs' });
        for (const p of res) list.append(h('div', { class: 'job on' }, h('img', { src: this.scene.clonePortrait(p.job, p.female) }), h('span', {}, p.job ? jobDisplay(p.job).toUpperCase() : 'CLONE')));
        body.append(list);
      } else if (kind === 'decor') {
        const d = DECOR.find((x) => x.name === b2.type)!;
        body.append(h('div', {}, `+${d.spirit} CIVIC SPIRIT`));
      }
    };
    this.open(displayName(b.type).toUpperCase(), body, refresh);
  }

  // ---------------------------------------------------------------- build menu
  openBuildMenu(tab: 'res' | 'decor' | 'path' | 'tree' = 'res') {
    const body = h('div', { class: 'buildmenu' });
    const tabs = h('div', { class: 'tabs' });
    const list = h('div', { class: 'items' });
    const tabsDef: [typeof tab, string][] = [['res', 'HOUSES'], ['decor', 'DECOR'], ['path', 'PATHS'], ['tree', 'TREES']];
    const show = (t: typeof tab) => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === t));
      list.innerHTML = '';
      const items: { type: string; cost: Cost | null; extra?: string; spirit?: number }[] = [];
      if (t === 'res') {
        for (const r of RESIDENCES) {
          if (!this.scene.hasFrame(r.name) || /^iap|^AGResidence|^Special/.test(r.name)) continue;
          if (!r.cost.coins && !r.cost.utopium && !r.cost.chroma) continue;
          items.push({ type: r.name, cost: r.cost, extra: `${r.population} BEDS · ${fmtTime(this.game.buildTime(r.name))}` });
        }
      } else if (t === 'decor') {
        const cats = ['Basic', 'Inspiring', 'Spectacular', 'Magnificent', 'Chroma (Normal)'];
        for (const d of DECOR) {
          if (!cats.includes(d.category) || !d.cost || !this.scene.hasFrame(d.name)) continue;
          items.push({ type: d.name, cost: d.cost, spirit: d.spirit, extra: d.category.toUpperCase() });
        }
      } else if (t === 'path') {
        for (const p of PATHS) if (p.cost && this.scene.hasFrame(p.name)) items.push({ type: p.name, cost: p.cost, extra: p.pathType.toUpperCase() });
      } else {
        for (const tr of TREES) if (tr.cost && /^Tree\d$/.test(tr.name)) items.push({ type: tr.name, cost: tr.cost });
      }
      for (const it of items) {
        const can = this.game.canAfford(it.cost!) && landUse(it.type) <= this.game.freeLand();
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

  startBuild(type: string) {
    this.close();
    this.buildType = type;
    this.scene.setBuildMode(type);
    const bar = $('#buildbar');
    bar.classList.remove('hidden');
    bar.innerHTML = '';
    const kind = kindOf(type);
    bar.append(h('img', { src: this.scene.workplaceThumb(type, 40) }),
      h('div', { class: 'bname' }, `${displayName(type).toUpperCase()}`, h('br'),
        h('small', {}, 'TAP A FREE SPOT TO PLACE')),
      costLine(this.game.placementCost(type), landUse(type)),
      btn('DONE', 'b-grey small', () => this.endBuild()));
    if (kind === 'path') bar.querySelector('small')!.textContent = 'TAP SPOTS TO LAY PATHS';
    this.update();
  }

  endBuild() {
    this.buildType = null;
    this.scene.setBuildMode(null);
    $('#buildbar').classList.add('hidden');
    this.update();
  }

  /** Called by the scene when the player taps a cell in build mode. */
  place(type: string, i: number, j: number) {
    const r = this.game.place(type, i, j, false, nowSec());
    if (!this.act(r)) return;
    sfx(kindOf(type) === 'path' ? 'tap_01' : 'Construction_sound');
    const k = kindOf(type);
    if (k === 'workplace' || k === 'residence') { this.endBuild(); }
    else if (!this.game.canAfford(this.game.placementCost(type)!) || landUse(type) > this.game.freeLand()) this.endBuild();
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
        btn('EXPAND', 'b-yellow', () => { if (this.act(g.expandLand(), 'UTOPIA EXPANDED! +10 LAND')) sfx('discovery_04'); }, this.s.coins < cost),
      );
    };
    this.open('EXPAND UTOPIA', body, refresh);
  }

  openMenu() {
    const body = h('div', { class: 'expand' },
      h('div', {}, 'PIXEL PEOPLE 4.20 WEB REMAKE — MILESTONE 1'),
      h('div', { class: 'hint' }, 'DRAG TO MOVE · WHEEL OR PINCH TO ZOOM · TAP TO ACT. THE GAME SAVES IN THIS BROWSER.'),
      h('div', { class: 'hint' }, `FREE BUTTONS: CONSTRUCTION ${this.s.freeBuildReadyAt > nowSec() ? 'IN ' + fmtTime(this.s.freeBuildReadyAt - nowSec()) : 'READY'} · SPLICER ${this.s.freeSpliceReadyAt > nowSec() ? 'IN ' + fmtTime(this.s.freeSpliceReadyAt - nowSec()) : 'READY'} (COOLDOWN ${FREE_COOLDOWN / 3600}H)`),
      btn('RESET ZOOM', 'b-grey small', () => { this.scene.setZoom(this.scene.defaultZoom()); this.close(); }),
      btn('NEW GAME (ERASES SAVE)', 'b-pink small', () => {
        if (confirm('Erase this city and start again?')) { window.dispatchEvent(new CustomEvent('pp-reset')); }
      }),
    );
    this.open('MENU', body);
  }
}

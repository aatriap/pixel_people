// Milestone 3 popups: settings, calendar, guests and mini-quests, achievements, Altar, Arcade, TV Station,
// utopium exchange, credits, skins and paint, tutorial narrator and breaking news.
import { ANIMALS, ANIMAL, CREDITS, JOBS, MISSIONS, OFFERS, STRINGS, displayName, jobDisplay, kindOf, DECOR_BY, RESIDENCE } from '../logic/data';
import { ACTIVE_ACHIEVEMENTS, ACH_BY_INDEX } from '../logic/achievements';
import { MINIQUEST, MQ } from '../logic/miniquests';
import {
  ALTAR_COIN_CAP, CATALOGUE_REFRESH_UTOPIUM, CLAW_CHROMA, CLAW_UTOPIUM, EXCHANGE_UTOPIUM, PACK_ITEMS, altarResult,
  dealPrice, exchangeCoins,
} from '../logic/shop';
import { SEASONS, WEEK, calendarAt, dayNumber, weekRewards, weekStart, weekday } from '../logic/calendar';
import { TUTORIAL } from '../logic/tutorial';
import { timeTillNoon } from '../logic/formulas';
import { FREE_COOLDOWN, MOTHERSHIP_UTOPIUM, REVEAL_UTOPIUM } from '../logic/game';
import type { Building } from '../logic/state';
import { exportSave, importSave, nowSec, saveFileName } from '../logic/save';
import { $, btn, costLine, fmtNum, fmtTime, h } from './dom';
import { sfx, setMuted } from './sound';
import type { UI } from './ui';

const cap = (s: string) => s[0] + s.slice(1).toLowerCase();
const fill = (t: string, ...v: (string | number)[]) => {
  let out = t.replace(/%%/g, '%');
  for (const x of v) out = out.replace(/%[is]/, String(x));
  return out;
};

export class Extras {
  constructor(private ui: UI) {}

  private get g() { return this.ui.game; }
  private get s() { return this.ui.game.state; }
  private local() { return this.g.local(nowSec()); }

  // ---------------------------------------------------------------- confirmation box (Yes / No)
  confirm(title: string, text: string, yes: () => void, back?: () => void) {
    const body = h('div', { class: 'confirm' }, h('div', { class: 'quote' }, text));
    const row = h('div', { class: 'row' });
    row.append(
      btn('', 'b-yes', () => { this.ui.close(); yes(); }, false, 'confirm-yes'),
      btn('', 'b-no', () => { this.ui.close(); back?.(); }, false, 'confirm-no'),
    );
    body.append(row);
    this.ui.open(title, body);
  }

  // ---------------------------------------------------------------- settings
  openSettings() {
    const ui = this.ui, s = this.s, g = this.g;
    const body = h('div', { class: 'settings' });
    const refresh = () => {
      const now = nowSec();
      body.innerHTML = '';
      const row = (label: string, ...kids: HTMLElement[]) => h('div', { class: 'setrow' }, h('span', {}, label), ...kids);
      body.append(
        row('MUSIC', btn(s.musicMuted ? 'OFF' : 'ON', s.musicMuted ? 'b-grey small' : 'b-green small', () => {
          s.musicMuted = !s.musicMuted; ui.music.setMuted(s.musicMuted); ui.onChange();
        }, false, 'set-music')),
        row('SOUND', btn(s.soundMuted ? 'OFF' : 'ON', s.soundMuted ? 'b-grey small' : 'b-green small', () => {
          s.soundMuted = !s.soundMuted; setMuted(s.soundMuted); ui.onChange();
        }, false, 'set-sound')),
        row('TUTORIAL', g.tutorialActive()
          ? btn('SKIP', 'b-orange small', () => this.confirm('SKIP TUTORIAL', 'SKIP THE TUTORIAL? UTOPIUM WILL RESET TO 25.', () => {
            ui.act(g.skipTutorial()); ui.endBuild();
          }, () => this.openSettings()), false, 'set-skip')
          : h('span', { class: 'ok' }, 'COMPLETE')),
      );
      body.append(h('div', { class: 'sethead' }, 'SAVE FILE'),
        h('div', { class: 'hint' }, 'MOVE YOUR CITY BETWEEN DEVICES (PC, IPHONE...): EXPORT IT HERE, THEN IMPORT THE FILE ON THE OTHER ONE.'),
        h('div', { class: 'row' },
          btn('EXPORT', 'b-green small', () => this.exportFile(), g.tutorialActive(), 'set-export'),
          btn('IMPORT', 'b-orange small', () => this.importFile(), false, 'set-import')));
      if (g.tutorialActive()) body.append(h('div', { class: 'hint' }, 'THE CITY IS SAVED ONCE THE TUTORIAL IS OVER.'));
      body.append(h('div', { class: 'sethead' }, 'INFO'),
        h('div', { class: 'hint' }, `FREE BUTTONS: CONSTRUCTION ${s.freeBuildReadyAt > now ? 'IN ' + fmtTime(s.freeBuildReadyAt - now) : 'READY'} · SPLICER ${s.freeSpliceReadyAt > now ? 'IN ' + fmtTime(s.freeSpliceReadyAt - now) : 'READY'} (COOLDOWN ${FREE_COOLDOWN / 3600}H)`),
        h('div', { class: 'hint' }, `DAILY RESET (MINE, SHELTER, TREES, MISSIONS, TV CATALOGUE) IN ${fmtTime(timeTillNoon(g.local(now)))}`),
        h('div', { class: 'hint' }, 'DRAG TO MOVE · WHEEL OR PINCH TO ZOOM · TAP TO ACT.'),
        h('div', { class: 'row' },
          btn('RESET ZOOM', 'b-grey small', () => { ui.scene.setZoom(ui.scene.defaultZoom()); ui.close(); }, false, 'set-zoom'),
          btn('RESET GAME', 'b-pink small', () => this.confirm('RESET GAME',
            'ERASE THIS CITY AND START A NEW GAME? THIS CANNOT BE UNDONE. EXPORT YOUR SAVE FIRST IF YOU WANT TO KEEP IT.',
            () => window.dispatchEvent(new CustomEvent('pp-reset')), () => this.openSettings()), false, 'set-reset')),
        h('div', { class: 'hint' }, 'PIXEL PEOPLE 4.20 WEB REMAKE · MILESTONE 3 · NO PURCHASES, NO ADS.'));
    };
    ui.open('SETTINGS', body, refresh);
  }

  private exportFile() {
    const text = exportSave(this.s);
    const name = saveFileName();
    const blob = new Blob([text], { type: 'application/json' });
    const file = typeof File !== 'undefined' ? new File([blob], name, { type: 'application/json' }) : null;
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    // iPhone: the share sheet can "Save to Files"; desktops download the file
    if (file && nav.canShare?.({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      nav.share({ files: [file], title: name }).catch(() => undefined);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    this.ui.toast('SAVE EXPORTED');
  }

  private importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json,text/plain';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      f.text().then((text) => {
        const st = importSave(text);
        if (!st) { this.ui.toast('NOT A PIXEL PEOPLE SAVE FILE', true); return; }
        this.confirm('IMPORT SAVE', `REPLACE THIS CITY WITH THE ONE IN "${f.name.toUpperCase()}"? (LAND LEVEL ${st.level}, ${st.unlockedJobs.length} JOBS)`,
          () => window.dispatchEvent(new CustomEvent('pp-import', { detail: text })), () => this.openSettings());
      }).catch(() => this.ui.toast('COULD NOT READ THE FILE', true));
    };
    input.click();
  }

  // ---------------------------------------------------------------- calendar (04 §5)
  openCalendar() {
    const ui = this.ui, g = this.g;
    const body = h('div', { class: 'calendar' });
    const refresh = () => {
      const local = this.local();
      const c = calendarAt(local);
      body.innerHTML = '';
      if (c.season < 0) { body.append(h('div', {}, STRINGS.Season_None_Desc ?? 'NO SEASON')); return; }
      const name = SEASONS[c.season];
      const nice = cap(name);
      const nextWeek = weekStart(local) + WEEK;
      body.append(h('div', { class: 'calhead' },
        h('img', { class: 'season', src: `assets/ui/SeasonArt_${nice}.png` }),
        h('div', {},
          h('div', { class: 'small' }, STRINGS.Season_CurrentSeason ?? 'CURRENT SEASON:'),
          h('div', { class: 'jobname' }, name),
          c.event ? h('div', { class: 'event' }, `${c.event.name.toUpperCase()}!`) : null,
          h('div', { class: 'hint' }, fill(STRINGS.Calendar_TimeLeft ?? '%s left', fmtTime(nextWeek - local)).toUpperCase()),
          h('div', { class: 'hint' }, 'SEASONS CHANGE EVERY WEEK!'))));
      body.append(h('div', { class: 'small' }, (STRINGS.Calendar_Desc ?? '').toUpperCase()));
      const week = h('div', { class: 'week' });
      const wd = weekday(local);
      const today = dayNumber(local);
      const monday = dayNumber(weekStart(local));
      (weekRewards(local) ?? []).forEach((r, i) => {
        const day = monday + i;
        const got = this.s.calendarCollected.includes(day);
        const icon = r.kind === 'utopium' ? 'Utopium' : r.kind === 'chroma' ? 'Chroma' : r.kind === 'coins' ? 'Coin' : 'GiftPacket';
        const cell = h('div', { class: `day ${i >= 5 ? 'weekend' : ''} ${day === today ? 'today' : ''} ${day < today ? 'past' : ''}` },
          h('small', {}, STRINGS[`Calendar_${i}`] ?? 'MTWTFSS'[i]),
          h('img', { src: `assets/ui/${icon}.png` }),
          h('small', {}, r.kind === 'gift' ? 'GIFT' : `${r.n}`));
        if (got) cell.append(h('img', { class: 'tick', src: 'assets/ui/GiftCollected.png' }));
        week.append(cell);
      });
      body.append(week);
      const r = weekRewards(local)?.[wd];
      if (r) {
        const what = r.kind === 'gift' ? (STRINGS.Calendar_Gift ?? 'A RANDOM GIFT') : `${r.n} ${r.kind.toUpperCase()}`;
        body.append(this.s.dailyGift
          ? btn(`COLLECT ${what}`, 'b-green', () => { if (ui.act(g.collectCalendar(nowSec()))) { sfx('correct_03'); ui.close(); } }, false, 'cal')
          : btn((STRINGS.Calendar_ComebackTmr ?? 'COME BACK TOMORROW').toUpperCase(), 'b-grey', () => {}, true));
      }
      // this season's exclusive missions and animals
      const uniques = MISSIONS.filter((m) => m.type === 4 && m.season === name && !m.discontinued);
      body.append(h('div', { class: 'sethead' }, STRINGS[`Season_${nice}_Mission_Header`] ?? `${name}-EXCLUSIVE MISSIONS`));
      const ml = h('div', { class: 'seasonlist' });
      for (const m of uniques) {
        const done = this.s.missions.uniquesDone.includes(m.id);
        const sp = m.reward.startsWith('SP-') ? m.reward.slice(3) : null;
        ml.append(h('div', { class: `smis ${done ? 'done' : ''}` },
          sp ? h('img', { src: ui.scene.clonePortrait(sp, false, 40) }) : null,
          h('small', {}, m.name.toUpperCase()), done ? h('small', { class: 'ok' }, 'DONE') : null));
      }
      if (!uniques.length) ml.append(h('div', { class: 'hint' }, 'NONE THIS SEASON'));
      body.append(ml, h('div', { class: 'hint' }, (STRINGS[`Season_${nice}_Mission_Desc`] ?? '').toUpperCase()));
      body.append(h('div', { class: 'sethead' }, (STRINGS[`Season_${nice}_Bottom`] ?? `${name} ANIMALS`).toUpperCase()));
      const al = h('div', { class: 'agrid seasonal' });
      for (const a of ANIMALS.filter((x) => x.seasons.includes(name) && x.droppable && !x.omit)) {
        const seen = this.s.animalsSeen.includes(a.name);
        al.append(h('div', { class: `acell ${seen ? '' : 'dim'}` }, ui.animalImg(a.name, 36), h('small', {}, seen ? a.name.toUpperCase() : '???')));
      }
      body.append(al);
    };
    ui.open((STRINGS.Calendar_Header ?? 'CALENDAR').toUpperCase(), body, undefined, 'wide');
    refresh();
  }

  // ---------------------------------------------------------------- guests (04 §4)
  onGuest(code: number, job?: string) {
    if (this.g.tutorialActive()) return;
    sfx('notification_01');
    if (code === 2001 && job) this.openSpecialGuest(job);
    else this.openMiniQuests();
  }

  openSpecialGuest(job: string) {
    const ui = this.ui, g = this.g;
    const body = h('div', { class: 'card guest' },
      h('img', { class: 'art', src: 'assets/ui/SpecialGeneCollectArt.png' }),
      h('div', { class: 'quote' }, STRINGS.Guest_Special_Desc ?? ''),
      h('img', { class: 'big', src: ui.scene.clonePortrait(job, false, 96) }),
      h('div', { class: 'jobname' }, jobDisplay(job).toUpperCase()),
      h('div', {}, (STRINGS.Guest_Special_Bottom ?? '').replace('\\n', ' ')),
      btn((STRINGS.Guest_Collect ?? 'COLLECT').toUpperCase(), 'b-green', () => { ui.close(); ui.act(g.claimSpecialGene(job)); }, false, 'guest-collect'));
    ui.open('SPECIAL GENE', body, undefined, 'card');
  }

  /** cMiniQuestGuestNPC popup: the available mini-quests, one page each. */
  openMiniQuests(page = 0) {
    const ui = this.ui, g = this.g, mq = g.miniquests;
    const body = h('div', { class: 'miniquest' });
    const refresh = () => {
      const local = this.local();
      const list = mq.available(local);
      body.innerHTML = '';
      if (!list.length) { body.append(h('div', {}, 'NO MINI-QUESTS RIGHT NOW. THE GUEST HAS BEAMED UP!')); return; }
      page = Math.min(page, list.length - 1);
      const id = list[page];
      const q = MINIQUEST.get(id)!;
      const st = mq.save(id).stage;
      const stage = q.stages[st];
      const qty = mq.qty(id);
      const key = q.key;
      body.append(h('img', { class: 'banner', src: `assets/ui/${q.banner}.png` }),
        h('div', { class: 'jobname' }, (STRINGS[`MiniQuest_${key}_Title`] ?? key).toUpperCase()),
        h('div', { class: 'quote' }, (STRINGS[`MiniQuest_${key}_Desc${st}`] ?? '').replace(/\\n/g, ' ')),
        h('div', { class: 'mqbottom' }, fill(STRINGS[`MiniQuest_${key}_Bottom${st}`] ?? '%i / ' + stage.req, qty)),
        this.ui.progress(stage.req ? qty / stage.req : 1),
        h('div', { class: 'mrew' }, `REWARD: ${this.rewardText(stage.reward)}`));
      const done = mq.isFulfilled(id);
      const row = h('div', { class: 'row' });
      row.append(btn('<', 'b-grey small', () => { page = (page + list.length - 1) % list.length; refresh(); }, list.length < 2, 'mq-prev'),
        btn((STRINGS.MiniQuest_Collect ?? 'COLLECT').toUpperCase(), 'b-green', () => {
          if (ui.act(mq.collect(id, this.local()))) { sfx('discovery_04'); ui.close(); }
        }, !done, 'mq-collect'),
        btn('>', 'b-grey small', () => { page = (page + 1) % list.length; refresh(); }, list.length < 2, 'mq-next'));
      body.append(row, h('div', { class: 'hint' }, `${page + 1} / ${list.length}`));
    };
    ui.open((STRINGS.MiniQuest_Popup_Title ?? 'MOTHERSHIP ALERT').toUpperCase(), body, refresh);
  }

  private rewardText(code: string): string {
    const [k, v] = code.split('-');
    const n = Number(v);
    switch (k) {
      case 'U': return `${n} UTOPIUM`;
      case 'Chr': return `${n} CHROMA`;
      case 'A': return '9 ANIMALS PACK!';
      case 'C': return 'COINS';
      default: return code;
    }
  }

  // ---------------------------------------------------------------- achievements (04 §6)
  openAchievements() {
    const ui = this.ui, ach = this.g.achievements;
    const body = h('div', { class: 'achievements' });
    const refresh = () => {
      body.innerHTML = '';
      const done = ACTIVE_ACHIEVEMENTS.filter((a) => ach.isDone(a.index)).length;
      body.append(h('div', { class: 'hint' }, `UNLOCKED ${done} / ${ACTIVE_ACHIEVEMENTS.length}`));
      const list = h('div', { class: 'achlist' });
      for (const a of ACTIVE_ACHIEVEMENTS) {
        const d = ach.isDone(a.index), c = ach.isCollected(a.index);
        const row = h('div', { class: `ach ${d ? 'done' : ''}` },
          h('img', { src: `assets/ui/ach/${a.sprite}.png`, class: d ? '' : 'locked' }),
          h('div', { class: 'info' }, h('b', {}, a.title.toUpperCase()), h('small', {}, a.desc.toUpperCase()),
            a.reward ? h('small', { class: 'rew' }, fill(STRINGS.Achievement_RewardText ?? 'REWARD: %i UTOPIUM', a.reward)) : null));
        if (d && !c) row.append(btn((STRINGS.Achievement_Collect ?? 'COLLECT').toUpperCase(), 'b-green small', () => {
          if (ui.act(ach.collect(a.index))) sfx('correct_03');
        }, false, `ach${a.index}`));
        else if (c) row.append(h('small', { class: 'ok' }, (STRINGS.Achievement_Collected ?? 'COLLECTED').toUpperCase()));
        else row.append(h('img', { class: 'lock', src: 'assets/ui/status_lock.png' }));
        list.append(row);
      }
      body.append(list);
    };
    ui.open((STRINGS.Achievements_Title ?? 'ACHIEVEMENTS').toUpperCase(), body, refresh, 'wide');
  }

  /** playBreakingNewsAchievement: a banner on the news bar. */
  breakingNews(index: number) {
    const a = ACH_BY_INDEX.get(index);
    if (!a) return;
    const el = $('#breaking');
    el.innerHTML = '';
    el.append(h('img', { src: 'assets/ui/breaking_news_1.png', class: 'bn' }), h('img', { src: `assets/ui/ach/${a.sprite}.png` }),
      h('span', {}, `${(STRINGS.Achievement_Unlocked ?? 'ACHIEVEMENT UNLOCKED').toUpperCase()}: ${a.title.toUpperCase()}`));
    el.classList.remove('hidden');
    sfx('Broadcast_News_Short');
    clearTimeout(this.newsTimer);
    this.newsTimer = window.setTimeout(() => el.classList.add('hidden'), 4500);
  }
  private newsTimer = 0;

  // ---------------------------------------------------------------- Altar (02 §6)
  openAltar() {
    const ui = this.ui, g = this.g, shop = g.shop;
    const sel: (string | null)[] = [null, null];
    const body = h('div', { class: 'altar' });
    const render = () => {
      body.innerHTML = '';
      const [a, b] = sel;
      const top = h('div', { class: 'altartop' });
      const slot = (k: 0 | 1) => {
        const n = sel[k];
        const d = h('div', { class: `pick ${n ? 'on' : ''}` }, n ? ui.animalImg(n, 56) : h('span', {}, '?'), h('div', {}, n ? n.toUpperCase() : 'ANIMAL'));
        d.addEventListener('click', () => { sel[k] = null; render(); });
        return d;
      };
      const r = a && b ? altarResult(a, b) : { kind: 'none' as const };
      const ind = a && b ? shop.altarIndicator(a, b) : 'none';
      const img = ind === 'none' ? 'Splice_NoCombo' : ind === 'old' ? 'Splice_OldCombo' : 'Splice_NewCombo';
      let text = a && b ? 'NO GENETIC MATCH' : 'SELECT TWO ANIMALS';
      if (r.kind === 'recipe') text = ind === 'old' ? `KNOWN: ${r.animal.toUpperCase()}` : 'NEW GENETIC MATCH FOUND!';
      if (r.kind === 'cat' || r.kind === 'dog') text = `A RANDOM BASE ${r.kind.toUpperCase()}`;
      const cost = a && b && r.kind !== 'none' ? shop.altarCost(a, b) : 0;
      top.append(slot(0), h('div', { class: 'combo' }, h('img', { src: `assets/ui/${img}.png` })), slot(1));
      body.append(h('img', { class: 'altarart', src: 'assets/ui/AnimalSpliceArt.png' }), top,
        h('div', { class: 'combotext' }, text),
        r.kind !== 'none' ? costLine({ coins: cost, utopium: 0, chroma: 0 }) : h('span'),
        btn('SPLICE', 'b-green', () => {
          const res = shop.altarSplice(a!, b!, this.local());
          if (ui.act(res)) { sfx('splice_02'); sel[0] = sel[1] = null; ui.close(); }
        }, r.kind === 'none', 'altar-splice'),
        h('div', { class: 'hint' }, `${STRINGS.Altar_Intro3 ?? ''} COST: A SHARE OF THE NEXT LAND LEVEL, AT MOST ${fmtNum(ALTAR_COIN_CAP)} COINS. RESULT IS INSTANT.`),
        h('div', { class: 'hint' }, (STRINGS.Altar_Hint ?? '').toUpperCase()));
      const grid = h('div', { class: 'agrid' });
      const owned = Object.keys(this.s.animals).filter((n) => this.s.animals[n] > 0).sort();
      if (!owned.length) grid.append(h('div', { class: 'hint' }, 'NO ANIMALS YET. HEARTS, THE ANIMAL SHELTER, GIFTS AND THE PET STORE GIVE ANIMALS.'));
      for (const n of owned) {
        const used = sel.filter((x) => x === n).length;
        const left = this.s.animals[n] - used;
        const cell = h('div', { class: `acell ${used ? 'on' : ''} ${left < 1 ? 'dim' : ''}` }, ui.animalImg(n, 40),
          h('small', {}, `${n.toUpperCase()} x${this.s.animals[n]}`), h('small', { class: 'tier' }, `T${ANIMAL.get(n)?.tier ?? '?'}`));
        cell.addEventListener('click', () => {
          if (left < 1) return;
          sfx('tap_01');
          if (sel[0] === null) sel[0] = n; else if (sel[1] === null) sel[1] = n; else { sel[0] = sel[1]; sel[1] = n; }
          render();
        });
        grid.append(cell);
      }
      body.append(grid);
    };
    ui.open((STRINGS.Altar_Header ?? 'ALTAR').toUpperCase(), body, undefined, 'wide');
    render();
  }

  // ---------------------------------------------------------------- Arcade (05 §1)
  openArcade() {
    const ui = this.ui, g = this.g, s = this.s;
    const body = h('div', { class: 'arcade' });
    const refresh = () => {
      body.innerHTML = '';
      const total = OFFERS.skins.length, got = s.skins.length;
      body.append(h('div', { class: 'jobname' }, (STRINGS.Arcade_Header ?? "THE CLAW").replace(/\\n/g, ' ')),
        h('div', { class: 'quote' }, (STRINGS.Arcade_Special ?? '').replace(/\\n/g, ' ')),
        h('img', { class: 'claw', src: 'assets/ui/packets/ArcadePacket.png' }),
        h('div', {}, fill(STRINGS.Gacha_SkinsCollected ?? 'Skins Collected: %i / %i', got, total).toUpperCase()),
        this.ui.progress(got / total));
      const row = h('div', { class: 'row' });
      const play = (cur: 'utopium' | 'chroma') => {
        const price = cur === 'utopium' ? CLAW_UTOPIUM : CLAW_CHROMA;
        this.confirm('THE CLAW', `SPEND ${price} ${cur.toUpperCase()} TO CONTINUE?`, () => {
          if (ui.act(g.shop.playClaw(cur))) sfx('buff_tadaa');
        }, () => this.openArcade());
      };
      row.append(btn(`PLAY ${CLAW_UTOPIUM}u`, 'b-pink', () => play('utopium'), got >= total, 'claw-u'),
        btn(`PLAY ${CLAW_CHROMA}c`, 'b-orange', () => play('chroma'), got >= total, 'claw-c'));
      body.append(row, h('div', { class: 'hint' }, 'EACH ROLL UNLOCKS ONE NEW BUILDING SKIN AT RANDOM, NEVER A DUPLICATE. TAP THE SKIN BUTTONS IN A BUILDING TO SWITCH.'));
      const list = h('div', { class: 'skinlist' });
      for (const sk of OFFERS.skins) {
        const has = s.skins.includes(sk.skin);
        list.append(h('div', { class: `skin ${has ? '' : 'dim'}` },
          h('img', { src: has ? ui.scene.workplaceThumb(sk.skin, 56) : 'assets/ui/status_lock.png' }),
          h('small', {}, displayName(sk.building).toUpperCase())));
      }
      body.append(list);
    };
    ui.open('ARCADE', body, refresh, 'wide');
  }

  /** Skin selector (cycleTileSkin) shown in a building popup when a skin of its type is unlocked. */
  skinRow(b: Building): HTMLElement | null {
    const ui = this.ui, shop = this.g.shop;
    const skins = shop.skinsFor(b.type);
    if (!skins.length) return null;
    const row = h('div', { class: 'row skins' }, h('small', {}, 'SKIN:'));
    row.append(btn('ORIGINAL', b.skin ? 'b-grey small' : 'b-green small', () => ui.act(shop.setSkin(b.id, null)), false, `skin-o-${b.id}`));
    skins.forEach((sk, i) => row.append(btn(`SKIN ${String.fromCharCode(65 + i)}`, b.skin === sk ? 'b-green small' : 'b-grey small',
      () => ui.act(shop.setSkin(b.id, sk)), false, `skin-${i}-${b.id}`)));
    return row;
  }

  /** PAINT (2 random colours) and RESET for a residence (05 §3.5). */
  paintRow(b: Building): HTMLElement | null {
    if (kindOf(b.type) !== 'residence' || !this.ui.scene.hasFrame(`${b.type}_Layer1`)) return null;
    const ui = this.ui, shop = this.g.shop;
    const sw = (c: number) => h('span', { class: 'swatch', style: `background:#${c.toString(16).padStart(6, '0')}` });
    return h('div', { class: 'row paint' },
      ...(b.paint ? b.paint.map(sw) : []),
      btn('PAINT', 'b-orange small', () => { if (ui.act(shop.paint(b.id))) sfx('splice_02'); }, false, `paint-${b.id}`),
      btn((STRINGS.PaintPopup_reset ?? 'RESET').toUpperCase(), 'b-grey small', () => ui.act(shop.resetPaint(b.id)), !b.paint, `paintr-${b.id}`));
  }

  // ---------------------------------------------------------------- TV Station (05 §3.3, §5.1)
  openTv(tab: 'deals' | 'packs' | 'coins' = 'deals') {
    const ui = this.ui, g = this.g, s = this.s, shop = g.shop;
    const body = h('div', { class: 'tv' });
    const tabs = h('div', { class: 'tabs' });
    const list = h('div', { class: 'items' });
    const show = () => {
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === tab));
      list.innerHTML = '';
      if (tab === 'deals') {
        list.append(h('div', { class: 'hint wideitem' }, (STRINGS.HousesDecor_Desc ?? '').toUpperCase()),
          h('div', { class: 'hint wideitem' }, fill(STRINGS.HousesDecor_RefreshTimer ?? 'OPTIONS REFRESH IN: %s', fmtTime(timeTillNoon(this.local())))));
        s.deals.forEach((d, i) => {
          const p = dealPrice(d.id)!;
          const out = d.stock < 1;
          const spirit = DECOR_BY.get(d.id)?.spirit ?? 0;
          const beds = RESIDENCE.get(d.id)?.population ?? 0;
          list.append(h('div', { class: `item ${out ? 'dim' : ''}` },
            h('img', { src: ui.scene.workplaceThumb(d.id, 72) }),
            h('div', { class: 'iname' }, displayName(d.id).toUpperCase()),
            h('small', {}, spirit ? `+${spirit} SPIRIT` : beds ? `${beds} BEDS` : ''),
            out ? h('b', {}, STRINGS.HousesDecor_OutOfStock ?? 'OUT OF STOCK')
              : h('div', { class: 'row' },
                btn(`${p.utopium}u`, 'b-pink small', () => { if (ui.act(shop.buyDeal(i, 'utopium', this.local()))) sfx('correct_03'); }, s.utopium < p.utopium, `deal-u${i}`),
                btn(`${p.chroma}c`, 'b-orange small', () => { if (ui.act(shop.buyDeal(i, 'chroma', this.local()))) sfx('correct_03'); }, s.chroma < p.chroma, `deal-c${i}`))));
        });
        list.append(h('div', { class: 'wideitem' }, btn(`${(STRINGS.HousesDecor_RefreshNow ?? 'REFRESH NOW').toUpperCase()} ${CATALOGUE_REFRESH_UTOPIUM}u`, 'b-pink small',
          () => ui.act(shop.refreshDeals()), s.utopium < CATALOGUE_REFRESH_UTOPIUM, 'deal-refresh')));
      } else if (tab === 'packs') {
        list.append(h('div', { class: 'hint wideitem' }, 'SPECIAL ITEMS ONCE SOLD ONLY IN PACKS. BUY ONE WITH CHROMA TO UNLOCK IT FOR GOOD: THE FIRST GOES TO STORAGE, MORE CAN BE BUILT FROM THE BUILD MENU.'));
        for (const pack of OFFERS.packs) {
          list.append(h('div', { class: 'wideitem packhead' }, h('img', { src: `assets/ui/${pack.art}.png` })));
          for (const it of PACK_ITEMS.filter((p) => p.pack === pack.id)) {
            const has = shop.packUnlocked(it.tile);
            const spirit = DECOR_BY.get(it.tile)?.spirit ?? 0;
            const beds = RESIDENCE.get(it.tile)?.population ?? 0;
            list.append(h('div', { class: `item ${has ? 'owned' : ''}` },
              h('img', { src: ui.scene.workplaceThumb(it.tile, 72) }),
              h('div', { class: 'iname' }, displayName(it.tile).toUpperCase()),
              h('small', {}, spirit ? `+${spirit} SPIRIT` : beds ? `${beds} BEDS` : kindOf(it.tile).toUpperCase()),
              has ? h('b', { class: 'ok' }, 'UNLOCKED')
                : btn(`${it.chroma}c`, 'b-orange small', () => { if (ui.act(shop.buyPackItem(it.tile, this.local()))) sfx('discovery_04'); }, s.chroma < it.chroma, `pack-${it.tile}`)));
          }
        }
      } else {
        list.append(this.exchangeBody());
      }
    };
    for (const [t, label] of [['deals', 'CATALOGUE'], ['packs', 'CHROMA SHOP'], ['coins', 'GET COINS']] as const) {
      const b = btn(label, 'tab', () => { tab = t; show(); }, false, `tv-${t}`);
      b.dataset.t = t;
      tabs.append(b);
    }
    body.append(h('div', { class: 'hint' }, `${STRINGS.HousesDecor_SubTitle ?? ''} · YOU HAVE ${fmtNum(s.utopium)}u · ${fmtNum(s.chroma)}c`), tabs, list);
    ui.open((STRINGS.HousesDecor_Title ?? 'TV STATION').toUpperCase(), body, show, 'wide');
  }

  /** cShopPopup idx 4..7: utopium -> coins (05 §3.2). */
  exchangeBody(): HTMLElement {
    const ui = this.ui, g = this.g, s = this.s;
    const box = h('div', { class: 'exchange wideitem' }, h('div', { class: 'hint' }, 'TRADE UTOPIUM FOR COINS.'));
    EXCHANGE_UTOPIUM.forEach((u, i) => {
      const coins = exchangeCoins(i, s.level);
      box.append(h('div', { class: 'exrow' },
        h('img', { src: 'assets/ui/Coin_BoxArt.png' }),
        h('span', {}, `${fmtNum(coins)} COINS`),
        btn(`${u}u`, 'b-pink small', () => this.confirm('GET COINS', `SPEND ${u} UTOPIUM FOR ${fmtNum(coins)} COINS?`,
          () => { if (ui.act(g.shop.exchange(i))) sfx('correct_03'); }), s.utopium < u, `ex${i}`)));
    });
    return box;
  }

  openExchange() {
    const body = h('div', { class: 'items' });
    const refresh = () => { body.innerHTML = ''; body.append(this.exchangeBody()); };
    this.ui.open('GET COINS', body, refresh);
  }

  // ---------------------------------------------------------------- Sheriff's Office (credits)
  openCredits() {
    const ui = this.ui, g = this.g;
    const body = h('div', { class: 'credits' });
    const refresh = () => {
      body.innerHTML = '';
      body.append(h('div', { class: 'quote' }, (STRINGS['Sheriffs Office_Special'] ?? '').replace(/\\n/g, ' ')));
      const list = h('div', { class: 'agrid' });
      for (const c of CREDITS) {
        const got = this.s.creditsCollected.includes(c.id);
        const cell = h('div', { class: 'acell' }, h('img', { src: `assets/ui/credits/${c.id}.png`, class: 'mug' }), h('small', {}, c.name), h('small', {}, c.role.toUpperCase()));
        if (c.reward && !got) cell.append(btn(`${c.reward}u`, 'b-green small', () => ui.act(g.collectCredit(c.id)), false, `cr${c.id}`));
        list.append(cell);
      }
      body.append(list);
    };
    ui.open((STRINGS['Sheriffs Office_Header'] ?? 'MOST WANTED').toUpperCase(), body, refresh, 'wide');
  }

  // ---------------------------------------------------------------- special buttons added in milestone 3
  specialButtons(type: string, row: HTMLElement) {
    const ui = this.ui, g = this.g;
    const head = (t: string) => h('div', { class: 'hint' }, (STRINGS[`${t}_Special`] ?? '').replace(/\\n/g, ' '));
    switch (type) {
      case 'Altar': row.append(btn('ENTER', 'b-special', () => this.openAltar(), false, 'altar'), head('Altar')); break;
      case 'Arcade': row.append(btn('THE CLAW', 'b-special', () => this.openArcade(), false, 'arcade'), head('Arcade')); break;
      case 'TV Station': row.append(btn('WATCH', 'b-special', () => this.openTv(), false, 'tv'),
        h('div', { class: 'hint' }, 'CATALOGUE OF SPECIAL HOUSES AND DECOR, CHROMA SHOP AND COINS.')); break;
      case 'Observatory': row.append(btn('CHANGE', 'b-special', () => { if (ui.act(g.changeBackground())) sfx('discovery_04'); }, false, 'obs'), head('Observatory')); break;
      case 'Funeral Parlor': row.append(btn(this.s.spiritWatch ? 'HIDE SPIRIT WATCH' : 'SHOW SPIRIT WATCH', 'b-special', () => ui.act(g.toggleSpiritWatch()), false, 'fun'),
        h('div', { class: 'hint' }, 'SHOW OR HIDE THE SPIRIT WATCH (SPIRIT AND DISCOUNT).')); break;
      case 'News Bureau': row.append(btn(this.s.newsFeed ? 'NEWSFEED: ON' : 'NEWSFEED: OFF', 'b-special', () => ui.act(g.toggleNewsFeed()), false, 'news'), head('News Bureau')); break;
      case 'Police Station': row.append(btn('ACHIEVEMENTS', 'b-special', () => this.openAchievements(), false, 'police')); break;
      case 'Sheriffs Office': row.append(btn('SEARCH', 'b-special', () => this.openCredits(), false, 'sheriff'), head('Sheriffs Office')); break;
      case 'Town Hall': row.append(
        btn('SAVE', 'b-special', () => { g.manualSave(nowSec()); ui.onChange(); ui.toast('UTOPIA SAVED!'); }, g.tutorialActive(), 'thsave'),
        btn('GET COINS', 'b-orange small', () => this.openExchange(), false, 'thcoins'));
        break;
    }
  }

  /** Mothership button for a worker (1 u, not for unique characters). */
  mothershipBtn(pid: string): HTMLElement | null {
    const ui = this.ui, g = this.g;
    if (!g.canDeletePeep(pid)) return null;
    return btn(`MOTHERSHIP ${MOTHERSHIP_UTOPIUM}u`, 'b-pink small', () => this.confirm('MOTHERSHIP',
      `SPEND ${MOTHERSHIP_UTOPIUM}u TO DELETE THIS CLONE? IT WILL BE GONE FOREVER.`, () => { if (ui.act(g.deleteClone(pid))) sfx('recharge_10'); }), false, `ms${pid}`);
  }

  /** Vacant job cell: reveal the formula for 5 u. */
  revealBtn(job: string): HTMLElement | null {
    const ui = this.ui, g = this.g;
    const need = g.requiredMission(job);
    if (need) return h('small', { class: 'hint' }, `UNSPLICABLE UNTIL "${(MISSIONS.find((m) => m.id === need)?.name ?? need).toUpperCase()}" IS COMPLETE`);
    if (this.s.revealed.includes(job)) {
      const r = g.revealFormula(job);
      return h('small', { class: 'formula' }, r.msg!.replace(/_/g, ' ').toUpperCase());
    }
    return btn(`REVEAL ${REVEAL_UTOPIUM}u`, 'b-grey small', () => this.confirm('REVEAL FORMULA?', `SPEND ${REVEAL_UTOPIUM} UTOPIUM TO SEE WHICH TWO GENES MAKE THIS JOB?`,
      () => ui.act(g.revealFormula(job), 'FORMULA REVEALED')), false, `rv${job}`);
  }

  // ---------------------------------------------------------------- news feed (cNewsFeed)
  private newsIdx = -1;
  newsText(): string {
    const peeps = this.s.peeps;
    this.newsIdx = (this.newsIdx + 1 + Math.floor(Math.random() * 5)) % 24;
    const name = () => {
      const p = peeps[Math.floor(Math.random() * peeps.length)];
      if (!p?.job) return 'A clone';
      const j = JOBS.find((x) => x.name === p.job);
      return j ? (p.female ? j.femaleName : j.maleName) : 'A clone';
    };
    return (STRINGS[`GenericNews_${this.newsIdx}`] ?? '').replace(/XXXX/g, name).replace(/YYYY/g, 'Diner');
  }

  // ---------------------------------------------------------------- tutorial narrator (01 §5)
  tutorialText(step: number): string {
    const t = TUTORIAL[step];
    if (!t) return '';
    const total = JOBS.filter((j) => j.type !== 'Guest').length;
    return fill(STRINGS[t.text] ?? t.text, total).replace(/\\n/g, ' ');
  }

  /** Mini-quest ids that a COLLECT would pay right now (for the guest bubble). */
  readyQuests(): number[] {
    const local = this.local();
    return this.g.miniquests.available(local).filter((id) => this.g.miniquests.isFulfilled(id));
  }
}

export { MQ };

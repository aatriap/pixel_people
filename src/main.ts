import Phaser from 'phaser';
import './style.css';
import { Game } from './logic/game';
import { importSave, load, nowSec, save, wipe } from './logic/save';
import { CityScene } from './render/CityScene';
import { UI } from './ui/ui';
import { sfx, setMuted } from './ui/sound';
import { STRINGS, displayName } from './logic/data';
import { Music } from './ui/music';
import { kindOf } from './logic/data';

async function start() {
  const manifest: Record<string, string[]> = await (await fetch('assets/atlas/manifest.json')).json();
  const pages = Object.values(manifest).flat();
  const storage = typeof localStorage !== 'undefined' ? localStorage : undefined;
  const saved = load(storage);
  // a new game starts in the tutorial (01 §5); saves made before milestone 3 count as done
  const game = saved ? new Game(saved) : Game.fresh(nowSec(), true);
  setMuted(game.state.soundMuted);
  (window as unknown as { pp: Game }).pp = game; // handy for debugging and the screenshot script

  const scene = new CityScene();
  let ui: UI;
  // like the game, nothing is saved while the tutorial runs (cUserData::writeData checks CURRENT_TUTORIAL)
  const persist = () => { if (!game.tutorialActive()) save(storage, game.state); };
  const changed = () => {
    persist();
    scene.refresh();
    ui.update();
  };

  const phaser = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    transparent: true,
    pixelArt: true,
    antialias: false,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    input: { activePointers: 3 },
    scene: [],
  });
  phaser.scene.add('city', scene, true, {
    game,
    pages,
    hooks: {
      onTapBuilding: (id: string) => {
        const b = game.building(id);
        if (!b) return;
        if (ui.editing) { ui.editTap(id); return; }
        if (game.state.hearts.on === id) { ui.tapHeartOn(); changed(); return; }
        // tutorial step 22: "tap on the mine to start work there"
        if (b.type === 'Utopium Mine' && game.state.tutorial === 22 && game.tapWorkplace(id, nowSec()).ok) { sfx('recharge_10'); changed(); return; }
        if (b.treeReady && kindOf(b.type) === 'tree') { game.tapTree(id, nowSec()); flushEvents(); changed(); return; }
        const specialReady = (b.type === 'Utopium Mine' && game.state.dailyUtopium) || (b.type === 'Animal Shelter' && game.state.dailyAnimal);
        if (game.needsRestart(b) && !specialReady) {
          if (game.tapWorkplace(id, nowSec()).ok) { sfx('recharge_10'); ui.toast('BACK TO WORK!'); changed(); return; }
        }
        ui.openBuilding(id);
      },
      onPlace: (type: string, i: number, j: number) => ui.place(type, i, j),
      onTapEmpty: (i: number, j: number) => ui.tapLand(i, j),
      onTapGuest: (code: number, job?: string) => { if (!ui.editing && !ui.buildType) ui.x.onGuest(code, job); },
      onReady: () => ready(),
    },
  });
  function flushEvents() {
    for (const e of game.drainEvents()) {
      if (e.type === 'coins') scene.coinGain(e.building, e.amount);
      if (e.type === 'arrived') { sfx('recharge_10'); ui.toast('A NEW CLONE ARRIVED!'); }
      if (e.type === 'built') {
        sfx('correct_03');
        const b = game.building(e.building);
        if (b && game.firstTickDone) ui.toast((STRINGS.LocalNotif_BuildingDone ?? '%s complete!').replace('%s', displayName(b.type)).toUpperCase());
      }
      if (e.type === 'spliced' && game.firstTickDone) { sfx('notification_01'); ui.toast((STRINGS.LocalNotif_SpliceDone ?? 'Splicing complete!').toUpperCase()); }
      if (e.type === 'mineReady') { sfx('notification_01'); ui.toast((STRINGS.LocalNotif_UtopiumMineReady ?? 'Mining complete!').toUpperCase()); }
      if (e.type === 'shelterReady') ui.toast((STRINGS.LocalNotif_AnimalShelterReady ?? 'Animals are ready!').toUpperCase());
      if (e.type === 'achievement') ui.x.breakingNews(e.index);
      if (e.type === 'tutorial' && e.step === -1) persist();
      if (e.type === 'tree') {
        scene.floatText(e.building, `+${e.amount}${e.kind === 'utopium' ? 'u' : ''}`, e.kind === 'utopium' ? '#ff7ad9' : '#ffe14a');
        sfx(e.kind === 'utopium' ? 'discovery_04' : 'correct_03');
      }
      if (e.type === 'dailyReset' && game.firstTickDone) ui.toast('A NEW DAY IN UTOPIA!');
    }
  }
  function ready() {
    // test hook: screen position of a cell centre (used by scripts/screenshots.mjs)
    (window as unknown as { ppCell: (i: number, j: number) => { x: number; y: number } }).ppCell = (i, j) => {
      const cam = scene.cameras.main;
      const w = { x: (j - i) * 61.5, y: -(i + j + 1) * 30.75 };
      return { x: (w.x - cam.worldView.x) * cam.zoom, y: (w.y - cam.worldView.y) * cam.zoom };
    };
    const music = new Music(game.state.musicMuted);
    ui = new UI(game, scene, changed, music);
    // 1 s logical tick (cGameManager::updateCallback). Offline time is paid by the first tick.
    const tick = () => {
      const now = nowSec();
      if (now <= game.state.lastTick && game.firstTickDone) return;
      game.tick(now);
      flushEvents();
      scene.refresh();
      scene.syncGuests(game.guests(game.local(now)));
      ui.update();
      if (game.state.playTime % 5 === 0) persist();
    };
    tick();
    window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); else tick(); });
    window.addEventListener('pagehide', persist);
    window.addEventListener('pp-reset', () => { wipe(storage); location.reload(); });
    window.addEventListener('pp-import', (ev) => {
      const st = importSave((ev as CustomEvent<string>).detail);
      if (!st) return;
      save(storage, st);
      location.reload();
    });
    (window as unknown as { ppScene: CityScene; ppUI: UI }).ppScene = scene;
    (window as unknown as { ppUI: UI }).ppUI = ui;
  }
}

start();

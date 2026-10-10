// Phaser scene: draws the city, clones and notifications; turns pointer input into pan/zoom/tap.
import Phaser from 'phaser';
import { Game } from '../logic/game';
import { Building } from '../logic/state';
import { ANIMAL, JOB, PATH, WORKPLACE, kindOf } from '../logic/data';
import { cellCenter, depthFor, footprintBox, originFor, roadVariant, worldToCell } from './iso';

export interface SceneHooks {
  onTapBuilding(id: string): void;
  onPlace(type: string, i: number, j: number): void;
  onTapEmpty(): void;
  onTapGuest(code: number, job?: string): void;
  onReady(): void;
}

/** A guest NPC walking on the roads (04 §4): 2001 special gene, 2005 mini-quests ("Mothership Alert"). */
export interface GuestInfo { code: number; job?: string }

interface PeepView { c: Phaser.GameObjects.Container; target?: { x: number; y: number }; busy: boolean }

export class CityScene extends Phaser.Scene {
  game2!: Game;
  hooks!: SceneHooks;
  pages: string[] = [];
  frameKey = new Map<string, string>();
  private world!: Phaser.GameObjects.Layer;
  private overlay!: Phaser.GameObjects.Layer;
  private views = new Map<string, Phaser.GameObjects.GameObject[]>();
  private hitImages = new Map<Phaser.GameObjects.GameObject, string>();
  private notifs = new Map<string, Phaser.GameObjects.Image>();
  private peepViews = new Map<string, PeepView>();
  private ghost: Phaser.GameObjects.GameObject[] = [];
  private grid: Phaser.GameObjects.Image[] = [];
  buildType: string | null = null;
  private hoverCell: { i: number; j: number } | null = null;
  private drag = { down: false, moved: false, sx: 0, sy: 0, camX: 0, camY: 0 };
  private pinch: { dist: number; zoom: number } | null = null;
  private signature = '';
  private coinAcc = new Map<string, number>();
  /** Placement modifiers: moving an existing building ignores its own cells and keeps its flip. */
  placeFlip = false;
  placeIgnore: string | undefined;
  private selected: string | null = null;
  private selection: Phaser.GameObjects.GameObject[] = [];
  private animalViews: { c: Phaser.GameObjects.Image; name: string }[] = [];
  private animalSig = '';

  constructor() { super('city'); }

  init(data: { game: Game; hooks: SceneHooks; pages: string[] }) {
    this.game2 = data.game;
    this.hooks = data.hooks;
    this.pages = data.pages;
  }

  preload() {
    for (const p of this.pages) this.load.atlas(p, `assets/atlas/${p}.png`, `assets/atlas/${p}.json`);
    this.load.image('ui-specialgene', 'assets/ui/notif_specialgene.png');
    this.load.image('ui-hint', 'assets/ui/Notif-Hint.png');
    this.load.image('ui-cursor', 'assets/ui/Cursor.png');
  }

  create() {
    for (const p of this.pages) {
      for (const f of this.textures.get(p).getFrameNames()) this.frameKey.set(f, p);
    }
    this.world = this.add.layer();
    this.overlay = this.add.layer().setDepth(100000);
    this.anims.create({
      key: 'construct', frameRate: 6, repeat: -1,
      frames: [1, 2, 3, 4, 5].map((n) => ({ key: this.frameKey.get(`ConstructionYard_${n}`)!, frame: `ConstructionYard_${n}` })),
    });
    this.anims.create({
      key: 'coin', frameRate: 10, repeat: -1,
      frames: [1, 2, 3, 4].map((n) => ({ key: this.frameKey.get(`coin_00${n}`)!, frame: `coin_00${n}` })),
    });
    const cam = this.cameras.main;
    cam.setRoundPixels(false);
    const c = cellCenter(1.5, 2);
    cam.centerOn(c.x, c.y - 60);
    cam.setZoom(this.defaultZoom());
    this.setupInput();
    this.rebuild();
    this.time.addEvent({ delay: 2000, loop: true, callback: () => this.flushCoins() });
    this.hooks.onReady();
  }

  defaultZoom(): number {
    const w = this.scale.width, h = this.scale.height;
    return Phaser.Math.Clamp(Math.min(w / 520, h / 640), 0.6, 1.4);
  }

  img(x: number, y: number, frame: string): Phaser.GameObjects.Image | null {
    const key = this.frameKey.get(frame);
    if (!key) return null;
    return this.add.image(x, y, key, frame);
  }

  hasFrame(f: string) { return this.frameKey.has(f); }

  // ------------------------------------------------------------------ city
  /** Recreate every building view when the layout changed. Cheap enough for this city size. */
  rebuild() {
    for (const objs of this.views.values()) for (const o of objs) o.destroy();
    this.views.clear();
    this.hitImages.clear();
    const g = this.game2;
    const occ = g.occupied();
    const ground: Phaser.GameObjects.GameObject[] = [];
    // floating ground under every occupied cell
    for (const key of occ.keys()) {
      const [i, j] = key.split(',').map(Number);
      const p = cellCenter(i, j);
      const im = this.img(p.x, p.y, 'GroundTileBig');
      if (im) {
        im.setOrigin(0.5, 127.75 / 200).setDepth(depthFor(i, j, -5000));
        this.world.add(im);
        ground.push(im);
      }
    }
    this.views.set('__ground', ground);
    const roads = new Set(g.state.buildings.filter((b) => PATH.has(b.type)).map((b) => `${b.x},${b.y}:${b.type}`));
    for (const b of g.state.buildings) this.views.set(b.id, this.buildingView(b, roads));
    this.signature = this.layoutSignature();
    this.syncPeeps();
    this.refreshDynamic();
    this.refreshGrid();
  }

  private buildingView(b: Building, roads: Set<string>): Phaser.GameObjects.GameObject[] {
    const box = footprintBox(b.type, b.x, b.y, b.flip);
    const out: Phaser.GameObjects.GameObject[] = [];
    const kind = kindOf(b.type);
    if (b.buildEnd >= 0) {
      for (const [i, j] of box.cells) {
        const p = cellCenter(i, j);
        const s = this.add.sprite(p.x, p.y, this.frameKey.get('ConstructionYard_1')!, 'ConstructionYard_1');
        const o = originFor(118, 121);
        s.setOrigin(o.ox, o.oy).setDepth(depthFor(i, j)).play('construct');
        s.setInteractive({ pixelPerfect: true, useHandCursor: true });
        this.hitImages.set(s, b.id);
        this.world.add(s);
        out.push(s);
      }
      return out;
    }
    let frame = b.type;
    let flip = b.flip;
    if (kind === 'path') {
      const has = (i: number, j: number) => roads.has(`${i},${j}:${b.type}`);
      const v = roadVariant(has(b.x + 1, b.y), has(b.x, b.y + 1), has(b.x, b.y - 1), has(b.x - 1, b.y));
      frame = b.type + v.suffix;
      flip = v.flip;
      if (!this.hasFrame(frame)) { frame = b.type; flip = false; }
    }
    // Arcade skin (cycleTileSkin): same canvas size as the original sprite
    if (b.skin && this.hasFrame(b.skin)) frame = b.skin;
    const p = cellCenter(box.minI, box.minJ);
    const im = this.img(p.x, p.y, frame);
    if (!im) {
      // no sprite in the APK for this one: draw a selection diamond so it is still visible
      for (const [i, j] of box.cells) {
        const q = cellCenter(i, j);
        const s = this.img(q.x, q.y, 'SelectionSquareFill');
        if (s) { s.setDepth(depthFor(i, j)).setTint(0x8888ff); this.world.add(s); out.push(s); this.hitImages.set(s, b.id); s.setInteractive(); }
      }
      return out;
    }
    const src = im.frame;
    const o = originFor(src.realWidth, src.realHeight);
    im.setOrigin(o.ox, o.oy);
    im.setFlipX(flip);
    im.setDepth(depthFor(box.minI, box.minJ, kind === 'path' ? -3000 : 0));
    // a wonder part still being researched is drawn as a ghost until its mission completes
    if (kind === 'wonder' && !this.game2.missions.wonderPartDone(b.type)) im.setAlpha(0.45).setTint(0x9fd8ff);
    im.setInteractive({ pixelPerfect: true, useHandCursor: kind === 'workplace' || kind === 'residence' });
    this.hitImages.set(im, b.id);
    this.world.add(im);
    out.push(im);
    // residence paint (cPaintPopup): _Layer1 and _Layer2 tinted with the two random colours
    if (kind === 'residence' && b.paint) {
      b.paint.forEach((rgb, k) => {
        const lf = `${b.type}_Layer${k + 1}`;
        const L = this.hasFrame(lf) ? this.img(p.x, p.y, lf) : null;
        if (!L) return;
        L.setOrigin(o.ox, o.oy).setFlipX(flip).setDepth(im.depth + 0.01 * (k + 1)).setTint(rgb);
        this.world.add(L);
        out.push(L);
      });
    }
    return out;
  }

  private layoutSignature(): string {
    const w = JSON.stringify(this.game2.state.missions.wonderMap);
    return w + this.game2.state.buildings.map((b) => `${b.id}@${b.x},${b.y},${b.flip ? 1 : 0},${b.buildEnd >= 0 ? 1 : 0},${b.skin ?? ''},${b.paint?.join('/') ?? ''}`).join('|');
  }

  /** Top centre of the visible (non-transparent) part of a sprite: the atlas frames are trimmed. */
  private visibleTop(im: Phaser.GameObjects.Image): { x: number; y: number } {
    const f = im.frame as unknown as { realHeight: number; data?: { spriteSourceSize?: { y: number } } };
    const sy = f.data?.spriteSourceSize?.y ?? 0;
    return { x: im.x, y: im.y - im.originY * f.realHeight * im.scaleY + sy * im.scaleY };
  }

  /** Called after each tick or action. */
  refresh() {
    if (this.layoutSignature() !== this.signature) this.rebuild();
    else { this.syncPeeps(); this.refreshDynamic(); }
    this.syncAnimals();
    this.drawSelection();
  }

  /** Notification bubbles: stopped workplaces, Arrival Center states. */
  private refreshDynamic() {
    const g = this.game2;
    const want = new Map<string, string>();
    for (const b of g.state.buildings) {
      if (g.needsRestart(b)) want.set(b.id, 'notif-stimulate');
      if (b.treeReady) want.set(b.id, 'notification_tree');
      if (b.type === 'Utopium Mine' && g.isBuilt(b) && g.state.dailyUtopium) want.set(b.id, 'Notif-Utopium');
      if (b.type === 'Animal Shelter' && g.isBuilt(b) && g.state.dailyAnimal) want.set(b.id, 'Notif-Gift');
    }
    if (g.state.hearts.on) want.set(g.state.hearts.on, 'notif-heart');
    const ac = g.state.buildings.find((b) => b.type === 'SpacePort');
    if (ac) {
      if (g.state.slots.some((s) => s.state === 3 || s.state === 5)) {
        want.set(ac.id, g.state.slots.some((s) => s.state === 5) ? 'Notif-NewJob' : 'Notif-Clone');
      } else if (g.state.slots.every((s) => s.state === 0) && !g.firstVacantResidence()) {
        want.set(ac.id, 'Notif-House');
      }
    }
    for (const [id, im] of this.notifs) {
      if (want.get(id) !== im.frame.name) { im.destroy(); this.notifs.delete(id); }
    }
    for (const [id, frame] of want) {
      if (this.notifs.has(id)) continue;
      const view = this.views.get(id)?.[0] as Phaser.GameObjects.Image | undefined;
      if (!view) continue;
      const top = this.visibleTop(view);
      const im = this.img(top.x, top.y + 24, frame);
      if (!im) continue;
      im.setOrigin(0.5, 1).setScale(1.6).setDepth(200000);
      im.setInteractive({ useHandCursor: true });
      this.hitImages.set(im, id);
      this.tweens.add({ targets: im, y: im.y - 8, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.inOut' });
      this.overlay.add(im);
      this.notifs.set(id, im);
    }
  }

  // ------------------------------------------------------------------ clones
  private peepFrames(job: string | null, female: boolean): string[] {
    if (!job) return [female ? 'FemaleClone' : 'CloneMale'];
    const jd = JOB.get(job);
    if (!jd) return [female ? 'FemaleClone' : 'CloneMale'];
    const s = female ? 'F' : 'M';
    return [female ? 'Female1' : 'Male1', `${jd.id}${s}`, `${jd.id}${s}_L`].filter((f) => this.hasFrame(f));
  }

  private makePeep(job: string | null, female: boolean, x: number, y: number) {
    const c = this.add.container(x, y);
    for (const f of this.peepFrames(job, female)) {
      const im = this.img(0, 0, f);
      if (im) c.add(im.setOrigin(0.5, 1));
    }
    c.setScale(1.5);
    return c;
  }

  /** Clones walk around their workplace (or home), hopping between nearby cells. */
  private syncPeeps() {
    const g = this.game2;
    const live = new Set<string>();
    for (const p of g.state.peeps) {
      const at = p.work ? g.building(p.work) : undefined;
      const inSlot = g.state.slots.some((s) => s.peep === p.id);
      if (!at || inSlot) continue; // jobless clones stay inside the Arrival Center
      const key = `${p.id}|${p.job}|${at.id}`;
      live.add(key);
      if (this.peepViews.has(key)) continue;
      const home = this.anchorFor(at);
      const c = this.makePeep(p.job, p.female, home.x, home.y);
      this.world.add(c);
      const pv: PeepView = { c, busy: false };
      this.peepViews.set(key, pv);
      this.wander(pv, at);
    }
    for (const [key, pv] of this.peepViews) {
      if (!live.has(key)) { this.tweens.killTweensOf(pv.c); pv.c.destroy(); this.peepViews.delete(key); }
    }
  }

  private anchorFor(b: Building) {
    const box = footprintBox(b.type, b.x, b.y, b.flip);
    const p = cellCenter(box.minI, box.minJ);
    return { x: p.x, y: p.y + 20 };
  }

  private wander(pv: PeepView, b: Building) {
    if (!pv.c.active) return;
    const base = this.anchorFor(b);
    // pick a nearby walkable spot: a road cell next to the building, or just in front of it
    const roads = this.game2.state.buildings.filter((r) => PATH.has(r.type)
      && Math.abs(r.x - b.x) <= 3 && Math.abs(r.y - b.y) <= 3);
    let tx = base.x + Phaser.Math.Between(-40, 40);
    let ty = base.y + Phaser.Math.Between(-6, 10);
    if (roads.length && Math.random() < 0.6) {
      const r = Phaser.Utils.Array.GetRandom(roads);
      const q = cellCenter(r.x, r.y);
      tx = q.x + Phaser.Math.Between(-20, 20);
      ty = q.y + Phaser.Math.Between(-8, 8);
    }
    const dist = Phaser.Math.Distance.Between(pv.c.x, pv.c.y, tx, ty);
    pv.c.setScale(tx < pv.c.x ? -1.5 : 1.5, 1.5);
    const dur = Math.max(400, dist * 30);
    this.tweens.add({
      targets: pv.c, x: tx, y: ty, duration: dur,
      onUpdate: () => {
        const cell = worldToCell(pv.c.x, pv.c.y);
        pv.c.setDepth(depthFor(cell.i, cell.j, 5));
        pv.c.list.forEach((o) => ((o as Phaser.GameObjects.Image).y = -Math.abs(Math.sin(pv.c.x / 6)) * 2));
      },
      onComplete: () => this.time.delayedCall(Phaser.Math.Between(800, 4000), () => this.wander(pv, b)),
    });
  }

  // ------------------------------------------------------------------ animals
  /** Owned animals stroll along the roads (decorative, cAnimalNPC). One sprite per animal kind, up to 12. */
  private syncAnimals() {
    const g = this.game2;
    const names = Object.keys(g.state.animals).filter((n) => g.state.animals[n] > 0).slice(0, 12);
    const roads = g.state.buildings.filter((b) => PATH.has(b.type) && g.isBuilt(b));
    const sig = names.join('|') + '#' + roads.length;
    if (sig === this.animalSig) return;
    this.animalSig = sig;
    for (const a of this.animalViews) { this.tweens.killTweensOf(a.c); a.c.destroy(); }
    this.animalViews = [];
    if (!roads.length) return;
    for (const name of names) {
      const id = ANIMAL.get(name)?.id;
      const r = Phaser.Utils.Array.GetRandom(roads);
      const q = cellCenter(r.x, r.y);
      const im = id ? this.img(q.x, q.y, `A${id}`) : null;
      if (!im) continue;
      im.setOrigin(0.5, 1).setScale(1.3);
      this.world.add(im);
      const av = { c: im, name };
      this.animalViews.push(av);
      this.strollAnimal(av);
    }
  }

  private strollAnimal(av: { c: Phaser.GameObjects.Image }) {
    if (!av.c.active) return;
    const roads = this.game2.state.buildings.filter((b) => PATH.has(b.type));
    if (!roads.length) return;
    const r = Phaser.Utils.Array.GetRandom(roads);
    const q = cellCenter(r.x, r.y);
    const tx = q.x + Phaser.Math.Between(-24, 24), ty = q.y + Phaser.Math.Between(-8, 8);
    av.c.setFlipX(tx < av.c.x);
    const dist = Phaser.Math.Distance.Between(av.c.x, av.c.y, tx, ty);
    this.tweens.add({
      targets: av.c, x: tx, y: ty, duration: Math.max(500, dist * 40),
      onUpdate: () => { const cell = worldToCell(av.c.x, av.c.y); av.c.setDepth(depthFor(cell.i, cell.j, 4)); },
      onComplete: () => this.time.delayedCall(Phaser.Math.Between(500, 3000), () => this.strollAnimal(av)),
    });
  }

  // ------------------------------------------------------------------ guests (cTerrainNPC)
  private guestViews = new Map<string, Phaser.GameObjects.Container>();
  private guestHits = new Map<Phaser.GameObjects.GameObject, GuestInfo>();
  private guestIcons = new Map<Phaser.GameObjects.Container, Phaser.GameObjects.Image>();

  update(time: number) {
    for (const [c, icon] of this.guestIcons) {
      if (!c.active) { icon.destroy(); this.guestIcons.delete(c); continue; }
      icon.setPosition(c.x, c.y - 34 - Math.abs(Math.sin(time / 300)) * 6).setAlpha(c.alpha);
    }
  }

  /** One walker per guest on a random road (04 §4). They beam up when their reason is gone. */
  syncGuests(list: GuestInfo[]) {
    const g = this.game2;
    const roads = g.state.buildings.filter((b) => PATH.has(b.type) && g.isBuilt(b));
    const want = new Map(roads.length ? list.map((x) => [`${x.code}:${x.job ?? ''}`, x]) : []);
    for (const [k, c] of this.guestViews) {
      if (want.has(k)) continue;
      this.tweens.killTweensOf(c);
      this.tweens.add({ targets: c, alpha: 0, y: c.y - 80, duration: 600, onComplete: () => c.destroy() }); // beamUp
      this.guestViews.delete(k);
    }
    for (const [k, info] of want) {
      if (this.guestViews.has(k)) continue;
      const r = Phaser.Utils.Array.GetRandom(roads);
      const q = cellCenter(r.x, r.y);
      const c = this.add.container(q.x, q.y);
      const frames = [info.code === 2001 ? 'Female1' : 'Male1', `${info.code}`, `${info.code}_L`].filter((f) => this.hasFrame(f));
      for (const f of frames) { const im = this.img(0, 0, f); if (im) c.add(im.setOrigin(0.5, 1)); }
      // the bubble lives in the overlay so buildings never hide it; update() keeps it over the guest
      const icon = this.add.image(q.x, q.y, info.code === 2001 ? 'ui-specialgene' : 'ui-hint').setOrigin(0.5, 1).setDepth(200000);
      this.overlay.add(icon);
      this.guestIcons.set(c, icon);
      icon.setInteractive({ useHandCursor: true });
      this.guestHits.set(icon, info);
      c.setScale(1.5).setAlpha(0);
      this.tweens.add({ targets: c, alpha: 1, duration: 500 }); // doSpawn
      for (const o of c.list) {
        (o as Phaser.GameObjects.Image).setInteractive({ useHandCursor: true });
        this.guestHits.set(o as Phaser.GameObjects.GameObject, info);
      }
      this.world.add(c);
      this.guestViews.set(k, c);
      this.strollGuest(c);
    }
  }

  private strollGuest(c: Phaser.GameObjects.Container) {
    if (!c.active) return;
    const roads = this.game2.state.buildings.filter((b) => PATH.has(b.type));
    if (!roads.length) return;
    const r = Phaser.Utils.Array.GetRandom(roads);
    const q = cellCenter(r.x, r.y);
    const tx = q.x + Phaser.Math.Between(-20, 20), ty = q.y + Phaser.Math.Between(-6, 6);
    c.setScale(tx < c.x ? -1.5 : 1.5, 1.5);
    const dist = Phaser.Math.Distance.Between(c.x, c.y, tx, ty);
    this.tweens.add({
      targets: c, x: tx, y: ty, duration: Math.max(600, dist * 45),
      onUpdate: () => { const cell = worldToCell(c.x, c.y); c.setDepth(depthFor(cell.i, cell.j, 6)); },
      onComplete: () => this.time.delayedCall(Phaser.Math.Between(1500, 4000), () => this.strollGuest(c)),
    });
  }

  /** Screen position of the first guest (screenshot script). */
  guestScreen(): { x: number; y: number } | null {
    const c = [...this.guestViews.values()][0];
    if (!c) return null;
    const cam = this.cameras.main;
    return { x: (c.x - cam.worldView.x) * cam.zoom, y: (c.y - 30 - cam.worldView.y) * cam.zoom };
  }

  // ------------------------------------------------------------------ tutorial marker
  private marker: Phaser.GameObjects.GameObject[] = [];
  private markerSig = '';

  /** Flashing squares (and the tutorial hand) on some cells. */
  setMarker(cells: [number, number][] | null, hand = false) {
    const sig = cells ? JSON.stringify(cells) + hand : '';
    if (sig === this.markerSig) return;
    this.markerSig = sig;
    for (const o of this.marker) o.destroy();
    this.marker = [];
    if (!cells) return;
    for (const [i, j] of cells) {
      const p = cellCenter(i, j);
      const s = this.img(p.x, p.y, 'SelectionSquareFill');
      if (s) {
        s.setTint(0xffe14a).setAlpha(0.8).setDepth(240000);
        this.tweens.add({ targets: s, alpha: 0.2, yoyo: true, repeat: -1, duration: 400 });
        this.overlay.add(s);
        this.marker.push(s);
      }
    }
    if (hand && cells.length) {
      const p = cellCenter(cells[0][0], cells[0][1]);
      const c = this.add.image(p.x + 10, p.y - 10, 'ui-cursor').setOrigin(0, 0).setScale(2.5).setDepth(260000);
      this.tweens.add({ targets: c, x: p.x + 22, y: p.y + 2, yoyo: true, repeat: -1, duration: 450 });
      this.overlay.add(c);
      this.marker.push(c);
    }
  }

  // ------------------------------------------------------------------ edit selection
  select(id: string | null) {
    this.selected = id;
    this.drawSelection(true);
  }

  private selSig = '';
  private drawSelection(force = false) {
    const b = this.selected ? this.game2.building(this.selected) : undefined;
    const sig = b ? `${b.id}@${b.x},${b.y},${b.flip}` : '';
    if (!force && sig === this.selSig) return;
    this.selSig = sig;
    for (const o of this.selection) o.destroy();
    this.selection = [];
    if (!b) return;
    for (const [i, j] of footprintBox(b.type, b.x, b.y, b.flip).cells) {
      const p = cellCenter(i, j);
      const s = this.img(p.x, p.y, 'SelectionSquareFill');
      if (s) {
        s.setTint(0x44ccff).setAlpha(0.55).setDepth(240000);
        this.tweens.add({ targets: s, alpha: 0.25, yoyo: true, repeat: -1, duration: 500 });
        this.overlay.add(s);
        this.selection.push(s);
      }
    }
  }

  // ------------------------------------------------------------------ effects
  /** Floating "+n" over a building (tree harvests). */
  floatText(buildingId: string, text: string, color = '#ffe14a') {
    const view = this.views.get(buildingId)?.[0] as Phaser.GameObjects.Image | undefined;
    if (!view || !view.active) return;
    const top = this.visibleTop(view);
    const t = this.add.text(top.x, top.y + 10, text, {
      fontFamily: '"04b03", monospace', fontSize: '20px', color, stroke: '#3a2400', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(300000);
    this.overlay.add(t);
    this.tweens.add({ targets: t, y: t.y - 60, alpha: 0, duration: 1600, onComplete: () => t.destroy() });
  }

  coinGain(buildingId: string, amount: number) {
    this.coinAcc.set(buildingId, (this.coinAcc.get(buildingId) ?? 0) + amount);
  }

  private flushCoins() {
    for (const [id, amount] of this.coinAcc) {
      const view = this.views.get(id)?.[0] as Phaser.GameObjects.Image | undefined;
      if (!view || !view.active) continue;
      const top = this.visibleTop(view);
      const c = this.add.container(top.x, top.y + 10).setDepth(300000);
      const coin = this.add.sprite(-10, 0, this.frameKey.get('coin_001')!, 'coin_001').play('coin').setScale(1.5);
      const t = this.add.text(4, 0, `+${amount}`, {
        fontFamily: '"04b03", monospace', fontSize: '18px', color: '#ffe14a', stroke: '#3a2400', strokeThickness: 4,
      }).setOrigin(0, 0.5);
      c.add([coin, t]);
      this.overlay.add(c);
      this.tweens.add({ targets: c, y: c.y - 50, alpha: 0, duration: 1400, onComplete: () => c.destroy() });
    }
    this.coinAcc.clear();
  }

  /** Centre the camera on a cell (tutorial flashing square). */
  panToCell(i: number, j: number) {
    const p = cellCenter(i, j);
    this.cameras.main.pan(p.x, p.y - 40, 400, 'Sine.easeInOut');
  }

  focusOn(id: string) {
    const b = this.game2.building(id);
    if (!b) return;
    const a = this.anchorFor(b);
    this.cameras.main.pan(a.x, a.y - 60, 400, 'Sine.easeInOut');
  }

  // ------------------------------------------------------------------ build mode
  setBuildMode(type: string | null, flip = false, ignore?: string) {
    this.buildType = type;
    this.placeFlip = flip;
    this.placeIgnore = ignore;
    this.clearGhost();
    this.refreshGrid();
  }

  private clearGhost() {
    for (const o of this.ghost) o.destroy();
    this.ghost = [];
  }

  private refreshGrid() {
    for (const g of this.grid) g.destroy();
    this.grid = [];
    if (!this.buildType) return;
    const occ = this.game2.occupied();
    let minI = 0, maxI = 0, minJ = 0, maxJ = 0;
    for (const k of occ.keys()) {
      const [i, j] = k.split(',').map(Number);
      minI = Math.min(minI, i); maxI = Math.max(maxI, i); minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
    }
    for (let i = minI - 2; i <= maxI + 2; i++) {
      for (let j = minJ - 2; j <= maxJ + 2; j++) {
        if (occ.has(`${i},${j}`)) continue;
        const p = cellCenter(i, j);
        const im = this.img(p.x, p.y, 'SelectionSquare');
        if (im) { im.setAlpha(0.35).setDepth(1); this.world.add(im); this.grid.push(im); }
      }
    }
  }

  private drawGhost(i: number, j: number) {
    this.clearGhost();
    const type = this.buildType;
    if (!type) return;
    const okPlace = this.game2.canPlaceAt(type, i, j, this.placeFlip, this.placeIgnore);
    const box = footprintBox(type, i, j, this.placeFlip);
    for (const [ci, cj] of box.cells) {
      const p = cellCenter(ci, cj);
      const s = this.img(p.x, p.y, 'SelectionSquareFill');
      if (s) { s.setTint(okPlace ? 0x44ff66 : 0xff4444).setAlpha(0.7).setDepth(250000); this.overlay.add(s); this.ghost.push(s); }
    }
    let frame = type;
    if (kindOf(type) === 'path') frame = type;
    const p = cellCenter(box.minI, box.minJ);
    const im = this.img(p.x, p.y, frame);
    if (im) {
      const o = originFor(im.frame.realWidth, im.frame.realHeight);
      im.setOrigin(o.ox, o.oy).setAlpha(0.75).setDepth(250001).setFlipX(this.placeFlip);
      if (!okPlace) im.setTint(0xff8080);
      this.overlay.add(im);
      this.ghost.push(im);
    }
  }

  // ------------------------------------------------------------------ input
  private setupInput() {
    this.input.addPointer(1);
    this.input.topOnly = true;
    const cam = this.cameras.main;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const pts = this.activePointers();
      if (pts.length >= 2) {
        this.pinch = { dist: Phaser.Math.Distance.BetweenPoints(pts[0].position, pts[1].position), zoom: cam.zoom };
        this.drag.moved = true;
        return;
      }
      this.drag = { down: true, moved: false, sx: p.x, sy: p.y, camX: cam.scrollX, camY: cam.scrollY };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const pts = this.activePointers();
      if (this.pinch && pts.length >= 2) {
        const d = Phaser.Math.Distance.BetweenPoints(pts[0].position, pts[1].position);
        this.zoomAt(this.pinch.zoom * (d / Math.max(1, this.pinch.dist)),
          (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
        return;
      }
      if (this.drag.down && p.isDown) {
        const dx = p.x - this.drag.sx, dy = p.y - this.drag.sy;
        if (!this.drag.moved && Math.hypot(dx, dy) > 8) this.drag.moved = true;
        if (this.drag.moved) {
          cam.scrollX = this.drag.camX - dx / cam.zoom;
          cam.scrollY = this.drag.camY - dy / cam.zoom;
        }
      } else if (this.buildType && !p.wasTouch) {
        const w = cam.getWorldPoint(p.x, p.y);
        const c = worldToCell(w.x, w.y);
        if (!this.hoverCell || c.i !== this.hoverCell.i || c.j !== this.hoverCell.j) {
          this.hoverCell = c;
          this.drawGhost(c.i, c.j);
        }
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.pinch) {
        if (this.activePointers().length === 0) this.pinch = null;
        return;
      }
      const wasTap = this.drag.down && !this.drag.moved;
      this.drag.down = false;
      if (!wasTap) return;
      const w = cam.getWorldPoint(p.x, p.y);
      if (this.buildType) {
        const c = worldToCell(w.x, w.y);
        this.drawGhost(c.i, c.j);
        this.hooks.onPlace(this.buildType, c.i, c.j);
        return;
      }
      const hits = this.input.hitTestPointer(p);
      for (const h of hits) {
        const guest = this.guestHits.get(h);
        if (guest) { this.hooks.onTapGuest(guest.code, guest.job); return; }
      }
      for (const h of hits) {
        const id = this.hitImages.get(h);
        if (id) { this.hooks.onTapBuilding(id); return; }
      }
      // fall back to the footprint under the finger
      const c = worldToCell(w.x, w.y);
      const id = this.game2.occupied().get(`${c.i},${c.j}`);
      if (id) this.hooks.onTapBuilding(id);
      else this.hooks.onTapEmpty();
    });
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(cam.zoom * Math.pow(1.0015, -dy), p.x, p.y);
    });
  }

  /** Zoom keeping the world point under (px, py) fixed. Phaser zooms around the camera centre. */
  zoomAt(z: number, px: number, py: number) {
    const cam = this.cameras.main;
    const w = cam.width, hh = cam.height;
    const wx = cam.scrollX + w / 2 + (px - w / 2) / cam.zoom;
    const wy = cam.scrollY + hh / 2 + (py - hh / 2) / cam.zoom;
    this.setZoom(z);
    cam.scrollX = wx - w / 2 - (px - w / 2) / cam.zoom;
    cam.scrollY = wy - hh / 2 - (py - hh / 2) / cam.zoom;
  }

  private activePointers(): Phaser.Input.Pointer[] {
    return this.input.manager.pointers.filter((p) => p.isDown);
  }

  setZoom(z: number) {
    this.cameras.main.setZoom(Phaser.Math.Clamp(z, 0.3, 3));
  }

  /** Thumbnail of a frame as a data URL (for the HTML menus). */
  private thumbCache = new Map<string, string>();
  thumb(frames: string[], w: number, h: number): string {
    const key = frames.join('+') + `@${w}x${h}`;
    const hit = this.thumbCache.get(key);
    if (hit) return hit;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (const f of frames) {
      const tk = this.frameKey.get(f);
      if (!tk) continue;
      const fr = this.textures.getFrame(tk, f);
      const srcImg = fr.source.image as HTMLImageElement;
      const single = frames.length === 1;
      const sss = single ? { x: 0, y: 0 } : (fr as unknown as { data: { spriteSourceSize: { x: number; y: number } } }).data.spriteSourceSize;
      const sw = single ? fr.cutWidth : fr.realWidth, sh = single ? fr.cutHeight : fr.realHeight;
      const scale = Math.min(w / sw, h / sh);
      const ox = (w - sw * scale) / 2, oy = (h - sh * scale) / 2;
      ctx.drawImage(srcImg, fr.cutX, fr.cutY, fr.cutWidth, fr.cutHeight,
        ox + sss.x * scale, oy + sss.y * scale, fr.cutWidth * scale, fr.cutHeight * scale);
    }
    const url = cv.toDataURL();
    this.thumbCache.set(key, url);
    return url;
  }

  clonePortrait(job: string | null, female: boolean, size = 54): string {
    return this.thumb(this.peepFrames(job, female), size, size);
  }

  workplaceThumb(type: string, size = 64): string {
    return this.thumb([type], size, size);
  }

  isWorkplace(type: string) { return WORKPLACE.has(type); }
}

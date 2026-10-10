#!/usr/bin/env python3
"""Copy only the sprites/sounds/fonts the web app uses out of the 4.20 APK assets.

Usage: python3 scripts/build-assets.py [path/to/assets_moderna]
- Map sprites are re-packed (unrotated, trimmed) into <=2048 px pages in public/assets/atlas,
  TexturePacker "JSON Hash" format, plus public/assets/atlas/manifest.json.
- UI sprites become single PNGs in public/assets/ui (used from HTML/CSS).
Output is committed, so Pillow is only needed to regenerate it.
"""
import json, os, shutil, sys
from PIL import Image

ROOT = sys.argv[1] if len(sys.argv) > 1 else '/mnt/project-files/assets_moderna'
RES = os.path.join(ROOT, 'assets', 'res')
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(APP, 'public', 'assets')
DATA = os.path.join(APP, 'src', 'data')
PAGE = 2048

_sheets = {}


def sheet(path):
    if path not in _sheets:
        meta = json.load(open(os.path.join(RES, path + '.atlas.json'), encoding='utf-8'))
        img = Image.open(os.path.join(RES, path + '.png')).convert('RGBA')
        _sheets[path] = (meta['frames'], img)
    return _sheets[path]


def frame(path, name):
    """Return the frame as an untrimmed RGBA image of its source size, or None."""
    frames, img = sheet(path)
    f = frames.get(name)
    if not f:
        return None
    fr = f['frame']
    if f['rotated']:  # stored 90 deg clockwise in the sheet
        c = img.crop((fr['x'], fr['y'], fr['x'] + fr['h'], fr['y'] + fr['w'])).transpose(Image.ROTATE_90)
    else:
        c = img.crop((fr['x'], fr['y'], fr['x'] + fr['w'], fr['y'] + fr['h']))
    ss, sp = f['sourceSize'], f['spriteSourceSize']
    out = Image.new('RGBA', (ss['w'], ss['h']), (0, 0, 0, 0))
    out.paste(c, (sp['x'], sp['y']))
    return out


def pack(name, items):
    """items: list of (key, image). Shelf-pack into pages; write png+json; return page names."""
    entries = []
    for key, im in items:
        bb = im.getbbox() or (0, 0, 1, 1)
        entries.append((key, im, bb))
    entries.sort(key=lambda e: -(e[2][3] - e[2][1]))
    pages, cur, x, y, shelf = [], {}, 0, 0, 0
    placed = []

    def flush():
        if not placed:
            return
        h = max(py + (bb[3] - bb[1]) for _, _, bb, px, py in placed)
        w = max(px + (bb[2] - bb[0]) for _, _, bb, px, py in placed)
        page = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        frames = {}
        for key, im, bb, px, py in placed:
            page.paste(im.crop(bb), (px, py))
            frames[key] = {
                'frame': {'x': px, 'y': py, 'w': bb[2] - bb[0], 'h': bb[3] - bb[1]},
                'rotated': False, 'trimmed': True,
                'spriteSourceSize': {'x': bb[0], 'y': bb[1], 'w': bb[2] - bb[0], 'h': bb[3] - bb[1]},
                'sourceSize': {'w': im.width, 'h': im.height},
            }
        pname = '%s-%d' % (name, len(pages))
        page.save(os.path.join(OUT, 'atlas', pname + '.png'), optimize=True)
        json.dump({'frames': frames, 'meta': {'image': pname + '.png', 'size': {'w': w, 'h': h}, 'scale': '1'}},
                  open(os.path.join(OUT, 'atlas', pname + '.json'), 'w'))
        pages.append(pname)
        placed.clear()

    for key, im, bb in entries:
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        if x + w > PAGE:
            x, y, shelf = 0, y + shelf + 1, 0
        if y + h > PAGE:
            flush()
            x, y, shelf = 0, 0, 0
        placed.append((key, im, bb, x, y))
        x += w + 1
        shelf = max(shelf, h)
    flush()
    return pages


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    for d in ('atlas', 'ui', 'audio', 'fonts'):
        os.makedirs(os.path.join(OUT, d))
    load = lambda f: json.load(open(os.path.join(DATA, f + '.json'), encoding='utf-8'))
    manifest = {}
    missing = []

    def collect(sheetpath, names, prefix=''):
        out = []
        for n in names:
            im = frame(sheetpath, prefix + n + '.png')
            if im is None:
                missing.append(prefix + n)
            else:
                out.append((n, im))
        return out

    # buildings -------------------------------------------------------------
    wp = collect('buildings/workplace/_workplaceBuildings_ss', [w['name'] for w in load('workplaces')],
                 'buildings/workplace/')
    res = collect('buildings/residence/_residenceBuildings_ss', [r['name'] for r in load('residences')],
                  'buildings/residence/')
    dec = collect('buildings/decor/_decor_ss', [d['name'] for d in load('decor')], 'buildings/decor/')
    pnames = [k.split('/')[-1][:-4] for k in sheet('buildings/paths/_paths_ss')[0]
              if '_summer' not in k]
    pth = collect('buildings/paths/_paths_ss', pnames, 'buildings/paths/')
    tre = collect('buildings/trees/_trees_ss', ['Tree%d' % i for i in range(1, 8)], 'buildings/trees/')
    com = collect('buildings/common/_buildingsCommon_ss',
                  ['GroundTileBig', 'SelectionSquare', 'SelectionSquareFill'], 'buildings/common/')
    com += collect('stimulate/_stimulate_ss', ['ConstructionYard_%d' % i for i in range(1, 6)] +
                   ['coin_00%d' % i for i in range(1, 5)], 'stimulate/')
    com += collect('always_on_screen_ui/always_on_screen', ['Notif-Clone', 'Notif-NewJob', 'Notif-House', 'Utopium'],
                   'always_on_screen_ui/sprites/')
    ns = Image.open(os.path.join(RES, 'terrain_notifs/sprites/notif-stimulate.png')).convert('RGBA')
    com.append(('notif-stimulate', ns))
    manifest['buildings'] = pack('buildings', wp + res)
    manifest['small'] = pack('small', dec + pth + tre + com)

    # clones ------------------------------------------------------------------
    jobs = [j for j in load('jobs')]
    cn = []
    for j in jobs:
        for s in ('M', 'F'):
            cn += ['%d%s' % (j['id'], s), '%d%s_L' % (j['id'], s)]
    chars = [(n, im) for n, im in ((n, frame('characters/_characters_ss', 'characters/%s.png' % n)) for n in
                                   cn + ['CloneMale', 'FemaleClone', 'Male1', 'Female1']) if im is not None]
    manifest['clones'] = pack('clones', chars)
    json.dump(manifest, open(os.path.join(OUT, 'atlas', 'manifest.json'), 'w'))

    # UI single PNGs ---------------------------------------------------------------
    ui = {
        'always_on_screen_ui/always_on_screen': ['Coin', 'Utopium', 'UITopBar', 'PlusButton', 'PlusButton_pressed',
                                                 'Notif-Clone', 'Notif-NewJob', 'HUDHeart'],
        'popups/_popupsSS': ['Chroma', 'CloseButton', 'CloseButton_Pressed', 'Build', 'Build_pressed', 'Expand',
                             'Expand_pressed', 'Landscape', 'SpeedUpbtn', 'SpeedUpbtn_pressed', 'Free', 'FreePressed',
                             'Yes', 'YesPressed', 'No', 'NoPressed', 'Splice_NoCombo', 'Splice_OldCombo',
                             'Splice_NewCombo', 'Splice_EvilCombo', 'Splice_normal', 'Splice_pressed',
                             'CharacterSplicebox', 'SplicingClone', 'WaitingClone', 'UnderConstruction',
                             'working', 'Idle', 'PlainBg', 'Spliceloadingbar', 'SpliceMenuJobSelectedBox',
                             'SpliceCharacterjobbox', 'status_lock', 'status_star', 'BackButton', 'BackButton_Pressed',
                             'FlipButton', 'FlipButton_Pressed', 'Deletebtn', 'build-moar-house', 'CurrencyBox',
                             'Building-Notification-Box', 'NotificationBar'],
    }
    prefix = {'always_on_screen_ui/always_on_screen': 'always_on_screen_ui/sprites/', 'popups/_popupsSS': 'popups/'}
    for sp, names in ui.items():
        for n in names:
            im = frame(sp, prefix[sp] + n + '.png')
            if im is None:
                missing.append(n)
                continue
            im.save(os.path.join(OUT, 'ui', n + '.png'))
    shutil.copy(os.path.join(RES, 'always_on_screen_ui/sprites/bg1.png'), os.path.join(OUT, 'ui', 'bg1.png'))
    for n in ('discovery_04', 'extra_05', 'recharge_10', 'tap_01', 'correct_03', 'Construction_sound', 'nega tap_02'):
        shutil.copy(os.path.join(RES, 'audio', n + '.mp3'), os.path.join(OUT, 'audio', n.replace(' ', '_') + '.mp3'))
    shutil.copy(os.path.join(RES, 'fonts', '04b03.ttf'), os.path.join(OUT, 'fonts', '04b03.ttf'))
    # icons for the PWA / home screen
    icon = Image.open(os.path.join(ROOT, 'res', 'mipmap-xxxhdpi-v4', 'ic_launcher.png')).convert('RGBA')
    pub = os.path.join(APP, 'public')
    for size, fn in ((180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')):
        bg = Image.new('RGBA', (size, size), (20, 12, 40, 255))
        ic = icon.resize((size, size), Image.NEAREST if size % icon.width == 0 else Image.LANCZOS)
        bg.alpha_composite(ic)
        bg.convert('RGB').save(os.path.join(pub, fn))
    print('pages', manifest)
    print('missing (no sprite in the APK):', missing)


main()

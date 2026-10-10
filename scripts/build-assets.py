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
    tre = collect('buildings/trees/_trees_ss', ['Tree%d' % i for i in range(1, 8)] + ['Tree101', 'SpecialTree1', 'SpecialTree2'],
                  'buildings/trees/')
    com = collect('buildings/common/_buildingsCommon_ss',
                  ['GroundTileBig', 'SelectionSquare', 'SelectionSquareFill', 'SpecialTerrain1'], 'buildings/common/')
    com += collect('stimulate/_stimulate_ss', ['ConstructionYard_%d' % i for i in range(1, 6)] +
                   ['coin_00%d' % i for i in range(1, 5)], 'stimulate/')
    com += collect('always_on_screen_ui/always_on_screen', ['Notif-Clone', 'Notif-NewJob', 'Notif-House', 'Utopium',
                                                            'notif-heart', 'notification_tree', 'Notif-Utopium',
                                                            'Notif-Gift', 'Notif-Empty', 'notif_specialgene',
                                                            'Notif-Hint', 'Notif-NewSkin'],
                   'always_on_screen_ui/sprites/')
    # milestone 2: wonders (one 1x1 tile per part), the Mission Pod and the animals
    wonders = ['MonumentPart%d' % i for i in range(1, 10)] + ['Monument3Part%d' % i for i in range(1, 5)] + \
              ['Monument4Part%d' % i for i in range(1, 5)]
    won = collect('buildings/wonders/_wonders_ss', wonders, 'buildings/wonders/')
    won += collect('buildings/workplace/_workplaceBuildings_ss', ['RocketShip'], 'buildings/workplace/')
    ani = [('A%d' % a['id'], im) for a, im in
           ((a, frame('animals/_animals_ss', 'animals/%dA.png' % a['id'])) for a in load('animals')) if im is not None]
    ns = Image.open(os.path.join(RES, 'terrain_notifs/sprites/notif-stimulate.png')).convert('RGBA')
    com.append(('notif-stimulate', ns))
    manifest['buildings'] = pack('buildings', wp + res)
    manifest['small'] = pack('small', dec + pth + tre + com + ani)
    manifest['wonders'] = pack('wonders', won)
    # milestone 3: Arcade skins (AltTile rows of shop_offers) and the residence paint layers (_Layer1/_Layer2)
    skins = collect('buildings/workplace/_workplaceBuildings_ss', [o['skin'] for o in load('offers')['skins']],
                    'buildings/workplace/')
    layers = collect('buildings/residence/_residenceBuildings_ss',
                     [r['name'] + l for r in load('residences') for l in ('_Layer1', '_Layer2')], 'buildings/residence/')
    manifest['skins'] = pack('skins', skins + layers)

    # clones ------------------------------------------------------------------
    jobs = [j for j in load('jobs')]
    cn = []
    for j in jobs:
        for s in ('M', 'F'):
            cn += ['%d%s' % (j['id'], s), '%d%s_L' % (j['id'], s)]
    chars = [(n, im) for n, im in ((n, frame('characters/_characters_ss', 'characters/%s.png' % n)) for n in
                                   cn + ['CloneMale', 'FemaleClone', 'Male1', 'Female1', '2001', '2001_L', '2005',
                                         '2005_L']) if im is not None]
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
                             'Building-Notification-Box', 'NotificationBar', 'HeartBG', 'RefreshMission',
                             'MissionBoxHighlight', 'Movebtn', 'Movebtn_pressed', 'Deletebtn_pressed',
                             'Special Building Button', 'Special Building Button pressed', 'SeasonArt_Thaw',
                             'SeasonArt_Swell', 'SeasonArt_Harvest', 'SeasonArt_Frost', 'GiftCollected',
                             'norequirement', 'AnimalSilhouette', 'VacationBtn', 'notif-heart',
                             # milestone 3
                             'Cursor', 'TutorialBox', 'MiniquestBanner_Altar', 'MiniquestBanner_Bank',
                             'MiniquestBanner_Calendar', 'MiniquestBanner_Park', 'MiniquestBanner_TVStation',
                             'MiniquestBanner_TownHall', 'MiniquestBanner_UtopiaHQ', 'Calendar_Weekday',
                             'Calendar_Weekend', 'Highlight_Weekday', 'Highlight_Weekend', 'SeasonArt_None',
                             'SpecialGeneCollectArt', 'specialgenecharbox', 'AnimalSpliceArt', 'AnimalSpliceBG',
                             'AnimalSpliceButton', 'Splice_AnimalCombo', 'ArrowAnimalSplicer', 'Reveal-Formula',
                             'Customizebtn', 'Customizebtn_pressed', 'Shop', 'Coin_BoxArt', 'Utopium_BoxArt',
                             'KRPack_BoxArt', 'CTPack_BoxArt', 'XmasPack_BoxArt', 'NaturePack_BoxArt',
                             'HalloweenPack_BoxArt', 'THPack_BoxArt', 'SaveButton', 'BusinessBg', 'HintPerson',
                             'Gallery_Arrow_button', 'ToAltarButton', 'Casino_Spin', 'Casino_Spin_Pressed',
                             'NewJobGlow', 'status_star', 'Special Building Button2', 'BoxBlue', 'BoxPurple'],
        'tutorial/_tutorial_ss': ['narrator_box', 'mouth_shape_1', 'mouth_shape_2', 'mouth_shape_3', 'mouth_shape_4',
                                  'mouth_shape_5'],
        'localization/english/image_english': ['TutorialNextbtn_normal', 'TutorialNextbtn_pressed', 'SpiritWatch',
                                               'breaking_news_1', 'UNNewsbar'],
    }
    ui['always_on_screen_ui/always_on_screen'] += ['Season_Thaw', 'Season_Swell', 'Season_Harvest', 'Season_Frost',
                                                   'Season_Calendar', 'GiftPacket', 'NewsFeedBar', 'notif_specialgene',
                                                   'Notif-Hint', 'Notif-NewSkin']
    prefix = {'always_on_screen_ui/always_on_screen': 'always_on_screen_ui/sprites/', 'popups/_popupsSS': 'popups/',
              'tutorial/_tutorial_ss': 'tutorial/sprites/',
              'localization/english/image_english': 'localization/english/'}
    for sp, names in ui.items():
        for n in names:
            im = frame(sp, prefix[sp] + n + '.png')
            if im is None:
                missing.append(n)
                continue
            im.save(os.path.join(OUT, 'ui', n.replace(' ', '_') + '.png'))
    # achievements (acN) and credits (<ID>C) icons, the Observatory's space backgrounds
    os.makedirs(os.path.join(OUT, 'ui', 'ach'))
    for a in load('achievements'):
        for n in (a['sprite'], 'ac_locked'):
            im = frame('achievements/_achievements_ss', 'achievements/%s.png' % n)
            if im is not None:
                im.save(os.path.join(OUT, 'ui', 'ach', n + '.png'))
    os.makedirs(os.path.join(OUT, 'ui', 'credits'))
    for c in load('credits'):
        im = frame('credits/_credits_ss', 'credits/%dC.png' % c['id'])
        if im is not None:
            im.save(os.path.join(OUT, 'ui', 'credits', '%d.png' % c['id']))
    for i in range(2, 7):
        shutil.copy(os.path.join(RES, 'always_on_screen_ui/sprites/bg%d.png' % i), os.path.join(OUT, 'ui', 'bg%d.png' % i))
    # reward card art (cPackOpeningPopup), scaled down from 640x960
    os.makedirs(os.path.join(OUT, 'ui', 'packets'))
    for n in ('GIFTpacket', 'LevelUpPacket', 'LOVEpacket', 'NewAnimalDiscovered', 'NewJobDiscovered', 'SpecialPacket',
              'MissionPacket', 'NineAnimalsPacket', 'ShopPacket', 'ArcadePacket'):
        im = frame('pack_opening_ui/sprites/_pack_opening_ss', 'pack_opening_ui/sprites/%s-hd.png' % n)
        im.resize((240, 360), Image.LANCZOS).save(os.path.join(OUT, 'ui', 'packets', n + '.png'), optimize=True)
    # background music (06: the .m4a versions) and the packet "rip" sound
    os.makedirs(os.path.join(OUT, 'music'))
    for n in ('Outer Space Theme RMX 1', 'Outer Space Theme RMX 2', 'Small Town Far In Space', 'Outer Space'):
        shutil.copy(os.path.join(RES, 'audio', n + '.m4a'), os.path.join(OUT, 'music', n.replace(' ', '_') + '.m4a'))
    shutil.copy(os.path.join(RES, 'audio', 'Rip.m4a'), os.path.join(OUT, 'audio', 'Rip.m4a'))
    shutil.copy(os.path.join(RES, 'always_on_screen_ui/sprites/bg1.png'), os.path.join(OUT, 'ui', 'bg1.png'))
    for n in ('discovery_04', 'extra_05', 'recharge_10', 'tap_01', 'correct_03', 'Construction_sound', 'nega tap_02',
              'notification_01', 'buff_tadaa', 'splice_02', 'Broadcast News Short'):
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

#!/usr/bin/env python3
"""Turn the Pixel People 4.20 static-data TSVs into typed JSON under src/data.

Usage: python3 scripts/build-data.py [path/to/datos/apk_moderna]
The generated JSON is committed, so Python is only needed to regenerate it.
"""
import csv, json, os, re, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '/mnt/project-files/datos/apk_moderna'
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'data')
os.makedirs(OUT, exist_ok=True)


def rows(name):
    with open(os.path.join(SRC, name), encoding='utf-8-sig', newline='') as f:
        return list(csv.reader(f, delimiter='\t'))


# ---- display names (text_english is what the game shows) -------------------
TEXT = {}
for r in rows('text_english.tsv')[1:]:
    if len(r) >= 2 and r[0] not in TEXT:
        TEXT[r[0]] = r[1]


def disp(internal, fallback):
    v = TEXT.get(internal + '_DisplayName')
    return (v or fallback or internal).strip()


def num(s, default=0):
    s = (s or '').strip()
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return default


def cells(cols):
    out = []
    for c in cols:
        c = c.strip()
        if not c:
            continue
        p = c.split(',')
        if len(p) >= 2:
            out.append([int(p[0]), int(p[1])])
    return out or [[0, 0]]


def kinds(cols):
    for c in cols:
        p = c.strip().split(',')
        if len(p) == 3:
            return p[2]
    return 'Land'


def parse_cost(s):
    """'10000' -> coins, '2u' -> utopium, '10u,200c' -> utopium+chroma, '-' -> None."""
    s = (s or '').strip()
    if not s or s in ('-', 'TBC'):
        return None
    cost = {'coins': 0, 'utopium': 0, 'chroma': 0}
    for part in s.split(','):
        part = part.strip()
        m = re.fullmatch(r'(\d+)\s*([uc]?)', part)
        if not m:
            return None
        v, unit = int(m.group(1)), m.group(2)
        cost[{'': 'coins', 'u': 'utopium', 'c': 'chroma'}[unit]] += v
    return cost


# ---- jobs --------------------------------------------------------------------
jobs = []
for r in rows('jobs_static_data.tsv')[1:]:
    r = r + [''] * 17
    if not r[0].strip() or not r[1].strip():
        continue
    name = r[1].strip()
    jtype = r[5].strip()
    if jtype not in ('Normal', 'Special'):
        continue
    jobs.append({
        'id': int(r[0]),
        'name': name,
        'displayName': TEXT.get('JobData ' + name, name).replace('_', ' ').strip(),
        'parent1': r[2].strip(),
        'parent2': r[3].strip(),
        'group': r[4].strip(),
        'type': jtype,
        'maleName': (r[6].strip() + ' ' + r[7].strip()).strip(),
        'femaleName': (r[8].strip() + ' ' + r[9].strip()).strip(),
        'quote': r[10].strip(),
        'workplaces': [w.strip() for w in r[11:14] if w.strip()],
        'requires': r[14].strip(),
    })

# ---- workplaces --------------------------------------------------------------
workplaces = []
hdr = rows('workplace_building_static_data.tsv')[0]
for r in rows('workplace_building_static_data.tsv')[1:]:
    r = r + [''] * 25
    if not r[2].strip():
        continue
    name = r[2].strip()
    workplaces.append({
        'name': name,
        'displayName': disp(name, r[1]),
        'workingTimeMin': num(r[3]),
        'multiplier': num(r[4]),
        'jobs': [j.strip() for j in r[5:11] if j.strip()],
        'maxOccupancy': num(r[11]),
        'baseConstructionSec': num(r[12]),
        'special': r[13].strip(),
        'buildType': r[14].strip(),
        'category': r[15].strip(),
        'buildable': r[16].strip() == 'Y',
        'size': num(r[18], 1),
        'cells': cells(r[19:]),
    })

# ---- residences --------------------------------------------------------------
residences = []
for r in rows('resident_building_static_data.tsv')[1:]:
    r = r + [''] * 15
    if not r[1].strip():
        continue
    name = r[1].strip()
    ctype = r[8].strip()
    parts = [num(x) for x in r[7].split(',')] if r[7].strip() else [0]
    cost = {'coins': 0, 'utopium': 0, 'chroma': 0}
    if ctype == 'Cash':
        cost['coins'] = parts[0]
    elif ctype == 'CashUtopium':
        cost['coins'], cost['utopium'] = parts[0], parts[1] if len(parts) > 1 else 0
    elif ctype == 'UtopiumChroma':
        cost['utopium'], cost['chroma'] = parts[0], parts[1] if len(parts) > 1 else 0
    tcells = r[10:]
    residences.append({
        'name': name,
        'displayName': disp(name, name),
        'population': num(r[2]),
        'baseConstructionSec': num(r[3]),   # column says (min) but the code uses it as seconds (03 §1.4)
        'cost': cost,
        'costType': ctype,
        'landCost': 0 if kinds(tcells) == 'Astro' else num(r[9], 1),
        'size': num(r[9], 1),
        'cells': cells(tcells),
        'kind': kinds(tcells),
    })

# ---- decor -------------------------------------------------------------------
decor = []
for r in rows('decor_static_data.tsv')[1:]:
    r = r + [''] * 15
    if not r[2].strip():
        continue
    decor.append({
        'id': num(r[0]),
        'name': r[2].strip(),
        'displayName': disp(r[2].strip(), r[1]).strip(),
        'spirit': num(r[3]),
        'cost': parse_cost(r[4]),
        'landCost': num(r[5]),
        'category': r[6].strip(),
        'size': num(r[8], 1),
        'cells': cells(r[9:]),
    })

# ---- paths -------------------------------------------------------------------
paths = []
for r in rows('path_static_data.tsv')[1:]:
    r = r + [''] * 12
    if not r[1].strip():
        continue
    paths.append({
        'name': r[1].strip(),
        'displayName': disp(r[1].strip(), r[1].strip()),
        'cost': parse_cost(r[2]),
        'landCost': num(r[3]),
        'pathType': r[4].strip(),
    })

# ---- trees -------------------------------------------------------------------
trees = []
for r in rows('trees_static_data.tsv')[1:]:
    r = r + [''] * 12
    if not r[2].strip():
        continue
    trees.append({
        'name': r[2].strip(),
        'displayName': disp(r[2].strip(), r[1]).strip(),
        'cost': parse_cost(r[3]),
        'landCost': num(r[4]),
    })

# ---- land --------------------------------------------------------------------
land = []
for r in rows('land_upgrade_data.tsv')[1:]:
    if r and r[0].strip():
        land.append({'level': int(r[0]), 'cost': int(r[1]), 'land': int(r[2]), 'utopium': int(r[3])})

# ---- animals -----------------------------------------------------------------
animals = []
for r in rows('animals_static_data.tsv')[1:]:
    r = r + [''] * 12
    if not r[0].strip().isdigit():
        continue
    animals.append({
        'id': int(r[0]),
        'name': r[1].strip(),
        'tier': num(r[3]),
        'categories': [c.strip() for c in r[4].split(',') if c.strip()],
        'seasons': [c.strip().upper() for c in r[5].split(',') if c.strip()],
        'cost': num(r[8]),
        'omit': r[9].strip() == 'Y',
        'droppable': r[10].strip() == 'Y',
    })

# ---- missions (04 §1.1): Omit=Y rows are not loaded; Omit=X are loaded as discontinued ----------
MTYPE = {'Normal': 2, 'Epic': 3, 'Unique': 4, 'Wonder': 5}
missions = []
for r in rows('missions.tsv')[1:]:
    r = r + [''] * 20
    mid, mtype = r[0].strip(), r[1].strip()
    if not mid or r[3].strip() == 'Y' or mtype not in MTYPE:
        continue
    missions.append({
        'id': mid,
        'type': MTYPE[mtype],
        'reward': r[2].strip(),
        'discontinued': r[3].strip() == 'X',
        'prerequisite': r[5].strip(),
        'reqs': [(x.strip() or 'NONE') for x in r[6:15]],
        'season': r[16].strip().upper(),
        'needAltar': r[17].strip() == 'Y',
        'needJobs': num(r[18]),
        'name': (TEXT.get('Mission_' + mid) or TEXT.get(mid + '_Header') or mid).strip(),
        'desc': (TEXT.get(mid + '_Desc') or '').strip(),
    })

# ---- a few UI strings ------------------------------------------------------------
keys = [k for k in TEXT if k.startswith(('Splicer_', 'SplicerPopup_'))] + [
    'Insufficient_Coin_Notif', 'LandLimitReached_Notif'] + [
    k for k in TEXT if k.startswith(('Monument', 'Wonder_', 'Heart_Quote', 'Hotel_', 'MissionControl_'))]
strings = {k: TEXT[k] for k in keys if k in TEXT}

for fname, data in [('jobs', jobs), ('workplaces', workplaces), ('residences', residences),
                    ('decor', decor), ('paths', paths), ('trees', trees), ('land', land),
                    ('animals', animals), ('missions', missions), ('strings', strings)]:
    with open(os.path.join(OUT, fname + '.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(fname, len(data))

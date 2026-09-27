#!/usr/bin/env python3
"""Build data/foods.json for Overload from USDA FoodData Central CSV downloads.

Usage: python3 tools/build_foods.py [--branded INDEX.tsv.gz] SR_LEGACY_DIR [FOUNDATION_DIR] > data/foods.json

Each DIR is an unzipped FoodData Central CSV download (food.csv,
food_nutrient.csv, food_portion.csv, ...). USDA data is public domain.

Output keeps what the app needs and nothing else: calories, protein, carbs
and fat per 100 g, the food's category, and its common servings in grams.
Foods listed in tools/staples.tsv (fdc_id, short name) are shown under the
short name and ranked first in search.

With --branded, packaged products picked in tools/branded.tsv are added from
the branded index (tools/build_branded_index.py), plus any Open Food Facts
fills in tools/branded_off.tsv. These carry a barcode, the label serving and
a drink flag (nutrients per 100 ml). A summary goes to stderr.
"""
import csv
import gzip
import json
import os
import re
import sys

csv.field_size_limit(10 ** 8)
HERE = os.path.dirname(os.path.abspath(__file__))

# Nutrient ids. Energy is 1008 in SR Legacy; Foundation foods often only
# carry the Atwater energy values (2047 general, 2048 specific).
KCAL = ('1008', '2048', '2047')
PROTEIN = '1003'
FAT = '1004'
CARBS = ('1005', '1050')  # by difference, then by summation
WANTED = set(KCAL) | {PROTEIN, FAT} | set(CARBS)

DATA_TYPES = {'sr_legacy_food': 'sr', 'foundation_food': 'fnd'}
SKIP_CATEGORIES = {'Baby Foods'}


def rows(folder, name):
    path = os.path.join(folder, name)
    if not os.path.exists(path):
        return
    with open(path, newline='', encoding='utf-8') as f:
        yield from csv.DictReader(f)


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def trim(x):
    """1.0 -> 1, 0.5 -> 0.5, for serving labels."""
    return ('%g' % x) if x is not None else ''


def load(folder, categories, foods):
    for r in rows(folder, 'food_category.csv'):
        categories.setdefault(r['id'], r['description'])
    units = {r['id']: r['name'] for r in rows(folder, 'measure_unit.csv')}

    local = {}
    for r in rows(folder, 'food.csv'):
        src = DATA_TYPES.get(r['data_type'])
        if not src:
            continue
        cat = categories.get(r.get('food_category_id', ''), '')
        if cat in SKIP_CATEGORIES:
            continue
        local[r['fdc_id']] = {'id': int(r['fdc_id']), 'name': r['description'].strip(), 'src': src, 'cat': cat, 'n': {}, 'servings': []}

    for r in rows(folder, 'food_nutrient.csv'):
        f = local.get(r['fdc_id'])
        if f is not None and r['nutrient_id'] in WANTED:
            v = num(r['amount'])
            if v is not None:
                f['n'][r['nutrient_id']] = v

    for r in sorted(rows(folder, 'food_portion.csv'), key=lambda r: (r['fdc_id'], int(num(r.get('seq_num')) or 0))):
        f = local.get(r['fdc_id'])
        grams = num(r.get('gram_weight'))
        if f is None or not grams or grams <= 0:
            continue
        unit = units.get(r.get('measure_unit_id', ''), '')
        if unit in ('undetermined', 'unknown'):
            unit = ''
        desc = (r.get('portion_description') or '').strip()
        mod = (r.get('modifier') or '').strip()
        if desc and desc.lower() not in ('quantity not specified',):
            label = desc
        else:
            label = ' '.join(p for p in (trim(num(r.get('amount'))), unit, mod) if p)
        if label and all(s[0] != label for s in f['servings']):
            f['servings'].append([label, round(grams, 1)])

    foods.extend(local.values())


def pick(n, ids):
    for i in ids:
        if i in n:
            return n[i]
    return None


def load_staples():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'staples.tsv')
    staples = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.split('#', 1)[0].strip()
                if line:
                    fdc, short = line.split('\t', 1)
                    staples[int(fdc)] = short.strip()
    return staples


UNIT_WORDS = [(r'\bONZ\b', 'oz'), (r'\bOZA\b', 'fl oz'), (r'\bFOZ\b', 'fl oz'), (r'\bGRM\b', 'g'), (r'\bMLT\b', 'ml'), (r'\bEA\b', 'each')]


def household(text):
    t = ' '.join(str(text or '').split('|')[0].split())
    t = re.sub(r'\s*\(?about\)?$', '', t, flags=re.I)
    t = re.sub(r',?\s*\d+ servings? per container', '', t, flags=re.I)
    t = re.sub(r'\s*per serving$', '', t, flags=re.I)
    t = re.sub(r'\bwaffies\b', 'waffles', t, flags=re.I)
    if re.fullmatch(r'amount( per serving)?', t, flags=re.I):
        t = '1 serving'
    for rx, word in UNIT_WORDS:
        t = re.sub(rx, word, t)
    if t.upper() == t:
        t = t.lower()
    return t.strip(' ,')


def serving_of(size, unit, label):
    """[label, grams] for the label serving, and whether it is a drink (ml)."""
    unit = str(unit or '').strip().lower()
    try:
        size = float(size)
    except (TypeError, ValueError):
        size = 0
    liquid = unit in ('ml', 'mlt')
    if unit not in ('g', 'grm', 'gm', 'mg', 'ml', 'mlt') or size <= 0:
        return None, liquid
    return [label or '1 serving', round(size, 1)], liquid


def code_key(gtin):
    """Barcodes compared without leading zeros: GTIN-14, EAN-13 and UPC-A agree."""
    return re.sub(r'\D', '', str(gtin or '')).lstrip('0')


def load_branded(index_path, cats):
    picks = {}
    for line in open(os.path.join(HERE, 'branded.tsv'), encoding='utf-8'):
        parts = line.rstrip('\n').split('\t')
        if len(parts) >= 2 and parts[0].isdigit():
            picks[parts[0]] = parts[1]
    rows = []
    with gzip.open(index_path, 'rt', encoding='utf-8') as f:
        for r in csv.reader(f, delimiter='\t'):
            name = picks.get(r[0])
            if not name:
                continue
            fdc, gtin, owner, brand, desc, cat, size, unit, house = r[:9]
            kcal, p, c, fat = (max(0.0, float(x)) for x in r[9:13])
            serving, liquid = serving_of(size, unit, household(house))
            if cat not in cats:
                cats.append(cat)
            rows.append([int(fdc), name, round(kcal), round(p, 1), round(c, 1), round(fat, 1), cats.index(cat), 'br', [], 0, desc,
                         code_key(gtin), serving, 1 if liquid else 0])
    missing = set(picks) - {str(r[0]) for r in rows}
    if missing:
        print('branded picks not in index: %s' % sorted(missing), file=sys.stderr)
    off = os.path.join(HERE, 'branded_off.tsv')
    if os.path.exists(off):
        cat = 'Packaged foods (Open Food Facts)'
        if cat not in cats:
            cats.append(cat)
        for line in open(off, encoding='utf-8'):
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 10 or not parts[1].strip():
                continue
            name, code, pname, brand, ssize, sgrams = parts[:6]
            kcal, p, c, fat = (max(0.0, float(x)) for x in parts[6:10])
            liquid = bool(re.search(r'\d\s*ml\b', ssize, re.I))
            serving, _ = serving_of(sgrams, 'ml' if liquid else 'g', household(ssize))
            rows.append(['o' + code_key(code), name, round(kcal), round(p, 1), round(c, 1), round(fat, 1), cats.index(cat), 'offx', [], 0, pname,
                         code_key(code), serving, 1 if liquid else 0])
    return rows


def main(folders, branded=None):
    categories, foods = {}, []
    for folder in folders:
        load(folder, categories, foods)
    staples = load_staples()

    # The same food can appear more than once (SR Legacy and Foundation both
    # have "Broccoli, raw"). Keep one: a staple if any, then the one with the
    # most servings, then SR Legacy.
    best = {}
    for f in foods:
        key = f['name'].lower()
        rank = (f['id'] in staples, len(f['servings']), f['src'] == 'sr')
        if key not in best or rank > best[key][0]:
            best[key] = (rank, f)
    dupes = len(foods) - len(best)
    foods = [v[1] for v in best.values()]
    missing = set(staples) - {f['id'] for f in foods}
    if missing:
        print('staples not found: %s' % sorted(missing), file=sys.stderr)

    out, cats, dropped = [], [], 0
    for f in sorted(foods, key=lambda f: f['name'].lower()):
        n = f['n']
        p, fat, c = n.get(PROTEIN), n.get(FAT), pick(n, CARBS)
        kcal = pick(n, KCAL)
        if kcal is None and None not in (p, fat, c):
            kcal = 4 * p + 4 * c + 9 * fat
        if kcal is None or p is None or fat is None or c is None:
            dropped += 1
            continue
        if f['cat'] not in cats:
            cats.append(f['cat'])
        # Carbs "by difference" can come out slightly negative; nothing is below zero.
        kcal, p, c, fat = (max(0, x) for x in (kcal, p, c, fat))
        short = staples.get(f['id'])
        out.append([f['id'], short or f['name'], round(kcal), round(p, 1), round(c, 1), round(fat, 1),
                    cats.index(f['cat']), f['src'], f['servings'], 1 if short else 0, f['name'] if short else ''])
    if branded:
        out.extend(load_branded(branded, cats))

    doc = {
        'v': 3,
        'source': 'USDA FoodData Central (public domain): SR Legacy, Foundation Foods, Branded Foods; some packaged foods from Open Food Facts (ODbL)',
        'per': '100 g',
        'fields': ['fdc_id', 'name', 'kcal', 'protein', 'carbs', 'fat', 'category', 'source', 'servings', 'staple', 'usda_name', 'barcode', 'serving', 'drink'],
        'categories': cats,
        'foods': out,
    }
    text = json.dumps(doc, separators=(',', ':'), ensure_ascii=False)
    sys.stdout.write(text + '\n')
    by_src = {}
    for row in out:
        by_src[row[7]] = by_src.get(row[7], 0) + 1
    print('foods: %d %s, merged duplicates: %d, dropped (missing macros): %d, staples: %d, categories: %d, bytes: %d'
          % (len(out), by_src, dupes, dropped, sum(r[9] for r in out), len(cats), len(text.encode('utf-8'))), file=sys.stderr)


if __name__ == '__main__':
    args = sys.argv[1:]
    index = None
    if args[:1] == ['--branded']:
        index, args = args[1], args[2:]
    if not args:
        sys.exit(__doc__)
    main(args, index)

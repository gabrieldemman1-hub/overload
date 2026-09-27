#!/usr/bin/env python3
"""Build data/foods.json for Overload from USDA FoodData Central CSV downloads.

Usage: python3 tools/build_foods.py SR_LEGACY_DIR [FOUNDATION_DIR] > data/foods.json

Each DIR is an unzipped FoodData Central CSV download (food.csv,
food_nutrient.csv, food_portion.csv, ...). USDA data is public domain.

Output keeps what the app needs and nothing else: calories, protein, carbs
and fat per 100 g, the food's category, and its common servings in grams.
A summary goes to stderr.
"""
import csv
import json
import os
import sys

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
        local[r['fdc_id']] = {'name': r['description'].strip(), 'src': src, 'cat': cat, 'n': {}, 'servings': []}

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


def main(folders):
    categories, foods = {}, []
    for folder in folders:
        load(folder, categories, foods)

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
        out.append([f['name'], round(kcal), round(p, 1), round(c, 1), round(fat, 1),
                    cats.index(f['cat']), f['src'], f['servings']])

    doc = {
        'v': 1,
        'source': 'USDA FoodData Central (public domain): SR Legacy and Foundation Foods',
        'per': '100 g',
        'fields': ['name', 'kcal', 'protein', 'carbs', 'fat', 'category', 'source', 'servings'],
        'categories': cats,
        'foods': out,
    }
    text = json.dumps(doc, separators=(',', ':'), ensure_ascii=False)
    sys.stdout.write(text + '\n')
    by_src = {}
    for row in out:
        by_src[row[6]] = by_src.get(row[6], 0) + 1
    print('foods: %d %s, dropped (missing macros): %d, categories: %d, bytes: %d'
          % (len(out), by_src, dropped, len(cats), len(text.encode('utf-8'))), file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])

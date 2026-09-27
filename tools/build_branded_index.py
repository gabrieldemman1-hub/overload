#!/usr/bin/env python3
"""Shrink USDA FoodData Central Branded Foods to a searchable index.

Usage: python3 tools/build_branded_index.py BRANDED_DIR | gzip > branded_index.tsv.gz

BRANDED_DIR is the unzipped Branded Foods CSV download (public domain). One
line per product still on sale in the US with calories, protein, carbs and fat:

  fdc_id, gtin, brand_owner, brand_name, description, category,
  serving_size, serving_unit, household_serving, kcal, protein, carbs, fat

Nutrients are per 100 g (per 100 ml for drinks). When a barcode appears more
than once, the most recently published record wins. tools/branded.tsv picks
products from this index for data/foods.json.
"""
import csv
import os
import sys

csv.field_size_limit(10 ** 8)
KCAL, PROTEIN, FAT, CARBS = '1008', '1003', '1004', '1005'
COLS = {KCAL: 0, PROTEIN: 1, CARBS: 2, FAT: 3}


def rows(folder, name):
    with open(os.path.join(folder, name), newline='', encoding='utf-8') as f:
        yield from csv.DictReader(f)


def clean(s):
    return ' '.join(str(s or '').replace('\t', ' ').split())


def main(folder):
    published = {r['fdc_id']: r.get('publication_date', '') for r in rows(folder, 'food.csv') if r.get('data_type') == 'branded_food'}
    names = {}
    for r in rows(folder, 'food.csv'):
        if r['fdc_id'] in published:
            names[r['fdc_id']] = clean(r['description'])

    products = {}
    for r in rows(folder, 'branded_food.csv'):
        fdc = r['fdc_id']
        if fdc not in names or clean(r.get('discontinued_date')):
            continue
        country = clean(r.get('market_country'))
        if country and country != 'United States':
            continue
        products[fdc] = r

    n = {}
    for r in rows(folder, 'food_nutrient.csv'):
        col = COLS.get(r['nutrient_id'])
        if col is None or r['fdc_id'] not in products:
            continue
        try:
            v = float(r['amount'])
        except ValueError:
            continue
        n.setdefault(r['fdc_id'], [None] * 4)[col] = v

    best = {}
    for fdc, r in products.items():
        vals = n.get(fdc)
        if not vals or None in vals:
            continue
        gtin = clean(r.get('gtin_upc')).lstrip('0') or fdc
        key = (gtin, published.get(fdc, ''), clean(r.get('available_date')), int(fdc))
        if gtin not in best or key[1:] > best[gtin][0][1:]:
            best[gtin] = (key, fdc)

    w = csv.writer(sys.stdout, delimiter='\t', lineterminator='\n')
    count = 0
    for gtin, (key, fdc) in sorted(best.items(), key=lambda kv: int(kv[1][1])):
        r, (kcal, p, c, f) = products[fdc], n[fdc]
        w.writerow([fdc, clean(r.get('gtin_upc')), clean(r.get('brand_owner')), clean(r.get('brand_name')), names[fdc],
                    clean(r.get('branded_food_category')), clean(r.get('serving_size')), clean(r.get('serving_size_unit')),
                    clean(r.get('household_serving_fulltext')), round(kcal, 1), round(p, 2), round(c, 2), round(f, 2)])
        count += 1
    print('products: %d of %d listed' % (count, len(products)), file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])

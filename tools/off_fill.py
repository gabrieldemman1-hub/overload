#!/usr/bin/env python3
"""Look up wishlist products that USDA does not have in Open Food Facts.

Usage: python3 tools/off_fill.py > tools/branded_off.tsv

Reads tools/branded_wishlist.txt and tools/branded.tsv; for every wishlist line
without a USDA match it searches Open Food Facts (most scanned first) and keeps
the first US product whose brand matches and has calories, protein, carbs and
fat. Output: name, barcode, product name, brand, serving size, serving grams,
kcal, protein, carbs, fat (per 100 g). Open Food Facts data is ODbL.
Searches are spaced out to stay inside Open Food Facts' rate limit.
"""
import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FIELDS = 'code,product_name,brands,countries_tags,serving_size,serving_quantity,nutriments'
UA = 'Overload/1.8 (personal food log; github.com/gabrieldemman1-hub/overload)'


def tokens(s):
    return re.findall(r'[a-z0-9]+', str(s).lower().replace("'", ''))


def wishlist():
    out = []
    for line in open(os.path.join(HERE, 'branded_wishlist.txt'), encoding='utf-8'):
        line = line.strip()
        if line and not line.startswith('#'):
            parts = [x.strip() for x in line.split('|')]
            out.append((parts[0], parts[1].lstrip('~'), [w for w in parts[2].split() if not w.startswith('-') and 'kcal' not in w]))
    return out


def search(q):
    url = 'https://world.openfoodfacts.org/cgi/search.pl?' + urllib.parse.urlencode({
        'search_terms': q, 'search_simple': 1, 'action': 'process', 'json': 1, 'page_size': 20,
        'sort_by': 'unique_scans_n', 'fields': FIELDS})
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r).get('products', [])


def main():
    have = {l.split('\t')[1] for l in open(os.path.join(HERE, 'branded.tsv'), encoding='utf-8') if '\t' in l}
    w = csv.writer(sys.stdout, delimiter='\t', lineterminator='\n')
    for name, brand, words in wishlist():
        if name in have:
            continue
        time.sleep(7)
        try:
            products = search(name)
        except Exception as e:  # keep going; a miss is just a miss
            print('error %s: %s' % (name, e), file=sys.stderr)
            continue
        btoks, wtoks = tokens(brand), tokens(' '.join(words))
        pick = None
        for p in products:
            n = p.get('nutriments') or {}
            vals = [n.get(k) for k in ('energy-kcal_100g', 'proteins_100g', 'carbohydrates_100g', 'fat_100g')]
            if any(v in (None, '') for v in vals):
                continue
            ptoks = tokens((p.get('product_name') or '') + ' ' + (p.get('brands') or ''))
            if not all(any(t.startswith(b) for t in ptoks) for b in btoks):
                continue
            if not all(any(t.startswith(x) for t in ptoks) for x in wtoks):
                continue
            if 'en:united-states' not in (p.get('countries_tags') or []):
                continue
            pick = (p, vals)
            break
        if not pick:
            print('miss: ' + name, file=sys.stderr)
            continue
        p, vals = pick
        w.writerow([name, p.get('code', ''), p.get('product_name', ''), (p.get('brands') or '').split(',')[0],
                    p.get('serving_size') or '', p.get('serving_quantity') or ''] + [round(float(v), 2) for v in vals])
        print('found: %s -> %s' % (name, p.get('product_name')), file=sys.stderr)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Pick products from the branded index for each line of tools/branded_wishlist.txt.

Usage: python3 tools/pick_branded.py branded_index.tsv.gz > tools/branded.tsv

Wishlist lines are  Name | brand | words [| category]:
  Name      the name shown in the app; * names it from the USDA description
            and the brand ("Lucerne 2% Reduced Fat Milk"); *ALL* takes every
            matching product, each named that way (store brands).
  brand     matched as whole words in the USDA brand owner or brand name;
            a leading ~ also allows the description ("~eggo" for
            "Kellogg's Eggo Waffles").
  words     each must start a word of the description or brand name;
            -word excludes products whose description has that word;
            kcal>30 or kcal<5 bounds calories per 100 g.
  category  optional; must appear in the USDA category (or description),
            or with a leading = be the whole category.

Records whose calories cannot be right are skipped: over 900 kcal per 100 g,
or calories far from what the protein, carbs and fat add up to (a record
entered per serving instead of per 100 g usually trips this).

Writes one line per product found: fdc_id, name for the app, and the USDA
description (for review). Lines with no match are listed on stderr.
The index comes from tools/build_branded_index.py (food-raw branch).
"""
import csv
import gzip
import os
import re
import sys

csv.field_size_limit(10 ** 8)
HERE = os.path.dirname(os.path.abspath(__file__))


def norm(s):
    return re.sub(r'\s+', ' ', str(s).lower().replace('’', "'").replace('ä', 'a').replace('é', 'e').replace('ó', 'o').replace('í', 'i'))


def tokens(s):
    return re.findall(r"[a-z0-9]+", norm(s).replace("'", ''))


def load_index(path):
    out = []
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        for r in csv.reader(f, delimiter='\t'):
            fdc, gtin, owner, brand, desc, cat, size, unit, house = r[:9]
            out.append((r, norm(owner + ' | ' + brand), norm(desc), set(tokens(brand + ' ' + desc)), set(tokens(desc)), norm(cat)))
    return out


def load_wishlist():
    wishes = []
    with open(os.path.join(HERE, 'branded_wishlist.txt'), encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = [x.strip() for x in line.split('|')]
            name, brand, words = parts[:3]
            cat = norm(parts[3]) if len(parts) > 3 else ''
            bounds = [(m.group(1), float(m.group(2))) for m in re.finditer(r'kcal([<>])(\d+)', words)]
            words = re.sub(r'kcal[<>]\d+', ' ', words)
            in_desc = brand.startswith('~')
            b = norm(brand.lstrip('~')).replace("'", '')
            rx = re.compile(r'(?<![a-z0-9])' + re.escape(b).replace(r'\ ', r'\s+') + r'(?![a-z0-9])')
            pos = tokens(' '.join(w for w in words.split() if not w.startswith('-')))
            neg = tokens(' '.join(w[1:] for w in words.split() if w.startswith('-')))
            wishes.append((name, rx, in_desc, pos, neg, cat, bounds, b))
    return wishes


def plausible(kcal, p, c, f):
    if kcal > 900 or min(kcal, p, c, f) < 0:
        return False
    est = 4 * p + 4 * c + 9 * f
    # Sugar alcohols and fiber make labels run under 4/4/9; allow for it.
    return abs(est - kcal) <= max(40, 0.35 * max(kcal, est))


# How store brands read in the app, keyed by the wishlist brand.
DISPLAY = {
    'lucerne': 'Lucerne', 'signature select': 'Signature Select', 'signature farms': 'Signature Farms',
    'signature cafe': 'Signature Cafe', 'o organics': 'O Organics', 'open nature': 'Open Nature',
    'primo taglio': 'Primo Taglio', 'waterfront bistro': 'Waterfront Bistro',
    "henrys marketplace": 'Sprouts', 'sprouts farmers market': 'Sprouts', 'costco companies': 'Kirkland Signature',
}
SMALL = {'and', 'or', 'of', 'with', 'in', 'a', 'the', 'for', 'on', 'to'}
SIZE = re.compile(r'\b\d+(\.\d+)?\s*(oz|ounce|fl|lb|ct|count|g|ml|pk)\b\.?', re.I)


def auto_name(brand_key, desc):
    """'BLACK BEANS, BLACK' from Sprouts -> 'Sprouts Black Beans'."""
    display = DISPLAY.get(brand_key, brand_key.title())
    d = SIZE.sub('', desc)
    for word in (display, 'KIRKLAND SIGNATURE', 'SPROUTS', 'SIGNATURE SELECT', 'O ORGANICS', 'LUCERNE', 'OPEN NATURE'):
        d = re.sub(r'^\s*' + re.escape(word) + r'\s*,?\s*', '', d, flags=re.I)
    segs = [x.strip() for x in d.split(',') if x.strip()]
    keep = segs[:1]
    for seg in segs[1:]:
        # Later segments usually repeat the first ("BLACK BEANS, BLACK"); keep only new information.
        if not set(tokens(seg)) <= set(tokens(' '.join(keep))):
            keep.append(seg)
    words = ' '.join(', '.join(keep).split()).lower().split(' ')
    title = ' '.join(w if (w in SMALL and i) else (w[:1].upper() + w[1:]) for i, w in enumerate(words))
    return display + ' ' + title


BULK = re.compile(r'\b\d+\s*(ct|count|pk|pack)\b|variety|multi ?pack|assort|club pack|bulk', re.I)


def score(r, wtoks):
    fdc, gtin, owner, brand, desc, cat, size, unit, house = r[:9]
    s = 0
    if house.strip():
        s += 4
    if gtin.strip():
        s += 2
    if BULK.search(desc):
        s -= 5
    # Fewer extra words means a closer match to what was asked for.
    extra = len([t for t in tokens(desc) if not re.fullmatch(r'\d+(oz|g|ct|lb|fl)?', t)]) - len(wtoks)
    s -= max(0, extra) * 0.6
    s += int(fdc) / 1e8  # newer records win ties
    return s


def main(index_path):
    index = load_index(index_path)
    seen, found, missing = set(), 0, []
    w = csv.writer(sys.stdout, delimiter='\t', lineterminator='\n')
    for name, rx, in_desc, words, neg, cat, bounds, brand_key in load_wishlist():
        best, every = None, []
        for r, owner_brand, desc, toks, dtoks, rcat in index:
            if not (rx.search(owner_brand.replace("'", '')) or (in_desc and rx.search(desc.replace("'", '')))):
                continue
            if not all(any(t.startswith(x) for t in toks) for x in words):
                continue
            if any(any(t.startswith(x) for t in dtoks) for x in neg):
                continue
            if cat.startswith('='):
                if rcat != cat[1:]:
                    continue
            elif cat and cat not in rcat and cat not in desc:
                continue
            kcal, p, c, f = (float(x) for x in r[9:13])
            if not plausible(kcal, p, c, f):
                continue
            if any((op == '>' and not kcal > v) or (op == '<' and not kcal < v) for op, v in bounds):
                continue
            if r[0] in seen:
                continue
            sc = score(r, words)
            if name == '*ALL*':
                every.append(r)
            elif best is None or sc > best[0]:
                best = (sc, r)
        if name == '*ALL*':
            names = set()
            for r in sorted(every, key=lambda r: -int(r[0])):
                n = auto_name(brand_key, r[4])
                if n.lower() in names or r[0] in seen:
                    continue
                names.add(n.lower())
                seen.add(r[0])
                w.writerow([r[0], n, r[4]])
                found += 1
            if not names:
                missing.append(name + ' ' + brand_key)
            continue
        if best:
            if name == '*':
                name = auto_name(brand_key, best[1][4])
            seen.add(best[1][0])
            w.writerow([best[1][0], name, best[1][4]])
            found += 1
        else:
            missing.append(name)
    print('found %d, missing %d' % (found, len(missing)), file=sys.stderr)
    for m in missing:
        print('  missing: ' + m, file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])

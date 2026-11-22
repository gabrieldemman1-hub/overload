#!/usr/bin/env python3
"""Fills the generated parts of the mockups, in place. Run from anywhere: python3 tools/build_mocks.py
- copies the Today page of fuel-today.html behind the sheets of fuel-add.html and fuel-amount.html
- draws the body-weight chart (train-history.html) and the 14-day bars (fuel-trends.html) from the data below
- writes the icon sheet of icons.html from icons.svg
The mockups stay plain static HTML; this only saves hand-copying. Blocks sit between BEGIN/END comments."""
import math, os, random, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
def read(n): return open(os.path.join(ROOT, n), encoding='utf-8').read()
def write(n, s): open(os.path.join(ROOT, n), 'w', encoding='utf-8').write(s)

def put(html, name, body):
    """Replace <!--@NAME--> the first time, or what sits between BEGIN/END NAME after that."""
    block = '<!--BEGIN %s-->\n%s\n<!--END %s-->' % (name, body.strip('\n'), name)
    if '<!--@%s-->' % name in html: return html.replace('<!--@%s-->' % name, block)
    pat = re.compile(r'<!--BEGIN %s-->.*?<!--END %s-->' % (name, name), re.S)
    assert pat.search(html), 'no place for ' + name
    return pat.sub(lambda m: block, html)

# ---- 1. Today behind the Fuel sheets --------------------------------------
today = re.search(r'<!--BEGIN TODAY-->(.*?)<!--END TODAY-->', read('fuel-today.html'), re.S).group(1)
today = today.replace('id="gauge-ticks"', 'id="gauge-ticks"')  # same ids are fine: one copy per page
for f in ('fuel-add.html', 'fuel-amount.html'):
    write(f, put(read(f), 'TODAY', today))

# ---- 2. Body weight: 30 weigh-ins, running 7-entry average ----------------
random.seed(7)
n = 30
bw = [round(186.6 - 1.9 * i / (n - 1) + random.uniform(-0.75, 0.75), 1) for i in range(n)]
bw[-1] = 184.2
avg = [sum(bw[max(0, i - 6):i + 1]) / len(bw[max(0, i - 6):i + 1]) for i in range(n)]
W, H, PL, PR, PT, PB, LO, HI = 326, 140, 34, 14, 10, 22, 183.0, 188.0
X = lambda i: PL + i / (n - 1) * (W - PL - PR)
Y = lambda v: PT + (1 - (v - LO) / (HI - LO)) * (H - PT - PB)
day = lambda i: ('%d Oct' % (21 + i)) if i < 11 else ('%d Nov' % (i - 10))   # 21 Oct .. 19 Nov
dots = ''.join('<circle class="pt faint" cx="%.1f" cy="%.1f" r="2.25"><title>%s: %.1f lb</title></circle>' % (X(i), Y(v), day(i), v) for i, v in enumerate(bw))
line = ' '.join(('M' if i == 0 else 'L') + '%.1f %.1f' % (X(i), Y(a)) for i, a in enumerate(avg))
chart = ('    %s\n    <path class="line" d="%s"/>\n    <circle class="pt now" cx="%.1f" cy="%.1f" r="5"><title>7-entry average today: %.1f lb</title></circle>'
         % (dots, line, X(n - 1), Y(avg[-1]), avg[-1]))
h = read('train-history.html')
if '<!--@BWDOTS-->' in h:   # first run: the hand-written placeholders
    h = re.sub(r'    <!--@BWDOTS-->\n    <path class="line" d="@BWLINE"/>\n    <circle class="pt now" cx="@BWENDX" cy="@BWENDY" r="5">.*?</circle>', '<!--@BWCHART-->', h, flags=re.S)
write('train-history.html', put(h, 'BWCHART', chart))
print('body weight: latest %.1f, 7-entry avg %.1f, 30-day change %+.1f, this week avg %.1f, week before %.1f'
      % (bw[-1], avg[-1], bw[-1] - bw[0], sum(bw[-4:]) / 4, sum(bw[-11:-4]) / 7))

# ---- 3. Fuel trends: 14 days of kcal against the target -------------------
days = [('F', 6, 2480), ('S', 7, 2710), ('S', 8, 2350), ('M', 9, 2590), ('T', 10, 2620), ('W', 11, 2440), ('T', 12, 2905),
        ('F', 13, 2510), ('S', 14, None), ('S', 15, 2380), ('M', 16, 2640), ('T', 17, 2570), ('W', 18, 2450), ('T', 19, 1322)]
W, H, PL, PR, PT, PB, TOP, TARGET, BAR = 326, 170, 34, 4, 12, 26, 3000, 2600, 12
slot = (W - PL - PR) / len(days)
Y = lambda v: PT + (1 - v / TOP) * (H - PT - PB)
cap = lambda x, y0, y1: 'M%.1f %.1fV%.1fa2 2 0 0 1 2-2h%da2 2 0 0 1 2 2V%.1fz' % (x, y0, y1 + 2, BAR - 4, y0)   # square at the base, 2 px round at the data end
out = []
for i, (wd, d, v) in enumerate(days):
    x, mid, last = PL + i * slot + (slot - BAR) / 2, PL + i * slot + slot / 2, i == len(days) - 1
    if v is None:
        out.append('<rect class="bar none" x="%.1f" y="%.1f" width="%d" height="3" rx="1"><title>%d Nov: not logged</title></rect>' % (x, Y(0) - 3, BAR, d))
    elif v > TARGET:
        # the part up to the target, a 2 px gap on the target line, then the part over it
        out.append('<rect class="bar" x="%.1f" y="%.1f" width="%d" height="%.1f"><title>%d Nov: %s kcal</title></rect>' % (x, Y(TARGET) + 1, BAR, Y(0) - Y(TARGET) - 1, d, format(v, ',')))
        top = min(Y(v), Y(TARGET) - 4)   # an overage too small to see still gets a 3 px cap
        out.append('<path class="bar over" d="%s"><title>%d Nov: %d kcal over</title></path>' % (cap(x, Y(TARGET) - 1, top), d, v - TARGET))
    else:
        out.append('<path class="bar%s" d="%s"><title>%d Nov: %s kcal</title></path>' % (' now' if last else '', cap(x, Y(0), Y(v)), d, format(v, ',')))
    out.append('<text class="lbl%s" x="%.1f" y="%d" text-anchor="middle">%s</text>' % (' strong' if last else '', mid, H - 14, wd))
    if d in (6, 9, 16, 19): out.append('<text class="lbl" x="%.1f" y="%d" text-anchor="middle">%d</text>' % (mid, H - 2, d))
write('fuel-trends.html', put(read('fuel-trends.html'), 'TRENDBARS', '\n'.join('    ' + s for s in out)))
logged = [v for _, _, v in days if v]
print('trends: avg %.0f over %d days = %.0f%% of target' % (sum(logged) / len(logged), len(logged), 100 * sum(logged) / len(logged) / TARGET))

# ---- 3b. Sleep, 14 nights stacked: deep, REM, light / other (components.html) ----
random.seed(11)
W, H, PL, PR, PT, PB, TOP, BAR = 326, 150, 30, 4, 12, 23, 8 * 60, 12
slot = (W - PL - PR) / 14
Y = lambda m: PT + (1 - m / TOP) * (H - PT - PB)
out = []
for i in range(14):
    total = random.randint(375, 470); deep = random.randint(58, 95); rem = random.randint(80, 118)
    x = PL + i * slot + (slot - BAR) / 2
    seg = lambda a, b, cls, top=False: ('<path class="%s" d="M%.1f %.1fV%.1fa2 2 0 0 1 2-2h%da2 2 0 0 1 2 2V%.1fz"/>' % (cls, x, Y(a), Y(b) + 2, BAR - 4, Y(a)) if top
                                         else '<rect class="%s" x="%.1f" y="%.1f" width="%d" height="%.1f"/>' % (cls, x, Y(b), BAR, Y(a) - Y(b)))
    # a 2 px gap in the surface colour separates the parts
    out.append('<g><title>%dh %02dm asleep, deep %dh %02dm, REM %dh %02dm</title>%s%s%s</g>' % (total // 60, total % 60, deep // 60, deep % 60, rem // 60, rem % 60,
               seg(0, deep - 2.5, 'sl-deep'), seg(deep, deep + rem - 2.5, 'sl-rem'), seg(deep + rem, total, 'sl-other', True)))
if os.path.exists(os.path.join(ROOT, 'components.html')):
    write('components.html', put(read('components.html'), 'SLEEPBARS', '\n'.join('    ' + s for s in out)))

# ---- 4. Icon sheet ---------------------------------------------------------
ids = re.findall(r'<symbol id="(i-[\w-]+)"', read('icons.svg'))
cells = '\n'.join('    <div class="ico"><svg class="ic"><use href="icons.svg#%s"/></svg><span>%s</span></div>' % (i, i[2:]) for i in ids if not i.startswith('i-mark-'))
if os.path.exists(os.path.join(ROOT, 'icons.html')):
    write('icons.html', put(read('icons.html'), 'ICONSHEET', cells))
print('%d icons' % len(ids))

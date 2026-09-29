/* Overload food log: calories, protein, carbs and fat.
 *
 * Loaded after app.js and built on the helpers it exposes (window.__overload.lib).
 * Where foods come from:
 *   - data/foods.json: about 7,700 common foods and about 650 packaged
 *     products (with barcodes) from USDA FoodData Central, built by
 *     tools/build_foods.py. Loaded the first time it is searched or scanned.
 *   - Open Food Facts: packaged foods, by barcode or by a brand search.
 *   - Foods typed in from a label. A barcode typed with it is remembered.
 *
 * Saved data (normalized in app.js):
 *   state.food.targets  { kcal, protein, carbs, fat }   empty means no target
 *   state.food.foods    { id: food }   every food logged, created or starred (fav), so recents work offline
 *   state.food.meals    { id: { id, name, items: [item] } }   saved meals; an item is an entry without id, meal, at
 *   state.diary         { 'YYYY-MM-DD': [entry] }
 * A food holds n (per 100 g, or 100 ml for a drink), serving { label, g, n } from
 * the label, servings [[label, grams]] from USDA, and liquid for drinks (ml, fl oz). An entry keeps its own calories and macros, so
 * editing a food later never changes days already logged.
 */
(function () {
  'use strict';

  const O = window.__overload;
  const { $, esc, uid, num, todayKey, addDays, fmtDate, openSheet, closeSheet, sheetHeader, toast, markDeleted } = O.lib;
  const S = () => O.state;

  const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  const OZ = 28.3495;
  const FLOZ = 29.5735;
  const DB_URL = './data/foods.json?db=4';  // ?db= changes when the list is rebuilt; keep sw.js in step
  const OFF = 'https://world.openfoodfacts.org';
  const OFF_FIELDS = 'code,product_name,product_name_en,generic_name,brands,serving_size,serving_quantity,serving_quantity_unit,nutriments';

  const fu = { day: null, meal: 0, search: '', off: null, offQuery: '', offBusy: false, offError: '', fx: null, from: null };

  // ---------------------------------------------------------------------------
  // Numbers
  // ---------------------------------------------------------------------------
  const r1 = (n) => Math.round(n * 10) / 10;
  const fmtK = (n) => Math.round(n).toLocaleString();
  const fmtG = (n) => (n >= 10 ? String(Math.round(n)) : String(r1(n)));
  const trimNum = (n) => String(Math.round(n * 100) / 100);
  const scale = (n, k) => ({ kcal: n.kcal * k, p: n.p * k, c: n.c * k, f: n.f * k });
  const ZERO = { kcal: 0, p: 0, c: 0, f: 0 };
  function sum(entries) {
    return entries.reduce((t, e) => ({ kcal: t.kcal + e.kcal, p: t.p + e.p, c: t.c + e.c, f: t.f + e.f }), ZERO);
  }

  function dayKey() { return fu.day || todayKey(); }
  function entriesFor(day) { return S().diary[day] || []; }

  // ---------------------------------------------------------------------------
  // Amounts: grams, ounces, the label serving, or a USDA serving
  // ---------------------------------------------------------------------------
  function servingText(sv, liquid) {
    if (!sv) return '';
    const hasWeight = /\d\s*(g|ml|oz)\b/i.test(sv.label);
    return sv.label + (sv.g && !hasWeight ? ' (' + trimNum(sv.g) + (liquid ? ' ml' : ' g') + ')' : '');
  }
  // Drinks go by volume (ml, fl oz); everything else by weight (g, oz).
  function unitOptions(food) {
    const o = [];
    if (food.serving) o.push({ u: 'srv', label: servingText(food.serving, food.liquid), g: food.serving.g || null });
    if (food.n) {
      (food.servings || []).forEach(([label, g], i) => o.push({ u: 's' + i, label: label + ' (' + trimNum(g) + ' g)', g }));
      if (food.liquid) { o.push({ u: 'ml', label: 'ml', g: 1 }); o.push({ u: 'floz', label: 'fl oz', g: FLOZ }); }
      else { o.push({ u: 'g', label: 'g', g: 1 }); o.push({ u: 'oz', label: 'oz', g: OZ }); }
    }
    return o;
  }
  function unitGrams(food, unit) { const o = unitOptions(food).find((x) => x.u === unit); return o ? o.g : null; }
  function nutrition(food, qty, unit) {
    if (!(qty > 0)) return null;
    if (unit === 'srv' && food.serving) {
      if (food.serving.n) return scale(food.serving.n, qty);
      if (food.n && food.serving.g) return scale(food.n, qty * food.serving.g / 100);
      return null;
    }
    const g = unitGrams(food, unit);
    return food.n && g ? scale(food.n, qty * g / 100) : null;
  }
  function amountText(food, qty, unit) {
    const q = trimNum(qty);
    if (unit === 'g' || unit === 'ml' || unit === 'oz') return q + ' ' + unit;
    if (unit === 'floz') return q + ' fl oz';
    const o = unitOptions(food).find((x) => x.u === unit);
    const label = o ? o.label : 'serving';
    return qty === 1 ? label : q + ' × ' + label;
  }
  function defaultAmount(food) {
    const last = food.last;
    if (last && unitOptions(food).some((o) => o.u === last.unit)) return { qty: last.qty, unit: last.unit };
    if (food.serving) return { qty: 1, unit: 'srv' };
    return { qty: 100, unit: food.liquid ? 'ml' : 'g' };
  }
  // Switching units keeps the same weight: 150 g becomes 5.3 oz, not 150 oz.
  function convert(food, qty, from, to) {
    const a = unitGrams(food, from), b = unitGrams(food, to);
    if (!(qty > 0) || !a || !b) return to === 'g' || to === 'ml' ? 100 : 1;
    const grams = qty * a;
    if (to === 'g' || to === 'ml') return Math.round(grams);
    if (to === 'oz' || to === 'floz') return r1(grams / b);
    return Math.round(grams / b * 4) / 4 || 0.25;
  }

  // ---------------------------------------------------------------------------
  // USDA list: loaded on first use, searched with a ranking that puts plain
  // foods ("Egg, whole, hard-boiled") above everything that merely contains the word.
  // ---------------------------------------------------------------------------
  let db = null, dbPromise = null, dbError = '';
  function loadDb() {
    if (db) return Promise.resolve(db);
    if (!dbPromise) {
      dbPromise = fetch(DB_URL).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((d) => { db = prepareDb(d); dbError = ''; return db; })
        .catch((e) => { dbPromise = null; dbError = 'Could not load the food list. Check the connection and try again.'; throw e; });
    }
    return dbPromise;
  }
  const LOW_CATS = new Set(['Restaurant Foods', 'Fast Foods', 'American Indian/Alaska Native Foods', 'Meals, Entrees, and Side Dishes']);
  const PROCESSED = ['oil', 'flour', 'chip', 'candy', 'candie', 'sauce', 'powder', 'dehydrated', 'dried', 'bar', 'mix', 'soup', 'juice', 'babyfood', 'substitute', 'imitation', 'custard', 'nog'];
  const PLAIN = ['raw', 'cooked', 'roasted', 'boiled', 'baked', 'grilled', 'steamed', 'broiled', 'hard-boiled'];
  function stem(w) {
    if (w.length <= 3) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/(oes|xes|ches|shes|sses)$/.test(w)) return w.slice(0, -2);
    if (/[^s]s$/.test(w)) return w.slice(0, -1);
    return w;
  }
  const words = (s) => (String(s).toLowerCase().match(/[a-z0-9%]+/g) || []).map(stem);
  // Barcodes are compared without leading zeros, so GTIN-14, EAN-13 and UPC-A agree.
  const codeKey = (c) => String(c || '').replace(/\D/g, '').replace(/^0+/, '');
  let dbByCode = new Map();
  function prepareDb(d) {
    const cats = d.categories || [];
    const list = d.foods.map((r) => {
      const [fdc, name, kcal, p, c, f, cat, src, servings, staple, usda, barcode, serving, drink] = r;
      const segs = name.split(',').map(words);
      const all = new Set(segs.flat().concat(usda ? words(usda) : []));
      const packaged = src === 'br' || src === 'offx';
      const food = {
        id: typeof fdc === 'string' ? fdc : 'u' + fdc, src: src === 'offx' ? 'off' : 'usda', name, usda: usda || null, brand: '', n: { kcal, p, c, f },
        serving: serving ? { label: serving[0], g: serving[1] || null, n: null } : null, servings: servings || [],
        _cat: cats[cat] || '', _staple: !!staple, _head: segs[0] || [], _segs: segs.length, _all: all, _list: [...all], _brandy: !packaged && /[A-Z]{3,}/.test(name)
      };
      if (barcode) food.barcode = barcode;
      if (drink) food.liquid = true;
      return food;
    });
    dbByCode = new Map(list.filter((x) => x.barcode).map((x) => [codeKey(x.barcode), x]));
    return list;
  }
  function scoreFood(q, x) {
    let s = 0;
    for (const t of q) {
      if (x._all.has(t)) s += 10;
      else if (!x._list.some((w) => w.startsWith(t))) return null;
      if (x._head.includes(t)) s += 8;
    }
    if (x._head[0] === q[0]) s += 6;
    if (x._staple) s += 25;
    if (LOW_CATS.has(x._cat)) s -= 15;
    if (x._brandy) s -= 10;
    if (PROCESSED.some((w) => x._all.has(w) && !q.includes(w))) s -= 12;
    if (PLAIN.some((w) => x._all.has(w))) s += 3;
    return s - x._segs * 1.5 - x.name.length / 40;
  }
  function searchDb(query, limit) {
    const q = words(query); if (!q.length || !db) return [];
    const hits = [];
    for (const x of db) { const s = scoreFood(q, x); if (s != null) hits.push([s, x]); }
    hits.sort((a, b) => b[0] - a[0]);
    return hits.slice(0, limit).map((h) => h[1]);
  }
  function searchMine(query) {
    const q = words(query); if (!q.length) return [];
    return Object.values(S().food.foods).filter((f) => {
      const all = words(f.name + ' ' + (f.brand || '') + ' ' + (f.usda || ''));
      return q.every((t) => all.some((w) => w.startsWith(t)));
    }).sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || (b.used || 0) - (a.used || 0)).slice(0, 8);
  }
  function favorites() { return Object.values(S().food.foods).filter((f) => f.fav).sort((a, b) => a.name.localeCompare(b.name)); }
  function recents() { return Object.values(S().food.foods).filter((f) => f.used && !f.fav).sort((a, b) => b.used - a.used).slice(0, 25); }
  function savedMeals() { return Object.values(S().food.meals).sort((a, b) => (b.used || 0) - (a.used || 0) || a.name.localeCompare(b.name)); }
  function searchMeals(query) {
    const q = words(query); if (!q.length) return [];
    return savedMeals().filter((m) => { const all = words(m.name); return q.every((t) => all.some((w) => w.startsWith(t))); });
  }

  // ---------------------------------------------------------------------------
  // Open Food Facts
  // ---------------------------------------------------------------------------
  function canonCode(raw) { let c = String(raw || '').replace(/\D/g, ''); if (c.length === 12) c = '0' + c; return c; }
  // An 8-digit code starting 0/1 may be a UPC-E (zero-suppressed UPC-A); lists store the long form.
  function upcEtoA(c) {
    if (!/^[01]\d{7}$/.test(c)) return null;
    const x = c.slice(1, 7), last = x[5];
    const body = last <= '2' ? x.slice(0, 2) + last + '0000' + x.slice(2, 5)
      : last === '3' ? x.slice(0, 3) + '00000' + x.slice(3, 5)
      : last === '4' ? x.slice(0, 4) + '00000' + x[4]
      : x.slice(0, 5) + '0000' + last;
    return '0' + c[0] + body + c[7];
  }
  async function offGet(path) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch(OFF + path, { signal: ctl.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Open Food Facts answered ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }
  function fromOff(p, code) {
    if (!p) return null;
    const n = p.nutriments || {};
    const has = (k) => n[k] != null && n[k] !== '' && Number.isFinite(+n[k]);
    const kcal100 = has('energy-kcal_100g') ? +n['energy-kcal_100g'] : has('energy-kj_100g') ? n['energy-kj_100g'] / 4.184 : null;
    const n100 = kcal100 != null ? { kcal: kcal100, p: +n.proteins_100g || 0, c: +n.carbohydrates_100g || 0, f: +n.fat_100g || 0 } : null;
    const g = +p.serving_quantity > 0 ? +p.serving_quantity : null;
    const perServing = has('energy-kcal_serving') ? { kcal: +n['energy-kcal_serving'], p: +n.proteins_serving || 0, c: +n.carbohydrates_serving || 0, f: +n.fat_serving || 0 } : null;
    const label = String(p.serving_size || '').trim() || (g ? trimNum(g) + ' g' : '');
    const serving = label && (g || perServing) ? { label, g, n: n100 && g ? null : perServing } : null;
    if (!n100 && !(serving && serving.n)) return null;
    const name = String(p.product_name || p.product_name_en || p.generic_name || '').trim();
    // Drinks: Open Food Facts gives them per 100 ml, and they are logged in ml / fl oz.
    const liquid = p.serving_quantity_unit === 'ml' || /\d\s*(ml|cl|l)\b|fl\.?\s*oz/i.test(String(p.serving_size || ''));
    const food = { id: 'b' + code, src: 'off', name: name || 'Barcode ' + code, brand: String(p.brands || '').split(',')[0].trim(), barcode: code, n: n100, serving, servings: [] };
    if (liquid) food.liquid = true;
    return food;
  }
  async function offProduct(code) {
    const tries = [code]; if (code.length === 13 && code[0] === '0') tries.push(code.slice(1));
    for (const c of tries) {
      const d = await offGet('/api/v2/product/' + c + '.json?fields=' + OFF_FIELDS);
      if (d && d.product) return { product: d.product, food: fromOff(d.product, code) };
    }
    return null;
  }
  async function offSearch(query) {
    const d = await offGet('/cgi/search.pl?search_terms=' + encodeURIComponent(query) + '&search_simple=1&action=process&json=1&page_size=24&sort_by=unique_scans_n&fields=' + OFF_FIELDS);
    return ((d && d.products) || []).map((p) => fromOff(p, canonCode(p.code))).filter((f) => f && f.barcode);
  }

  // ---------------------------------------------------------------------------
  // Food screen
  // ---------------------------------------------------------------------------
  function bar(v, target, cls) {
    const pct = target > 0 ? Math.min(100, v / target * 100) : 0;
    const over = target > 0 && v > target * 1.05;
    return '<div class="f-bar"><span class="' + (over ? 'over' : cls || '') + '" style="width:' + pct.toFixed(1) + '%"></span></div>';
  }
  function macroCell(label, v, target) {
    return '<div class="f-macro"><div class="k">' + label + '</div><div class="v">' + fmtG(v) + '<span class="muted">' + (target > 0 ? ' / ' + target : '') + ' g</span></div>' + bar(v, target, 'm') + '</div>';
  }
  function render() {
    const st = S(), day = dayKey(), today = todayKey();
    const list = entriesFor(day), tot = sum(list), t = st.food.targets;
    const label = day === today ? 'Today' : day === addDays(today, -1) ? 'Yesterday' : fmtDate(day);
    const nav = '<div class="f-daynav"><button class="icon-btn" data-action="food-day" data-d="-1" aria-label="Previous day">‹</button>'
      + '<button class="f-daylabel" data-action="food-day" data-d="0">' + esc(label) + '</button>'
      + '<button class="icon-btn" data-action="food-day" data-d="1" aria-label="Next day" ' + (day >= today ? 'disabled' : '') + '>›</button></div>';

    let head;
    if (t.kcal > 0) {
      const left = t.kcal - tot.kcal;
      head = '<div class="f-kcal"><div><span class="f-big">' + fmtK(tot.kcal) + '</span><span class="muted"> / ' + fmtK(t.kcal) + ' kcal</span></div>'
        + '<div class="f-left ' + (left < 0 ? 'over' : '') + '">' + (left >= 0 ? fmtK(left) + ' left' : fmtK(-left) + ' over') + '</div></div>' + bar(tot.kcal, t.kcal);
    } else {
      head = '<div class="f-kcal"><div><span class="f-big">' + fmtK(tot.kcal) + '</span><span class="muted"> kcal</span></div>'
        + '<button class="btn small ghost" data-action="food-targets">Set target</button></div>';
    }
    const summary = '<div class="card f-sum">' + head + '<div class="f-macros">' + macroCell('Protein', tot.p, t.protein) + macroCell('Carbs', tot.c, t.carbs) + macroCell('Fat', tot.f, t.fat) + '</div></div>';

    const meals = MEALS.map((m, mi) => {
      const items = list.filter((e) => e.meal === mi);
      const kcal = sum(items).kcal;
      const rows = items.map((e) => '<button class="f-row" data-action="food-edit" data-id="' + esc(e.id) + '"><div class="grow"><div class="title">' + esc(e.name) + '</div><div class="sub">'
        + esc([e.amt, e.brand].filter(Boolean).join(' · ')) + '</div></div><div class="f-rk">' + fmtK(e.kcal) + '</div></button>').join('');
      return '<div class="card f-meal" data-meal="' + mi + '"><div class="f-meal-head"><h2>' + m + '</h2><div class="row"><span class="muted small">' + (items.length ? fmtK(kcal) + ' kcal' : '') + '</span>'
        + '<button class="icon-btn f-more" data-action="food-meal-menu" data-meal="' + mi + '" aria-label="' + m + ' options">⋯</button></div></div>'
        + rows + '<button class="btn subtle small block mt8" data-action="food-add" data-meal="' + mi + '">+ Add food</button></div>';
    }).join('');
    // An empty day offers the day before in one tap.
    let copy = '';
    if (!list.length) {
      const prev = entriesFor(addDays(day, -1));
      if (prev.length) copy = '<button class="btn ghost block f-copyday" data-action="food-copy-day">Copy ' + (day === today ? 'yesterday' : esc(fmtDate(addDays(day, -1)))) + ' · ' + countText(prev) + '</button>';
    }
    const tip = list.length ? '<p class="tiny muted center mt8">Hold a food, then drag it to another meal.</p>' : '';
    return '<div class="screen-title"><h1>Food</h1></div>' + nav + summary + copy + meals + tip;
  }

  // ---------------------------------------------------------------------------
  // Drag a logged food to another meal, or to another spot in the same meal.
  // Touch: hold still for a moment, then drag (a quick swipe still scrolls).
  // Mouse: just drag. A plain tap still opens the food.
  // ---------------------------------------------------------------------------
  const HOLD_MS = 300, SLOP = 8, EDGE = 80;
  const dnd = { press: null, drag: null, suppressClick: false, scrollTimer: null };

  // Moves an entry and gives it an `at` between its new neighbours: cloud sync orders a day by `at`.
  function moveEntry(day, id, meal, beforeId) {
    const list = (S().diary[day] || []).slice();
    const i = list.findIndex((e) => e.id === id); if (i < 0) return false;
    const e = Object.assign({}, list[i]);
    const was = list.map((x) => x.id).join() + '|' + list[i].meal;
    list.splice(i, 1);
    e.meal = meal;
    let j = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
    if (j < 0) { const last = list.map((x) => x.meal).lastIndexOf(meal); j = last >= 0 ? last + 1 : list.length; }
    list.splice(j, 0, e);
    if (list.map((x) => x.id).join() + '|' + meal === was) return false;
    const prev = list[j - 1], next = list[j + 1];
    const pa = prev && prev.at, na = next && next.at;
    e.at = pa != null && na != null ? (pa + na) / 2 : pa != null ? pa + 1 : na != null ? na - 1 : Date.now();
    S().diary[day] = list;
    return true;
  }

  function dndStart(p) {
    // A render during the hold replaces the row: use the one on screen now.
    const row = document.querySelector('.f-meal .f-row[data-id="' + CSS.escape(p.row.dataset.id) + '"]');
    if (!row || O.screen !== 'food' || $('#sheet') && !$('#sheet').hidden) return;
    const r = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('f-ghost'); ghost.removeAttribute('data-action');
    Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' });
    document.body.appendChild(ghost);
    row.classList.add('f-lifted');
    const line = document.createElement('div'); line.className = 'f-drop-line';
    dnd.drag = { id: row.dataset.id, pointer: p.id, day: dayKey(), row, ghost, line, dy: p.y - r.top, x: p.x, y: p.y, meal: null, before: null, card: null };
    document.body.classList.add('f-dragging');
    if (navigator.vibrate) navigator.vibrate(10);
    dndMove(p.x, p.y);
    dnd.scrollTimer = setInterval(() => {
      const d = dnd.drag; if (!d) return;
      const bottom = window.innerHeight - EDGE - 60;  // the tab bar covers the bottom
      const v = d.y < EDGE ? -Math.ceil((EDGE - d.y) / 6) : d.y > bottom ? Math.ceil((d.y - bottom) / 6) : 0;
      if (v) { window.scrollBy(0, v); dndMove(d.x, d.y); }
    }, 16);
  }
  function dndMove(x, y) {
    const d = dnd.drag; d.x = x; d.y = y;
    d.ghost.style.top = (y - d.dy) + 'px';
    const under = document.elementFromPoint(x, y);
    const card = under && under.closest('.f-meal');
    if (d.card && d.card !== card) d.card.classList.remove('f-drop-target');
    d.card = card;
    if (!card) { d.line.remove(); d.meal = null; return; }
    card.classList.add('f-drop-target');
    const rows = [...card.querySelectorAll('.f-row[data-id]')].filter((r) => r.dataset.id !== d.id);
    const before = rows.find((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; }) || null;
    const anchor = before || card.querySelector('[data-action="food-add"]');
    if (d.line.nextSibling !== anchor) card.insertBefore(d.line, anchor);
    d.meal = +card.dataset.meal; d.before = before ? before.dataset.id : null;
  }
  function dndEnd(drop) {
    const d = dnd.drag; if (!d) return;
    clearInterval(dnd.scrollTimer);
    d.ghost.remove(); d.line.remove(); d.row.classList.remove('f-lifted');
    document.querySelectorAll('.f-row.f-lifted').forEach((r) => r.classList.remove('f-lifted'));
    if (d.card) d.card.classList.remove('f-drop-target');
    document.body.classList.remove('f-dragging');
    dnd.drag = null;
    dnd.suppressClick = true; setTimeout(() => { dnd.suppressClick = false; }, 400);
    if (!drop || d.meal == null) return;
    const from = (entriesFor(d.day).find((e) => e.id === d.id) || {}).meal;
    if (!moveEntry(d.day, d.id, d.meal, d.before)) return;
    O.save(); O.render();
    if (from !== d.meal) toast('Moved to ' + MEALS[d.meal]);
  }
  function dndCancelPress() { if (dnd.press) { clearTimeout(dnd.press.timer); dnd.press = null; } }

  document.addEventListener('pointerdown', (e) => {
    if (O.screen !== 'food' || dnd.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const row = e.target.closest && e.target.closest('.f-meal .f-row[data-id]'); if (!row) return;
    dndCancelPress();
    const p = { row, x: e.clientX, y: e.clientY, id: e.pointerId, mouse: e.pointerType === 'mouse', timer: null };
    if (!p.mouse) p.timer = setTimeout(() => { if (dnd.press === p) { dnd.press = null; dndStart(p); } }, HOLD_MS);
    dnd.press = p;
  });
  document.addEventListener('pointermove', (e) => {
    if (dnd.drag) { if (e.pointerId === dnd.drag.pointer) { e.preventDefault(); dndMove(e.clientX, e.clientY); } return; }
    const p = dnd.press; if (!p || p.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP;
    if (!moved) return;
    if (p.mouse) { dnd.press = null; dndStart(Object.assign(p, { x: e.clientX, y: e.clientY })); }
    else dndCancelPress();  // moved before the hold: that is a scroll
  }, { passive: false });
  // Only the finger that started the drag moves or drops it; a second finger is ignored.
  document.addEventListener('pointerup', (e) => { if (dnd.press && dnd.press.id === e.pointerId) dndCancelPress(); if (dnd.drag && e.pointerId === dnd.drag.pointer) dndEnd(true); });
  document.addEventListener('pointercancel', (e) => { if (dnd.press && dnd.press.id === e.pointerId) dndCancelPress(); if (dnd.drag && e.pointerId === dnd.drag.pointer) dndEnd(false); });
  // While dragging, the page must not scroll under the finger (iOS needs a non-passive touchmove).
  document.addEventListener('touchmove', (e) => { if (dnd.drag) e.preventDefault(); }, { passive: false });
  // The click that ends a drag (wherever the finger was lifted) must not open a food or switch tabs;
  // only that one click is swallowed. A long press must not open a menu.
  document.addEventListener('click', (e) => { if (dnd.suppressClick) { dnd.suppressClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.f-meal .f-row[data-id]')) e.preventDefault(); });

  // ---------------------------------------------------------------------------
  // Add food: search, recents, scan, quick add, new food
  // ---------------------------------------------------------------------------
  function sheetAdd(meal) {
    if (meal != null) fu.meal = meal;
    fu.from = 'add';
    openSheet(sheetHeader('Add to ' + MEALS[fu.meal])
      + '<div class="f-searchrow"><input class="input" type="search" data-field="food-search" placeholder="Search foods" autocomplete="off" autocorrect="off" enterkeyhint="search" value="' + esc(fu.search) + '">'
      + '<button class="icon-btn f-scanbtn" data-action="food-scan" aria-label="Scan a barcode">▥</button></div>'
      + '<div class="btn-row mt8"><button class="btn ghost small" data-action="food-scan">Scan barcode</button><button class="btn ghost small" data-action="food-quick">Quick add</button><button class="btn ghost small" data-action="food-new">New food</button></div>'
      + '<div id="food-results" class="mt12"></div>');
    renderResults();
    if (!fu.search) loadDb().then(() => { if ($('#food-results') && fu.search) renderResults(); }).catch(() => {});
  }
  function resultRow(f, src) {
    // Packaged foods read best per label serving; plain foods per 100 g.
    const sv = f.serving && (f.serving.n || (f.n && f.serving.g ? scale(f.n, f.serving.g / 100) : null));
    const n = sv || f.n;
    const per = sv ? fmtK(sv.kcal) + ' kcal / ' + esc(servingText(f.serving, f.liquid)) : f.n ? fmtK(f.n.kcal) + ' kcal / 100 ' + (f.liquid ? 'ml' : 'g') : '';
    const macro = n ? ' · P ' + fmtG(n.p) + ' C ' + fmtG(n.c) + ' F ' + fmtG(n.f) : '';
    const sub = [f.brand && esc(f.brand), per + macro].filter(Boolean).join(' · ');
    return '<button class="f-row" data-action="food-pick" data-src="' + src + '" data-id="' + esc(f.id) + '"><div class="grow"><div class="title">' + (f.fav ? '<span class="f-favmark">★</span> ' : '') + esc(f.name) + '</div><div class="sub">' + sub + '</div></div><span class="chev">›</span></button>';
  }
  function mealRow(m) {
    return '<button class="f-row" data-action="food-sm-open" data-id="' + esc(m.id) + '"><div class="grow"><div class="title">' + esc(m.name) + '</div><div class="sub">' + countText(m.items) + '</div></div><span class="chev">›</span></button>';
  }
  function countText(items) { return items.length + (items.length === 1 ? ' food' : ' foods') + ' · ' + fmtK(sum(items).kcal) + ' kcal'; }
  function renderResults() {
    const box = $('#food-results'); if (!box) return;
    const q = fu.search.trim();
    let html = '';
    if (!q) {
      const meals = savedMeals(), fav = favorites(), rec = recents();
      const sections = [];
      if (meals.length) sections.push('<div class="group-title">Saved meals</div>' + meals.map(mealRow).join(''));
      if (fav.length) sections.push('<div class="group-title">Favorites</div>' + fav.map((f) => resultRow(f, 'mine')).join(''));
      if (rec.length) sections.push('<div class="group-title">Recent</div>' + rec.map((f) => resultRow(f, 'mine')).join(''));
      html = sections.length ? sections.join('').replace('group-title', 'group-title first')
        : '<p class="small muted center mt16">Search the food list, scan a barcode, or type a food in from its label.<br>Foods you log show up here next time. Tap ☆ on a food to keep it at the top.</p>';
    } else {
      const meals = searchMeals(q), mine = searchMine(q);
      if (meals.length) html += '<div class="group-title first">Saved meals</div>' + meals.map(mealRow).join('');
      if (mine.length) html += '<div class="group-title' + (html ? '' : ' first') + '">Your foods</div>' + mine.map((f) => resultRow(f, 'mine')).join('');
      html += '<div class="group-title' + (html ? '' : ' first') + '">Common foods</div>';
      if (db) {
        const shown = new Set(mine.map((f) => f.id));
        const hits = searchDb(q, 30).filter((f) => !shown.has(f.id));
        html += hits.length ? hits.map((f) => resultRow(f, 'usda')).join('') : '<p class="small muted">No common food matches. Try fewer words, or search brands below.</p>';
      } else if (dbError) {
        html += '<p class="small muted">' + esc(dbError) + '</p><button class="btn ghost small mt8" data-action="food-db-retry">Try again</button>';
      } else {
        html += '<p class="small muted">Loading the food list…</p>';
        loadDb().then(() => renderResults(), () => renderResults());
      }
      html += '<div class="group-title">Brands and packaged foods</div>';
      if (fu.offBusy) html += '<p class="small muted">Searching Open Food Facts…</p>';
      else if (fu.off && fu.offQuery === q) {
        html += fu.off.length ? fu.off.map((f) => resultRow(f, 'off')).join('') : '<p class="small muted">Nothing found. Scanning the barcode works better for packaged foods.</p>';
      } else {
        if (fu.offError) html += '<p class="small muted">' + esc(fu.offError) + '</p>';
        html += '<button class="btn ghost block" data-action="food-online">Search brands for “' + esc(q) + '”</button>';
      }
    }
    box.innerHTML = html;
  }
  async function searchOnline() {
    const q = fu.search.trim(); if (!q) return;
    fu.offBusy = true; fu.offError = ''; renderResults();
    try { fu.off = await offSearch(q); fu.offQuery = q; }
    catch (e) { fu.off = null; fu.offError = navigator.onLine === false ? 'You are offline. Brand search needs a connection.' : 'Brand search did not answer. Try again, or scan the barcode.'; }
    fu.offBusy = false;
    if (fu.search.trim() === q) renderResults();
  }

  // ---------------------------------------------------------------------------
  // Amount sheet: how much, which meal. Used to add and to edit.
  // ---------------------------------------------------------------------------
  function sheetAmount(food, opts) {
    opts = opts || {};
    const amt = opts.qty != null ? { qty: opts.qty, unit: opts.unit } : defaultAmount(food);
    fu.fx = { food, meal: opts.meal != null ? opts.meal : fu.meal, qty: amt.qty, unit: amt.unit, entryId: opts.entryId || null, day: opts.day || dayKey() };
    const units = unitOptions(food).map((o) => '<option value="' + o.u + '" ' + (o.u === amt.unit ? 'selected' : '') + '>' + esc(o.label) + '</option>').join('');
    const back = fu.from === 'add' && !opts.entryId ? '<button class="btn subtle small" data-action="food-back">‹ Back</button>' : '';
    const fixable = food.src === 'custom' ? 'Edit food' : food.src === 'off' || food.barcode ? 'Numbers wrong? Fix them' : '';
    const stored = S().food.foods[food.id];
    const star = food.src === 'entry' ? '' : '<button class="icon-btn f-star' + (stored && stored.fav ? ' on' : '') + '" data-action="food-fav" aria-label="Favorite" aria-pressed="' + !!(stored && stored.fav) + '">' + (stored && stored.fav ? '★' : '☆') + '</button>';
    openSheet(sheetHeader(opts.entryId ? 'Edit' : 'Add food', back + star)
      + '<div class="f-food-name">' + esc(food.name) + '</div>'
      + '<div class="small muted mb8">' + esc([food.brand, food.src === 'usda' ? 'USDA' : food.src === 'off' ? 'Open Food Facts' : food.src === 'custom' ? 'Your food' : ''].filter(Boolean).join(' · ')) + '</div>'
      + '<div class="f-amount"><input class="input" type="number" inputmode="decimal" step="any" min="0" data-field="food-qty" value="' + trimNum(amt.qty) + '" aria-label="Amount">'
      + '<select class="select" data-field="food-unit" aria-label="Unit">' + units + '</select></div>'
      + '<div id="food-preview" class="f-preview mt12"></div>'
      + '<div class="field mt12"><label>Meal</label><div class="seg f-mealseg">' + MEALS.map((m, i) => '<button class="' + (i === fu.fx.meal ? 'on' : '') + '" data-action="food-meal" data-i="' + i + '">' + m + '</button>').join('') + '</div></div>'
      + '<button class="btn block mt12" data-action="food-save">' + (opts.entryId ? 'Save' : 'Add to ' + MEALS[fu.fx.meal]) + '</button>'
      + (opts.entryId ? '<button class="btn danger block mt8" data-action="food-delete">Remove from ' + MEALS[fu.fx.meal] + '</button>' : '')
      + (fixable ? '<button class="btn subtle block mt8" data-action="food-fix">' + fixable + '</button>' : ''));
    renderPreview();
  }
  function renderPreview() {
    const box = $('#food-preview'); const x = fu.fx; if (!box || !x) return;
    const n = nutrition(x.food, x.qty, x.unit);
    const cell = (v, k) => '<div class="stat"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
    box.innerHTML = n ? '<div class="stat-row">' + cell(fmtK(n.kcal), 'kcal') + cell(fmtG(n.p), 'Protein g') + cell(fmtG(n.c), 'Carbs g') + cell(fmtG(n.f), 'Fat g') + '</div>'
      : '<p class="small muted center">Enter an amount.</p>';
    const btn = $('[data-action="food-save"]'); if (btn) btn.disabled = !n;
  }
  function saveEntry() {
    const x = fu.fx; if (!x) return;
    const n = nutrition(x.food, x.qty, x.unit); if (!n) { toast('Enter an amount'); return; }
    const st = S(), day = x.day || dayKey();  // the day it was opened for, even if midnight passed
    let stored = null;
    if (x.food.src !== 'entry') {
      // Keep the food itself so it shows in Recent and works offline next time.
      stored = st.food.foods[x.food.id] || (st.food.foods[x.food.id] = storable(x.food));
      stored.used = Date.now();
      stored.last = { qty: x.qty, unit: x.unit };
    }
    const entry = {
      id: x.entryId || uid(), food: stored ? stored.id : (x.food.ref || null), meal: x.meal, qty: x.qty, unit: x.unit,
      amt: amountText(x.food, x.qty, x.unit), name: x.food.name, brand: x.food.brand || '',
      kcal: Math.round(n.kcal), p: r1(n.p), c: r1(n.c), f: r1(n.f), at: Date.now()
    };
    const list = (st.diary[day] || []).slice();
    const i = list.findIndex((e) => e.id === entry.id);
    if (i >= 0) { entry.at = list[i].at || entry.at; list[i] = entry; } else list.push(entry);
    st.diary[day] = list;
    O.save(); closeSheet(); O.render();
    toast(i >= 0 ? 'Saved' : 'Added to ' + MEALS[x.meal]);
    fu.fx = null;
  }
  function storable(food) {
    const f = { id: food.id, src: food.src, name: food.name, brand: food.brand || '', n: food.n || null, serving: food.serving || null, servings: (food.servings || []).slice(0, 8) };
    if (food.usda) f.usda = food.usda;
    if (food.barcode) f.barcode = food.barcode;
    if (food.liquid) f.liquid = true;
    return f;
  }
  function deleteEntry() {
    const x = fu.fx; if (!x || !x.entryId) return;
    const st = S(), day = x.day || dayKey();
    const list = (st.diary[day] || []).filter((e) => e.id !== x.entryId);
    if (list.length) st.diary[day] = list; else delete st.diary[day];
    markDeleted('food', x.entryId);
    O.save(); closeSheet(); O.render(); toast('Removed');
    fu.fx = null;
  }
  function editEntry(id) {
    const e = entriesFor(dayKey()).find((x) => x.id === id); if (!e) return;
    fu.from = null;
    if (!e.food && e.qty == null) { sheetQuick(e); return; }
    let food = e.food && S().food.foods[e.food];
    if (!food || !unitOptions(food).some((o) => o.u === e.unit)) {
      // The food was deleted or changed shape: edit the logged amount as one serving.
      food = { id: e.id, src: 'entry', ref: e.food, name: e.name, brand: e.brand, n: null, serving: { label: e.amt || '1 serving', g: null, n: { kcal: e.kcal, p: e.p, c: e.c, f: e.f } }, servings: [] };
      sheetAmount(food, { meal: e.meal, entryId: e.id, qty: 1, unit: 'srv' });
      return;
    }
    sheetAmount(food, { meal: e.meal, entryId: e.id, qty: e.qty, unit: e.unit });
  }

  // ---------------------------------------------------------------------------
  // Favorites, saved meals, copying
  // ---------------------------------------------------------------------------
  function toggleFav() {
    const x = fu.fx; if (!x || x.food.src === 'entry') return;
    const st = S();
    const f = st.food.foods[x.food.id] || (st.food.foods[x.food.id] = storable(x.food));
    f.fav = !f.fav; if (!f.fav) delete f.fav;
    O.save();
    const b = $('[data-action="food-fav"]');
    if (b) { b.textContent = f.fav ? '★' : '☆'; b.classList.toggle('on', !!f.fav); b.setAttribute('aria-pressed', String(!!f.fav)); }
    toast(f.fav ? 'Added to favorites' : 'Removed from favorites');
  }
  // Copies are new entries with the same food, amount and numbers.
  function addCopies(day, items, meal) {
    const st = S(), now = Date.now();
    const copies = items.map((e, i) => ({ id: uid(), food: e.food || null, meal: meal != null ? meal : e.meal, qty: e.qty, unit: e.unit, amt: e.amt || '', name: e.name, brand: e.brand || '',
      kcal: e.kcal, p: e.p, c: e.c, f: e.f, at: now + i }));
    if (!copies.length) return 0;
    st.diary[day] = (st.diary[day] || []).concat(copies);
    copies.forEach((e) => { const f = e.food && st.food.foods[e.food]; if (f) f.used = now; });
    O.save();
    return copies.length;
  }
  function copyText(n, where) { return 'Copied ' + n + (n === 1 ? ' food' : ' foods') + (where ? ' to ' + where : ''); }

  function sheetMealMenu(mi) {
    const day = dayKey(), today = todayKey(), prevDay = addDays(day, -1);
    const items = entriesFor(day).filter((e) => e.meal === mi);
    const prev = entriesFor(prevDay).filter((e) => e.meal === mi);
    const prevName = day === today ? 'yesterday’s' : esc(fmtDate(prevDay)) + '’s';
    const btn = (action, label, sub, cls) => '<button class="f-row" data-action="' + action + '" data-meal="' + mi + '"><div class="grow"><div class="title' + (cls ? ' ' + cls : '') + '">' + label + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div></button>';
    let html = '';
    if (prev.length) html += btn('food-copy-meal', 'Copy ' + prevName + ' ' + MEALS[mi], countText(prev));
    if (items.length) html += btn('food-save-meal', 'Save as a meal', 'Log these ' + items.length + ' again in one tap');
    if (items.length && day !== today) html += btn('food-copy-today', 'Copy to today', countText(items));
    if (items.length) html += btn('food-clear-meal', 'Clear ' + MEALS[mi], '', 'f-danger');
    openSheet(sheetHeader(MEALS[mi]) + (html ? '<div class="f-menu">' + html + '</div>' : '<p class="small muted center mt16 mb8">Nothing to copy, save or clear here yet.</p>'));
  }
  function saveMealAs(mi) {
    const items = entriesFor(dayKey()).filter((e) => e.meal === mi); if (!items.length) return;
    const name = prompt('Name this meal', MEALS[mi]);
    if (name == null) return;
    const id = uid();
    S().food.meals[id] = { id, name: name.trim() || MEALS[mi], items: items.map(({ food, qty, unit, amt, name, brand, kcal, p, c, f }) => ({ food, qty, unit, amt, name, brand, kcal, p, c, f })) };
    O.save(); closeSheet(); toast('Saved "' + (name.trim() || MEALS[mi]) + '"');
  }
  function sheetSavedMeal(id, meal) {
    const m = S().food.meals[id]; if (!m) return;
    fu.sm = { id, meal: meal != null ? meal : (fu.sm && fu.sm.id === id ? fu.sm.meal : fu.meal) };
    const t = sum(m.items);
    const cell = (v, k) => '<div class="stat"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
    const rows = m.items.map((e, i) => '<div class="f-row f-static"><div class="grow"><div class="title">' + esc(e.name) + '</div><div class="sub">' + esc([e.amt, e.brand].filter(Boolean).join(' · ')) + '</div></div>'
      + '<div class="f-rk">' + fmtK(e.kcal) + '</div><button class="icon-btn f-x" data-action="food-sm-remove" data-i="' + i + '" aria-label="Remove ' + esc(e.name) + '">✕</button></div>').join('');
    openSheet(sheetHeader(esc(m.name), fu.from === 'add' ? '<button class="btn subtle small" data-action="food-back">‹ Back</button>' : '')
      + '<div class="stat-row f-preview">' + cell(fmtK(t.kcal), 'kcal') + cell(fmtG(t.p), 'Protein g') + cell(fmtG(t.c), 'Carbs g') + cell(fmtG(t.f), 'Fat g') + '</div>'
      + '<div class="mt8">' + rows + '</div>'
      + '<div class="field mt12"><label>Meal</label><div class="seg f-mealseg">' + MEALS.map((x, i) => '<button class="' + (i === fu.sm.meal ? 'on' : '') + '" data-action="food-sm-meal" data-i="' + i + '">' + x + '</button>').join('') + '</div></div>'
      + '<button class="btn block mt12" data-action="food-sm-log">Add ' + countText(m.items).split(' · ')[0] + ' to ' + MEALS[fu.sm.meal] + '</button>'
      + '<div class="btn-row mt8"><button class="btn subtle small" data-action="food-sm-rename">Rename</button><button class="btn danger small" data-action="food-sm-delete">Delete meal</button></div>');
  }
  function logSavedMeal() {
    const m = fu.sm && S().food.meals[fu.sm.id]; if (!m) return;
    const n = addCopies(dayKey(), m.items, fu.sm.meal);
    m.used = Date.now(); O.save();
    closeSheet(); O.render(); toast(copyText(n, MEALS[fu.sm.meal]));
  }

  // ---------------------------------------------------------------------------
  // Quick add and foods typed in from a label
  // ---------------------------------------------------------------------------
  function sheetQuick(entry) {
    const v = (k) => (entry && entry[k] ? esc(entry[k]) : '');
    fu.fx = entry ? { entryId: entry.id, meal: entry.meal, day: dayKey() } : { meal: fu.meal, day: dayKey() };
    openSheet(sheetHeader(entry ? 'Edit quick add' : 'Quick add')
      + '<form id="food-quick-form"><div class="field"><label>Name (optional)</label><input class="input" name="name" value="' + (entry && entry.name !== 'Quick add' ? esc(entry.name) : '') + '" placeholder="Quick add"></div>'
      + '<div class="field"><label>Calories</label><input class="input" name="kcal" type="number" inputmode="decimal" step="any" min="0" required value="' + v('kcal') + '"></div>'
      + '<div class="field-row"><div class="field"><label>Protein g</label><input class="input" name="p" type="number" inputmode="decimal" step="any" min="0" value="' + v('p') + '"></div>'
      + '<div class="field"><label>Carbs g</label><input class="input" name="c" type="number" inputmode="decimal" step="any" min="0" value="' + v('c') + '"></div>'
      + '<div class="field"><label>Fat g</label><input class="input" name="f" type="number" inputmode="decimal" step="any" min="0" value="' + v('f') + '"></div></div>'
      + '<div class="field"><label>Meal</label><div class="seg f-mealseg">' + MEALS.map((m, i) => '<button type="button" class="' + (i === fu.fx.meal ? 'on' : '') + '" data-action="food-meal" data-i="' + i + '">' + m + '</button>').join('') + '</div></div>'
      + '<button class="btn block" type="submit">' + (entry ? 'Save' : 'Add') + '</button>'
      + (entry ? '<button class="btn danger block mt8" type="button" data-action="food-delete">Remove</button>' : '') + '</form>');
  }
  function submitQuick(form) {
    const fd = new FormData(form); const st = S();
    const kcal = num(fd.get('kcal'), NaN); if (!(kcal >= 0)) { toast('Enter calories'); return; }
    const x = fu.fx || { meal: fu.meal };
    const day = x.day || dayKey();
    const entry = { id: x.entryId || uid(), food: null, meal: x.meal, qty: null, unit: null, amt: '', name: String(fd.get('name') || '').trim() || 'Quick add', brand: '',
      kcal: Math.round(kcal), p: r1(Math.max(0, num(fd.get('p'), 0))), c: r1(Math.max(0, num(fd.get('c'), 0))), f: r1(Math.max(0, num(fd.get('f'), 0))), at: Date.now() };
    const list = (st.diary[day] || []).slice();
    const i = list.findIndex((e) => e.id === entry.id);
    if (i >= 0) { entry.at = list[i].at || entry.at; list[i] = entry; } else list.push(entry);
    st.diary[day] = list;
    O.save(); closeSheet(); O.render(); toast(i >= 0 ? 'Saved' : 'Added to ' + MEALS[x.meal]);
    fu.fx = null;
  }

  // The label gives numbers per serving; with the serving's weight they also work in grams and ounces.
  function sheetFoodForm(food, opts) {
    opts = opts || {};
    const f = food || {};
    const sv = f.serving || (f.n ? { label: '100 g', g: 100, n: null } : null);
    const per = sv ? (sv.n || (f.n && sv.g ? scale(f.n, sv.g / 100) : null)) : null;
    const v = (x) => (x == null || x === '' ? '' : esc(typeof x === 'number' ? trimNum(x) : x));
    const r2 = (x) => Math.round(x * 100) / 100;  // 0.1 would shift the per-100 g numbers on a small serving
    fu.form = { id: food && food.src === 'custom' ? food.id : null, orig: food && food.id, day: opts.day, meal: opts.meal != null ? opts.meal : fu.meal, entryId: opts.entryId || null, qty: opts.qty, unit: opts.unit, liquid: !!(food && food.liquid) };
    openSheet(sheetHeader(food && food.src === 'custom' ? 'Edit food' : 'New food')
      + (opts.msg ? '<div class="banner">' + esc(opts.msg) + '</div>' : '')
      + '<form id="food-form"><div class="field"><label>Name</label><input class="input" name="name" required value="' + v(f.name) + '" placeholder="e.g. Protein bar, chocolate"></div>'
      + '<div class="field-row"><div class="field"><label>Brand (optional)</label><input class="input" name="brand" value="' + v(f.brand) + '"></div>'
      + '<div class="field"><label>Barcode (optional)</label><input class="input" name="barcode" inputmode="numeric" value="' + v(opts.barcode || f.barcode) + '"></div></div>'
      + '<div class="group-title first">Nutrition label</div>'
      + '<div class="field-row"><div class="field"><label>Serving size</label><input class="input" name="slabel" value="' + v(sv ? sv.label : '1 serving') + '" placeholder="1 bar"></div>'
      + '<div class="field"><label>Serving ' + (f.liquid ? 'ml' : 'weight g') + '</label><input class="input" name="sg" type="number" inputmode="decimal" step="any" min="0" value="' + v(sv && sv.g) + '" placeholder="optional"></div></div>'
      + '<p class="tiny muted mb8">With the weight, you can also log this in grams or ounces.</p>'
      + '<div class="field"><label>Calories per serving</label><input class="input" name="kcal" type="number" inputmode="decimal" step="any" min="0" required value="' + v(per && r2(per.kcal)) + '"></div>'
      + '<div class="field-row"><div class="field"><label>Protein g</label><input class="input" name="p" type="number" inputmode="decimal" step="any" min="0" value="' + v(per && r2(per.p)) + '"></div>'
      + '<div class="field"><label>Carbs g</label><input class="input" name="c" type="number" inputmode="decimal" step="any" min="0" value="' + v(per && r2(per.c)) + '"></div>'
      + '<div class="field"><label>Fat g</label><input class="input" name="f" type="number" inputmode="decimal" step="any" min="0" value="' + v(per && r2(per.f)) + '"></div></div>'
      + '<button class="btn block" type="submit">Save food</button>'
      + (food && food.src === 'custom' ? '<button class="btn danger block mt8" type="button" data-action="food-forget">Delete this food</button>' : '')
      + '</form>');
  }
  function submitFoodForm(form) {
    const fd = new FormData(form); const st = S();
    const name = String(fd.get('name') || '').trim(); const kcal = num(fd.get('kcal'), NaN);
    if (!name || !(kcal >= 0)) { toast('Enter a name and calories'); return; }
    const code = canonCode(fd.get('barcode'));
    const g = num(fd.get('sg'), 0) > 0 ? num(fd.get('sg'), 0) : null;
    const perServing = { kcal, p: Math.max(0, num(fd.get('p'), 0)), c: Math.max(0, num(fd.get('c'), 0)), f: Math.max(0, num(fd.get('f'), 0)) };
    const old = fu.form && fu.form.id ? st.food.foods[fu.form.id] : null;
    const id = code.length >= 8 ? 'b' + code : (old && old.id[0] === 'c' ? old.id : 'c' + uid());
    const prev = st.food.foods[id] || old || (fu.form && fu.form.orig ? st.food.foods[fu.form.orig] : null);
    const food = {
      id, src: 'custom', name, brand: String(fd.get('brand') || '').trim(), barcode: code.length >= 8 ? code : undefined,
      n: g ? scale(perServing, 100 / g) : null,
      serving: { label: String(fd.get('slabel') || '').trim() || '1 serving', g, n: g ? null : perServing },
      servings: [], used: prev ? prev.used : undefined, last: prev && prev.id === id ? prev.last : undefined, fav: prev && prev.fav ? true : undefined,
      liquid: fu.form && fu.form.liquid ? true : undefined
    };
    Object.keys(food).forEach((k) => food[k] === undefined && delete food[k]);
    if (old && old.id !== id) delete st.food.foods[old.id];
    st.food.foods[id] = food;
    O.save();
    const ctx = fu.form || { meal: fu.meal };
    fu.form = null;
    toast('Food saved');
    // Back to the amount: same entry and amount when editing one, else 1 serving.
    const keep = ctx.entryId && ctx.qty > 0 && unitOptions(food).some((o) => o.u === ctx.unit);
    sheetAmount(food, { meal: ctx.meal, entryId: ctx.entryId, day: ctx.day, qty: keep ? ctx.qty : 1, unit: keep ? ctx.unit : 'srv' });
  }
  function forgetFood() {
    const f = fu.form && fu.form.id && S().food.foods[fu.form.id]; if (!f) return;
    if (!confirm('Delete "' + f.name + '"? Days already logged keep their numbers.')) return;
    delete S().food.foods[f.id]; fu.form = null;
    O.save(); closeSheet(); O.render(); toast('Food deleted');
  }

  // ---------------------------------------------------------------------------
  // Barcode scanning (zxing-wasm, self-hosted in vendor/zxing)
  // ---------------------------------------------------------------------------
  const scan = { stream: null, on: false, engine: null };
  async function scanEngine() {
    if (scan.engine) return scan.engine;
    if ('BarcodeDetector' in window) {
      try {
        const ok = await window.BarcodeDetector.getSupportedFormats();
        const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => ok.includes(f));
        if (want.length) { const det = new window.BarcodeDetector({ formats: want }); scan.engine = { native: true, read: async (src) => (await det.detect(src)).map((r) => r.rawValue) }; return scan.engine; }
      } catch (e) { /* use zxing */ }
    }
    const zx = await import('./vendor/zxing/reader/index.js');
    await zx.prepareZXingModule({ overrides: { locateFile: (p, prefix) => (p.endsWith('.wasm') ? new URL('./vendor/zxing/' + p, location.href).href : prefix + p) }, fireImmediately: true });
    const opts = { formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'], tryHarder: true, maxNumberOfSymbols: 1 };
    scan.engine = { native: false, read: async (img) => (await zx.readBarcodes(img, opts)).filter((r) => r.isValid !== false).map((r) => r.text) };
    return scan.engine;
  }
  const scanCanvas = document.createElement('canvas');
  const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
  function frameSource(eng) { return eng.native ? scanCanvas : scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height); }
  function scanStatus(t) { const el = $('#scan-status'); if (el) el.textContent = t; }

  function sheetScan() {
    openSheet(sheetHeader('Scan barcode', fu.from === 'add' ? '<button class="btn subtle small" data-action="food-back">‹ Back</button>' : '')
      + '<div class="f-scanview"><video id="scan-video" playsinline muted></video><div class="guide"></div></div>'
      + '<p id="scan-status" class="small muted center mt8">Starting camera…</p>'
      + '<div class="btn-row mt8"><label class="btn ghost small" for="scan-photo">Scan a photo</label><button class="btn ghost small" data-action="food-type-code">Type the number</button></div>'
      + '<input type="file" id="scan-photo" data-field="food-photo" accept="image/*" capture="environment" hidden>');
    startCamera();
  }
  async function startCamera() {
    try {
      const eng = scanEngine();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('This browser has no camera access.'), { name: 'NoCamera' });
      scan.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      const v = $('#scan-video');
      if (!v) { stopCamera(); return; }
      v.srcObject = scan.stream; await v.play();
      await eng;
      scanStatus('Hold the barcode inside the box.');
      scan.on = true;
      scanLoop(v);
    } catch (e) {
      stopCamera();
      scanStatus(e.name === 'NotAllowedError' ? 'Camera access is off. Allow it in Settings › Safari › Camera, or scan a photo.' : 'Camera did not start. Scan a photo or type the number.');
    }
  }
  function stopCamera() {
    scan.on = false;
    if (scan.stream) scan.stream.getTracks().forEach((t) => t.stop());
    scan.stream = null;
  }
  async function scanLoop(v) {
    while (scan.on) {
      if (v.readyState >= 2 && v.videoWidth) {
        const sw = v.videoWidth, sh = Math.round(v.videoHeight * 0.5), sy = Math.round((v.videoHeight - sh) / 2);
        const k = Math.min(1, 960 / sw);
        scanCanvas.width = Math.round(sw * k); scanCanvas.height = Math.round(sh * k);
        scanCtx.drawImage(v, 0, sy, sw, sh, 0, 0, scanCanvas.width, scanCanvas.height);
        try {
          const codes = await scan.engine.read(frameSource(scan.engine));
          if (codes.length && scan.on) { stopCamera(); foundCode(codes[0]); return; }
        } catch (e) { /* keep trying */ }
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  async function scanPhoto(file) {
    if (!file) return;
    stopCamera(); scanStatus('Reading the photo…');
    try {
      const eng = await scanEngine();
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      scanCanvas.width = Math.round(bmp.width * k); scanCanvas.height = Math.round(bmp.height * k);
      scanCtx.drawImage(bmp, 0, 0, scanCanvas.width, scanCanvas.height);
      const codes = await eng.read(frameSource(eng));
      if (codes.length) foundCode(codes[0]); else scanStatus('No barcode in that photo. Get closer, keep it flat, and use good light.');
    } catch (e) { scanStatus('Could not read that photo.'); }
  }
  let scanSeq = 0;
  async function foundCode(raw) {
    const code = canonCode(raw);
    if (code.length < 8) { toast('That does not look like a barcode'); return; }
    if (navigator.vibrate) navigator.vibrate(50);
    const seq = ++scanSeq;
    // Only show the result if the scan sheet is still open and no newer scan started.
    const current = () => seq === scanSeq && !!$('#scan-status');
    const keys = [codeKey(code)]; const longForm = upcEtoA(code); if (longForm) keys.push(codeKey(longForm));
    // Your own foods first (a fixed or typed-in label wins), then the built-in list, then Open Food Facts.
    const foods = Object.values(S().food.foods);
    const mine = S().food.foods['b' + code] || foods.find((f) => f.barcode && keys.includes(codeKey(f.barcode)) && f.src === 'custom')
      || foods.find((f) => f.barcode && keys.includes(codeKey(f.barcode)));
    if (mine) { sheetAmount(mine, { meal: fu.meal }); return; }
    scanStatus('Looking up ' + code + '…');
    const listed = await loadDb().then(() => keys.map((k) => dbByCode.get(k)).find(Boolean), () => null);
    if (!current()) return;
    if (listed) { sheetAmount(listed, { meal: fu.meal }); return; }
    try {
      let hit = await offProduct(code);
      if (!(hit && hit.food) && longForm) hit = (await offProduct(longForm)) || hit;
      if (!current()) return;
      if (hit && hit.food) { sheetAmount(hit.food, { meal: fu.meal }); return; }
      const name = hit && hit.product ? String(hit.product.product_name || '').trim() : '';
      sheetFoodForm(name ? { name, brand: String(hit.product.brands || '').split(',')[0].trim(), src: 'new' } : null,
        { barcode: code, msg: name ? 'Found the product but not its nutrition. Type it from the label once and the barcode is remembered.' : 'This barcode is not in the database yet. Type it from the label once and the next scan finds it.' });
    } catch (e) {
      if (!current()) return;
      sheetFoodForm(null, { barcode: code, msg: 'Could not reach the food database' + (navigator.onLine === false ? ' (offline)' : '') + '. Type it from the label, or try again later.' });
    }
  }

  // ---------------------------------------------------------------------------
  // Targets (also shown in Settings)
  // ---------------------------------------------------------------------------
  function targetRows() {
    const t = S().food.targets;
    const row = (k, label, sub) => '<div class="toggle-row"><div><div>' + label + '</div><div class="small muted">' + sub + '</div></div><input class="input" style="width:100px;text-align:center" type="number" inputmode="numeric" min="0" placeholder="–" value="' + (t[k] > 0 ? t[k] : '') + '" data-field="food-target" data-k="' + k + '"></div>';
    const fromMacros = (t.protein || 0) * 4 + (t.carbs || 0) * 4 + (t.fat || 0) * 9;
    const note = fromMacros > 0 ? '<p class="small muted mt8">Your macro targets add up to ' + fmtK(fromMacros) + ' kcal' + (t.kcal > 0 && Math.abs(fromMacros - t.kcal) > t.kcal * 0.05 ? ', which does not match the calorie target.' : '.') + '</p>' : '';
    return row('kcal', 'Calories', 'kcal a day') + row('protein', 'Protein', 'grams a day') + row('carbs', 'Carbs', 'grams a day') + row('fat', 'Fat', 'grams a day') + note;
  }
  function settingsCard() {
    return '<div class="group-title">Food targets</div><div class="card"><p class="small muted">Leave a box empty for no target.</p><div id="food-target-rows">' + targetRows() + '</div></div>';
  }
  function sheetTargets() {
    openSheet(sheetHeader('Daily targets') + '<p class="small muted">Leave a box empty for no target. These are also in Settings.</p><div id="food-target-rows">' + targetRows() + '</div><button class="btn block mt12" data-action="sheet-close">Done</button>');
  }

  // ---------------------------------------------------------------------------
  // Events (app.js forwards anything named food-*)
  // ---------------------------------------------------------------------------
  function click(a, d) {
    switch (a) {
      case 'food-day': {
        const today = todayKey();
        const next = d.d === '0' ? today : addDays(dayKey(), +d.d);
        fu.day = next >= today ? null : next;
        O.render(); break;
      }
      case 'food-add': fu.search = ''; fu.off = null; fu.offError = ''; sheetAdd(+d.meal); break;
      case 'food-back': stopCamera(); sheetAdd(); break;
      case 'food-pick': {
        // Your stored copy wins, so numbers you fixed are what gets logged.
        const f = S().food.foods[d.id] || (d.src === 'usda' ? (db || []).find((x) => x.id === d.id) : d.src === 'off' ? (fu.off || []).find((x) => x.id === d.id) : null);
        if (f) sheetAmount(f, { meal: fu.meal });
        break;
      }
      case 'food-online': searchOnline(); break;
      case 'food-db-retry': dbError = ''; renderResults(); break;
      case 'food-meal': {
        if (fu.fx) fu.fx.meal = +d.i;
        document.querySelectorAll('.f-mealseg button').forEach((b) => b.classList.toggle('on', +b.dataset.i === +d.i));
        const save = $('[data-action="food-save"]'); if (save && fu.fx && !fu.fx.entryId) save.textContent = 'Add to ' + MEALS[+d.i];
        break;
      }
      case 'food-save': saveEntry(); break;
      case 'food-delete': deleteEntry(); break;
      case 'food-edit': editEntry(d.id); break;
      case 'food-fix': {
        const x = fu.fx; if (!x) break;
        sheetFoodForm(x.food.src === 'custom' ? x.food : Object.assign({}, x.food, { src: 'new' }), { barcode: x.food.barcode, meal: x.meal, entryId: x.entryId, day: x.day, qty: x.qty, unit: x.unit });
        break;
      }
      case 'food-forget': forgetFood(); break;
      case 'food-quick': sheetQuick(null); break;
      case 'food-new': sheetFoodForm(null, { meal: fu.meal }); break;
      case 'food-scan': sheetScan(); break;
      case 'food-type-code': {
        stopCamera();
        const code = prompt('Barcode number (under the bars):');
        if (code) foundCode(code); else startCamera();
        break;
      }
      case 'food-targets': sheetTargets(); break;
      case 'food-fav': toggleFav(); break;
      case 'food-meal-menu': sheetMealMenu(+d.meal); break;
      case 'food-copy-meal': {
        const mi = +d.meal, n = addCopies(dayKey(), entriesFor(addDays(dayKey(), -1)).filter((e) => e.meal === mi), mi);
        closeSheet(); O.render(); toast(copyText(n)); break;
      }
      case 'food-copy-today': {
        const mi = +d.meal, n = addCopies(todayKey(), entriesFor(dayKey()).filter((e) => e.meal === mi), mi);
        closeSheet(); O.render(); toast(copyText(n, 'today')); break;
      }
      case 'food-copy-day': {
        const n = addCopies(dayKey(), entriesFor(addDays(dayKey(), -1)));
        O.render(); toast(copyText(n)); break;
      }
      case 'food-clear-meal': {
        const mi = +d.meal, st = S(), day = dayKey();
        if (!confirm('Remove everything from ' + MEALS[mi] + '?')) break;
        const list = entriesFor(day).filter((e) => e.meal !== mi);
        entriesFor(day).forEach((e) => { if (e.meal === mi) markDeleted('food', e.id); });
        if (list.length) st.diary[day] = list; else delete st.diary[day];
        O.save(); closeSheet(); O.render(); toast(MEALS[mi] + ' cleared'); break;
      }
      case 'food-save-meal': saveMealAs(+d.meal); break;
      case 'food-sm-open': sheetSavedMeal(d.id, fu.meal); break;
      case 'food-sm-meal': {
        if (!fu.sm) break;
        fu.sm.meal = +d.i;
        document.querySelectorAll('.f-mealseg button').forEach((b) => b.classList.toggle('on', +b.dataset.i === +d.i));
        const m = S().food.meals[fu.sm.id], go = $('[data-action="food-sm-log"]');
        if (m && go) go.textContent = 'Add ' + countText(m.items).split(' · ')[0] + ' to ' + MEALS[+d.i];
        break;
      }
      case 'food-sm-log': logSavedMeal(); break;
      case 'food-sm-remove': {
        const m = fu.sm && S().food.meals[fu.sm.id]; if (!m) break;
        m.items.splice(+d.i, 1);
        if (!m.items.length) { delete S().food.meals[m.id]; O.save(); fu.from === 'add' ? sheetAdd() : closeSheet(); toast('Meal deleted'); break; }
        O.save(); sheetSavedMeal(m.id); break;
      }
      case 'food-sm-rename': {
        const m = fu.sm && S().food.meals[fu.sm.id]; if (!m) break;
        const name = prompt('Rename meal', m.name);
        if (name && name.trim()) { m.name = name.trim(); O.save(); sheetSavedMeal(m.id); }
        break;
      }
      case 'food-sm-delete': {
        const m = fu.sm && S().food.meals[fu.sm.id]; if (!m) break;
        if (!confirm('Delete the saved meal "' + m.name + '"? Days already logged are not changed.')) break;
        delete S().food.meals[m.id]; O.save();
        if (fu.from === 'add') sheetAdd(); else closeSheet();
        toast('Meal deleted'); break;
      }
    }
  }
  function input(el, f) {
    if (f === 'food-search') {
      fu.search = el.value;
      if (fu.offQuery !== fu.search.trim()) fu.offError = '';
      renderResults();
    } else if (f === 'food-qty' && fu.fx) {
      fu.fx.qty = num(el.value, 0);
      renderPreview();
    }
  }
  function change(el, f) {
    if (f === 'food-unit' && fu.fx) {
      const q = convert(fu.fx.food, fu.fx.qty, fu.fx.unit, el.value);
      fu.fx.unit = el.value; fu.fx.qty = q;
      const inp = $('[data-field="food-qty"]'); if (inp) inp.value = trimNum(q);
      renderPreview();
    } else if (f === 'food-target') {
      const v = Math.round(num(el.value, 0));
      S().food.targets[el.dataset.k] = v > 0 ? v : null;
      O.save();
      // The sheet's rows (macro total note) and the screen behind it both change.
      const rows = $('#food-target-rows'); if (rows && rows.closest('#sheet-panel')) rows.innerHTML = targetRows();
      O.render();
    } else if (f === 'food-photo') {
      scanPhoto(el.files[0]); el.value = '';
    }
  }
  function submit(form) {
    if (form.id === 'food-quick-form') submitQuick(form);
    else if (form.id === 'food-form') submitFoodForm(form);
  }

  document.addEventListener('overload:sheetclose', () => { stopCamera(); fu.form = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

  window.__overloadFood = {
    render, click, input, change, submit, settingsCard,
    // for tests and the console
    _: { searchDb, loadDb, nutrition, unitOptions, convert, canonCode, fromOff, foundCode, fu }
  };
  if (O.screen === 'food') O.render();
})();

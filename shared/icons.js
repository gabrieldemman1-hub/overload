/* release 3.0 (bump.sh sets this line; the offline copy refuses the file when it names another release) */
/* Overload + Fuel: the icon set. A classic script (no module, no build).
 *
 *   icon('check')            -> '<svg class="ic" viewBox="0 0 24 24" ...>...</svg>'
 *   icon('check', 's')       -> the same with class="ic s" (16 px; 'm' is 20 px, 'l' is 32 px, see shared/ui.css)
 *   icon('trophy', 's', '🏆') -> the drawing, then '<span class="sr">🏆</span>': a text alternative, hidden from view.
 *                               Pass the glyph the icon replaced wherever that glyph was part of a line of text
 *                               (the streak, a PR, "weight ↑"): assistive tech and the tests go on reading what they read.
 *   window.__icons           -> { name: inner SVG markup }, for anything that needs the raw paths
 *
 * The apps must still draw if this file did not arrive: each script that calls icon() starts with
 *   const icon = window.icon || (() => '');
 *
 * One grid (24 x 24, 2 px margin), one stroke weight (1.75, round caps and joins), colour from currentColor.
 * Every icon is aria-hidden: the control it sits in carries the label (text or aria-label).
 * The presentation attributes are written on the <svg> itself, so an icon is right even before the stylesheet loads.
 * Use it inside template strings: '<button class="icon-btn" aria-label="Close">' + icon('close') + '</button>'.
 * Setting textContent on an element wipes its icon: where code swaps a glyph (cloud pill, star, quick-add +),
 * set innerHTML = icon(name) instead.
 */
(function (root) {
  'use strict';
  var P = {
    /* ---- tabs: Overload ---- */
    dumbbell: '<path d="M3 10v4M6.5 6.5v11M17.5 6.5v11M21 10v4M6.5 12h11"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    list: '<path d="M9 6h11.5M9 12h11.5M9 18h11.5"/><path d="M4.25 6h.01M4.25 12h.01M4.25 18h.01" stroke-width="2.6"/>',
    chart: '<path d="M4 4v16h16"/><path d="M8 15l3.5-4 3 2.5L20 7.5"/>',
    settings: '<path d="M4 8h8.5M17.5 8H20M4 16h2.5M11.5 16H20"/><circle cx="15" cy="8" r="2.5"/><circle cx="9" cy="16" r="2.5"/>',
    /* ---- tabs: Fuel ---- */
    gauge: '<path d="M3.5 17a8.5 8.5 0 0 1 17 0"/><path d="M12 17l4-5.5"/><path d="M12 17h.01" stroke-width="2.8"/>',
    bars: '<rect x="4.5" y="12" width="3.5" height="8" rx=".9"/><rect x="10.25" y="4" width="3.5" height="16" rx=".9"/><rect x="16" y="8.5" width="3.5" height="11.5" rx=".9"/>',

    /* ---- actions ---- */
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    'chevron-left': '<path d="M14.5 6l-6 6 6 6"/>',
    'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
    'chevron-down': '<path d="M6 9.5l6 6 6-6"/>',
    'chevron-up': '<path d="M6 14.5l6-6 6 6"/>',
    'arrow-up': '<path d="M12 19V5M6.5 10.5L12 5l5.5 5.5"/>',
    'arrow-down': '<path d="M12 5v14M6.5 13.5L12 19l5.5-5.5"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="2.8"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    barcode: '<path d="M3 8V5h3M21 8V5h-3M3 16v3h3M21 16v3h-3"/><path d="M7 9v6M10 9v6M13 9v6M17 9v6"/>',
    camera: '<path d="M3.5 9.5a1.5 1.5 0 0 1 1.5-1.5h2.2l1.5-2.5h6.6L16.8 8H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-8z"/><circle cx="12" cy="13.2" r="3.4"/>',
    swap: '<path d="M4 8h15M16 5l3 3-3 3M20 16H5M8 13l-3 3 3 3"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2L17.5 7M10.25 10.5v5.5M13.75 10.5v5.5"/>',
    edit: '<path d="M4 20l1-4.2L16.3 4.5l3.2 3.2L8.2 19 4 20zM14 6.8l3.2 3.2"/>',
    note: '<path d="M5 4.5h14V15l-4.5 4.5H5v-15zM14.5 19.5V15H19M8.5 9h7M8.5 12.5h4"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
    link: '<path d="M10.2 13.8a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1.2 1.1"/><path d="M13.8 10.2a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1.2-1.1"/>',
    external: '<path d="M10 5.5H5.5v13h13V14M14 5.5h4.5V10M18.5 5.5L11 13"/>',
    undo: '<path d="M8 5.5l-4 4 4 4M4 9.5h10.5a5 5 0 0 1 0 10H11"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19 3.2V7h-3.8"/>',
    play: '<path d="M8 5.5v13l10.5-6.5L8 5.5z"/>',
    flag: '<path d="M5.5 21V4M5.5 4.5h12l-2.4 3.75 2.4 3.75h-12"/>',
    drag: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="2.8"/>',
    share: '<path d="M12 14V3.5M8.5 7L12 3.5 15.5 7M8 10.5H5.5V20h13v-9.5H16"/>',
    'add-square': '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>',

    /* ---- data in and out ---- */
    cloud: '<path d="M7.5 18.5a4.25 4.25 0 0 1-.6-8.46 5.5 5.5 0 0 1 10.63-1.2A4.85 4.85 0 0 1 17 18.5H7.5z"/>',
    'cloud-check': '<path d="M7.5 18.5a4.25 4.25 0 0 1-.6-8.46 5.5 5.5 0 0 1 10.63-1.2A4.85 4.85 0 0 1 17 18.5H7.5z"/><path d="M9.3 13l2 2 3.5-3.7"/>',
    'cloud-off': '<path d="M9.2 6.4a5.5 5.5 0 0 1 8.3 2.4 4.85 4.85 0 0 1 2.6 8.1M17 18.5H7.5a4.25 4.25 0 0 1-.6-8.46"/><path d="M4 4l16 16"/>',
    sync: '<path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12a7.5 7.5 0 0 1 13.2-4.9"/><path d="M18 3.5v3.8h-3.8M6 20.5v-3.8h3.8"/>',
    export: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
    import: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
    clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3.5h6V5M9 11h6M9 15h3.5"/>',
    file: '<path d="M6 3.5h8l4 4v13H6v-17zM14 3.5v4h4"/>',

    /* ---- training ---- */
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9M10 3h4M12 3v3"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 5.5H5V7a3 3 0 0 0 3 3M16 5.5h3V7a3 3 0 0 1-3 3M12 13v4M8.5 20h7M9.5 17h5"/>',
    flame: '<path d="M12 3c.6 3.2 5 5.2 5 10a5 5 0 0 1-10 0c0-1.9.8-3.4 1.9-4.5.3 1.5 1 2.4 2 2.8C10.8 8.6 11.2 5.6 12 3z"/>',
    bolt: '<path d="M13 3L5 13.5h6L10 21l8.5-10.5h-6L13 3z"/>',
    scale: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10.5a4.6 4.6 0 0 1 8 0M12 7.5l1 3"/>',
    moon: '<path d="M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7z"/>',
    heart: '<path d="M12 20S4.5 15.6 4.5 9.9A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.6 12 20 12 20z"/>',
    pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01" stroke-width="2.4"/>',
    bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14l1.5-2zM10 20.6a2.2 2.2 0 0 0 4 0"/>',

    /* ---- food ---- */
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8L12 3.5z"/>',
    'star-filled': '<path fill="currentColor" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8L12 3.5z"/>',
    stack: '<path d="M12 4l8.5 4.25L12 12.5 3.5 8.25 12 4zM3.5 12.25L12 16.5l8.5-4.25M3.5 16.25L12 20.5l8.5-4.25"/>',
    leaf: '<path d="M5.5 18.5C5 11 9.5 5.5 19 5c.5 9.5-5 14-13.5 13.5zM5.5 18.5L13 11"/>',

    /* ---- status ---- */
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
    warning: '<path d="M12 4l9 15.5H3L12 4zM12 10v4.5M12 17h.01"/>',

    /* ---- the two apps' marks, for .brand-mark and .app-tile: the drawings of the Home Screen icons (tools/icons.js) on the
       24 px grid, in currentColor. Fuel's leaf is a hole in the plate, so it shows whatever the mark sits on. ---- */
    'mark-overload': '<g fill="currentColor" stroke="none"><rect x="1.97" y="11.39" width="20.06" height="1.22" rx=".61"/><rect x="4.41" y="8.25" width="2.53" height="7.5" rx=".89"/><rect x="7.45" y="5.44" width="2.95" height="13.12" rx="1.03"/><rect x="13.6" y="5.44" width="2.95" height="13.12" rx="1.03"/><rect x="17.06" y="8.25" width="2.53" height="7.5" rx=".89"/></g>',
    'mark-fuel': '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M7.17 12a7.03 7.03 0 1 0 14.06 0a7.03 7.03 0 1 0 -14.06 0ZM9.84 16.66C8.95 11.2 12.45 7.34 18.59 7.34C18.77 13.34 15.09 17.3 9.84 16.66Z"/><path d="M11.67 14.84L15.26 10.99" stroke-width=".75"/><path d="M3.19 5.53v3.52a1.17 1.17 0 0 0 2.34 0V5.53M4.36 5.53V18.47" stroke-width="1.17"/>'
  };
  // Other names for the same drawing, so call sites can say what they mean.
  var ALIAS = {
    'tab-today': 'dumbbell', 'tab-program': 'calendar', 'tab-exercises': 'list', 'tab-history': 'chart', 'tab-settings': 'settings',
    'tab-fuel': 'gauge', 'tab-trends': 'bars',
    sliders: 'settings', 'chart-line': 'chart', 'chart-bar': 'bars', dots: 'more', streak: 'flame', pr: 'trophy', recovery: 'heart', cardio: 'heart',
    finish: 'flag', 'drag-handle': 'drag', warn: 'warning', back: 'chevron-left', up: 'arrow-up', down: 'arrow-down', 'home-screen': 'add-square',
    favorite: 'star', 'favorite-on': 'star-filled', 'saved-meal': 'stack', scan: 'barcode', sleep: 'moon', weight: 'scale', reminders: 'bell',
    update: 'refresh', reload: 'refresh'
  };
  var HEAD = ' viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
  var has = Object.prototype.hasOwnProperty;
  var esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  function icon(name, extraClass, alt) {
    // Own names only: icon('constructor') or icon('__proto__') is an unknown name like any other.
    var key = has.call(P, name) ? name : has.call(ALIAS, name) ? ALIAS[name] : null;
    if (key === null) return '';   // an unknown name draws nothing rather than breaking the row
    var cls = extraClass ? ' ' + String(extraClass).replace(/[^A-Za-z0-9_ -]/g, '') : '';   // class names only: nothing here can open an attribute
    return '<svg class="ic' + cls + '"' + HEAD + P[key] + '</svg>' + (alt ? '<span class="sr">' + esc(alt) + '</span>' : '');
  }
  root.icon = icon;
  root.__icons = P;
  root.__iconAliases = ALIAS;
  if (typeof module !== 'undefined' && module.exports) module.exports = { icon: icon, icons: P, aliases: ALIAS };   // tools only
})(typeof window !== 'undefined' ? window : globalThis);

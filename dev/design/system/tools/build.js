// Builds the reference screens. Usage: node tools/build.js
// Writes dev/design/system/<name>.html from the template strings in pages-train.js, pages-fuel.js and pages-misc.js.
// Icons come from shared/icons.js (the same icon('name') the apps call), written into the pages as inline SVG.
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./lib.js');
const sets = [require('./pages-train.js').pages, require('./pages-fuel.js').pages];
try { sets.push(require('./pages-misc.js').pages); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
const out = path.join(__dirname, '..');
const names = [];
for (const pages of sets) for (const name of Object.keys(pages)) {
  fs.writeFileSync(path.join(out, name + '.html'), L.page(name, pages[name]));
  names.push(name);
}
fs.writeFileSync(path.join(__dirname, 'pages.json'), JSON.stringify(names, null, 1) + '\n');
// The contact sheet: every shot of one theme on one page (tools/shoot.js photographs it).
const group = (label, list) => '<h2>' + label + '</h2><div class="grid">' + list.map((n) => '<figure><img src="../shots/' + n + '-THEME.png" alt=""><figcaption>' + n + '</figcaption></figure>').join('') + '</div>';
fs.writeFileSync(path.join(__dirname, 'contact.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Contact sheet</title><style>'
  + 'body{margin:0;padding:28px 32px 40px;font:14px -apple-system,"Inter",system-ui,sans-serif;background:#1b1d20;color:#cfd3d8}body.light{background:#d9d9d4;color:#33363a}'
  + 'h2{margin:26px 0 12px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:700}h2:first-child{margin-top:0}'
  + '.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:18px 14px}figure{margin:0}img{display:block;width:100%;height:auto;border-radius:22px;box-shadow:0 0 0 1px rgba(128,128,128,.35)}'
  + 'figcaption{margin-top:8px;font-size:12px;letter-spacing:.04em}</style></head><body>'
  + group('Overload (training)', names.filter((n) => /^train-/.test(n))) + group('Fuel (diet)', names.filter((n) => /^fuel-/.test(n))) + group('Both apps', names.filter((n) => !/^(train|fuel)-/.test(n)))
  + '<script>var t=new URLSearchParams(location.search).get("theme")==="light"?"light":"dark";document.body.className=t;document.querySelectorAll("img").forEach(function(i){i.src=i.getAttribute("src").replace("THEME",t)})</script></body></html>\n');
console.log('built ' + names.length + ' pages: ' + names.join(', '));

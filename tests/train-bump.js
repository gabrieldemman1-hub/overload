#!/usr/bin/env node
/* bump.sh, the release script for both apps: which numbers it takes, what it changes, what it refuses.
 *
 *   node tests/train-bump.js [--tree=<folder>] [--port=<ignored>]
 *
 * Runs bump.sh under every shell that is here of sh, dash and bash --posix, on throw-away copies of the tree
 * (the repo itself is never bumped). What must hold (review finding T2):
 *   - a release number is MAJOR.MINOR: two whole numbers with a dot, no leading zero, no third part. 2.9, 3.0
 *     again, 31, 3.01, 3.1.0, 03.1, 3., .1, v3.1, 3,1, "3.1 " and the empty word are refused;
 *   - it must be higher than the current release, compared as two whole numbers (the rule of the start-up
 *     rescue): from 3.9, 3.10 is taken and 3.8 is refused;
 *   - a new first number only with --major (and --major only with one);
 *   - a refused number changes no file, byte for byte;
 *   - a taken number sets every ?v= in both pages and both workers, VERSION in overload.js and fuel/fuel.js,
 *     the release in sync.js, and moves overload-vN and fuel-vN on by one; --check passes afterwards;
 *   - --check fails when app.js, styles.css or food.js is at the root (names v2.8's page asks for), when
 *     sync.js's release differs from VERSION, or when the words a worker's install reads the release by
 *     (const VERSION = ' in both main scripts, release: ' in sync.js) are there more than once;
 *   - every other file with ?v= in an install list (scripts and stylesheets of both apps and shared/) carries the
 *     first line  /* release <number> ... * /  : a taken number sets it, and --check fails when it names another
 *     release, is there twice or is missing (final review, upgrade#1: the workers refuse such a file);
 *   - --check fails when sw.js or fuel/sw.js differs from the published one (origin/main) but keeps its cache
 *     name, and passes once sh bump.sh moved it on; a worker new since then, and a tree without git, are not
 *     compared (final review, upgrade#3). Those checks run in throw-away git repositories made here.
 *   --tree=DIR   the tree to copy. Default: the repo this file is in.
 * No server, no browser: --port is accepted and ignored, like the other tests' runner passes it.
 * Prints one PASS or FAIL line per check; exit code 1 when a check failed.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const lib = require('./lib');
const T = require('./train-common');

const args = T.args();
const TREE = args.tree ? path.resolve(String(args.tree)) : lib.REPO;
const run = T.runner('train-bump');
const { need, same } = run;

const temp = [];
process.on('exit', () => temp.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* leave it */ } }));
const SKIP = new Set(['.git', '.github', 'tests', 'dev', 'node_modules', 'connector', 'tools', 'lab']);
let base = null;
// A fresh copy of the tree: what bump.sh reads, changes and checks.
function copy() {
  if (!base) {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'overload-bump-base-')); temp.push(base);
    fs.cpSync(TREE, base, { recursive: true, filter: (src) => { const rel = path.relative(TREE, src); return !rel || !SKIP.has(rel.split(path.sep)[0]); } });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overload-bump-')); temp.push(dir);
  fs.cpSync(base, dir, { recursive: true });
  return dir;
}
// Every file of a copy with a hash of its bytes, for "nothing changed".
function fingerprint(dir) {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'); } };
  walk(dir);
  return out;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
// The training app's main script: the script of the page that holds  const VERSION = '…'  (overload.js since 3.0).
const MAIN = [...read(TREE, 'index.html').matchAll(/src="\.\/([^"?]+)\?v=/g)].map((x) => x[1]).find((f) => /const VERSION = '/.test(read(TREE, f))) || 'overload.js';
const SHELLS = [['sh'], ['dash'], ['bash', '--posix']].filter((s) => spawnSync('sh', ['-c', 'command -v ' + s[0]]).status === 0);
// The files that carry the first line  /* release <number> ... * /: every address with ?v= in the two install lists
// (as a path from the root), but the main scripts and sync.js, which carry their own marks.
const assetsIn = (rel) => ((/const ASSETS = \[([\s\S]*?)\n\];/.exec(read(TREE, rel)) || [])[1] || '').split('\n').map((l) => /^\s*'([^']+)'/.exec(l)).filter(Boolean).map((m) => m[1]);
const MARKED = [...new Set(assetsIn('sw.js').filter((a) => a.includes('?v=')).map((a) => path.posix.normalize(a.split('?')[0]))
  .concat(assetsIn('fuel/sw.js').filter((a) => a.includes('?v=')).map((a) => path.posix.normalize('fuel/' + a.split('?')[0]))))]
  .filter((f) => !['overload.js', 'sync.js', 'fuel/fuel.js'].includes(f)).sort();
// A throw-away git repository of a copy, with refs/remotes/origin/main at its first commit: "the published release".
function gitCopy(publish) {
  const dir = copy();
  const git = (...a) => { const r = spawnSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', '-c', 'commit.gpgsign=false'].concat(a), { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) throw new Error('git ' + a.join(' ') + ': ' + r.stderr); return r.stdout; };
  git('init', '-q');
  if (publish) publish(dir);
  git('add', '-A'); git('commit', '-q', '-m', 'published');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { dir, git };
}
const HAVE_GIT = spawnSync('git', ['--version']).status === 0;
function bump(shell, dir, words) {
  const r = spawnSync(shell[0], shell.slice(1).concat(['bump.sh'], words), { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
// What a copy says about its release, everywhere bump.sh writes it.
function releaseOf(dir) {
  const stamps = (rel) => [...new Set((read(dir, rel).match(/\?v=[0-9A-Za-z._-]+/g) || []).map((s) => s.replace(/\.$/, '').slice(3)))];
  return {
    pages: ['index.html', 'sw.js', 'fuel/index.html', 'fuel/sw.js'].map((f) => f + ':' + stamps(f).join('|')),
    version: (/const VERSION = '([^']*)'/.exec(read(dir, MAIN)) || [])[1],
    fuel: (/const VERSION = '([^']*)'/.exec(read(dir, 'fuel/fuel.js')) || [])[1],
    sync: (/^\s*release: '([^']*)'/m.exec(read(dir, 'sync.js')) || [])[1],
    caches: [(/const CACHE = '([^']+)'/.exec(read(dir, 'sw.js')) || [])[1], (/const CACHE = '([^']+)'/.exec(read(dir, 'fuel/sw.js')) || [])[1]],
    marks: MARKED.map((f) => f + ':' + ((/^\/\* release (\S+) /m.exec(read(dir, f)) || [])[1] || '') + 'x' + (read(dir, f).split('/* release ').length - 1))
  };
}
const at = (v, caches) => ({ pages: ['index.html', 'sw.js', 'fuel/index.html', 'fuel/sw.js'].map((f) => f + ':' + v), version: v, fuel: v, sync: v, caches, marks: MARKED.map((f) => f + ':' + v + 'x1') });

(async () => {
  console.log('# tree: ' + TREE + (TREE === lib.REPO ? ' (the working tree)' : ' (a copy)') + '; main script ' + MAIN + '; shells: ' + SHELLS.map((s) => s.join(' ')).join(', '));
  const start = releaseOf(TREE);
  const n = Number(start.caches[0].replace('overload-v', '')), m = Number(start.caches[1].replace('fuel-v', ''));
  const cachesAfter = (k) => ['overload-v' + (n + k), 'fuel-v' + (m + k)];
  await run.step('set-up', 'the tree is one release everywhere: ' + start.version, async () => {
    same(start, at(start.version, start.caches), 'the release in the tree');
    need(start.version === '3.0', 'the checks below are written for 3.0; the tree is at ' + start.version);
    need(SHELLS.length >= 2, 'shells found: ' + SHELLS.map((s) => s[0]).join(', '));
    return start.caches.join(', ');
  });

  for (const shell of SHELLS) {
    const sh = shell.join(' ');
    const step = (title, fn) => run.step(sh, title, fn);

    await step('--check passes on the tree and changes nothing', async () => {
      const dir = copy(), before = fingerprint(dir), r = bump(shell, dir, ['--check']);
      need(r.code === 0, 'exit ' + r.code + ': ' + r.out.trim().split('\n').pop());
      same(fingerprint(dir), before, 'the files');
      return r.out.trim().split('\n').pop();
    });

    const refused = [['2.9'], ['3.0'], ['31'], ['3.01'], ['3.1.0'], ['03.1'], ['3.'], ['.1'], ['v3.1'], ['3,1'], ['3.1 '], [''], ['3.12345'], ['4.0'], ['--major', '3.1'], ['--major', '2.9'], ['3.1', '3.2'], ['--check', '3.1']];
    await step('refused, with exit code 1 and no file changed: ' + refused.map((w) => JSON.stringify(w.join(' '))).join(', '), async () => {
      const dir = copy(), before = fingerprint(dir), wrong = [];
      for (const words of refused) {
        const r = bump(shell, dir, words);
        if (r.code !== 1 || !/bump\.sh: /.test(r.out)) wrong.push(JSON.stringify(words.join(' ')) + ' exit ' + r.code + ' (' + r.out.trim().split('\n').pop().slice(0, 80) + ')');
      }
      need(!wrong.length, 'taken or not refused cleanly: ' + wrong.join('; '));
      same(fingerprint(dir), before, 'the files after the refused numbers');
      return refused.length + ' refused';
    });

    await step('the messages say why: not a release number, not higher, a new first number needs --major', async () => {
      const dir = copy();
      const say = (w) => bump(shell, dir, w).out;
      need(/not a release number/.test(say(['3.01'])) && /not a release number/.test(say(['31'])), say(['3.01']));
      need(/not higher than the current release 3\.0/.test(say(['3.0'])) && /not higher/.test(say(['2.9'])), say(['2.9']));
      need(/--major 4\.0/.test(say(['4.0'])), say(['4.0']));
      need(/--major is for a new first number/.test(say(['--major', '3.1'])), say(['--major', '3.1']));
      return say(['4.0']).trim().slice(9, 120) + '…';
    });

    await step('3.1 is taken: every ?v=, both VERSIONs, sync.js\'s release, both caches one on; --check passes', async () => {
      const dir = copy(), r = bump(shell, dir, ['3.1']);
      need(r.code === 0, 'exit ' + r.code + ': ' + r.out.trim());
      same(releaseOf(dir), at('3.1', cachesAfter(1)), 'the release after the bump');
      const c = bump(shell, dir, ['--check']);
      need(c.code === 0, '--check afterwards: ' + c.out.trim());
      const again = bump(shell, dir, ['3.1']);
      need(again.code === 1 && /not higher/.test(again.out), 'the same number again: exit ' + again.code);
      return r.out.trim().split('\n')[0];
    });

    await step('numbers compare as two whole numbers: from 3.9, 3.10 is taken and then 3.9 is refused', async () => {
      const dir = copy();
      need(bump(shell, dir, ['3.9']).code === 0, '3.9 was refused');
      const r = bump(shell, dir, ['3.10']);
      need(r.code === 0, '3.10 after 3.9: exit ' + r.code + ': ' + r.out.trim());
      same(releaseOf(dir), at('3.10', cachesAfter(2)), 'the release after 3.10');
      const back = bump(shell, dir, ['3.9']);
      need(back.code === 1, '3.9 after 3.10: exit ' + back.code);
      return '3.0 -> 3.9 -> 3.10; 3.9 refused afterwards';
    });

    await step('--major 4.0 is taken (before or after the number)', async () => {
      const a = copy(), b = copy();
      const r1 = bump(shell, a, ['--major', '4.0']), r2 = bump(shell, b, ['4.0', '--major']);
      need(r1.code === 0 && r2.code === 0, 'exit ' + r1.code + ' and ' + r2.code + ': ' + (r1.out + r2.out).trim().slice(0, 200));
      same(releaseOf(a), at('4.0', cachesAfter(1)), 'the release after --major 4.0');
      same(releaseOf(b), releaseOf(a), 'the other order');
      return r1.out.trim().split('\n')[0];
    });

    await step('--check fails when a name v2.8\'s page asks for is at the root (app.js, styles.css, food.js)', async () => {
      const out = [];
      for (const f of ['app.js', 'styles.css', 'food.js']) {
        const dir = copy();
        fs.writeFileSync(path.join(dir, f), '/* anything */\n');
        const r = bump(shell, dir, ['--check']);
        need(r.code === 1 && new RegExp(f.replace('.', '\\.') + ' is at the root').test(r.out), f + ': exit ' + r.code + ' ' + r.out.trim().split('\n').pop());
        const b = bump(shell, dir, ['3.1']);
        need(b.code === 1, f + ': a bump went through with exit 0');
        out.push(f);
      }
      return out.join(', ') + ' each refused';
    });

    await step('--check fails when the words the workers read the release by are not there exactly once', async () => {
      const out = [];
      for (const [f, extra] of [[MAIN, "\n// const VERSION = '3.0' (an example in a comment)\n"], ['sync.js', "\n// release: '3.0'\n"], ['fuel/fuel.js', "\n// const VERSION = '3.0'\n"]]) {
        const dir = copy();
        fs.appendFileSync(path.join(dir, f), extra);
        const r = bump(shell, dir, ['--check']);
        need(r.code === 1 && /exactly once|exactly one line/.test(r.out), f + ': exit ' + r.code + ' ' + r.out.trim().split('\n').pop());
        out.push(f);
      }
      return out.join(', ') + ' each refused';
    });

    await step('--check fails when the first line /* release ... */ of a versioned file names another release, is there twice or is missing', async () => {
      const out = [];
      for (const [f, change, why, bumpTakes] of [
        ['fuel/food.js', (t) => t.replace('/* release 3.0 ', '/* release 2.9 '), /fuel\/food\.js says release '2\.9'/, true],   // a new number sets it again
        ['programs.js', (t) => t + '\n/* release 3.0 (an example in a comment) */\n', /programs\.js has "\/\* release " 2 times/, false],
        ['shared/ui.css', (t) => t.replace(/^\/\* release [^\n]*\n/, ''), /shared\/ui\.css has "\/\* release " 0 times/, false]
      ]) {
        const dir = copy();
        fs.writeFileSync(path.join(dir, f), change(read(dir, f)));
        const r = bump(shell, dir, ['--check']);
        need(r.code === 1 && why.test(r.out), f + ': exit ' + r.code + ' ' + r.out.trim().split('\n').slice(-3).join(' / '));
        const b = bump(shell, dir, ['3.1']);
        need((b.code === 0) === bumpTakes, f + ': sh bump.sh 3.1 ended with exit ' + b.code + ' ' + b.out.trim().split('\n').pop());
        if (bumpTakes) same(releaseOf(dir), at('3.1', cachesAfter(1)), 'the release after the bump');
        out.push(f);
      }
      return out.join(', ') + ' each refused by --check';
    });

    await step('--check fails when a worker differs from the published one (origin/main) under the same cache name; sh bump.sh with the next release mends it', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const { dir, git } = gitCopy();
      let r = bump(shell, dir, ['--check']);
      need(r.code === 0 && !/not compared/.test(r.out), 'the published tree itself: exit ' + r.code + ' ' + r.out.trim().split('\n').pop());
      // The food list rebuilt the old way (README before the final review): ?db= moved by hand, no new release.
      for (const f of ['fuel/food.js', 'fuel/sw.js']) fs.writeFileSync(path.join(dir, f), read(dir, f).split('foods.json?db=5').join('foods.json?db=6'));
      const FUEL = /fuel\/sw\.js differs from the published one \(origin\/main\), but its cache is still fuel-v1/;
      r = bump(shell, dir, ['--check']);
      need(r.code === 1 && FUEL.test(r.out), 'fuel/sw.js changed, not committed: exit ' + r.code + ' ' + r.out.trim().split('\n').slice(-2).join(' / '));
      git('commit', '-q', '-am', 'the food list, ?db=6');
      r = bump(shell, dir, ['--check']);
      need(r.code === 1 && FUEL.test(r.out), 'fuel/sw.js changed and committed, not published: exit ' + r.code);
      r = bump(shell, dir, ['3.1']);
      need(r.code === 0, 'sh bump.sh 3.1: exit ' + r.code + ' ' + r.out.trim().split('\n').pop());
      // sw.js changed alone
      const other = gitCopy();
      fs.writeFileSync(path.join(other.dir, 'sw.js'), read(other.dir, 'sw.js').replace('const NET_WAIT = 3000;', 'const NET_WAIT = 2500;'));
      r = bump(shell, other.dir, ['--check']);
      need(r.code === 1 && /sw\.js differs from the published one \(origin\/main\), but its cache is still overload-v24/.test(r.out), 'sw.js changed: exit ' + r.code + ' ' + r.out.trim().split('\n').slice(-2).join(' / '));
      return 'fuel/sw.js (?db=6) and sw.js (NET_WAIT) refused; after sh bump.sh 3.1 the check passes';
    });

    await step('--check does not compare a worker that is new since the published release, nor a tree without git', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      let saved = null;
      const { dir } = gitCopy((d) => { saved = read(d, 'fuel/sw.js'); fs.rmSync(path.join(d, 'fuel/sw.js')); });
      fs.writeFileSync(path.join(dir, 'fuel/sw.js'), saved.split('foods.json?db=5').join('foods.json?db=6'));
      fs.writeFileSync(path.join(dir, 'fuel/food.js'), read(dir, 'fuel/food.js').split('foods.json?db=5').join('foods.json?db=6'));
      let r = bump(shell, dir, ['--check']);
      need(r.code === 0, 'fuel/sw.js new since the published release: exit ' + r.code + ' ' + r.out.trim().split('\n').slice(-2).join(' / '));
      const plain = copy();
      r = bump(shell, plain, ['--check']);
      need(r.code === 0 && /not compared with the published workers/.test(r.out), 'no git: exit ' + r.code + ' ' + r.out.trim());
      return 'both pass; without git it says it did not compare';
    });

    await step('--check fails when sync.js says another release than VERSION', async () => {
      const dir = copy();
      fs.writeFileSync(path.join(dir, 'sync.js'), read(dir, 'sync.js').replace(/^(\s*release: ')[^']*'/m, "$12.8'"));
      const r = bump(shell, dir, ['--check']);
      need(r.code === 1 && /sync\.js says release '2\.8'/.test(r.out), 'exit ' + r.code + ': ' + r.out.trim().split('\n').pop());
      return r.out.trim().split('\n')[0].slice(0, 100);
    });
  }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });

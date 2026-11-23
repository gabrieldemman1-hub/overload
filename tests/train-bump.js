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
 *   - round 4, rel#1: under the published release (origin/main's VERSION is the tree's), --check fails naming each
 *     page and each file with ?v= that differs from its published copy (both apps; also after two branches that
 *     each ran sh bump.sh 3.1 merge cleanly), and passes once sh bump.sh moved the release on;
 *   - round 4, rel#3: in a git repository, --check and sh bump.sh fail naming a file of an install list, a page
 *     or a worker that git does not track, and pass once it is added; files with changes not committed yet are
 *     named in a warning, which does not fail;
 *   - round 4, rel#2: sh bump.sh sets  release: '…'  in backup.js and connector.js too, and --check fails when it
 *     names another release or is there more than once (overload.js uses neither module of another release).
 *   - round 5, pub#1: after a roll-back (v2.8's files published again), --check compares with the newest published
 *     commit of the tree's release: the same 3.0 passes, a changed fuel/fuel.js or fuel/sw.js (fuel-v1) fails;
 *   - round 5, pub#2: with a remote origin, bump.sh fetches origin/main first (a pull request merged on the server
 *     counts), says which published commit and release it compared with, and with BUMP_NO_FETCH=1 or a fetch
 *     that fails compares with the copy here and says so. These run in throw-away repositories with a bare origin
 *     in a temporary folder; nothing reaches GitHub.
 *   - round 6, fp#1: a roll-back that moved main back to v2.8's commit with a force-push (from this clone, or from
 *     a second one and then fetched) leaves 3.0 only in this clone's record of origin/main (its reflog): --check
 *     still compares with it, so a changed fuel/fuel.js under 3.0 fails and the same 3.0 passes;
 *   - round 6, cache#1 and hint#1: after 3.1 is rolled back to 3.0 (git revert, published), a change under 3.0 is
 *     told to take 3.2 and why, sh bump.sh 3.2 takes caches above 3.1's, and a worker set back by hand to 3.1's
 *     cache name fails, naming that published commit and its release;
 *   - round 6: in a fresh clone (no record of origin/main) and a shallow one, both read what is there and pass.
 *   - round 6, after review: once git has dropped the record entry of 3.0 itself, the force-push's entry (whose old
 *     value is 3.0) still counts; a shallow clone that does not reach a rolled-back 3.1 fetches main's whole
 *     history (or, with BUMP_NO_FETCH=1, warns that it is shallow).
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
// env: extra variables for bump.sh; { BUMP_NO_FETCH: null } takes the variable away (bump.sh then fetches origin).
function bump(shell, dir, words, env) {
  const e = Object.assign({}, process.env, env || {});
  for (const k of Object.keys(e)) if (e[k] == null) delete e[k];
  const r = spawnSync(shell[0], shell.slice(1).concat(['bump.sh'], words), { cwd: dir, encoding: 'utf8', env: e });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
// git in any folder (a second clone, a bare origin), with a name for its commits.
function gitIn(dir, ...a) {
  const r = spawnSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', '-c', 'commit.gpgsign=false'].concat(a), { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git ' + a.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}
// Round 5, pub#1: the files of folder `src` published as the next commit of origin/main, as a roll-back does (v2.8's
// files pushed to main again). The working tree, HEAD and the index of `dir` are left as they are.
function publishFiles(dir, src, message) {
  const index = path.join(dir, '.git', 'other-index');
  const env = Object.assign({}, process.env, { GIT_INDEX_FILE: index });
  const g = (...a) => { const r = spawnSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', '-c', 'commit.gpgsign=false'].concat(a), { cwd: dir, encoding: 'utf8', env }); if (r.status !== 0) throw new Error('git ' + a.join(' ') + ': ' + r.stderr); return r.stdout.trim(); };
  g('--work-tree=' + src, 'add', '-A');
  const commit = g('commit-tree', g('write-tree'), '-p', 'refs/remotes/origin/main', '-m', message);
  g('update-ref', 'refs/remotes/origin/main', commit);
  fs.rmSync(index, { force: true });
  return commit;
}
let v28 = null;
const v28Tree = () => { if (!v28) { v28 = T.extractV28(); temp.push(v28); } return v28; };
const tempDir = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temp.push(d); return d; };
// Round 6, fp#1: a repository whose history is v2.8's files, then the tree (3.0) on top, with a bare origin in a
// temporary folder whose main is that 3.0, pushed from here (so this clone's record of origin/main holds it).
function v28Then30() {
  const dir = copy();
  const git = (...a) => gitIn(dir, ...a);
  git('init', '-q');
  git('--work-tree=' + v28Tree(), 'add', '-A'); git('commit', '-q', '-m', 'v2.8');
  const v28c = git('rev-parse', 'HEAD');
  git('add', '-A'); git('commit', '-q', '-m', '3.0');
  const r30 = git('rev-parse', 'HEAD');
  const origin = tempDir('overload-bump-origin-');
  gitIn(origin, 'init', '-q', '--bare');
  git('remote', 'add', 'origin', origin); git('push', '-q', 'origin', 'HEAD:main'); git('fetch', '-q', 'origin');
  return { dir, git, origin, v28c, r30 };
}
// Round 6, cache#1 and hint#1: 3.0 published, then 3.1 (sh bump.sh 3.1 and a change to train.css) published, then 3.1
// rolled back by git revert, published: the tree and origin/main are 3.0's files again, 3.1 is in the history.
function rolledBack31(shell) {
  const { dir, git } = gitCopy();
  need(bump(shell, dir, ['3.1']).code === 0, 'set-up: sh bump.sh 3.1 was refused');
  fs.appendFileSync(path.join(dir, 'train.css'), '\n/* 3.1 */\n');
  git('commit', '-q', '-am', '3.1'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const r31 = git('rev-parse', 'HEAD').trim();
  git('revert', '--no-edit', 'HEAD'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { dir, git, r31 };
}
// What a copy says about its release, everywhere bump.sh writes it.
function releaseOf(dir) {
  const stamps = (rel) => [...new Set((read(dir, rel).match(/\?v=[0-9A-Za-z._-]+/g) || []).map((s) => s.replace(/\.$/, '').slice(3)))];
  return {
    pages: ['index.html', 'sw.js', 'fuel/index.html', 'fuel/sw.js'].map((f) => f + ':' + stamps(f).join('|')),
    version: (/const VERSION = '([^']*)'/.exec(read(dir, MAIN)) || [])[1],
    fuel: (/const VERSION = '([^']*)'/.exec(read(dir, 'fuel/fuel.js')) || [])[1],
    sync: (/^\s*release: '([^']*)'/m.exec(read(dir, 'sync.js')) || [])[1],
    helpers: ['backup.js', 'connector.js'].map((f) => f + ':' + ((/^\s*release: '([^']*)'/m.exec(read(dir, f)) || [])[1] || '')),
    caches: [(/const CACHE = '([^']+)'/.exec(read(dir, 'sw.js')) || [])[1], (/const CACHE = '([^']+)'/.exec(read(dir, 'fuel/sw.js')) || [])[1]],
    marks: MARKED.map((f) => f + ':' + ((/^\/\* release (\S+) /m.exec(read(dir, f)) || [])[1] || '') + 'x' + (read(dir, f).split('/* release ').length - 1))
  };
}
const at = (v, caches) => ({ pages: ['index.html', 'sw.js', 'fuel/index.html', 'fuel/sw.js'].map((f) => f + ':' + v), version: v, fuel: v, sync: v, helpers: ['backup.js:' + v, 'connector.js:' + v], caches, marks: MARKED.map((f) => f + ':' + v + 'x1') });

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
      for (const [f, extra] of [[MAIN, "\n// const VERSION = '3.0' (an example in a comment)\n"], ['sync.js', "\n// release: '3.0'\n"], ['fuel/fuel.js', "\n// const VERSION = '3.0'\n"], ['backup.js', "\n// release: '3.0'\n"], ['connector.js', "\n// release: '3.0'\n"]]) {
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
      const { dir, git } = gitCopy((d) => { saved = read(d, 'fuel/sw.js'); fs.rmSync(path.join(d, 'fuel/sw.js')); });
      fs.writeFileSync(path.join(dir, 'fuel/sw.js'), saved.split('foods.json?db=5').join('foods.json?db=6'));
      fs.writeFileSync(path.join(dir, 'fuel/food.js'), read(dir, 'fuel/food.js').split('foods.json?db=5').join('foods.json?db=6'));
      git('add', '-A'); git('commit', '-q', '-m', 'the diet app\'s worker, not published yet');   // in git (rel#3), new since origin/main
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

    // Round 4, rel#2: overload.js uses no backup.js or connector.js of another release, so each names its own.
    await step('--check fails when backup.js or connector.js says another release than VERSION, or none (rel#2)', async () => {
      const out = [];
      for (const [f, change, why] of [
        ['backup.js', (t) => t.replace(/^(\s*release: ')[^']*'/m, "$12.8'"), /backup\.js says release '2\.8'/],
        ['connector.js', (t) => t.replace(/^\s*release: '[^']*',[^\n]*\n/m, ''), /connector\.js says release ''/]
      ]) {
        const dir = copy();
        fs.writeFileSync(path.join(dir, f), change(read(dir, f)));
        const r = bump(shell, dir, ['--check']);
        need(r.code === 1 && why.test(r.out), f + ': exit ' + r.code + ' ' + r.out.trim().split('\n').slice(-2).join(' / '));
        out.push(f);
      }
      return out.join(', ') + ' each refused';
    });

    // Round 4, rel#1: a change published under the release phones already have.
    await step('--check fails naming each page and ?v= file changed under the published release (Overload, then Fuel), and passes after sh bump.sh 3.1 (rel#1)', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const { dir, git } = gitCopy();
      fs.writeFileSync(path.join(dir, 'index.html'), read(dir, 'index.html').replace('<main id="app" class="screen"></main>', '<main id="app" class="screen"></main><p hidden>new</p>'));
      fs.appendFileSync(path.join(dir, MAIN), '\nwindow.__changed = true;\n');
      fs.appendFileSync(path.join(dir, 'train.css'), '\n:root { --changed: 1; }\n');
      const named = (out, files) => files.filter((f) => !new RegExp(f.replace(/[./]/g, '\\$&') + ' changed but the release is still 3\\.0: phones (keep the old copy|run it with their old copies of the other files)\\. Run sh bump\\.sh 3\\.1').test(out));
      let r = bump(shell, dir, ['--check']);
      need(r.code === 1 && !named(r.out, ['index.html', MAIN, 'train.css']).length, 'not committed: exit ' + r.code + '; not named: ' + named(r.out, ['index.html', MAIN, 'train.css']).join(', ') + ' / ' + r.out.trim().split('\n').slice(-3).join(' / '));
      git('commit', '-q', '-am', 'a change without a new release');
      r = bump(shell, dir, ['--check']);
      need(r.code === 1 && !named(r.out, ['index.html', MAIN, 'train.css']).length, 'committed: exit ' + r.code);
      need(!/programs\.js changed|sync\.js changed|backup\.js changed/.test(r.out), 'a file that did not change was named: ' + r.out.trim());
      r = bump(shell, dir, ['3.1']);
      need(r.code === 0, 'sh bump.sh 3.1: exit ' + r.code + ' ' + r.out.trim().split('\n').pop());
      const fuel = gitCopy();
      fs.writeFileSync(path.join(fuel.dir, 'fuel/index.html'), read(fuel.dir, 'fuel/index.html').replace('<main id="app" class="screen"></main>', '<main id="app" class="screen"></main><p hidden>new</p>'));
      fs.appendFileSync(path.join(fuel.dir, 'fuel/fuel.js'), '\nwindow.__changed = true;\n');
      fs.appendFileSync(path.join(fuel.dir, 'shared/ui.css'), '\n:root { --changed: 1; }\n');
      r = bump(shell, fuel.dir, ['--check']);
      need(r.code === 1 && !named(r.out, ['fuel/index.html', 'fuel/fuel.js', 'shared/ui.css']).length, 'Fuel: exit ' + r.code + '; not named: ' + named(r.out, ['fuel/index.html', 'fuel/fuel.js', 'shared/ui.css']).join(', '));
      return 'index.html, ' + MAIN + ', train.css named; then fuel/index.html, fuel/fuel.js, shared/ui.css; sh bump.sh 3.1 passes';
    });

    await step('--check fails after two branches that each ran sh bump.sh 3.1 merge cleanly, naming the file the second one changed (rel#1)', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const { dir, git } = gitCopy();
      const main = git('symbolic-ref', '--short', 'HEAD').trim();
      const r30 = git('rev-parse', 'HEAD').trim();
      git('branch', '-q', 'feat-b');
      need(bump(shell, dir, ['3.1']).code === 0, 'branch A: sh bump.sh 3.1 was refused');
      fs.appendFileSync(path.join(dir, 'programs.js'), '\n/* A */\n');
      git('commit', '-q', '-am', 'A');
      // Branch B takes 3.1 too while 3.0 is still the published release (round 6: a branch that takes it only after A
      // was published gets caches above A's, and its merge conflicts in sw.js), and changes train.css.
      git('checkout', '-q', 'feat-b');
      need(bump(shell, dir, ['3.1']).code === 0, 'branch B: sh bump.sh 3.1 was refused');
      fs.appendFileSync(path.join(dir, 'train.css'), '\n/* B */\n');
      git('commit', '-q', '-am', 'B');
      git('checkout', '-q', main); git('update-ref', 'refs/remotes/origin/main', 'HEAD');   // A is published
      git('checkout', '-q', '-b', 'feat-c', r30);
      const atC = bump(shell, dir, ['3.1']);   // 3.1 is published already: even here it says to take the next one
      need(atC.code === 1 && /programs\.js changed but the release is still 3\.1/.test(atC.out), 'sh bump.sh 3.1 on branch C, after A published 3.1: exit ' + atC.code);
      git('checkout', '-q', '-f', main); git('merge', '-q', '--no-edit', 'feat-b');
      need(spawnSync('sh', ['-c', 'git show origin/main:sw.js | cmp -s - sw.js'], { cwd: dir }).status === 0, 'sw.js after the merge is not the published one: the test lost its point');
      const r = bump(shell, dir, ['--check']);
      need(r.code === 1 && /train\.css changed but the release is still 3\.1: phones keep the old copy\. Run sh bump\.sh 3\.2/.test(r.out) && !/programs\.js changed/.test(r.out), 'after the merge: exit ' + r.code + ' ' + r.out.trim().split('\n').slice(-3).join(' / '));
      return 'train.css named; sw.js byte-identical to the published one';
    });

    // Round 4, rel#3: what git does not have, GitHub Pages does not publish.
    await step('--check and sh bump.sh fail naming a new script, a page or a worker that is not in git; a file not committed yet is only a warning (rel#3)', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const { dir, git } = gitCopy();
      fs.writeFileSync(path.join(dir, 'stats.js'), '/* release 3.0 (bump.sh sets this line; …) */\nwindow.__stats = 1;\n');
      fs.writeFileSync(path.join(dir, 'sw.js'), read(dir, 'sw.js').replace("  './connector.js?v=3.0',\n", "  './connector.js?v=3.0',\n  './stats.js?v=3.0',\n"));
      fs.writeFileSync(path.join(dir, 'index.html'), read(dir, 'index.html').replace('  <script src="./connector.js?v=3.0"></script>\n', '  <script src="./connector.js?v=3.0"></script>\n  <script src="./stats.js?v=3.0"></script>\n'));
      need(/stats\.js\?v=3\.0/.test(read(dir, 'sw.js')) && /stats\.js\?v=3\.0/.test(read(dir, 'index.html')), 'set-up: stats.js is not in the install list and the page');
      const NOT = /stats\.js is not in git: the published site would not have it\. git add it/;
      let r = bump(shell, dir, ['3.1']);
      need(r.code === 1 && NOT.test(r.out), 'sh bump.sh 3.1: exit ' + r.code + ' ' + r.out.trim().split('\n').slice(-3).join(' / '));
      git('commit', '-q', '-am', '3.1');   // 'git commit -a' leaves the new file out
      r = bump(shell, dir, ['--check']);
      need(r.code === 1 && NOT.test(r.out), '--check after git commit -am: exit ' + r.code);
      git('add', 'stats.js'); git('commit', '-q', '-m', 'stats.js');
      r = bump(shell, dir, ['--check']);
      need(r.code === 0 && !/warning/.test(r.out), '--check after git add: exit ' + r.code + ' ' + r.out.trim().split('\n').slice(-2).join(' / '));
      // A page and a worker that git does not track (removed from the index, still on disk).
      const other = gitCopy();
      other.git('rm', '-q', '--cached', 'fuel/index.html', 'fuel/sw.js'); other.git('commit', '-q', '-m', 'untracked');
      r = bump(shell, other.dir, ['--check']);
      need(r.code === 1 && /fuel\/index\.html is not in git/.test(r.out) && /fuel\/sw\.js is not in git/.test(r.out), 'page and worker not tracked: exit ' + r.code + ' ' + r.out.trim().split('\n').slice(-3).join(' / '));
      // Changes not committed yet, on a release that is not the published one: named, and only a warning.
      const third = gitCopy();
      need(bump(shell, third.dir, ['3.1']).code === 0, 'sh bump.sh 3.1 was refused');
      third.git('commit', '-q', '-am', '3.1');
      fs.appendFileSync(path.join(third.dir, 'train.css'), '\n/* not committed */\n');
      r = bump(shell, third.dir, ['--check']);
      need(r.code === 0 && /warning: not committed yet: train\.css\. Commit them before you push\./.test(r.out), 'uncommitted train.css: exit ' + r.code + ' ' + r.out.trim());
      return 'stats.js refused by sh bump.sh 3.1 and --check until git add; fuel/index.html and fuel/sw.js refused; train.css not committed: a warning';
    });

    // Round 5, pub#1: 3.0 published, then v2.8's files published again (the roll-back), then 3.0 published again.
    // Phones that had 3.0 keep fuel-v1 (and a phone not opened meanwhile overload-v24) with 3.0's files.
    const tail = (r) => r.out.trim().split('\n').slice(-3).join(' / ');
    await step('after a roll-back to v2.8, --check compares with 3.0 as it was published: the same 3.0 passes; fuel/fuel.js, or fuel/sw.js under fuel-v1, changed under 3.0 fails (pub#1)', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const { dir, git } = gitCopy();
      const r30 = git('rev-parse', 'HEAD').trim();
      publishFiles(dir, v28Tree(), 'roll back to v2.8');
      need(spawnSync('git', ['cat-file', '-e', 'origin/main:fuel/sw.js'], { cwd: dir }).status !== 0 && /const VERSION = '2\.8'/.test(gitIn(dir, 'show', 'origin/main:app.js')), 'set-up: origin/main is not v2.8\'s files');
      const wrong = [];
      let r = bump(shell, dir, ['--check']);
      const before = /release 3\.0 was published before, last at ([0-9a-f]+): phones may still have it/.exec(r.out);
      if (!(r.code === 0 && before && r30.startsWith(before[1]) && /published: origin\/main at [0-9a-f]+, release 2\.8/.test(r.out))) wrong.push('the same 3.0 published again: exit ' + r.code + ' ' + tail(r));
      fs.appendFileSync(path.join(dir, 'fuel/fuel.js'), '\nwindow.__fixed = true;\n');
      git('commit', '-q', '-am', 'a fix, still 3.0');
      r = bump(shell, dir, ['--check']);
      if (!(r.code === 1 && /fuel\/fuel\.js changed but the release is still 3\.0: phones keep the old copy\. Run sh bump\.sh 3\.1/.test(r.out))) wrong.push('fuel/fuel.js changed under 3.0: exit ' + r.code + ' ' + tail(r));
      // The worker under the same cache name: v2.8's files have no fuel/sw.js, but phones kept 3.0's.
      const w = gitCopy();
      publishFiles(w.dir, v28Tree(), 'roll back to v2.8');
      for (const f of ['fuel/food.js', 'fuel/sw.js']) fs.writeFileSync(path.join(w.dir, f), read(w.dir, f).split('foods.json?db=5').join('foods.json?db=6'));
      r = bump(shell, w.dir, ['--check']);
      if (!(r.code === 1 && /fuel\/sw\.js differs from the published one \(origin\/main at [0-9a-f]+, the last of release 3\.0\), but its cache is still fuel-v1/.test(r.out))) wrong.push('fuel/sw.js changed under fuel-v1: exit ' + r.code + ' ' + tail(r));
      r = bump(shell, dir, ['3.1']);
      if (r.code !== 0) wrong.push('sh bump.sh 3.1 after the fix: exit ' + r.code + ' ' + tail(r));
      need(!wrong.length, wrong.join('; '));
      return 'the same 3.0: passes; fuel/fuel.js and fuel/sw.js (?db=6, fuel-v1) refused; sh bump.sh 3.1 passes';
    });

    // Round 5, pub#2: a pull request merged on GitHub is published, also when this clone has not fetched since.
    await step('--check fetches origin/main first: branch B\'s 3.1 fails once A\'s 3.1 is merged on the server; BUMP_NO_FETCH=1 and a fetch that fails say what they compared with (pub#2)', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const { dir, git } = gitCopy();
      const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'overload-bump-origin-')); temp.push(origin);
      const web = fs.mkdtempSync(path.join(os.tmpdir(), 'overload-bump-web-')); temp.push(web);
      gitIn(origin, 'init', '-q', '--bare');
      git('remote', 'add', 'origin', origin); git('push', '-q', 'origin', 'HEAD:main'); git('fetch', '-q', 'origin');
      const r30 = git('rev-parse', 'HEAD').trim();
      gitIn(web, 'clone', '-q', '-b', 'main', origin, '.');
      // Branch A: 3.1 and a change to programs.js, merged on "GitHub" (the second clone). This clone does not fetch.
      git('checkout', '-q', '-b', 'feat-a');
      need(bump(shell, dir, ['3.1']).code === 0, 'branch A: sh bump.sh 3.1 was refused');
      fs.appendFileSync(path.join(dir, 'programs.js'), '\n/* A */\n');
      git('commit', '-q', '-am', 'A'); git('push', '-q', 'origin', 'feat-a');
      gitIn(web, 'fetch', '-q', 'origin'); gitIn(web, 'merge', '-q', '--no-ff', '--no-edit', 'origin/feat-a'); gitIn(web, 'push', '-q', 'origin', 'main');
      const merged = gitIn(web, 'rev-parse', 'HEAD');
      need(git('rev-parse', 'origin/main').trim() === r30, 'set-up: this clone has the merge already');
      // Branch B, from 3.0: 3.1 too (taken while origin/main here still says 3.0), and a change to train.css.
      git('checkout', '-q', '-b', 'feat-b', r30);
      need(bump(shell, dir, ['3.1'], { BUMP_NO_FETCH: '1' }).code === 0, 'branch B: sh bump.sh 3.1 was refused');
      fs.appendFileSync(path.join(dir, 'train.css'), '\n/* B */\n');
      git('commit', '-q', '-am', 'B');
      const at = (out) => { const m = /published: origin\/main at ([0-9a-f]+), release (\S+)/.exec(out); return m ? { at: m[1], release: m[2] } : null; };
      const wrong = [];
      let r = bump(shell, dir, ['--check'], { BUMP_NO_FETCH: '1' });
      let p = at(r.out);
      if (!(r.code === 0 && /origin\/main not fetched \(BUMP_NO_FETCH is set\): this is the copy here, from \d{4}-\d\d-\d\d \(its last commit\)/.test(r.out) && p && r30.startsWith(p.at) && p.release === '3.0')) wrong.push('BUMP_NO_FETCH=1: exit ' + r.code + ' ' + tail(r));
      r = bump(shell, dir, ['--check'], { BUMP_NO_FETCH: null });
      p = at(r.out);
      if (!(r.code === 1 && p && merged.startsWith(p.at) && p.release === '3.1' && /programs\.js changed but the release is still 3\.1/.test(r.out) && /train\.css changed but the release is still 3\.1: phones keep the old copy\. Run sh bump\.sh 3\.2/.test(r.out))) wrong.push('fetched: exit ' + r.code + ' ' + tail(r));
      if (git('rev-parse', 'origin/main').trim() !== merged) wrong.push('origin/main here is not the merge after the check');
      // An origin that cannot be reached: a warning with the date of the copy here, and the checks go on with it.
      git('remote', 'set-url', 'origin', path.join(origin, 'not-there'));
      r = bump(shell, dir, ['--check'], { BUMP_NO_FETCH: null });
      if (!(r.code === 1 && /warning: could not fetch origin\/main: compared with the copy here, from \d{4}-\d\d-\d\d \(its last commit\)/.test(r.out) && /train\.css changed but the release is still 3\.1/.test(r.out))) wrong.push('origin not there: exit ' + r.code + ' ' + tail(r));
      need(!wrong.length, wrong.join('; '));
      return 'not fetched: passes and says so; fetched: programs.js and train.css named; fetch failed: a warning, compared with the copy here';
    });

    // Round 6: the last lines bump.sh printed, without the lines about the copy and files not committed.
    const brief = (r) => r.out.trim().split('\n').filter((l) => !/^(warning: not committed|origin\/main not fetched)/.test(l)).slice(-3).join(' / ');
    // Round 6, fp#1: the roll-back made by moving main back to v2.8's commit (git push -f), not by a new commit. No
    // commit of origin/main's history carries 3.0 any more; this clone's record of origin/main (its reflog) does.
    await step('after a roll-back that moved main back to v2.8 with a force-push, from here or from a second clone and then fetched, --check still compares with 3.0 as it was published: the same 3.0 passes, a changed fuel/fuel.js fails (fp#1)', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const SEEN = /release 3\.0 was published before, last at ([0-9a-f]+): phones may still have it/;
      const FIX = /fuel\/fuel\.js changed but the release is still 3\.0: phones keep the old copy\. Run sh bump\.sh 3\.1/;
      const AT28 = /published: origin\/main at [0-9a-f]+, release 2\.8/;
      const wrong = [];
      // From this clone.
      const a = v28Then30();
      a.git('push', '-q', '-f', 'origin', a.v28c + ':main');
      need(a.git('rev-parse', 'refs/remotes/origin/main') === a.v28c, 'set-up: origin/main here is not v2.8 after the force-push');
      need(a.git('rev-list', a.v28c).split('\n').every((c) => spawnSync('git', ['cat-file', '-e', c + ':overload.js'], { cwd: a.dir }).status !== 0), 'set-up: a commit of origin/main\'s history carries overload.js');
      let r = bump(shell, a.dir, ['--check'], { BUMP_NO_FETCH: '1' });
      let m = SEEN.exec(r.out);
      if (!(r.code === 0 && m && a.r30.startsWith(m[1]) && AT28.test(r.out))) wrong.push('from here, the same 3.0: exit ' + r.code + ' ' + brief(r));
      fs.appendFileSync(path.join(a.dir, 'fuel/fuel.js'), '\nwindow.__fixed = true;\n');
      a.git('commit', '-q', '-am', 'a fix, still 3.0');
      r = bump(shell, a.dir, ['--check'], { BUMP_NO_FETCH: '1' });
      m = SEEN.exec(r.out);
      if (!(r.code === 1 && m && a.r30.startsWith(m[1]) && FIX.test(r.out))) wrong.push('from here, fuel/fuel.js changed under 3.0: exit ' + r.code + ' ' + brief(r));
      r = bump(shell, a.dir, ['3.1'], { BUMP_NO_FETCH: '1' });
      if (r.code !== 0) wrong.push('from here, sh bump.sh 3.1 after the fix: exit ' + r.code + ' ' + brief(r));
      // From a second clone (GitHub's web page, another computer); the check here fetches it.
      const b = v28Then30();
      const web = tempDir('overload-bump-web-');
      gitIn(web, 'clone', '-q', '-b', 'main', b.origin, '.');
      gitIn(web, 'push', '-q', '-f', 'origin', b.v28c + ':main');
      need(b.git('rev-parse', 'refs/remotes/origin/main') === b.r30, 'set-up: this clone has seen the force-push already');
      fs.appendFileSync(path.join(b.dir, 'fuel/fuel.js'), '\nwindow.__fixed = true;\n');
      b.git('commit', '-q', '-am', 'a fix, still 3.0');
      r = bump(shell, b.dir, ['--check'], { BUMP_NO_FETCH: null });
      m = SEEN.exec(r.out);
      if (!(r.code === 1 && m && b.r30.startsWith(m[1]) && FIX.test(r.out) && AT28.test(r.out))) wrong.push('from a second clone, fetched: exit ' + r.code + ' ' + brief(r));
      if (b.git('rev-parse', 'refs/remotes/origin/main') !== b.v28c) wrong.push('origin/main here is not v2.8 after the check: it did not fetch');
      need(!wrong.length, wrong.join('; '));
      return 'from here: the same 3.0 passes, fuel/fuel.js refused, sh bump.sh 3.1 passes; from a second clone: fetched, fuel/fuel.js refused';
    });

    // Round 6, cache#1: a release made from rolled-back files never takes a cache name a published worker had.
    await step('after 3.1 is rolled back to 3.0 (git revert, published), sh bump.sh 3.2 takes caches above 3.1\'s and --check passes; a worker set back by hand to 3.1\'s cache name fails, naming that commit and release (cache#1)', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const { dir, git, r31 } = rolledBack31(shell);
      same(releaseOf(dir).caches, start.caches, 'set-up: the caches after the revert');
      const wrong = [];
      fs.appendFileSync(path.join(dir, 'train.css'), '\n/* the fix */\n');
      fs.appendFileSync(path.join(dir, 'fuel/fuel.js'), '\nwindow.__fixed = true;\n');
      let r = bump(shell, dir, ['3.2']);
      const took = releaseOf(dir).caches;
      if (!(r.code === 0 && took.join() === cachesAfter(2).join() && /caches: overload-v\d+, fuel-v\d+ \(higher than any published before\)/.test(r.out))) wrong.push('sh bump.sh 3.2: exit ' + r.code + ', caches ' + took.join(', ') + ' (3.1 had ' + cachesAfter(1).join(', ') + ')' + (r.code ? ' ' + brief(r) : ''));
      git('commit', '-q', '-am', '3.2');
      r = bump(shell, dir, ['--check']);
      if (r.code !== 0) wrong.push('--check on 3.2: exit ' + r.code + ' ' + brief(r));
      // The same 3.2 with 3.1's cache names put back by hand: phones that kept 3.1 would install it into 3.1's cache.
      const [o31, f31] = cachesAfter(1);
      fs.writeFileSync(path.join(dir, 'sw.js'), read(dir, 'sw.js').replace(/const CACHE = 'overload-v\d+'/, "const CACHE = '" + o31 + "'"));
      fs.writeFileSync(path.join(dir, 'fuel/sw.js'), read(dir, 'fuel/sw.js').replace(/const CACHE = 'fuel-v\d+'/, "const CACHE = '" + f31 + "'"));
      git('commit', '-q', '--allow-empty', '-am', '3.2 under 3.1\'s cache names');
      r = bump(shell, dir, ['--check']);
      const named = (f, c) => { const x = new RegExp('FAILED: ' + f.replace(/[./]/g, '\\$&') + ' differs from the published one \\(origin/main at ([0-9a-f]+), release 3\\.1\\), but its cache is still ' + c + ': phones would install it into the cache the running worker serves from\\. Run sh bump\\.sh 3\\.3').exec(r.out); return !!x && r31.startsWith(x[1]); };
      if (!(r.code === 1 && named('sw.js', o31) && named('fuel/sw.js', f31))) wrong.push('3.2 under ' + o31 + ' and ' + f31 + ' by hand: exit ' + r.code + ' ' + brief(r));
      need(!wrong.length, wrong.join('; '));
      return 'sh bump.sh 3.2: ' + took.join(', ') + '; set back to ' + o31 + ' and ' + f31 + ': both refused';
    });

    // Round 6, hint#1: the number to take is above every published one, rolled back or not.
    await step('after 3.1 is rolled back to 3.0, a change under 3.0 is told to take 3.2 (not 3.1) and why; sh bump.sh 3.2 then passes (hint#1)', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const { dir, git } = rolledBack31(shell);
      const wrong = [];
      fs.appendFileSync(path.join(dir, 'train.css'), '\n/* the fix */\n');
      git('commit', '-q', '-am', 'the fix, still 3.0');
      let r = bump(shell, dir, ['--check']);
      if (!(r.code === 1 && /train\.css changed but the release is still 3\.0: phones keep the old copy\. Run sh bump\.sh 3\.2/.test(r.out)
        && /release 3\.1 was published before \(rolled back\): a fix needs 3\.2/.test(r.out) && !/sh bump\.sh 3\.1/.test(r.out))) wrong.push('--check: exit ' + r.code + ' ' + brief(r));
      r = bump(shell, dir, ['3.2']);
      if (r.code !== 0) wrong.push('sh bump.sh 3.2 as told: exit ' + r.code + ' ' + brief(r));
      need(!wrong.length, wrong.join('; '));
      return 'Run sh bump.sh 3.2, and "release 3.1 was published before (rolled back): a fix needs 3.2"; then it passes';
    });

    // Round 6: what bump.sh reads of git works in a fresh clone (no record of origin/main yet) and a shallow one.
    await step('in a fresh clone with no record of origin/main and in a shallow clone, --check and sh bump.sh 3.1 read what is there and pass', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const a = v28Then30();
      const fresh = tempDir('overload-bump-fresh-');
      gitIn(fresh, 'clone', '-q', '-b', 'main', a.origin, '.');
      gitIn(fresh, 'reflog', 'expire', '--expire=now', '--expire-unreachable=now', '--all');
      need(gitIn(fresh, 'log', '-g', '--format=%H', 'refs/remotes/origin/main') === '', 'set-up: the fresh clone has a record of origin/main');
      const shallow = tempDir('overload-bump-shallow-');
      gitIn(shallow, 'clone', '-q', '--depth', '1', '-b', 'main', 'file://' + a.origin, '.');
      need(gitIn(shallow, 'rev-parse', '--is-shallow-repository') === 'true', 'set-up: the clone is not shallow');
      const wrong = [];
      for (const [name, d] of [['fresh', fresh], ['shallow', shallow]]) {
        let r = bump(shell, d, ['--check'], { BUMP_NO_FETCH: '1' });
        if (!(r.code === 0 && /published: origin\/main at [0-9a-f]+, release 3\.0/.test(r.out) && !/fatal|error:|usage:/i.test(r.out))) wrong.push(name + ' --check: exit ' + r.code + ' ' + brief(r));
        r = bump(shell, d, ['3.1'], { BUMP_NO_FETCH: '1' });
        if (!(r.code === 0 && releaseOf(d).caches.join() === cachesAfter(1).join() && !/fatal|error:|usage:/i.test(r.out))) wrong.push(name + ' sh bump.sh 3.1: exit ' + r.code + ', caches ' + releaseOf(d).caches.join(', ') + ' ' + brief(r));
      }
      need(!wrong.length, wrong.join('; '));
      return 'fresh and shallow: --check and sh bump.sh 3.1 pass';
    });

    // Round 6, after review: git gc drops a record entry about 30 days after its commit left origin/main. The
    // force-push's own entry still names 3.0 as what main was before it, and bump.sh reads that too.
    await step('after a force-push roll-back, once git has dropped the record entry of 3.0 itself, the force-push entry\'s old value still counts: a changed fuel/fuel.js under 3.0 fails', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const SEEN = /release 3\.0 was published before, last at ([0-9a-f]+): phones may still have it/;
      const FIX = /fuel\/fuel\.js changed but the release is still 3\.0: phones keep the old copy\. Run sh bump\.sh 3\.1/;
      const a = v28Then30();
      a.git('push', '-q', '-f', 'origin', a.v28c + ':main');
      // 3.0's own entry made six weeks ago, the force-push's today; then what git gc does after 30 days.
      const log = path.join(a.dir, '.git', 'logs', 'refs', 'remotes', 'origin', 'main');
      const lines = fs.readFileSync(log, 'utf8').split('\n');
      const old = Math.floor(Date.now() / 1000) - 42 * 86400;
      for (let i = 0; i < lines.length; i++) if (lines[i].split(' ')[1] === a.r30) lines[i] = lines[i].replace(/> \d+ ([+-]\d{4})\t/, '> ' + old + ' $1\t');
      fs.writeFileSync(log, lines.join('\n'));
      a.git('reflog', 'expire', '--expire=never', '--expire-unreachable=30.days.ago', 'refs/remotes/origin/main');
      need(a.git('log', '-g', '--format=%H', 'refs/remotes/origin/main').split('\n').filter(Boolean).length === 1, 'set-up: the record does not hold only the force-push');
      need(!a.git('log', '-g', '--format=%H', 'refs/remotes/origin/main').split('\n').includes(a.r30), 'set-up: the record still lists 3.0 as a value origin/main had');
      fs.appendFileSync(path.join(a.dir, 'fuel/fuel.js'), '\nwindow.__fixed = true;\n');
      a.git('commit', '-q', '-am', 'a fix, still 3.0');
      const r = bump(shell, a.dir, ['--check'], { BUMP_NO_FETCH: '1' });
      const m = SEEN.exec(r.out);
      need(r.code === 1 && m && a.r30.startsWith(m[1]) && FIX.test(r.out), 'exit ' + r.code + ' ' + brief(r));
      return 'refused, naming 3.0 as published at ' + m[1];
    });

    // Round 6, after review: a shallow clone (a cloud session clones 50 commits) that does not reach a release
    // published and rolled back before its oldest commit: --check fetches main's whole history first; with
    // BUMP_NO_FETCH it says the clone is shallow.
    await step('in a shallow clone that does not reach 3.1 (published, then rolled back by a revert), --check fetches the whole history and names 3.2; with BUMP_NO_FETCH=1 it warns that the clone is shallow', async () => {
      if (!HAVE_GIT) return 'skipped: no git here';
      const a = v28Then30();
      need(bump(shell, a.dir, ['3.1'], { BUMP_NO_FETCH: '1' }).code === 0, 'set-up: sh bump.sh 3.1 was refused');
      fs.appendFileSync(path.join(a.dir, 'train.css'), '\n/* 3.1 */\n');
      a.git('commit', '-q', '-am', '3.1'); a.git('push', '-q', 'origin', 'HEAD:main');
      a.git('revert', '--no-edit', 'HEAD'); a.git('push', '-q', 'origin', 'HEAD:main');
      for (let i = 1; i <= 3; i++) { fs.appendFileSync(path.join(a.dir, 'notes.txt'), 'note ' + i + '\n'); a.git('add', 'notes.txt'); a.git('commit', '-q', '-m', 'docs ' + i); }
      a.git('push', '-q', 'origin', 'HEAD:main');
      const d = tempDir('overload-bump-shallow31-');
      gitIn(d, 'clone', '-q', '--depth', '2', '-b', 'main', 'file://' + a.origin, '.');
      need(gitIn(d, 'rev-parse', '--is-shallow-repository') === 'true', 'set-up: the clone is not shallow');
      fs.appendFileSync(path.join(d, 'train.css'), '\n/* the fix */\n');
      gitIn(d, 'commit', '-q', '-am', 'the fix, still 3.0');
      const wrong = [];
      let r = bump(shell, d, ['--check'], { BUMP_NO_FETCH: '1' });
      if (!(r.code === 1 && /warning: this clone has origin\/main's history only back to \d{4}-\d\d-\d\d \(a shallow clone\), so a release published and rolled back before that is not seen\. Run git fetch --unshallow origin main/.test(r.out))) wrong.push('BUMP_NO_FETCH=1: exit ' + r.code + ' ' + brief(r));
      r = bump(shell, d, ['--check'], { BUMP_NO_FETCH: null });
      if (!(r.code === 1 && /Run sh bump\.sh 3\.2/.test(r.out) && /release 3\.1 was published before \(rolled back\): a fix needs 3\.2/.test(r.out) && !/shallow clone/.test(r.out))) wrong.push('fetched: exit ' + r.code + ' ' + brief(r));
      if (gitIn(d, 'rev-parse', '--is-shallow-repository') !== 'false') wrong.push('the clone is still shallow after the check');
      need(!wrong.length, wrong.join('; '));
      return 'not fetched: warned; fetched: whole history, names 3.2';
    });
  }
  run.done();
})().catch((e) => { console.error(e); process.exit(1); });

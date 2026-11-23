/* release 3.0 (bump.sh sets this line; the offline copy refuses the file when it names another release) */
/* Fuel — automatic safety copies. (Fuel's own copy of Overload's backup.js: the two apps share one site, and in
 * an ordinary browser one storage, so each keeps its copies in a database of its own.)
 * The whole saved data is copied into IndexedDB, which is separate from (and much larger than) the space the app
 * saves into: one copy a day (taken at start, and again when the app goes to the background, so the day's food
 * is in it) for the last 7 days, plus the latest copy taken just before an Import, a Reset, a Restore or a cloud
 * sign-in changed the data. Settings lists them with Restore. Loaded before fuel.js; fuel.js uses
 * window.__overloadBackup (the name Overload uses: the two apps are separate pages).
 * Nothing here may break the app: every failure is swallowed and reported only as "not available".
 */
(function () {
  'use strict';
  const DB = 'fuel-copies';   // never Overload's 'overload-copies': the two would overwrite each other's daily copy
  const KEEP_DAYS = 7;
  const OPEN_WAIT = 2000;   // Safari can leave the open request unanswered: give up then, so callers fall back
  const RUN_WAIT = 5000;    // and a transaction that never finishes: give up then too (review finding data#2)
  let dbp = null;           // the open database (a promise of it), kept for the session
  let kept = null;          // the database dbp gave, once it did

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const idb = window.indexedDB;
      if (!idb) { reject(new Error('IndexedDB is not available')); return; }
      let over = false;
      const fail = (err) => { if (!over) { over = true; clearTimeout(t); reject(err); } };
      const t = setTimeout(() => fail(new Error('IndexedDB did not answer')), OPEN_WAIT);
      const req = idb.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });   // small: listed in Settings
        if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });   // the copies themselves
      };
      req.onsuccess = () => {
        const db = req.result;
        if (over) { db.close(); return; }   // answered too late: the next call opens again
        over = true; clearTimeout(t);
        kept = db;
        db.onversionchange = () => forget(db);
        // The connection can be lost while the app runs: an iPhone drops it for an app that comes back from the
        // background ("Connection to Indexed Database server lost"). Then the next call opens it again.
        db.onclose = () => forget(db);
        resolve(db);
      };
      req.onerror = () => fail(req.error || new Error('IndexedDB did not open'));
      req.onblocked = () => fail(new Error('IndexedDB is busy'));
    });
    dbp.catch(() => { dbp = null; });   // try again next time
    return dbp;
  }
  // Lets go of an opened database, if it is still the one kept, so that the next call opens it again.
  function forget(db) {
    if (db !== kept) return;
    kept = null; dbp = null;
    try { db.close(); } catch (e) { /* closed already */ }
  }
  // One transaction; fn queues its requests synchronously (Safari closes a transaction left idle).
  // A transaction that cannot be started (the connection was lost: db.transaction throws) or that fails lets go
  // of the database, and is tried once more on a fresh connection. A transaction that failed changed nothing,
  // so the second try starts from the same place. When the database does not open, there is no second try:
  // the caller already waited OPEN_WAIT for it.
  // A transaction that neither completes nor fails within RUN_WAIT is given up the same way, without a second
  // try: the connection is let go (the next call opens it again) and the call rejects, so take() resolves
  // false and the caller's own fallback applies (Reset, Restore and an import then do nothing and say so). A
  // copy that would complete after that was not counted on: nothing was done in its name.
  function run(stores, mode, fn) {
    const once = () => open().then((db) => new Promise((resolve, reject) => {
      let over = false, t = null;
      const end = (f) => (v) => { if (over) return; over = true; clearTimeout(wait); f(v); };
      const lost = end((err) => { forget(db); reject({ again: true, err }); });
      const stuck = end((err) => { forget(db); reject(err); });
      const wait = setTimeout(() => { stuck(new Error('IndexedDB did not finish')); try { if (t) t.abort(); } catch (x) { /* over already */ } }, RUN_WAIT);
      try { t = db.transaction(stores, mode); } catch (e) { lost(e); return; }
      let out;
      t.oncomplete = end(() => resolve(out));
      t.onerror = () => lost(t.error || new Error('IndexedDB error'));
      t.onabort = () => lost(t.error || new Error('IndexedDB aborted'));
      try { fn(t, (v) => { out = v; }); } catch (e) { try { t.abort(); } catch (x) { /* over already */ } lost(e); }
    }));
    const real = (e) => Promise.reject(e && e.again ? e.err : e);
    return once().catch((e) => (e && e.again ? once().catch(real) : real(e)));
  }
  const dayKey = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  // What a copy holds, for the list (counted once, when it is taken).
  // days: food days, entries: foods logged in them, first / last: the dates they span.
  function summary(text) {
    const s = { days: null, entries: null, first: null, last: null };
    try {
      const o = JSON.parse(text);
      const diary = o && o.diary && typeof o.diary === 'object' && !Array.isArray(o.diary) ? o.diary : {};
      const dates = Object.keys(diary).filter((k) => Array.isArray(diary[k]) && diary[k].length).sort();
      s.days = dates.length;
      s.entries = dates.reduce((n, k) => n + diary[k].length, 0);
      if (dates.length) { s.first = dates[0]; s.last = dates[dates.length - 1]; }
    } catch (e) { /* unreadable text: counts stay unknown */ }
    return s;
  }

  // kind: 'day' (one per date, the last 7 dates kept), or 'import' | 'reset' | 'restore' | 'cloud' | 'unreadable'
  // (the latest of each kind kept). `text` is the data, or a function that gives it (called only when a copy is
  // written, so a start that already has today's copy costs nothing). `force` replaces today's daily copy.
  // Resolves to true when the copy is stored.
  function take(kind, text, force) {
    try {
      const at = Date.now();
      const id = kind === 'day' ? 'day-' + dayKey(at) : 'before-' + kind;
      return run(['meta', 'data'], 'readwrite', (t, done) => {
        const ms = t.objectStore('meta'), ds = t.objectStore('data');
        const write = () => {
          const body = typeof text === 'function' ? text() : text;
          if (typeof body !== 'string' || !body) { done(false); return; }
          ms.put(Object.assign({ id, kind, at, chars: body.length }, summary(body))); ds.put({ id, text: body });
          if (kind !== 'day') { done(true); return; }
          const r = ms.getAll();
          r.onsuccess = () => {
            const days = r.result.filter((m) => m.kind === 'day').sort((a, b) => (a.id < b.id ? 1 : -1));
            days.slice(KEEP_DAYS).forEach((m) => { ms.delete(m.id); ds.delete(m.id); });
            done(true);
          };
        };
        if (kind === 'day' && !force) {
          const g = ms.get(id);
          g.onsuccess = () => { if (g.result) done(false); else write(); };
        } else write();
      }).catch(() => false);
    } catch (e) { return Promise.resolve(false); }
  }
  // Newest first, without the text. Rejects when IndexedDB cannot be used.
  function list() {
    return run(['meta'], 'readonly', (t, done) => {
      const r = t.objectStore('meta').getAll();
      r.onsuccess = () => done(r.result.slice().sort((a, b) => b.at - a.at));
    });
  }
  function get(id) {
    return run(['meta', 'data'], 'readonly', (t, done) => {
      const m = t.objectStore('meta').get(id), d = t.objectStore('data').get(id);
      d.onsuccess = () => done(m.result && d.result ? Object.assign({}, m.result, { text: d.result.text }) : null);
    });
  }

  window.__overloadBackup = { take, list, get, KEEP_DAYS };
})();

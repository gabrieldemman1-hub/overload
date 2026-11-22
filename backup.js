/* Overload — automatic safety copies.
 * The whole saved data is copied into IndexedDB, which is separate from (and much larger than) the space the app
 * saves into: one copy a day (taken at start, and again after a workout is finished) for the last 7 days, plus the
 * latest copy taken just before an Import, a Reset, a Restore or a cloud sign-in replaced the data, the copy taken
 * at the split into two apps, and the last three taken before "Remove the old food log". Settings lists them with
 * Restore. Loaded before overload.js (app.js until 2.8, which uses it the same way): window.__overloadBackup.
 * Nothing here may break the app: every failure is swallowed and reported only as "not available".
 */
(function () {
  'use strict';
  const DB = 'overload-copies';
  const KEEP_DAYS = 7;
  const KEEP_REMOVALS = 3;  // copies taken before "Remove the old food log": each has its own, the newest three are kept
  const OPEN_WAIT = 2000;   // Safari can leave the open request unanswered: give up then, so callers fall back
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
  function run(stores, mode, fn) {
    const once = () => open().then((db) => new Promise((resolve, reject) => {
      const lost = (err) => { forget(db); reject({ again: true, err }); };
      let t;
      try { t = db.transaction(stores, mode); } catch (e) { lost(e); return; }
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => lost(t.error || new Error('IndexedDB error'));
      t.onabort = () => lost(t.error || new Error('IndexedDB aborted'));
      try { fn(t, (v) => { out = v; }); } catch (e) { try { t.abort(); } catch (x) { /* over already */ } lost(e); }
    }));
    const real = (e) => Promise.reject(e && e.again ? e.err : e);
    return once().catch((e) => (e && e.again ? once().catch(real) : real(e)));
  }
  const dayKey = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  // What a copy holds, for the list (counted once, when it is taken).
  function summary(text) {
    const s = { workouts: null, first: null, last: null, foodDays: null };
    try {
      const o = JSON.parse(text);
      const ws = (o && Array.isArray(o.workouts) ? o.workouts : []).filter((w) => w && w.finishedAt && typeof w.date === 'string');
      s.workouts = ws.length;
      if (ws.length) { const d = ws.map((w) => w.date).sort(); s.first = d[0]; s.last = d[d.length - 1]; }
      s.foodDays = o && o.diary && typeof o.diary === 'object' ? Object.keys(o.diary).length : 0;
    } catch (e) { /* unreadable text: counts stay unknown */ }
    return s;
  }
  // The id a copy is stored under. A daily copy has one per date; a removal copy one of its own, so a second
  // removal never writes over the first (the one before it may hold food the second does not).
  const idFor = (kind, at) => (kind === 'day' ? 'day-' + dayKey(at) : kind === 'foodremove' ? 'before-foodremove-' + at : 'before-' + kind);

  // kind: 'day' (one per date, the last 7 dates kept), 'foodremove' (one per removal, the last 3 kept), or
  // 'import' | 'reset' | 'restore' | 'cloud' | 'unreadable' | 'split' (the latest of each kind kept). `text` is the
  // data, or a function that gives it (called only when a copy is written, so a start that already has today's
  // copy costs nothing). `force` replaces today's daily copy. Resolves to true when the copy is stored.
  function take(kind, text, force) {
    try {
      const at = Date.now();
      const id = idFor(kind, at);
      return run(['meta', 'data'], 'readwrite', (t, done) => {
        const ms = t.objectStore('meta'), ds = t.objectStore('data');
        const write = () => {
          const body = typeof text === 'function' ? text() : text;
          if (typeof body !== 'string' || !body) { done(false); return; }
          ms.put(Object.assign({ id, kind, at, chars: body.length }, summary(body))); ds.put({ id, text: body });
          if (kind !== 'day' && kind !== 'foodremove') { done(true); return; }
          // Only so many of these are kept: the newest, by date for daily copies and by time for removal copies.
          const r = ms.getAll();
          r.onsuccess = () => {
            const mine = r.result.filter((m) => m.kind === kind);
            if (kind === 'day') mine.sort((a, b) => (a.id < b.id ? 1 : -1)); else mine.sort((a, b) => (+b.at || 0) - (+a.at || 0));
            mine.slice(kind === 'day' ? KEEP_DAYS : KEEP_REMOVALS).forEach((m) => { ms.delete(m.id); ds.delete(m.id); });
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

  window.__overloadBackup = { take, list, get, KEEP_DAYS, KEEP_REMOVALS };
})();

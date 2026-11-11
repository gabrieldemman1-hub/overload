/* Overload — automatic safety copies.
 * The whole saved data is copied into IndexedDB, which is separate from (and much larger than) the space the app
 * saves into: one copy a day (taken at start, and again after a workout is finished) for the last 7 days, plus the
 * latest copy taken just before an Import, a Reset, a Restore or a cloud sign-in replaced the data. Settings lists
 * them with Restore. Loaded before app.js; app.js uses window.__overloadBackup.
 * Nothing here may break the app: every failure is swallowed and reported only as "not available".
 */
(function () {
  'use strict';
  const DB = 'overload-copies';
  const KEEP_DAYS = 7;
  const OPEN_WAIT = 2000;   // Safari can leave the open request unanswered: give up then, so callers fall back
  let dbp = null;

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
        db.onversionchange = () => { db.close(); dbp = null; }; resolve(db);
      };
      req.onerror = () => fail(req.error || new Error('IndexedDB did not open'));
      req.onblocked = () => fail(new Error('IndexedDB is busy'));
    });
    dbp.catch(() => { dbp = null; });   // try again next time
    return dbp;
  }
  // One transaction; fn queues its requests synchronously (Safari closes a transaction left idle).
  function run(stores, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error || new Error('IndexedDB error'));
      t.onabort = () => reject(t.error || new Error('IndexedDB aborted'));
      fn(t, (v) => { out = v; });
    }));
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

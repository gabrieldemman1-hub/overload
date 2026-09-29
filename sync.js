/* Overload cloud sync (optional).
 *
 * Firebase Auth (email + password) and Firestore. The app keeps working from
 * localStorage; this module mirrors changes to the cloud and applies remote
 * changes back. Layout in Firestore:
 *
 *   users/{uid}/meta/state          { core: <json>, updatedAt }   settings, exercises, prescriptions, program, body weight, sleep, food targets and saved foods
 *   users/{uid}/workouts/{workout}  { data: <json>, updatedAt }   one document per workout
 *   users/{uid}/foodDays/{date}     { data: <json>, updatedAt }   one document per day of food log (its entries)
 *
 * Firestore's persistent cache queues writes while offline and replays them
 * when the network is back, so logging in the gym without signal is fine.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, doc, collection, getDocFromServer, getDocsFromServer, onSnapshot, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAjr58d-qecqZ8xGIjTTVtX3GFup8rHIFk',
  authDomain: 'overload-6b7e8.firebaseapp.com',
  projectId: 'overload-6b7e8',
  storageBucket: 'overload-6b7e8.firebasestorage.app',
  messagingSenderId: '552615951265',
  appId: '1:552615951265:web:c4286c7bfbaccb7149a9e0'
};

const SYNC_KEY = 'overload.sync.v1';
const CORE_KEYS = ['settings', 'exercises', 'presc', 'program', 'active', 'bodyweight', 'sleep', 'templates', 'food', 'deleted'];
const BATCH_LIMIT = 400;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });

const host = () => window.__overload;
let user = null;
let known = null;          // { uid, core: hash|null, workouts: { id: hash }, days: { date: hash } } — what the cloud is known to hold
let unsubs = [];
let pushTimer = null;
let inflight = 0;
let lastSync = null;
let lastError = '';
let linking = null;        // uid of the account whose first read is in flight
let linkTimer = null;
let linkTries = 0;

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------
// The bookkeeping keeps a short hash of each document, not a second full copy of
// the data, so it does not eat into the phone's storage for the app itself.
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'h' + (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36) + '.' + str.length.toString(36);
}
const isHash = (v) => typeof v === 'string' && /^h[0-9a-z]+\.[0-9a-z]+$/.test(v);
const toHash = (v) => (v == null || isHash(v) ? v : hash(v));
function loadKnown() {
  try {
    const k = JSON.parse(localStorage.getItem(SYNC_KEY));
    if (!k || !k.workouts) return null;
    // Older versions stored full JSON copies. Shrink them to hashes.
    k.core = toHash(k.core);
    Object.keys(k.workouts).forEach((id) => { k.workouts[id] = toHash(k.workouts[id]); });
    // Before the food log there were no days; the listener fills them in.
    if (!k.days || typeof k.days !== 'object') k.days = {};
    return k;
  } catch (e) { return null; }
}
function saveKnown() { try { known ? localStorage.setItem(SYNC_KEY, JSON.stringify(known)) : localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ } }
function coreOf(s) { const o = {}; CORE_KEYS.forEach((k) => { o[k] = s[k]; }); return o; }
function coreJson(s) { return JSON.stringify(coreOf(s)); }

function metaRef() { return doc(db, 'users', user.uid, 'meta', 'state'); }
function workoutRef(id) { return doc(db, 'users', user.uid, 'workouts', id); }
function workoutsCol() { return collection(db, 'users', user.uid, 'workouts'); }
function dayRef(date) { return doc(db, 'users', user.uid, 'foodDays', date); }
function daysCol() { return collection(db, 'users', user.uid, 'foodDays'); }
// ---------------------------------------------------------------------------
// Merging. Two phones can change the same data, and Firestore replays a phone's
// offline writes as-is when it reconnects. So lists are merged, never replaced:
// food entries by id, weigh-ins and nights by date, minus anything in the
// deletion records (state.deleted, merged too). Changes this phone has not
// uploaded yet win over the cloud's copy.
// ---------------------------------------------------------------------------
let baseCore = null;   // the core document as the cloud last held it, for telling which side changed a key
const DELETED_KINDS = ['food', 'bw', 'sleep', 'workouts'];
function mergeDeleted(a, b) {
  const out = {};
  DELETED_KINDS.forEach((k) => {
    out[k] = Object.assign({}, (a && a[k]) || {});
    Object.entries((b && b[k]) || {}).forEach(([id, t]) => { if (!(out[k][id] >= t)) out[k][id] = t; });
  });
  return out;
}
// The first list wins for a date both have.
function unionByDate(first, second, gone) {
  const by = new Map();
  (second || []).forEach((x) => by.set(x.date, x));
  (first || []).forEach((x) => by.set(x.date, x));
  return [...by.values()].filter((x) => !(gone && gone[x.date])).sort((a, b) => (a.date < b.date ? -1 : 1));
}
// Two copies of one day's food log: every entry from both, `first` winning for the same entry.
function mergeDay(first, second, gone) {
  const byId = new Map((second || []).map((e) => [e.id, e]));
  (first || []).forEach((e) => byId.set(e.id, e));
  return [...byId.values()].filter((e) => !(gone && gone[e.id])).sort((a, b) => (a.at || 0) - (b.at || 0));
}
function mergeCore(local, remote) {
  const localAhead = hash(coreJson(local)) !== known.core;
  const out = {};
  CORE_KEYS.forEach((k) => {
    // A key this phone changed and has not uploaded yet stays; otherwise the cloud's copy.
    const changedHere = localAhead && baseCore && JSON.stringify(local[k]) !== JSON.stringify(baseCore[k]);
    out[k] = changedHere || remote[k] === undefined ? local[k] : remote[k];
  });
  out.deleted = mergeDeleted(local.deleted, remote.deleted);
  out.bodyweight = localAhead ? unionByDate(local.bodyweight, remote.bodyweight, out.deleted.bw) : unionByDate(remote.bodyweight, local.bodyweight, out.deleted.bw);
  out.sleep = localAhead ? unionByDate(local.sleep, remote.sleep, out.deleted.sleep) : unionByDate(remote.sleep, local.sleep, out.deleted.sleep);
  return out;
}
// Drop anything the deletion records say is gone (after new records arrive from another phone).
function applyDeleted(st) {
  const del = st.deleted || {}; const food = del.food || {}, ws = del.workouts || {};
  const diary = {};
  Object.keys(st.diary || {}).forEach((d) => { const list = st.diary[d].filter((e) => !food[e.id]); if (list.length) diary[d] = list; });
  st.diary = diary;
  st.workouts = (st.workouts || []).filter((w) => !ws[w.id] || w.id === st.active);
  return st;
}

function report() {
  const h = host(); if (!h) return;
  let status, msg;
  if (!user) { status = 'off'; msg = ''; }
  else if (lastError) { status = 'error'; msg = lastError; }
  else if (inflight > 0) { status = navigator.onLine ? 'syncing' : 'offline'; msg = navigator.onLine ? 'Syncing…' : 'Offline, will sync later'; }
  else { status = 'synced'; msg = lastSync ? 'Synced ' + new Date(lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Synced'; }
  h.setSyncStatus(status, msg);
}

function friendly(e) {
  const code = (e && e.code) || '';
  const map = {
    'auth/invalid-email': 'That email address does not look right.',
    'auth/user-not-found': 'No account with that email. Tap Create account.',
    'auth/wrong-password': 'Wrong password.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/invalid-login-credentials': 'Wrong email or password.',
    'auth/email-already-in-use': 'That email already has an account. Tap Sign in.',
    'auth/weak-password': 'Password needs at least 6 characters.',
    'auth/missing-password': 'Enter a password.',
    'auth/network-request-failed': 'No connection. Try again when you are online.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/operation-not-allowed': 'Email/password sign-in is not enabled in Firebase yet.',
    'unavailable': 'Could not reach the cloud.',
    'permission-denied': 'Firestore rules are blocking this account. Check the rules in Firebase.'
  };
  return map[code] || (e && e.message) || 'Something went wrong.';
}

// ---------------------------------------------------------------------------
// Push: diff local state against what the cloud is known to hold
// ---------------------------------------------------------------------------
function schedulePush() {
  if (!user || !known) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1000);
}

async function push() {
  if (!user || !known) return;
  const s = host().state;
  const now = Date.now();
  const ops = [];
  const before = JSON.stringify(known);   // what the cloud held before this push, for rollback on failure

  const cj = coreJson(s), ch = hash(cj);
  if (ch !== known.core) { ops.push((b) => b.set(metaRef(), { core: cj, updatedAt: now, v: 1 })); known.core = ch; baseCore = JSON.parse(cj); }

  const seen = {};
  s.workouts.forEach((w) => {
    const j = JSON.stringify(w), h = hash(j); seen[w.id] = true;
    if (known.workouts[w.id] !== h) { ops.push((b) => b.set(workoutRef(w.id), { data: j, updatedAt: now, v: 1 })); known.workouts[w.id] = h; }
  });
  Object.keys(known.workouts).forEach((id) => {
    if (!seen[id]) { ops.push((b) => b.delete(workoutRef(id))); delete known.workouts[id]; }
  });

  const diary = s.diary || {};
  Object.keys(diary).forEach((date) => {
    const j = JSON.stringify(diary[date]), h = hash(j);
    if (known.days[date] !== h) { ops.push((b) => b.set(dayRef(date), { data: j, updatedAt: now, v: 1 })); known.days[date] = h; }
  });
  Object.keys(known.days).forEach((date) => {
    if (!diary[date]) { ops.push((b) => b.delete(dayRef(date))); delete known.days[date]; }
  });
  saveKnown();
  if (!ops.length) return;

  // If a batch is rejected (rules, quota), forget that the cloud has it so the
  // next push sends it again. Sets are idempotent, so re-sending is harmless.
  const rollback = () => { if (known && known.uid === user.uid) { known = JSON.parse(before); saveKnown(); } };
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const b = writeBatch(db);
    ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(b));
    inflight++; report();
    b.commit().then(() => { lastSync = Date.now(); lastError = ''; }, (e) => { lastError = friendly(e); rollback(); setTimeout(schedulePush, 60000); })
      .finally(() => { inflight--; report(); });
  }
}

// ---------------------------------------------------------------------------
// Pull: live listeners apply remote changes into the app
// ---------------------------------------------------------------------------
function listen() {
  stopListening();
  unsubs.push(onSnapshot(metaRef(), { includeMetadataChanges: false }, (snap) => {
    if (!snap.exists() || snap.metadata.hasPendingWrites) return;
    const remote = snap.data().core;
    if (typeof remote !== 'string' || hash(remote) === known.core) return;
    let core; try { core = JSON.parse(remote); } catch (e) { return; }
    const local = host().state;
    const next = applyDeleted(Object.assign({}, local, mergeCore(local, core)));
    known.core = hash(remote); baseCore = core; saveKnown();
    host().setState(next);
    schedulePush();   // the merge may hold something the cloud lacks; push() only sends what differs
  }, (e) => { lastError = friendly(e); report(); }));

  unsubs.push(onSnapshot(workoutsCol(), (qs) => {
    let changed = false, resurrected = false;
    const list = host().state.workouts.slice();
    qs.docChanges().forEach((ch) => {
      if (ch.doc.metadata.hasPendingWrites) return;
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        if (known.workouts[id] === undefined) return;
        const i = list.findIndex((w) => w.id === id);
        if (i >= 0) list.splice(i, 1);
        delete known.workouts[id]; changed = true;
      } else {
        const j = ch.doc.data().data;
        if (typeof j !== 'string' || known.workouts[id] === hash(j)) return;
        let w; try { w = JSON.parse(j); } catch (e) { return; }
        const del = (host().state.deleted || {}).workouts || {};
        // Deleted here but brought back by another phone's old write: the next push deletes it again.
        if (del[id] && id !== host().state.active) { known.workouts[id] = hash(j); resurrected = true; return; }
        const i = list.findIndex((x) => x.id === id);
        if (i >= 0) list[i] = w; else list.push(w);
        known.workouts[id] = hash(j); changed = true;
      }
    });
    if (resurrected) { saveKnown(); schedulePush(); }
    if (!changed) return;
    list.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    saveKnown();
    host().setState(Object.assign({}, host().state, { workouts: list }));
  }, (e) => { lastError = friendly(e); report(); }));

  unsubs.push(onSnapshot(daysCol(), (qs) => {
    let changed = false, pushBack = false;
    const diary = Object.assign({}, host().state.diary);
    const gone = ((host().state.deleted || {}).food) || {};
    qs.docChanges().forEach((ch) => {
      if (ch.doc.metadata.hasPendingWrites) return;
      const date = ch.doc.id;
      const localAhead = diary[date] && hash(JSON.stringify(diary[date])) !== known.days[date];
      if (ch.type === 'removed') {
        if (known.days[date] === undefined) return;
        delete known.days[date]; changed = true;
        // Entries logged here and not uploaded yet survive the other phone clearing the day.
        const keep = localAhead ? diary[date].filter((e) => !gone[e.id]) : [];
        if (keep.length) { diary[date] = keep; pushBack = true; } else delete diary[date];
      } else {
        const j = ch.doc.data().data;
        if (typeof j !== 'string' || known.days[date] === hash(j)) return;
        let entries; try { entries = JSON.parse(j); } catch (e) { return; }
        if (!Array.isArray(entries)) return;
        const merged = localAhead ? mergeDay(diary[date], entries, gone) : mergeDay(entries, diary[date], gone);
        if (merged.length) diary[date] = merged; else delete diary[date];
        known.days[date] = hash(j); changed = true;
        if (JSON.stringify(merged) !== j) pushBack = true;
      }
    });
    if (!changed) return;
    saveKnown();
    host().setState(Object.assign({}, host().state, { diary }));
    if (pushBack) schedulePush();
  }, (e) => { lastError = friendly(e); report(); }));
}

function stopListening() { unsubs.forEach((u) => u()); unsubs = []; }

// ---------------------------------------------------------------------------
// First link of this device to an account
// ---------------------------------------------------------------------------
async function link() {
  const h = host();
  clearTimeout(linkTimer);
  const stored = loadKnown();
  if (stored && stored.uid === user.uid) {
    known = stored;
    listen();
    schedulePush();
    report();
    return;
  }
  if (linking === user.uid) return;

  // First link: read what the account already holds, from the server itself
  // (not the offline cache). Until that read succeeds nothing is uploaded, so
  // a bad connection can never make this phone overwrite the cloud copy.
  const uid = user.uid;
  const fresh = { uid, core: null, workouts: {}, days: {} };
  linking = uid;
  inflight++; report();
  try {
    const [meta, ws, ds] = await Promise.all([getDocFromServer(metaRef()), getDocsFromServer(workoutsCol()), getDocsFromServer(daysCol())]);
    if (!user || user.uid !== uid) return;
    const local = h.state;
    const localHasHistory = local.workouts.some((w) => w.finishedAt);
    let next = JSON.parse(JSON.stringify(local));

    if (meta.exists() && typeof meta.data().core === 'string') {
      // Cloud already has data: it wins for settings and program; everything dated or with an id is merged.
      fresh.core = hash(meta.data().core);
      const cloud = JSON.parse(meta.data().core);
      baseCore = cloud;
      Object.assign(next, cloud);
      next.deleted = mergeDeleted(local.deleted, cloud.deleted);
      next.bodyweight = unionByDate(cloud.bodyweight, local.bodyweight, next.deleted.bw);
      next.sleep = unionByDate(cloud.sleep, local.sleep, next.deleted.sleep);
      // Foods saved only on this phone are kept alongside the account's.
      if (local.food && local.food.foods && next.food) next.food.foods = Object.assign({}, local.food.foods, next.food.foods || {});
      // This phone's workouts and templates use its own exercise ids: match them to the account's by name.
      next.exercises = (next.exercises || []).slice();
      next.presc = Object.assign({}, next.presc || {});
      const byName = new Map(next.exercises.map((e) => [String(e.name).toLowerCase(), e.id]));
      const idMap = {};
      const usedHere = (id) => local.workouts.some((w) => w.entries.some((en) => en.exId === id || en.swappedFrom === id));
      (local.exercises || []).forEach((e) => {
        const cid = byName.get(String(e.name).toLowerCase());
        if (cid) { if (cid !== e.id) idMap[e.id] = cid; }
        else if (usedHere(e.id)) { next.exercises.push(e); byName.set(String(e.name).toLowerCase(), e.id); if (local.presc[e.id]) next.presc[e.id] = local.presc[e.id]; }
      });
      const remap = (id) => idMap[id] || id;
      next.workouts = local.workouts.filter((w) => localHasHistory || w.id === local.active).map((w) => Object.assign({}, w, {
        entries: w.entries.map((en) => Object.assign({}, en, { exId: remap(en.exId), swappedFrom: en.swappedFrom ? remap(en.swappedFrom) : en.swappedFrom }))
      }));
      const tIds = new Set((cloud.templates || []).map((t) => t.id));
      next.templates = (cloud.templates || []).concat((local.templates || []).filter((t) => !tIds.has(t.id))
        .map((t) => Object.assign({}, t, { days: t.days.map((d) => Object.assign({}, d, { exercises: d.exercises.map(remap) })) })));
      if (local.active && next.workouts.some((w) => w.id === local.active)) next.active = local.active;
    }
    ws.forEach((d) => {
      const j = d.data().data; if (typeof j !== 'string') return;
      let w; try { w = JSON.parse(j); } catch (e) { return; }   // one broken document must not block sign-in
      fresh.workouts[d.id] = hash(j);
      const i = next.workouts.findIndex((x) => x.id === d.id);
      if (i >= 0) next.workouts[i] = w; else next.workouts.push(w);
    });
    next.workouts.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    if (next.active && !next.workouts.some((w) => w.id === next.active)) next.active = null;
    // Food days are merged entry by entry, so neither phone's log is lost.
    next.diary = Object.assign({}, local.diary || {});
    ds.forEach((d) => {
      const j = d.data().data; if (typeof j !== 'string') return;
      let entries; try { entries = JSON.parse(j); } catch (e) { return; }
      if (!Array.isArray(entries)) return;
      fresh.days[d.id] = hash(j);
      const merged = mergeDay(entries, next.diary[d.id], (next.deleted || {}).food);
      if (merged.length) next.diary[d.id] = merged; else delete next.diary[d.id];
    });

    applyDeleted(next);
    known = fresh;
    saveKnown();
    h.setState(next);
    lastError = '';
    linkTries = 0;
  } catch (e) {
    if (!user || user.uid !== uid) return;
    // Leave known unset: no listeners and no pushes until a read works.
    known = null;
    lastError = (friendly(e) || 'Could not reach the cloud.') + ' Nothing was uploaded; retrying.';
    const wait = Math.min(300, 15 * 2 ** linkTries++) * 1000;
    linkTimer = setTimeout(() => { if (user && user.uid === uid && !known) link(); }, wait);
    return;
  } finally {
    if (linking === uid) linking = null;
    inflight--; report();
  }
  if (!user || user.uid !== uid) return;
  listen();
  push();
}

// ---------------------------------------------------------------------------
// Public API used by app.js
// ---------------------------------------------------------------------------
window.__overloadSync = {
  get user() { return user ? { email: user.email, uid: user.uid } : null; },
  get lastSync() { return lastSync; },
  get error() { return lastError; },
  async signIn(email, password) {
    lastError = '';
    try { await signInWithEmailAndPassword(auth, email.trim(), password); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async createAccount(email, password) {
    lastError = '';
    try { await createUserWithEmailAndPassword(auth, email.trim(), password); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async resetPassword(email) {
    try { await sendPasswordResetEmail(auth, email.trim()); }
    catch (e) { throw new Error(friendly(e)); }
  },
  async signOut() {
    clearTimeout(pushTimer); clearTimeout(linkTimer); linkTries = 0;
    stopListening();
    known = null; saveKnown();
    lastSync = null; lastError = '';
    await signOut(auth);
  },
  pushNow() {
    clearTimeout(pushTimer);
    if (user && !known) { linkTries = 0; return link(); }
    return push();
  }
};

onAuthStateChanged(auth, (u) => {
  user = u;
  if (u) link();
  else { stopListening(); known = null; report(); }
  if (host()) host().render();
});

document.addEventListener('overload:save', schedulePush);
window.addEventListener('online', () => { report(); if (user && !known && !linking) { linkTries = 0; link(); } else schedulePush(); });
window.addEventListener('offline', report);

/* Fuel cloud sync (optional).
 *
 * Firebase Auth (email + password) and Firestore: the same project and the same account as Overload (the
 * training app, one folder up), but documents of its own. The app keeps working from localStorage; this
 * module mirrors changes to the cloud and applies remote changes back. Layout in Firestore:
 *
 *   users/{uid}/meta/fuel         { core: <json>, updatedAt, v }   units and theme, food targets, saved foods, saved meals, deletion records, the body weight
 *   users/{uid}/fuelDays/{date}   { data: <json>, updatedAt, v }   one document per day of the food log
 *
 * Overload's documents lie next to these: users/{uid}/meta/state, workouts/{id}, and foodDays/{date} (the
 * food log as versions up to 2.8 kept it; phones on those versions still read and write it). This module
 * never writes or deletes any of them and never listens to them. It reads meta/state and foodDays once, at
 * the first sign-in to an account that has no meta/fuel yet, to bring the food log across (fromOverload).
 * With documents of its own, nothing an Overload of any version does can reach Fuel's log, and nothing Fuel
 * does can change what Overload finds.
 *
 * Where both apps run in one browser storage (a computer, or Safari before Fuel is on the Home Screen) they
 * must not share a sign-in or an offline cache: the Firebase app here has a name of its own.
 *
 * Firestore's persistent cache queues writes while offline and replays them when the network is back, so
 * logging without signal is fine.
 *
 * One file, and every import is a full address: the start-up rescue in index.html runs stored scripts from
 * local copies, from where an address relative to this file could not be found.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, doc, collection, getDocFromServer, getDocsFromServer, onSnapshot, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// The same project as Overload's sync.js: one account holds both apps' data.
const firebaseConfig = {
  apiKey: 'AIzaSyAjr58d-qecqZ8xGIjTTVtX3GFup8rHIFk',
  authDomain: 'overload-6b7e8.firebaseapp.com',
  projectId: 'overload-6b7e8',
  storageBucket: 'overload-6b7e8.firebasestorage.app',
  messagingSenderId: '552615951265',
  appId: '1:552615951265:web:c4286c7bfbaccb7149a9e0'
};

const SYNC_KEY = 'fuel.sync.v1';
const STATE_KEY = 'fuel.state.v1';   // fuel.js's saved data: looked at here only to see whether there was any, when fuel.js does not say (noteTrusted)
const BATCH_LIMIT = 400;

const app = initializeApp(firebaseConfig, 'fuel');   // Overload's is the default app; this one must not be
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });

const host = () => window.__overload;
let user = null;
let known = null;          // { uid, core: hash|null, days: { date: hash } } — what the cloud is known to hold
let unsubs = [];
let pushTimer = null;
let inflight = 0;
let lastSync = null;
let lastError = '';
let linking = null;        // uid of the account whose first read is in flight
let linkTimer = null;
let linkTries = 0;
// The note in storage says what the cloud holds of THIS phone's data, and a push deletes in the cloud whatever
// the note lists and the phone no longer has. So a note is only believed when the page started on saved data.
// A page that started with none (a new phone at Welcome, or storage that lost the data but kept the note)
// has nothing the note could describe: it links as a new phone, which downloads and deletes nothing. From
// that link on, the note is this session's own.
// fuel.js says whether the page started on saved data (it looked before anything could be tapped, and it
// removes the note itself when there was none). This module runs only once its three imports have arrived,
// which can take seconds: by then Start fresh may have saved an empty diary, so the storage seen from here
// would say "saved data" and the old note would be believed. The storage is looked at only when fuel.js does
// not say (an older fuel.js).
let noteTrusted = false;
try {
  const h = window.__overload;
  noteTrusted = h && typeof h.startedWithData === 'boolean' ? h.startedWithData : localStorage.getItem(STATE_KEY) !== null;
} catch (e) { noteTrusted = false; }

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const obj = (x) => (isObj(x) ? x : {});
// Ids are looked up as an object's own keys only: "constructor" and the like are on every object.
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// A day of the food log is named by its date. Nothing else is ever made into a document address: an empty
// name or one with a "/" makes Firestore refuse the whole upload it is part of.
const isDay = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
const defined = (o) => { const out = {}; Object.keys(o).forEach((k) => { if (o[k] !== undefined) out[k] = o[k]; }); return out; };

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
// The stored note, or null. Whatever in it is not what this file writes is left out: a day it does not list
// is simply sent again, which is always safe.
function loadKnown() {
  try {
    const k = JSON.parse(localStorage.getItem(SYNC_KEY));
    if (!isObj(k) || typeof k.uid !== 'string' || !k.uid) return null;
    const days = {};
    Object.keys(obj(k.days)).forEach((d) => { if (isDay(d) && typeof k.days[d] === 'string') days[d] = k.days[d]; });
    k.days = days;
    if (typeof k.core !== 'string') k.core = null;
    return k;
  } catch (e) { return null; }
}
// While the app cannot save its own data, this phone's saved copy falls behind what was sent to the cloud.
// Writing down that the cloud has it would make the next start delete or overwrite it there; without
// the note, the next start takes the cloud's newer copies back. Forgetting (known = null) is always safe.
function saveKnown() {
  const h = host();
  if (known && h && h.saveFailed) return;
  try { known ? localStorage.setItem(SYNC_KEY, JSON.stringify(known)) : localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ }
}
// Cloud documents are parsed without keys that would change how objects behave (__proto__ and the like).
const parse = (t) => JSON.parse(t, (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v));

// Fuel's own documents: the only ones this file writes, deletes or listens to.
function metaRef() { return doc(db, 'users', user.uid, 'meta', 'fuel'); }
function dayRef(date) { return doc(db, 'users', user.uid, 'fuelDays', date); }
function daysCol() { return collection(db, 'users', user.uid, 'fuelDays'); }
// Overload's documents. For the two server reads of the first sign-in (see link) and for nothing else:
// never hand these to a batch or a listener. A write to meta/state would replace the training app's
// settings and program on every phone.
function overloadMetaRef() { return doc(db, 'users', user.uid, 'meta', 'state'); }
function overloadDaysCol() { return collection(db, 'users', user.uid, 'foodDays'); }

// The core as it is sent: only what is named here, and always in the same order (saved foods, saved meals
// and deletion records by id). Two phones that hold the same things then send the same text, whatever order
// they got them in; a different order would look like a change and they would re-send it to each other
// forever. From settings only units and theme are ever sent or taken: nothing else belongs in this
// document (Overload's settings hold the key to its connector, which is a secret).
const sorted = (o) => { const out = {}; Object.keys(obj(o)).sort().forEach((k) => { out[k] = o[k]; }); return out; };
function coreOf(s) {
  const settings = obj(s.settings), food = obj(s.food), targets = obj(food.targets), gone = obj(s.deleted);
  return {
    settings: { units: settings.units, theme: settings.theme },
    food: { targets: { kcal: targets.kcal, protein: targets.protein, carbs: targets.carbs, fat: targets.fat }, foods: sorted(food.foods), meals: sorted(food.meals) },
    deleted: { food: sorted(gone.food), foods: sorted(gone.foods), meals: sorted(gone.meals) },
    bodyweight: Array.isArray(s.bodyweight) ? s.bodyweight : []
  };
}
function coreJson(s) { return JSON.stringify(coreOf(s)); }

// ---------------------------------------------------------------------------
// Merging. Two phones can change the same data, and Firestore replays a phone's
// offline writes as-is when it reconnects. So lists are merged, never replaced:
// food entries, saved foods and saved meals by id, minus anything in the deletion
// records (state.deleted, merged too, and never pruned). Changes this phone has
// not uploaded yet win over the cloud's copy.
// ---------------------------------------------------------------------------
let baseCore = null;   // the core document as the cloud last held it, for telling which side changed something
const DELETED_KINDS = ['food', 'foods', 'meals'];   // entries, saved foods, saved meals
// Every record of both sides; the later time wins for an id both have.
function mergeDeleted(a, b) {
  const out = {};
  DELETED_KINDS.forEach((k) => {
    const m = Object.assign({}, obj(obj(a)[k])), theirs = obj(obj(b)[k]);
    Object.keys(theirs).forEach((id) => { if (!(has(m, id) && m[id] >= theirs[id])) m[id] = theirs[id]; });
    out[k] = m;
  });
  return out;
}
// An entry can be merged only by its id. The app gives every entry one when it loads, so only a hand-made
// document can hold one without.
const hasId = (e) => isObj(e) && typeof e.id === 'string' && !!e.id;
// The entries of a list from the cloud that can be merged. (A number as id is taken as text, as the app does.)
function usable(list) {
  return (Array.isArray(list) ? list : []).map((e) => (isObj(e) && typeof e.id === 'number' ? Object.assign({}, e, { id: String(e.id) }) : e)).filter(hasId);
}
const timeOf = (e) => (typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : 0);
// Two copies of one day's food log: every entry from both, `first` winning for the same entry. In the order
// of their times, and by id where two times are equal, so every phone ends with the same text for the same entries.
function mergeDay(first, second, gone) {
  const byId = new Map();
  usable(second).forEach((e) => byId.set(e.id, e));
  usable(first).forEach((e) => byId.set(e.id, e));
  return [...byId.values()].filter((e) => !(gone && has(gone, e.id)))
    .sort((a, b) => timeOf(a) - timeOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
// Saved foods (or saved meals) against their deletion records, after two sides were put together: a thing
// and a record for the same id cannot both stand. The record wins, so that a phone's old copy cannot bring
// a deleted food back. One exception: a food's id can be used again (the same barcode typed in again, or a
// listed product logged again after his corrected copy of it was deleted), and fuel.js then drops the record
// on that phone. For the other phones to follow, a thing used after it was deleted counts as back: its
// record goes. Both arguments are changed in place.
function settle(things, gone) {
  Object.keys(things).forEach((id) => {
    if (!has(gone, id)) return;
    if (isObj(things[id]) && things[id].used > gone[id]) delete gone[id]; else delete things[id];
  });
}
// What a core from the cloud changes on this phone: the parts of the state to lay over it.
function mergeCore(local, remote) {
  const mine = coreOf(local), theirs = coreOf(remote), was = baseCore ? coreOf(baseCore) : null;
  const localAhead = hash(JSON.stringify(mine)) !== known.core;
  // Did this phone change it and not upload it yet? Only the core the cloud last held can tell; without it
  // (it is not known for a moment after a start) the cloud's copy is taken.
  const changedHere = (pick) => localAhead && !!was && JSON.stringify(pick(mine)) !== JSON.stringify(pick(was));
  const out = { settings: local.settings, food: Object.assign({}, local.food), bodyweight: local.bodyweight };
  // Units, theme and the body weight go together: the weight is a number in those units.
  if (!changedHere((c) => [c.settings, c.bodyweight])) {
    out.settings = Object.assign({}, local.settings, defined(theirs.settings));
    if (Array.isArray(remote.bodyweight)) out.bodyweight = remote.bodyweight;
  }
  if (!changedHere((c) => c.food.targets) && isObj(obj(remote.food).targets)) out.food.targets = Object.assign({}, obj(local.food).targets, defined(theirs.food.targets));
  out.deleted = Object.assign({}, local.deleted, mergeDeleted(mine.deleted, theirs.deleted));
  // Saved foods and saved meals: everything either side has. For an id both have, this phone's copy stays
  // when it has something to upload and that thing changed here (or, with no way to tell, may have).
  ['foods', 'meals'].forEach((kind) => {
    const here = mine.food[kind], there = theirs.food[kind], all = Object.assign({}, here, there);
    Object.keys(here).forEach((id) => {
      if (!has(there, id) || (localAhead && (!was || JSON.stringify(here[id]) !== JSON.stringify(was.food[kind][id])))) all[id] = here[id];
    });
    settle(all, out.deleted[kind]);
    out.food[kind] = all;
  });
  return out;
}
// Drop the entries the deletion records say are gone (after new records arrive from another phone).
function applyDeleted(st) {
  const gone = obj(obj(st.deleted).food), diary = {};
  Object.keys(obj(st.diary)).forEach((d) => {
    const list = Array.isArray(st.diary[d]) ? st.diary[d].filter((e) => !(isObj(e) && has(gone, e.id))) : [];
    if (list.length) diary[d] = list;
  });
  st.diary = diary;
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
  const h = host();
  if (!user || !known || !h || h.unreadable) return;
  const s = h.state;
  const now = Date.now();
  const ops = [];
  const before = JSON.stringify(known);   // what the cloud held before this push, for rollback on failure

  const cj = coreJson(s), ch = hash(cj);
  if (ch !== known.core) { const ref = metaRef(); ops.push((b) => b.set(ref, { core: cj, updatedAt: now, v: 1 })); known.core = ch; baseCore = JSON.parse(cj); }

  // Days. Each document's address is made here, before the note is saved, and only from a name that is a
  // date: a name Firestore refuses would otherwise stop the upload after the note already says "sent".
  const diary = obj(s.diary), here = {};
  Object.keys(diary).forEach((date) => {
    const list = diary[date];
    if (!isDay(date) || !Array.isArray(list) || !list.length) return;   // not a day of the food log: nothing to send
    here[date] = true;
    // Every entry needs an id: other phones merge a day entry by entry, and entries without one would all
    // become one there. Such a day waits on this phone (the app gives ids at every start) and is not deleted
    // in the cloud meanwhile.
    if (!list.every(hasId)) return;
    const j = JSON.stringify(list), dh = hash(j);
    if (known.days[date] !== dh) { const ref = dayRef(date); ops.push((b) => b.set(ref, { data: j, updatedAt: now, v: 1 })); known.days[date] = dh; }
  });
  // A day the cloud holds and this phone no longer has: he removed its last entry, or reset or restored.
  Object.keys(known.days).forEach((date) => {
    if (here[date]) return;
    if (isDay(date)) { const ref = dayRef(date); ops.push((b) => b.delete(ref)); }
    delete known.days[date];
  });
  saveKnown();
  if (!ops.length) return;

  // If a batch is rejected (rules, quota), forget that the cloud has it so the
  // next push sends it again. Sets are idempotent, so re-sending is harmless.
  const rollback = () => { if (known && user && known.uid === user.uid) { known = JSON.parse(before); saveKnown(); } };
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
    if (typeof remote !== 'string') return;
    let core; try { core = parse(remote); } catch (e) { return; }
    if (!isObj(core)) return;
    // The core the note describes (after a start it comes from the offline cache first): nothing to take,
    // but from here on it can tell which parts this phone has changed since.
    if (hash(remote) === known.core) { baseCore = core; return; }
    const local = host().state;
    const next = applyDeleted(Object.assign({}, local, mergeCore(local, core)));
    known.core = hash(remote); baseCore = core;
    host().setState(next); saveKnown();   // after the app's own save, so a failed save is known
    schedulePush();   // the merge may hold something the cloud lacks; push() only sends what differs
  }, (e) => { lastError = friendly(e); report(); }));

  unsubs.push(onSnapshot(daysCol(), (qs) => {
    let changed = false, pushBack = false;
    const diary = Object.assign({}, host().state.diary);
    const gone = obj(obj(host().state.deleted).food);
    qs.docChanges().forEach((ch) => {
      if (ch.doc.metadata.hasPendingWrites) return;
      const date = ch.doc.id;
      if (!isDay(date)) return;   // not a day of the food log
      const mine = Array.isArray(diary[date]) ? diary[date] : null;
      const localAhead = !!mine && hash(JSON.stringify(mine)) !== known.days[date];
      if (ch.type === 'removed') {
        if (known.days[date] === undefined) return;
        delete known.days[date]; changed = true;
        // A day leaves this phone only through deletion records, never because its document vanished.
        // When another phone removes a day's last entry, the records arrive with it (the core, in the same
        // upload) and the day goes. A document deleted any other way (a reset elsewhere, a mistake in the
        // console) cannot empty the log: what is not recorded as deleted stays, and is uploaded again.
        const keep = (mine || []).filter((e) => !(isObj(e) && has(gone, e.id)));
        if (keep.length) { diary[date] = keep; pushBack = true; } else delete diary[date];
      } else {
        const j = ch.doc.data().data;
        if (typeof j !== 'string' || known.days[date] === hash(j)) return;
        let entries; try { entries = parse(j); } catch (e) { return; }
        if (!Array.isArray(entries)) return;
        const merged = localAhead ? mergeDay(mine, entries, gone) : mergeDay(entries, mine, gone);
        if (merged.length) diary[date] = merged; else delete diary[date];
        known.days[date] = hash(j); changed = true;
        if (JSON.stringify(merged) !== j) pushBack = true;
      }
    });
    if (!changed) return;
    host().setState(Object.assign({}, host().state, { diary }));
    saveKnown();
    if (pushBack) schedulePush();
  }, (e) => { lastError = friendly(e); report(); }));
  // No listener on anything of Overload's: its documents are read once, in link(), and never again.
}

function stopListening() { unsubs.forEach((u) => u()); unsubs = []; }

// ---------------------------------------------------------------------------
// First link of this device to an account
// ---------------------------------------------------------------------------
const hasTargets = (t) => ['kcal', 'protein', 'carbs', 'fat'].some((k) => obj(t)[k] > 0);
// Does this phone hold no food of its own yet (a new phone, or one still at Welcome)?
function isEmpty(s) {
  const food = obj(s.food);
  return !Object.keys(obj(s.diary)).length && !Object.keys(obj(food.foods)).length && !Object.keys(obj(food.meals)).length
    && !hasTargets(food.targets) && !(Array.isArray(s.bodyweight) && s.bodyweight.length);
}
// A body weight is a number in the units of where it comes from (183.6 lb is 83.3 kg; fuel.js converts the same way).
const unitsOf = (settings) => (obj(settings).units === 'kg' ? 'kg' : 'lb');
const inUnits = (w, from, to) => (from === to ? w : Math.round((to === 'kg' ? w / 2.20462 : w * 2.20462) * 10) / 10);

// The account already holds Fuel's own core (another phone, or this one before a reset): its units, theme and
// targets win; saved foods, saved meals and deletion records of both sides are put together, the account's
// copy winning for an id both have. `next` is a copy of this phone's state and is changed in place.
function takeCore(next, cloud) {
  const mine = coreOf(next), theirs = coreOf(cloud), units = unitsOf(next.settings);
  next.settings = Object.assign({}, next.settings, defined(theirs.settings));
  if (theirs.bodyweight.length) next.bodyweight = theirs.bodyweight;
  else next.bodyweight = mine.bodyweight.map((b) => (isObj(b) ? Object.assign({}, b, { weight: inUnits(b.weight, units, unitsOf(next.settings)) }) : b));
  if (hasTargets(theirs.food.targets)) next.food.targets = Object.assign({}, next.food.targets, defined(theirs.food.targets));   // else the phone's stay
  next.deleted = Object.assign({}, next.deleted, mergeDeleted(mine.deleted, theirs.deleted));
  ['foods', 'meals'].forEach((kind) => {
    next.food[kind] = Object.assign({}, mine.food[kind], theirs.food[kind]);
    settle(next.food[kind], next.deleted[kind]);
  });
}

// The account holds nothing of Fuel's yet: what Overload keeps there, read once and only read. From its core
// document only the food part is taken, by name: targets, saved foods, saved meals, the deletion records of
// food entries, units, theme, and the latest weigh-in. Never its settings as a whole (the connector's key
// is in them), never anything about training.
function fromOverload(meta, days) {
  let core = {};
  if (meta.exists() && typeof meta.data().core === 'string') { try { core = obj(parse(meta.data().core)); } catch (e) { core = {}; } }
  const food = obj(core.food), settings = obj(core.settings);
  const weighed = (Array.isArray(core.bodyweight) ? core.bodyweight : []).filter((b) => isObj(b) && isDay(b.date) && b.weight > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = weighed[weighed.length - 1];
  const out = {
    units: settings.units, theme: settings.theme,
    targets: obj(food.targets), foods: obj(food.foods), meals: obj(food.meals), gone: obj(obj(core.deleted).food),
    weight: last ? { date: last.date, weight: last.weight } : null,
    days: {}, entries: 0
  };
  days.forEach((d) => {
    const j = d.data().data;
    if (!isDay(d.id) || typeof j !== 'string') return;
    let entries; try { entries = parse(j); } catch (e) { return; }   // one broken document must not block sign-in
    entries = usable(entries);
    if (entries.length) { out.days[d.id] = entries; out.entries += entries.length; }
  });
  return out;
}
// Overload's food log into this phone's state, exactly as an import does it (fuel.js): it only adds.
// What the phone holds wins for an id both have; what was deleted on the phone stays deleted; targets and
// body weight are taken only when the phone has none. Returns whether Overload's copy held any food.
// The same entries arriving here and by Copy my food log, in either order, end as one copy: they carry
// the same ids.
function addFromOverload(next, from) {
  const food = next.food, gone = next.deleted;
  // A phone with no food of its own takes Overload's units and theme too, as an import at Welcome does.
  if (isEmpty(next)) {
    if (from.units === 'lb' || from.units === 'kg') next.settings.units = from.units;
    if (['system', 'dark', 'light'].includes(from.theme)) next.settings.theme = from.theme;
  }
  if (!hasTargets(food.targets) && hasTargets(from.targets)) ['kcal', 'protein', 'carbs', 'fat'].forEach((k) => { food.targets[k] = from.targets[k] === undefined ? null : from.targets[k]; });
  ['foods', 'meals'].forEach((kind) => {
    Object.keys(from[kind]).forEach((id) => { if (!has(food[kind], id) && !has(gone[kind], id)) food[kind][id] = from[kind][id]; });
  });
  const held = new Set();
  Object.keys(next.diary).forEach((d) => next.diary[d].forEach((e) => held.add(e.id)));
  Object.keys(from.days).forEach((date) => {
    // Not what the phone holds, not what was deleted on the phone, not what Overload itself recorded as deleted.
    const add = from.days[date].filter((e) => !held.has(e.id) && !has(gone.food, e.id) && !has(from.gone, e.id));
    add.forEach((e) => held.add(e.id));
    if (add.length) next.diary[date] = mergeDay(next.diary[date], add, null);   // a day nothing is added to stays exactly as it is
  });
  // Overload's deletion records come along, so that another copy of its log cannot bring those entries back
  // later. Except for an entry this phone holds: that one stays, so it must not be marked as deleted.
  Object.keys(from.gone).forEach((id) => { if (!held.has(id) && !has(gone.food, id)) gone.food[id] = from.gone[id]; });
  if (!next.bodyweight.length && from.weight) {
    next.bodyweight = [{ date: from.weight.date, weight: inUnits(from.weight.weight, unitsOf({ units: from.units }), unitsOf(next.settings)) }];
  }
  const days = Object.keys(from.days).length;
  // The note Settings shows under "From Overload" (fuel.js keeps the same one after an import). Only when
  // the account held food days: an account without them (cloud sync was turned on in Overload after 2.8)
  // has brought no log across, and Settings should go on offering Copy my food log.
  if (days && !next.moved) next.moved = { from: 'Overload account', at: Date.now(), days, entries: from.entries, madeAt: null };
  return !!(days || Object.keys(from.foods).length || Object.keys(from.meals).length);
}

async function link() {
  const h = host();
  clearTimeout(linkTimer);
  if (!h || h.unreadable) return;   // the app could not read its saved data (or waits at Add to Home Screen): nothing syncs until he chooses what to do
  // Not on a page that started without saved data (see noteTrusted): with a note left in storage, the push
  // below would take "not here" for "deleted here" and empty the account. Without the note the account's
  // copy comes down first.
  const stored = noteTrusted ? loadKnown() : null;
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
  const fresh = { uid, core: null, days: {} };
  baseCore = null;   // what was known of another account's core says nothing about this one's
  linking = uid;
  inflight++; report();
  try {
    const [meta, ds] = await Promise.all([getDocFromServer(metaRef()), getDocsFromServer(daysCol())]);
    if (!user || user.uid !== uid) return;
    // No meta/fuel: Fuel has never written to this account. Then, and only then, Overload's copy is read.
    let overload = null;
    if (!meta.exists()) {
      const [om, od] = await Promise.all([getDocFromServer(overloadMetaRef()), getDocsFromServer(overloadDaysCol())]);
      if (!user || user.uid !== uid) return;
      overload = fromOverload(om, od);
    }
    const local = h.state;
    const next = JSON.parse(JSON.stringify(local));
    let brought = false;   // did the account hold anything that is merged into this phone's data

    if (meta.exists() && typeof meta.data().core === 'string') {
      let cloud = null; try { cloud = parse(meta.data().core); } catch (e) { cloud = null; }
      if (isObj(cloud)) { fresh.core = hash(meta.data().core); baseCore = cloud; takeCore(next, cloud); brought = true; }
    }
    // Fuel's own days are merged entry by entry, the account's copy winning for the same entry, so neither
    // side's log is lost.
    ds.forEach((d) => {
      const j = d.data().data;
      if (!isDay(d.id) || typeof j !== 'string') return;
      let entries; try { entries = parse(j); } catch (e) { return; }   // one broken document must not block sign-in
      if (!Array.isArray(entries)) return;
      fresh.days[d.id] = hash(j);
      const merged = mergeDay(entries, next.diary[d.id], next.deleted.food);
      if (merged.length) next.diary[d.id] = merged; else delete next.diary[d.id];
      brought = true;
    });
    if (overload) brought = addFromOverload(next, overload) || brought;
    applyDeleted(next);
    // What is on this phone is about to change: keep a copy of it first. (Not of a phone that holds nothing:
    // that would replace an earlier copy, which may be the one he needs.)
    if (brought && !isEmpty(local) && h.safetyCopy) h.safetyCopy('cloud');
    known = fresh;
    h.setState(next);
    saveKnown();
    noteTrusted = true;
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
  push();   // whatever the merge holds and the account does not: on an account new to Fuel, meta/fuel and every day
}

// ---------------------------------------------------------------------------
// Public API used by fuel.js
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
    // The stored note of what the cloud holds is kept (it names the account): signing back in to the same
    // account then sends the changes made in between instead of taking the cloud's older copy.
    // fuel.js removes it when Reset or Restore runs while signed out.
    known = null;
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
  const h = host();
  if (h) { if (h.syncChanged) h.syncChanged(); else h.render(); }   // only the sync parts, not the whole screen
});

document.addEventListener('overload:save', schedulePush);
window.addEventListener('online', () => { report(); if (user && !known && !linking) { linkTries = 0; link(); } else schedulePush(); });
window.addEventListener('offline', report);

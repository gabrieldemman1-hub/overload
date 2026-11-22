/* Overload cloud sync (optional).
 *
 * Firebase Auth (email + password) and Firestore. The app keeps working from
 * localStorage; this module mirrors changes to the cloud and applies remote
 * changes back. Layout in Firestore:
 *
 *   users/{uid}/meta/state          { core: <json>, updatedAt, v }   settings, exercises, prescriptions, program, body weight, sleep, templates, deletion records; plus the food part (below)
 *   users/{uid}/workouts/{workout}  { data: <json>, updatedAt, v }   one document per workout
 *   users/{uid}/foodDays/{date}     the food log as versions up to 2.8 kept it. Never read, written or deleted here.
 *
 * Food moved to the diet app in 3.0. This module no longer syncs food in either direction:
 *   - the food part of meta/state (food targets, saved foods and meals, and the food deletion records) is sent
 *     back exactly as the cloud already holds it, whatever this phone's own old food copy looks like;
 *   - nothing from the cloud is merged into the old food copy on this phone (state.food, state.diary,
 *     state.deleted.food);
 *   - foodDays is left alone, so phones still on 2.8 and the diet app's first sign-in find it as 2.8 left it.
 * Versions up to 2.8 can run again on the same data (a roll-back, or the old files during an update), so the
 * note in localStorage (overload.sync.v1) keeps their meaning.
 *
 * Firestore's persistent cache queues writes while offline and replays them
 * when the network is back, so logging in the gym without signal is fine.
 * The core is one document, replaced whole, so it is the exception: it is sent only when this phone changed
 * something in it, and the first one of a session only once the server's own core has been taken in (see push).
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
const TRAIN_KEYS = CORE_KEYS.filter((k) => k !== 'food' && k !== 'deleted');   // compared one by one (see partsOf)
const RECORD_DAYS = 90;   // overload.js (normalize) drops deletion records older than this at every start
const BATCH_LIMIT = 400;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });

const host = () => window.__overload;
let user = null;
let known = null;          // { uid, core: hash|null, workouts: { id: hash }, days: { date: hash }, parts } — what the cloud is known to hold
                           // (days: the food days as a version up to 2.8 noted them; this version only ever removes from it, see forgetDays;
                           // parts: the noted core in more detail, see partsOf)
let unsubs = [];
let pushTimer = null;
let inflight = 0;
let lastSync = null;
let lastError = '';
let linking = null;        // uid of the account whose first read is in flight
let linkTimer = null;
let linkTries = 0;
let serverSeen = false;    // the server's own core has been taken in during this session (see readServerCore)
let coreHeld = false;      // this phone's core waits for that
let reading = false;       // the read of readServerCore is in flight
let readTimer = null;
let readTries = 0;
let linkGen = 0;           // goes up at every link and sign-out: an answer that arrives for an earlier one is dropped

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
    // A note from before the food log has no days. Nothing here adds any: food days are not synced any more.
    if (!k.days || typeof k.days !== 'object') k.days = {};
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
// Food moved to the diet app. This app no longer reads or changes food, on the phone or in the cloud:
// the core document is sent with the food part the cloud already holds, and foodDays is never touched.
let cloudFood;   // undefined: the cloud's core not seen yet in this session; null: the account has no core; else its food part
const foodPart = (core) => ({ food: core.food, del: core.deleted && core.deleted.food });
// The core as it is sent. Once the cloud's food part is known it replaces this phone's (the old food copy here
// can be older, emptied by a reset or removed on purpose: none of that may reach the account). Only an account
// with no core at all gets this phone's own food part, with its first upload. fp: another food part to use.
function coreOf(s, fp) {
  if (fp === undefined) fp = cloudFood;
  const o = {}; CORE_KEYS.forEach((k) => { o[k] = s[k]; });
  if (fp) { o.food = fp.food; o.deleted = Object.assign({}, s.deleted, { food: fp.del }); }
  return o;
}
function coreJson(s, fp) { return JSON.stringify(coreOf(s, fp)); }

// The note's `core` is one hash of the whole core text. Beside it the note keeps `parts`, worked out from the same
// text: a hash of each training key, one of the food part, and the training deletion records themselves (weigh-ins,
// nights and workouts deleted in the last 90 days: a few small entries). With them this phone can tell, also after
// a restart and without the offline cache, what it changed itself since that core:
//   - which keys (a merge keeps those and takes the cloud's for the rest);
//   - whether anything at all, leaving out its old food copy (frozen here, so it differs from the account's food
//     part as soon as a phone on 2.8 logs a food) and deletion records past their 90 days (the app drops those at
//     every start; that changes no data, and must not send this phone's whole core over newer ones).
// Versions up to 2.8 keep a field of the note they do not know and leave it as it is. When one of them sends or
// takes a core, `known.core` changes and `parts.core` no longer names it: the parts are then not used (notedParts).
const textOf = (v) => (v === undefined ? '' : JSON.stringify(v));
function partsOf(core, coreHash) {
  const keys = {}; TRAIN_KEYS.forEach((k) => { keys[k] = hash(textOf(core[k])); });
  const del = {}, d = core.deleted && typeof core.deleted === 'object' ? core.deleted : {};
  Object.keys(d).forEach((k) => { if (k !== 'food' && d[k] && typeof d[k] === 'object') del[k] = Object.assign({}, d[k]); });
  return { core: coreHash, keys, food: hash(textOf(foodPart(core))), del };
}
function notedParts() {
  const p = known && known.parts;
  if (!p || typeof p !== 'object' || !isHash(known.core) || p.core !== known.core) return null;
  if (!p.keys || typeof p.keys !== 'object' || !isHash(p.food) || !p.del || typeof p.del !== 'object') return null;
  return TRAIN_KEYS.every((k) => isHash(p.keys[k])) ? p : null;
}
// The deletion records of one kind that are still kept, in one text: the same rule as normalize in overload.js.
function liveRecords(m, cutoff) {
  const o = m && typeof m === 'object' ? m : {};
  return JSON.stringify(Object.keys(o).filter((id) => o[id] > cutoff).sort().map((id) => [id, o[id]]));
}
// Does this phone's core hold something the noted core does not? With a note from a version up to 2.8 (no parts),
// the whole text is compared, as there.
function coreAhead(s) {
  const p = notedParts();
  if (!p) return hash(coreJson(s)) !== known.core;
  const c = coreOf(s);
  if (TRAIN_KEYS.some((k) => hash(textOf(c[k])) !== p.keys[k])) return true;
  if (hash(textOf(foodPart(c))) !== p.food) return true;   // the cloud's food part as sent from here: the noted one
  const cutoff = Date.now() - RECORD_DAYS * 864e5, mine = c.deleted && typeof c.deleted === 'object' ? c.deleted : {};
  return Object.keys(Object.assign({}, mine, p.del)).some((k) => k !== 'food' && liveRecords(mine[k], cutoff) !== liveRecords(p.del[k], cutoff));
}

function metaRef() { return doc(db, 'users', user.uid, 'meta', 'state'); }
function workoutRef(id) { return doc(db, 'users', user.uid, 'workouts', id); }
function workoutsCol() { return collection(db, 'users', user.uid, 'workouts'); }

// Food days. Versions up to 2.8 kept the food log in foodDays and noted every day in known.days; their push
// deletes in the cloud every day the note lists and the phone no longer has. This version sends nothing there.
// It only forgets: a day that is gone from this phone leaves the note, so an older version started on this
// data again can never delete it in the cloud (it downloads the day instead). Days the phone still has stay
// noted exactly as the older version wrote them, so that version finds nothing to upload either.
function forgetDays(note, diary) {
  let changed = false;
  Object.keys(note.days).forEach((date) => { if (!diary[date]) { delete note.days[date]; changed = true; } });
  return changed;
}
// Done at every save of the app, signed in or not (signed out, the note waits in storage for the next sign-in),
// and not left to the push a second later: the app can be closed in between.
function forgetDaysNow() {
  const h = host();
  if (!h || h.unreadable || h.saveFailed) return;   // not saved: the stored data still has its days, and the stored note belongs to it
  const note = known || loadKnown();
  if (!note || !forgetDays(note, h.state.diary || {})) return;
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(note)); } catch (e) { /* ignore */ }
}
// ---------------------------------------------------------------------------
// Merging. Two phones can change the same data, and Firestore replays a phone's
// offline writes as-is when it reconnects. So lists are merged, never replaced:
// weigh-ins and nights by date, minus anything in the deletion records
// (state.deleted, merged too). Changes this phone has not uploaded yet win over
// the cloud's copy. Food is not merged at all: this phone's old food copy and the
// cloud's food part each stay as they are.
// ---------------------------------------------------------------------------
let baseCore = null;   // the core document as the cloud last held it, for telling which side changed a key
// 'food' stays in this list only so that the four kinds keep their order in the text every phone writes.
// Both callers put this phone's own food records back over the merged ones.
const DELETED_KINDS = ['food', 'bw', 'sleep', 'workouts'];
function mergeDeleted(a, b) {
  const out = {};
  DELETED_KINDS.forEach((k) => {
    const m = Object.assign({}, (a && a[k]) || {});
    Object.entries((b && b[k]) || {}).forEach(([id, t]) => { if (!(m[id] >= t)) m[id] = t; });
    // Same order on every phone, so two phones holding the same records upload the same text
    // (a different order would look like a change and they would re-send it to each other forever).
    out[k] = {}; Object.keys(m).sort().forEach((id) => { out[k][id] = m[id]; });
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
// The result has no `food` key: the caller lays it over the state, whose own food stays.
function mergeCore(local, remote) {
  // Which keys did this phone change since the noted core? With the note's parts, each key against its hash: the old
  // food copy and the deletion records do not count, and it holds after a restart too. Without them (a note from a
  // version up to 2.8): only while the whole core differs from the note, and only for keys that differ from the
  // cloud's core as last seen in this session (none after a restart: the cloud's then wins every key). While the
  // cloud's food part is not known yet, the remote's stands in for it, as this phone's own is never sent.
  const p = notedParts();
  const ahead = !p && hash(coreJson(local, cloudFood !== undefined ? cloudFood : foodPart(remote))) !== known.core;
  const mine = p ? (k) => hash(textOf(local[k])) !== p.keys[k]
    : (k) => ahead && !!baseCore && JSON.stringify(local[k]) !== JSON.stringify(baseCore[k]);
  const out = {};
  CORE_KEYS.forEach((k) => {
    if (k === 'food' || k === 'deleted') return;   // the cloud's food part is never taken into the old food copy; deleted: below
    // A key this phone changed and has not uploaded yet stays; otherwise the cloud's copy.
    out[k] = mine(k) || remote[k] === undefined ? local[k] : remote[k];
  });
  out.deleted = mergeDeleted(local.deleted, remote.deleted);
  out.deleted.food = (local.deleted && local.deleted.food) || {};   // nor are its food deletion records
  // Weigh-ins and nights: both lists, by date. For a date both have, this phone's entry wins only if it changed this list.
  const first = (k) => (p ? mine(k) : ahead);
  out.bodyweight = first('bodyweight') ? unionByDate(local.bodyweight, remote.bodyweight, out.deleted.bw) : unionByDate(remote.bodyweight, local.bodyweight, out.deleted.bw);
  out.sleep = first('sleep') ? unionByDate(local.sleep, remote.sleep, out.deleted.sleep) : unionByDate(remote.sleep, local.sleep, out.deleted.sleep);
  return out;
}
// Drop the workouts the deletion records say are gone (after new records arrive from another phone).
// The food log is not filtered: a food deletion record must not remove entries from the old food copy.
function applyDeleted(st) {
  const ws = (st.deleted || {}).workouts || {};
  st.workouts = (st.workouts || []).filter((w) => !ws[w.id] || w.id === st.active);
  return st;
}

function report() {
  const h = host(); if (!h) return;
  let status, msg;
  if (!user) { status = 'off'; msg = ''; }
  else if (lastError) { status = 'error'; msg = lastError; }
  else if (inflight > 0 || coreHeld) { status = navigator.onLine ? 'syncing' : 'offline'; msg = navigator.onLine ? 'Syncing…' : 'Offline, will sync later'; }
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
  if (!user || !known || host().unreadable) return;
  const s = host().state;
  const now = Date.now();
  const ops = [];
  // Food days: nothing is sent, and a day that is gone from this phone is only forgotten (see forgetDays).
  // Before the copy for rollback is taken, so that a rejected batch cannot put a forgotten day back in the note.
  forgetDays(known, s.diary || {});
  const before = JSON.stringify(known);   // what the cloud held before this push, for rollback on failure

  // The core goes only once the cloud's own core has been seen in this session (cloudFood is set): until then
  // the food part it must carry is not known, and sending this phone's would overwrite the account's.
  // It goes only when this phone changed something in it (coreAhead): a core that differs from the note only by
  // deletion records past their 90 days is not sent. And the first one of a session waits until the server's own
  // core has been taken in (serverSeen): a copy from the offline cache can be weeks old, and the whole core sent
  // over the account's would undo on every phone what the others changed meanwhile.
  const cj = coreJson(s), ch = hash(cj);
  const ahead = cloudFood !== undefined && ch !== known.core && coreAhead(s);
  if (ahead && serverSeen) {
    ops.push((b) => b.set(metaRef(), { core: cj, updatedAt: now, v: 1 }));
    known.core = ch; baseCore = JSON.parse(cj); cloudFood = foodPart(baseCore); known.parts = partsOf(baseCore, ch);
  }
  if (coreHeld !== (ahead && !serverSeen)) { coreHeld = !coreHeld; report(); }
  if (coreHeld) readServerCore();

  const seen = {};
  s.workouts.forEach((w) => {
    const j = JSON.stringify(w), h = hash(j); seen[w.id] = true;
    if (known.workouts[w.id] !== h) { ops.push((b) => b.set(workoutRef(w.id), { data: j, updatedAt: now, v: 1 })); known.workouts[w.id] = h; }
  });
  Object.keys(known.workouts).forEach((id) => {
    if (!seen[id]) { ops.push((b) => b.delete(workoutRef(id))); delete known.workouts[id]; }
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
// One snapshot of the core: from the listener, or from the read of readServerCore (onlyNoted: taken only when it
// is the core the note names, see there). Returns false when it was not taken.
function takeCore(snap, onlyNoted) {
  // Every snapshot of the core, this phone's own unsent writes included, shows the food part the cloud holds
  // (or will hold once the write lands). It is noted for the next upload and never taken into the app.
  // The first one of a session is what lets the core be sent at all (see push).
  const unseen = cloudFood === undefined;
  // No core in the account. Only the server's own word counts: an empty cache while offline says nothing.
  if (!snap.exists()) { if (unseen && !snap.metadata.fromCache) { cloudFood = null; schedulePush(); } return true; }
  const remote = snap.data().core;
  if (typeof remote !== 'string') return true;   // nothing that can be read: nothing to take in
  let core; try { core = parse(remote); } catch (e) { return true; }
  if (!core || typeof core !== 'object') return true;
  const rh = hash(remote);
  if (snap.metadata.hasPendingWrites || rh === known.core) {
    cloudFood = foodPart(core);
    // The noted core in hand, and a note without its parts (written by a version up to 2.8): work them out now.
    if (rh === known.core && !notedParts()) { known.parts = partsOf(core, rh); saveKnown(); }
    if (unseen) schedulePush();
    return true;
  }
  if (onlyNoted) return false;
  const local = host().state;
  const next = applyDeleted(Object.assign({}, local, mergeCore(local, core)));   // before cloudFood moves on: mergeCore compares with the core known so far
  known.core = rh; baseCore = core; cloudFood = foodPart(core); known.parts = partsOf(core, rh);
  host().setState(next); saveKnown();   // after the app's own save, so a failed save is known
  schedulePush();   // the merge may hold something the cloud lacks; push() only sends what this phone changed
  return true;
}

// What this session knew of the server's core belongs to one link: forgotten at the next one and at sign-out.
function forgetServer() { serverSeen = false; coreHeld = false; reading = false; readTries = 0; clearTimeout(readTimer); linkGen++; }
// The first core a session sends waits for the server's own core (serverSeen; see push). A snapshot of the listener
// that is not from the offline cache is that. But the listener tells nothing when the server holds what the cache
// held, so when this phone has a core to send, the server is asked once. Its answer is taken only when it is the
// core the note names, or the account has none: anything else the listener brings and merges (its snapshots come
// in order; an answer from here could be older than the last one it gave). No signal: asked again when the signal
// is back, at the next save, and after a while.
function readServerCore() {
  if (reading || serverSeen || !user || !known) return;
  clearTimeout(readTimer);
  reading = true;
  const gen = linkGen;
  getDocFromServer(metaRef()).then((snap) => {
    if (gen !== linkGen) return;
    readTries = 0;
    if (!serverSeen && takeCore(snap, true)) serverSeen = true;
    if (serverSeen) schedulePush();
    else readTimer = setTimeout(schedulePush, 15000);
  }, (e) => {
    if (gen !== linkGen) return;
    if (e && e.code && e.code !== 'unavailable') { lastError = friendly(e); report(); }
    readTimer = setTimeout(schedulePush, Math.min(300, 15 * 2 ** readTries++) * 1000);
  }).finally(() => { if (gen === linkGen) reading = false; });
}

function listen() {
  stopListening();
  unsubs.push(onSnapshot(metaRef(), { includeMetadataChanges: false }, (snap) => {
    takeCore(snap, false);
    // Not from the offline cache: the server's own core, now taken in. The first core of the session may go.
    if (!snap.metadata.fromCache && !serverSeen) { serverSeen = true; schedulePush(); }
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
        let w; try { w = parse(j); } catch (e) { return; }
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
    host().setState(Object.assign({}, host().state, { workouts: list }));
    saveKnown();
  }, (e) => { lastError = friendly(e); report(); }));
  // No listener on foodDays: food days are neither read nor merged here any more.
}

function stopListening() { unsubs.forEach((u) => u()); unsubs = []; }

// ---------------------------------------------------------------------------
// First link of this device to an account
// ---------------------------------------------------------------------------
async function link() {
  const h = host();
  clearTimeout(linkTimer);
  cloudFood = undefined;   // what was seen belongs to the listeners before this link, maybe to another account
  forgetServer();
  if (h.unreadable) return;   // the app could not read its saved data: nothing syncs until he chooses what to do
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
  // foodDays is not read, and the new note lists no food days.
  const uid = user.uid;
  const fresh = { uid, core: null, workouts: {}, days: {} };
  linking = uid;
  inflight++; report();
  try {
    const [meta, ws] = await Promise.all([getDocFromServer(metaRef()), getDocsFromServer(workoutsCol())]);
    if (!user || user.uid !== uid) return;
    const local = h.state;
    const localHasHistory = local.workouts.some((w) => w.finishedAt);
    let next = JSON.parse(JSON.stringify(local));

    if (meta.exists() && typeof meta.data().core === 'string') {
      // Cloud already has data: it wins for settings and program; everything dated or with an id is merged.
      // Except food: this phone's old food copy (or its empty one) stays exactly as it is, the account's is not taken.
      fresh.core = hash(meta.data().core);
      const cloud = parse(meta.data().core);
      baseCore = cloud;
      fresh.parts = partsOf(cloud, fresh.core);
      const mine = { food: next.food, del: (next.deleted || {}).food || {} };
      Object.assign(next, cloud);
      next.food = mine.food;
      next.deleted = mergeDeleted(local.deleted, cloud.deleted);
      next.deleted.food = mine.del;
      next.bodyweight = unionByDate(cloud.bodyweight, local.bodyweight, next.deleted.bw);
      next.sleep = unionByDate(cloud.sleep, local.sleep, next.deleted.sleep);
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
      let w; try { w = parse(j); } catch (e) { return; }   // one broken document must not block sign-in
      fresh.workouts[d.id] = hash(j);
      const i = next.workouts.findIndex((x) => x.id === d.id);
      if (i >= 0) next.workouts[i] = w; else next.workouts.push(w);
    });
    next.workouts.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    if (next.active && !next.workouts.some((w) => w.id === next.active)) next.active = null;
    applyDeleted(next);
    // The food part every core sent from here on carries: the account's, as the server just gave it
    // (parsed again, so nothing in the app shares these objects). null: no core yet, the first upload creates it.
    cloudFood = meta.exists() && typeof meta.data().core === 'string' ? foodPart(parse(meta.data().core)) : null;
    // The account's settings and program are about to replace this phone's: keep a copy of what is here first.
    if (fresh.core && h.safetyCopy) h.safetyCopy('cloud');
    known = fresh;
    serverSeen = true;   // read from the server itself just now, and merged
    h.setState(next);
    saveKnown();
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
// Public API used by overload.js
// ---------------------------------------------------------------------------
window.__overloadSync = {
  release: '3.0',   // the release this file belongs to (bump.sh sets it): overload.js removes the old food log only beside its own release's sync module
  get user() { return user ? { email: user.email, uid: user.uid } : null; },
  get lastSync() { return lastSync; },
  get error() { return lastError; },
  // Does the account hold this phone's whole old food log? True only when the note proves it: the phone has
  // food days, every one is noted with exactly the content it has now, the note lists no other day, and the
  // saved foods, meals and targets are the ones in the account. This version uploads no food, so whatever a
  // version up to 2.8 had not sent is on this phone only: the app can ask here before it says that signing in
  // to the diet app brings the food log across.
  get foodInCloud() {
    if (!user || !known || !cloudFood) return false;
    const s = host().state, diary = s.diary || {}, dates = Object.keys(diary);
    return dates.length > 0 && Object.keys(known.days).length === dates.length
      && dates.every((date) => known.days[date] === hash(JSON.stringify(diary[date])))
      && JSON.stringify(s.food) === JSON.stringify(cloudFood.food);
  },
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
    stopListening(); forgetServer();
    // The stored note of what the cloud holds is kept (it names the account): signing back in to the same
    // account then sends the changes made in between instead of taking the cloud's older copy.
    // overload.js removes it when Reset or Import runs while signed out.
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
  else { stopListening(); forgetServer(); known = null; cloudFood = undefined; report(); }
  const h = host();
  if (h) { if (h.syncChanged) h.syncChanged(); else h.render(); }   // only the sync parts, not the whole screen
});

document.addEventListener('overload:save', () => { forgetDaysNow(); schedulePush(); });
window.addEventListener('online', () => { report(); readTries = 0; if (user && !known && !linking) { linkTries = 0; link(); } else schedulePush(); });
window.addEventListener('offline', report);

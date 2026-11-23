/* release 3.0 (bump.sh sets this line; the offline copy refuses the file when it names another release) */
/* Fuel cloud sync (optional).
 *
 * Firebase Auth (email + password) and Firestore: the same project and the same account as Overload (the
 * training app, one folder up), but documents of its own. The app keeps working from localStorage; this
 * module mirrors changes to the cloud and applies remote changes back. Layout in Firestore:
 *
 *   users/{uid}/meta/fuel         { core: <json>, updatedAt, v, base }   units and theme, food targets, saved foods, saved meals, deletion records, the body weight
 *   users/{uid}/fuelDays/{date}   { data: <json>, updatedAt, v, base }   one document per day of the food log
 *
 * `base` is the hash of the copy of that document the writing phone had taken in before it wrote (null: it
 * knew none). It tells another phone whether the writer had its latest copy (see merging).
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
 * Firestore's persistent cache queues writes while offline and replays them when the network is back. A
 * document is replaced whole, so a phone's old copy replayed over newer ones would undo what other phones
 * changed. So the first upload of a document in a session (and again after the signal was lost) waits until
 * the server's own copy has been taken in: a change made without signal stays in the app's storage and goes up
 * merged (see push).
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
const OWN_KEEP = 2 * 864e5;   // a write of this phone that the server confirmed is remembered this long (see own writes)
const OWN_MAX = 40;           // and at most this many per document
const CONFIRM_ONE_BY_ONE = 20;   // up to this many days waiting are asked of the server one by one; more, as the whole collection

const app = initializeApp(firebaseConfig, 'fuel');   // Overload's is the default app; this one must not be
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });

const host = () => window.__overload;
let user = null;
// What the cloud is known to hold: { uid, email, core: hash|null, days: { date: hash }, parts, own[, signedOut] }
// (parts: the noted copies item by item; own: this phone's latest writes; both below).
let known = null;
let unsubs = [];
let pushTimer = null;
let inflight = 0;
let lastSync = null;
let lastError = '';
let linking = null;        // uid of the account whose first read is in flight
let linkTimer = null;
let linkTries = 0;
// The server's own copy taken in during this session, and since the signal was last lost: the core, every day
// (a listener snapshot that is not from the offline cache), or single days (a confirm read, readServer).
let coreSeen = false, daysSeen = false;
const dayOk = new Set();
let waiting = false;       // something to upload waits for that
const waitDays = new Set();
let reading = false;       // the confirm read of readServer is in flight
let readTimer = null;
let readTries = 0;
let linkGen = 0;           // goes up at every link, sign-out and loss of signal: an answer that arrives for an earlier one is dropped
let swept = false;         // the days listener's first snapshot from the server in this session was compared with the note
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
// The bookkeeping keeps short hashes, not a second full copy of the data, so it does not eat into the phone's
// storage for the app itself.
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
// One item of a document (an entry of a day, or one item of the core: see coreItems), in at most 7 characters.
// It is only ever compared with the hashes of the same item's other copies: 32 bits are plenty for that.
function ihash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0).toString(36);
}
const isHash = (v) => typeof v === 'string' && /^h[0-9a-z]+\.[0-9a-z]+$/.test(v);
const isHashes = (v) => typeof v === 'string' && /^([0-9a-z]+( [0-9a-z]+)*)?$/.test(v);
// The note's parts: for the core and for each day, the set of item hashes of the copy the note names (h: that
// copy's hash, null for a document the cloud does not hold), as one text: { h, n: 'hash hash …' }. With them
// a merge tells, item by item, what this phone changed itself since that copy (mergeItems).
// The note's own writes: for each document, this phone's uploads of it since it last took in another phone's
// copy, in order: { b: the base it was sent with, h: its hash, p: hashes of its items that its base lacked,
// g: hashes of its base's items it no longer held, t: when, c: 1 once the server confirmed it }. They tell
// what a copy written beside them, by a phone that did not have them, misses (ownSince). Confirmed ones are
// forgotten after OWN_KEEP; unconfirmed ones only once a copy without pending writes shows them (the server's, or
// the offline cache's at the next start: see the days listener).
const okParts = (p) => isObj(p) && (p.h === null || isHash(p.h)) && isHashes(p.n);
const okWrite = (w) => isObj(w) && (w.b === null || isHash(w.b)) && isHash(w.h) && isHashes(w.p) && isHashes(w.g) && typeof w.t === 'number';
// The stored note, or null. Whatever in it is not what this file writes is left out: a day it does not list
// is simply sent again, which is always safe, and a day without its parts is merged without them.
function loadKnown() {
  try {
    const k = JSON.parse(localStorage.getItem(SYNC_KEY));
    if (!isObj(k) || typeof k.uid !== 'string' || !k.uid) return null;
    const days = {};
    Object.keys(obj(k.days)).forEach((d) => { if (isDay(d) && typeof k.days[d] === 'string') days[d] = k.days[d]; });
    k.days = days;
    if (typeof k.core !== 'string') k.core = null;
    const p = obj(k.parts), parts = { core: okParts(p.core) ? p.core : null, days: {} };
    Object.keys(obj(p.days)).forEach((d) => { if (isDay(d) && okParts(p.days[d])) parts.days[d] = p.days[d]; });
    k.parts = parts;
    const o = obj(k.own), own = { core: Array.isArray(o.core) ? o.core.filter(okWrite) : [], days: {} };
    Object.keys(obj(o.days)).forEach((d) => { if (isDay(d) && Array.isArray(o.days[d])) { const l = o.days[d].filter(okWrite); if (l.length) own.days[d] = l; } });
    k.own = own;
    return k;
  } catch (e) { return null; }
}
const freshNote = (uid) => ({ uid, email: user ? user.email : '', core: null, days: {}, parts: { core: null, days: {} }, own: { core: [], days: {} } });
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
const TARGETS = ['kcal', 'protein', 'carbs', 'fat'];
function coreOf(s) {
  const settings = obj(s.settings), food = obj(s.food), targets = obj(food.targets), gone = obj(s.deleted);
  const deleted = { food: sorted(gone.food), foods: sorted(gone.foods), meals: sorted(gone.meals) };
  // The records of stars taken off and of corrections deleted (fuel.js keeps them only once there is one): sent
  // only then, so a core without them is the same text as before they existed.
  MORE_KINDS.forEach((k) => { if (Object.keys(obj(gone[k])).length) deleted[k] = sorted(gone[k]); });
  return {
    settings: { units: settings.units, theme: settings.theme },
    food: { targets: { kcal: targets.kcal, protein: targets.protein, carbs: targets.carbs, fat: targets.fat }, foods: sorted(food.foods), meals: sorted(food.meals) },
    deleted,
    bodyweight: Array.isArray(s.bodyweight) ? s.bodyweight : []
  };
}
function coreJson(s) { return JSON.stringify(coreOf(s)); }

// ---------------------------------------------------------------------------
// Items: what a merge compares one by one
// ---------------------------------------------------------------------------
// The core's items (c is a coreOf): units and the body weight as one (the weight is a number in those units),
// the theme, each target, each saved food, each saved meal. The deletion records are not items: they are put
// together, never replaced (mergeDeleted).
function coreItems(c) {
  const m = new Map([['w', [c.settings.units, c.bodyweight]], ['t', c.settings.theme]]);
  TARGETS.forEach((k) => m.set('k.' + k, c.food.targets[k]));
  Object.keys(c.food.foods).forEach((id) => m.set('f.' + id, c.food.foods[id]));
  Object.keys(c.food.meals).forEach((id) => m.set('m.' + id, c.food.meals[id]));
  return m;
}
const itemText = (k, v) => JSON.stringify([k, v === undefined ? null : v]);
// A day's items: its entries by id (an entry's text holds its id).
const entryText = (k, e) => JSON.stringify(e);
const hasId = (e) => isObj(e) && typeof e.id === 'string' && !!e.id;
// The entries of a list from the cloud that can be merged. (A number as id is taken as text, as the app does.)
function usable(list) {
  return (Array.isArray(list) ? list : []).map((e) => (isObj(e) && typeof e.id === 'number' ? Object.assign({}, e, { id: String(e.id) }) : e)).filter(hasId);
}
function entryItems(list) { const m = new Map(); usable(list).forEach((e) => m.set(e.id, e)); return m; }
const hashesOf = (items, textOf) => [...items].map(([k, v]) => ihash(textOf(k, v)));
const setText = (hs) => [...new Set(hs)].sort().join(' ');
const toSet = (s) => new Set(s ? s.split(' ') : []);

// What the note says about one document (key: 'core' or a date).
const notedHash = (key) => { const v = key === 'core' ? known.core : known.days[key]; return v === undefined ? null : v; };
function validParts(key) {
  const p = key === 'core' ? known.parts.core : known.parts.days[key];
  return p && p.h === notedHash(key) ? p : null;
}
function setParts(key, h, n) { if (key === 'core') known.parts.core = { h, n }; else known.parts.days[key] = { h, n }; }
function dropParts(key) { if (key === 'core') known.parts.core = null; else delete known.parts.days[key]; }
// This phone's writes of a document since it last took in another phone's copy of it: only while the last of
// them is still the copy the note names.
function ownList(key) {
  const l = key === 'core' ? known.own.core : known.own.days[key];
  return Array.isArray(l) && l.length && l[l.length - 1].h === notedHash(key) ? l : null;
}
function setOwn(key, l) {
  const now = Date.now();
  l = l.filter((w) => !w.c || now - w.t < OWN_KEEP).slice(-OWN_MAX);
  if (key === 'core') known.own.core = l;
  else if (l.length) known.own.days[key] = l; else delete known.own.days[key];
}
function dropOwn(key) { if (key === 'core') known.own.core = []; else delete known.own.days[key]; }
// Confirmed writes are forgotten after OWN_KEEP: a copy written beside one of them comes long before that.
function pruneOwn() {
  const now = Date.now(), keep = (l) => l.filter((w) => !w.c || now - w.t < OWN_KEEP);
  known.own.core = keep(known.own.core);
  Object.keys(known.own.days).forEach((d) => { const l = keep(known.own.days[d]); if (l.length) known.own.days[d] = l; else delete known.own.days[d]; });
}
// The server holds this phone's write of the document (its hash h): it is confirmed.
function confirmOwn(key, h) {
  const l = key === 'core' ? known.own.core : known.own.days[key];
  let done = false;
  (l || []).forEach((w) => { if (w.h === h && !w.c) { w.c = 1; done = true; } });
  return done;
}
// What a copy from the cloud misses of this phone's own writes: those from the first one that had the same base
// as that copy (it was written beside them, by a phone that did not have them), or whose base that copy is (the
// server never got them: lost from the phone's queue, or not arrived yet). null: it misses none.
function ownSince(list, base, inHash) {
  if (!list) return null;
  const i = list.findIndex((w) => (base !== undefined && w.b === base) || w.b === inHash);
  if (i < 0) return null;
  const put = new Set(), gone = new Set();
  list.slice(i).forEach((w) => { toSet(w.p).forEach((x) => put.add(x)); toSet(w.g).forEach((x) => gone.add(x)); });
  return { put, gone };
}
// The noted set for a merge: the note's parts; without them, this phone's own items when it holds exactly the
// noted copy (it changed nothing); else an empty set: everything here counts as changed here, nothing is lost.
function notedSet(key, localHash, localSet) {
  const p = validParts(key);
  if (p) return toSet(p.n);
  return localHash === notedHash(key) ? localSet() : new Set();
}
// How a copy from the cloud (its base and hash) is merged into this phone's copy of the document.
// The writer had the copy the note names (null: none, as the note says): a plain merge. Otherwise it may have
// written beside this phone's own writes, or the server may lack them (ownSince). A copy whose writer did not
// say (no base) counts as written after the noted one, as do copies from phones this one has not heard from
// for a while.
function howToMerge(key, base, inHash, localHash, localSet) {
  const noted = notedSet(key, localHash, localSet);
  if (base !== undefined && base === notedHash(key)) return { noted, own: null };
  return { noted, own: ownSince(ownList(key), base, inHash) };
}
// An upload of a document: noted as what the cloud now holds, and among this phone's own writes.
function noteWrite(key, base, h, items, textOf, noted) {
  const hs = hashesOf(items, textOf), mine = new Set(hs);
  const p = noted ? hs.filter((x) => !noted.has(x)) : hs;
  const g = noted ? [...noted].filter((x) => !mine.has(x)) : [];
  const l = ownList(key) || [];
  if (l.length || p.length || g.length) setOwn(key, l.concat([{ b: base, h, p: setText(p), g: setText(g), t: Date.now() }]));
  else dropOwn(key);
  if (key === 'core') known.core = h; else known.days[key] = h;
  setParts(key, h, setText(hs));
}

// ---------------------------------------------------------------------------
// Merging. Two phones can change the same data, and a phone that was offline can
// come back with old copies. Each item (an entry, a saved food or meal, a target,
// the theme, units with the body weight) is merged by itself against the copy the
// note names: this phone's value wins only for what it changed itself since that
// copy; for the rest the cloud's value stands, and so does its absence of an item
// the noted copy held (removed on another phone: by a deletion, or a Reset or
// Restore there). Deletion records (state.deleted, merged too, and never pruned)
// always win.
// ---------------------------------------------------------------------------
const DELETED_KINDS = ['food', 'foods', 'meals'];   // entries, saved foods, saved meals
// Stars taken off, and his own foods or corrections deleted (review findings data#3, data#4). Only there once a
// side has one. fuel.js drops a star's record when the food is starred (also after a merge, in setState).
const MORE_KINDS = ['fav', 'custom'];
// Every record of both sides; the later time wins for an id both have.
function mergeDeleted(a, b) {
  const out = {};
  DELETED_KINDS.concat(MORE_KINDS).forEach((k) => {
    if (MORE_KINDS.includes(k) && !isObj(obj(a)[k]) && !isObj(obj(b)[k])) return;
    const m = Object.assign({}, obj(obj(a)[k])), theirs = obj(obj(b)[k]);
    Object.keys(theirs).forEach((id) => { if (!(has(m, id) && m[id] >= theirs[id])) m[id] = theirs[id]; });
    out[k] = m;
  });
  return out;
}
// One document's items (Maps, key to value), this phone's and the cloud's. noted: the item hashes of the copy the
// note names (notedSet). own: what the cloud's copy misses of this phone's writes (ownSince), or null. An item is
// this phone's when it is new or changed here since the noted copy, or removed here (the noted copy held the
// cloud's); also when it is among own's. This phone's then stays, also over the cloud's own change of it.
// Every other item is the cloud's: its value, or its absence, unless the cloud's copy was written beside own
// (by a phone that did not have this phone's copy): then an item only this phone holds stays.
function mergeItems(mine, theirs, textOf, noted, own) {
  const out = new Map();
  new Set([...mine.keys(), ...theirs.keys()]).forEach((k) => {
    const m = mine.has(k), r = theirs.has(k);
    const mt = m ? textOf(k, mine.get(k)) : null, rt = r ? textOf(k, theirs.get(k)) : null;
    if (m && mt === rt) { out.set(k, mine.get(k)); return; }
    const mh = m ? ihash(mt) : null, rh = r ? ihash(rt) : null;
    let here = m ? !noted.has(mh) : noted.has(rh);
    if (!here && own) here = (m && own.put.has(mh)) || (r && own.gone.has(rh));
    if (here) { if (m) out.set(k, mine.get(k)); return; }
    if (r) out.set(k, theirs.get(k));
    else if (own) out.set(k, mine.get(k));
  });
  return out;
}
const timeOf = (e) => (typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : 0);
const byTime = (a, b) => timeOf(a) - timeOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Two copies of one day's food log at a first link: every entry from both, `first` winning for the same entry.
// In the order of their times, and by id where two times are equal, so every phone ends with the same text for
// the same entries.
function mergeDay(first, second, gone) {
  const byId = new Map();
  usable(second).forEach((e) => byId.set(e.id, e));
  usable(first).forEach((e) => byId.set(e.id, e));
  return [...byId.values()].filter((e) => !(gone && has(gone, e.id))).sort(byTime);
}
// The cloud's copy of a day into this phone's (mergeItems), minus the entries the deletion records say are gone.
// An entry here without an id (the app gives every entry one at start) is kept as it is.
function mergeEntries(local, remote, noted, own, gone) {
  const loose = (Array.isArray(local) ? local : []).filter((e) => isObj(e) && !hasId(e));
  const got = mergeItems(entryItems(local), entryItems(remote), entryText, noted, own);
  return [...got.values()].filter((e) => !(gone && has(gone, e.id))).sort(byTime).concat(loose);
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
function mergeCore(local, remote, noted, own) {
  const mine = coreOf(local), theirs = coreOf(remote), M = coreItems(mine);
  const got = mergeItems(M, coreItems(theirs), itemText, noted, own);
  const took = (k) => got.get(k) !== M.get(k);   // the cloud's value of an item that both always have
  const out = { settings: Object.assign({}, local.settings), food: Object.assign({}, local.food), bodyweight: local.bodyweight };
  if (took('w')) {
    if (theirs.settings.units !== undefined) out.settings.units = theirs.settings.units;
    if (Array.isArray(remote.bodyweight)) out.bodyweight = remote.bodyweight;
  }
  if (took('t') && theirs.settings.theme !== undefined) out.settings.theme = theirs.settings.theme;
  if (isObj(obj(remote.food).targets)) {
    const t = Object.assign({}, obj(local.food).targets);
    TARGETS.forEach((k) => { if (took('k.' + k) && theirs.food.targets[k] !== undefined) t[k] = theirs.food.targets[k]; });
    out.food.targets = t;
  }
  out.deleted = Object.assign({}, local.deleted, mergeDeleted(mine.deleted, theirs.deleted));
  [['foods', 'f.'], ['meals', 'm.']].forEach(([kind, pre]) => {
    const all = {};
    got.forEach((v, k) => { if (k.startsWith(pre)) all[k.slice(2)] = v; });
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
  else if (inflight > 0 || waiting) { status = navigator.onLine ? 'syncing' : 'offline'; msg = navigator.onLine ? 'Syncing…' : 'Offline, will sync later'; }
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
const daySeen = (date) => daysSeen || dayOk.has(date);

async function push() {
  const h = host();
  if (!user || !known || !h || h.unreadable) return;
  const s = h.state;
  const now = Date.now();
  const ops = [];
  const before = JSON.stringify(known);   // what the cloud held before this push, for rollback on failure
  // A document goes up only once the server's own copy of it has been taken in during this session (coreSeen,
  // daySeen): a copy from the offline cache can be weeks old, and this phone's whole copy sent over the
  // account's would undo on every phone what the others changed meanwhile. Until then the change waits here,
  // and is merged with the server's copy when that comes (the listeners, or readServer).
  let wait = false;
  waitDays.clear();

  const cj = coreJson(s), ch = hash(cj);
  if (ch !== known.core) {
    if (coreSeen) {
      const ref = metaRef(), base = notedHash('core'), core = JSON.parse(cj);
      ops.push({ key: 'core', h: ch, run: (b) => b.set(ref, { core: cj, updatedAt: now, v: 1, base }) });
      noteWrite('core', base, ch, coreItems(core), itemText, validParts('core') ? toSet(validParts('core').n) : null);
    } else wait = true;
  }

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
    if (known.days[date] === dh) return;
    if (!daySeen(date)) { wait = true; waitDays.add(date); return; }
    const ref = dayRef(date), base = notedHash(date), p = validParts(date);
    ops.push({ key: date, h: dh, run: (b) => b.set(ref, { data: j, updatedAt: now, v: 1, base }) });
    noteWrite(date, base, dh, entryItems(list), entryText, p ? toSet(p.n) : null);
  });
  // A day the cloud holds and this phone no longer has: he removed its last entry, or reset or restored.
  Object.keys(known.days).forEach((date) => {
    if (here[date]) return;
    if (isDay(date) && !daySeen(date)) { wait = true; waitDays.add(date); return; }
    if (isDay(date)) { const ref = dayRef(date); ops.push({ run: (b) => b.delete(ref) }); }
    delete known.days[date]; dropParts(date); dropOwn(date);
  });
  pruneOwn();
  saveKnown();
  if (waiting !== wait) { waiting = wait; report(); }
  if (wait) readServer();
  if (!ops.length) return;

  // If a batch is rejected (rules, quota), forget that the cloud has it so the
  // next push sends it again. Sets are idempotent, so re-sending is harmless.
  const uid = user.uid;
  const rollback = () => { if (known && user && known.uid === uid) { known = JSON.parse(before); saveKnown(); } };
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const b = writeBatch(db), part = ops.slice(i, i + BATCH_LIMIT);
    part.forEach((op) => op.run(b));
    inflight++; report();
    b.commit().then(() => {
      lastSync = Date.now(); lastError = '';
      if (known && known.uid === uid) { part.forEach((op) => { if (op.key) confirmOwn(op.key, op.h); }); saveKnown(); }
    }, (e) => { lastError = friendly(e); rollback(); setTimeout(schedulePush, 60000); })
      .finally(() => { inflight--; report(); });
  }
}

// ---------------------------------------------------------------------------
// The server's own copy, when the listeners do not bring it
// ---------------------------------------------------------------------------
// What this session knew of the server belongs to one link and one stretch of signal: forgotten at the next link,
// at sign-out and when the signal is lost.
function forgetServer() {
  coreSeen = false; daysSeen = false; dayOk.clear(); reading = false; readTries = 0; clearTimeout(readTimer); linkGen++;
}
// An upload waits for the server's own copy (see push). A listener snapshot that is not from the offline cache is
// that. But a listener tells nothing when the server holds what the cache held, so when this phone has something
// to send, the server is asked once for the documents concerned. Its answer is taken only when it is the copy the
// note names (or there is none, as the note says): anything else the listeners bring and merge (their snapshots
// come in order; an answer from here could be older than the last one they gave). No signal: asked again when the
// signal is back, at the next save, and after a while.
function readServer() {
  if (reading || !user || !known) return;
  const wantCore = waiting && !coreSeen && hash(coreJson(host().state)) !== known.core;
  const days = [...waitDays].filter((d) => !daySeen(d));
  if (!wantCore && !days.length) return;
  clearTimeout(readTimer);
  reading = true;
  const gen = linkGen;
  const asks = [];
  if (wantCore) {
    asks.push(getDocFromServer(metaRef()).then((snap) => {
      if (gen !== linkGen || coreSeen) return;
      const t = snap.exists() ? snap.data().core : undefined;
      if (!snap.exists() || (typeof t === 'string' && hash(t) === known.core)) { coreSeen = true; if (typeof t === 'string') confirmOwn('core', hash(t)); }
    }));
  }
  // A day is as the note says when the server holds the noted copy, or none and the note lists none.
  const check = (date, j) => {
    const noted = known.days[date];
    if ((j === undefined && noted === undefined) || (typeof j === 'string' && hash(j) === noted)) { dayOk.add(date); if (j !== undefined) confirmOwn(date, hash(j)); }
  };
  if (days.length > CONFIRM_ONE_BY_ONE) {
    asks.push(getDocsFromServer(daysCol()).then((qs) => {
      if (gen !== linkGen) return;
      const there = new Map(); qs.forEach((d) => there.set(d.id, d.data().data));
      days.forEach((date) => check(date, there.has(date) ? there.get(date) : undefined));
    }));
  } else {
    days.forEach((date) => asks.push(getDocFromServer(dayRef(date)).then((snap) => { if (gen === linkGen) check(date, snap.exists() ? snap.data().data : undefined); })));
  }
  Promise.all(asks).then(() => {
    if (gen !== linkGen) return;
    readTries = 0;
    saveKnown();
    // What was not as noted comes through the listeners, merged; if not, it is asked again after a while.
    if ((!wantCore || coreSeen) && days.every(daySeen)) schedulePush(); else readTimer = setTimeout(schedulePush, 15000);
  }, (e) => {
    if (gen !== linkGen) return;
    if (e && e.code && e.code !== 'unavailable') { lastError = friendly(e); report(); }
    readTimer = setTimeout(schedulePush, Math.min(300, 15 * 2 ** readTries++) * 1000);
  }).finally(() => { if (gen === linkGen) reading = false; });
}
// This phone's uploads whose answer never came (the app was closed a moment after they went): at every link of a
// phone with a note, and when the signal is back, the server is asked once for just those documents, and a write it
// holds as it was sent is confirmed (review finding sync#8). The listeners cannot always tell: the SDK keeps such a
// write and sends it again at the next start, and the server's answer to that changes only the document's metadata,
// which they are not told of. (A copy from the offline cache without pending writes confirms too: see the days
// listener.) No answer: asked again at the next link or when the signal is back.
function confirmLeft() {
  if (!user || !known) return;
  // Only while the latest of them is the copy the note names, and not confirmed (one confirmed after it holds it).
  const left = (key) => { const l = ownList(key); return !!l && !l[l.length - 1].c; };
  const core = left('core'), days = Object.keys(known.own.days).filter((d) => isDay(d) && left(d));
  if (!core && !days.length) return;
  const gen = linkGen, asks = [];
  const take = (key, t) => { if (gen === linkGen && known && typeof t === 'string') confirmOwn(key, hash(t)); };
  if (core) asks.push(getDocFromServer(metaRef()).then((s) => take('core', s.exists() ? s.data().core : undefined)));
  if (days.length > CONFIRM_ONE_BY_ONE) asks.push(getDocsFromServer(daysCol()).then((qs) => qs.forEach((d) => { if (days.includes(d.id)) take(d.id, d.data().data); })));
  else days.forEach((date) => asks.push(getDocFromServer(dayRef(date)).then((s) => take(date, s.exists() ? s.data().data : undefined))));
  Promise.all(asks).then(() => { if (gen === linkGen && known) saveKnown(); }, () => { /* asked again later */ });
}

// ---------------------------------------------------------------------------
// Pull: live listeners apply remote changes into the app
// ---------------------------------------------------------------------------
// One snapshot of the core from the listener.
function takeCore(snap) {
  if (!snap.exists() || snap.metadata.hasPendingWrites) return;
  const d = snap.data(), remote = d.core;
  if (typeof remote !== 'string') return;
  let core; try { core = parse(remote); } catch (e) { return; }
  if (!isObj(core)) return;
  const rh = hash(remote), items = () => coreItems(coreOf(core));
  // Without pending writes, also from the offline cache: the server took it (see the days listener).
  if (confirmOwn('core', rh)) saveKnown();
  // The core the note names (after a start it comes from the offline cache first): nothing to take. A note
  // without its parts gets them now.
  if (rh === known.core) { if (!validParts('core')) { setParts('core', rh, setText(hashesOf(items(), itemText))); saveKnown(); } return; }
  const local = host().state, lj = coreJson(local);
  const how = howToMerge('core', d.base, rh, hash(lj), () => new Set(hashesOf(coreItems(JSON.parse(lj)), itemText)));
  const next = applyDeleted(Object.assign({}, local, mergeCore(local, core, how.noted, how.own)));
  known.core = rh; setParts('core', rh, setText(hashesOf(items(), itemText))); dropOwn('core');
  host().setState(next); saveKnown();   // after the app's own save, so a failed save is known
  schedulePush();   // the merge may hold something the cloud lacks; push() only sends what differs
}
// This phone's uploads of a document that the server has not confirmed, after the last one it did confirm (that one
// held everything before it): the items they put there (p), and whether one of them made the document (its base is
// null: the server held none when it went).
function unconfirmed(key) {
  const l = ownList(key) || [], put = new Set();
  let i = l.length, made = false;
  while (i > 0 && !l[i - 1].c) i--;
  l.slice(i).forEach((w) => { toSet(w.p).forEach((x) => put.add(x)); if (w.b === null) made = true; });
  return { put, made };
}
// A day the cloud no longer holds (its document was deleted, or the server's first answer lacks it). What this phone
// logged or changed on it since it last synced stays, and goes up again: the entries it added or changed since the
// noted copy, and those its uploads put there that the server has not confirmed (they may never have arrived). The
// rest go, as they went there (a Reset or Restore on another phone, or its last entry removed, with their records);
// a write of this phone that was never confirmed does not keep them (review finding sync#8). The whole day stays
// only when this phone's unconfirmed upload made the day (the server may never have had any of it: the first
// sign-in's upload, say, whose answer was lost with the SDK's offline store), or when there is no telling what
// changed here (a note without the day's parts; this release writes none). Returns 0 (not noted), 1 (gone here
// too) or 2 (something stays: send it).
function removeDay(date, diary, gone) {
  if (known.days[date] === undefined) return 0;
  const mine = Array.isArray(diary[date]) ? diary[date] : [];
  const p = validParts(date), u = unconfirmed(date), lh = hash(JSON.stringify(mine));
  let keep = mine;
  if (!u.made && (p || lh === known.days[date])) {
    const noted = p ? toSet(p.n) : new Set(hashesOf(entryItems(mine), entryText));
    keep = mine.filter((e) => { if (!hasId(e)) return true; const x = ihash(entryText(e.id, e)); return !noted.has(x) || u.put.has(x); });
  }
  keep = keep.filter((e) => !(isObj(e) && has(gone, e.id)));
  delete known.days[date]; dropParts(date); dropOwn(date);
  if (keep.length) { diary[date] = keep; return 2; }
  delete diary[date];
  return 1;
}

function listen() {
  stopListening();
  unsubs.push(onSnapshot(metaRef(), { includeMetadataChanges: false }, (snap) => {
    takeCore(snap);
    // Not from the offline cache (and not this phone's own write laid over it): the server's own core, now
    // taken in. The core may go up.
    if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites && !coreSeen) { coreSeen = true; schedulePush(); }
  }, (e) => { lastError = friendly(e); report(); }));

  swept = false;
  unsubs.push(onSnapshot(daysCol(), (qs) => {
    let changed = false, pushBack = false, noted = false;
    const st = host().state, diary = Object.assign({}, st.diary);
    const gone = obj(obj(st.deleted).food);
    const fromServer = !qs.metadata.fromCache;
    qs.docChanges().forEach((ch) => {
      if (ch.doc.metadata.hasPendingWrites) return;
      const date = ch.doc.id;
      if (!isDay(date)) return;   // not a day of the food log
      if (ch.type === 'removed') {
        const r = removeDay(date, diary, gone);
        if (r) { changed = true; if (r === 2) pushBack = true; }
        return;
      }
      const d = ch.doc.data(), j = d.data;
      // A document that cannot be read (made by hand): nothing to take, and this phone's copy may replace it.
      const unreadable = () => { if (!ch.doc.metadata.fromCache) dayOk.add(date); };
      if (typeof j !== 'string') { unreadable(); return; }
      const jh = hash(j);
      if (known.days[date] === jh) {   // the day as noted; a note without its parts gets them now
        if (!validParts(date)) { let e; try { e = parse(j); } catch (x) { return; } setParts(date, jh, setText(hashesOf(entryItems(e), entryText))); noted = true; }
        return;
      }
      let entries; try { entries = parse(j); } catch (e) { unreadable(); return; }
      if (!Array.isArray(entries)) { unreadable(); return; }
      const mine = Array.isArray(diary[date]) ? diary[date] : null;
      const how = howToMerge(date, d.base, jh, mine ? hash(JSON.stringify(mine)) : null, () => new Set(hashesOf(entryItems(mine), entryText)));
      const merged = mergeEntries(mine, entries, how.noted, how.own, gone);
      if (merged.length) diary[date] = merged; else delete diary[date];
      known.days[date] = jh; setParts(date, jh, setText(hashesOf(entryItems(entries), entryText))); dropOwn(date);
      changed = true;
      if (JSON.stringify(merged) !== j) pushBack = true;
    });
    // This phone's writes that a snapshot shows as they were sent: confirmed. Also from the offline cache: the SDK
    // keeps a document there without pending writes only once the server has taken it. So a write whose answer
    // never came (the app was closed a moment after it went) is confirmed at the next start, although nothing
    // changed on the server and no snapshot from it follows (review finding sync#8).
    qs.docs.forEach((x) => { if (!x.metadata.hasPendingWrites && isDay(x.id) && known.own.days[x.id] && typeof x.data().data === 'string' && confirmOwn(x.id, hash(x.data().data))) noted = true; });
    if (fromServer) {
      // The first snapshot from the server in this session lists every day the server holds. A start with the
      // offline cache cleared gets no 'removed' for a day deleted meanwhile, so it is compared with the note here.
      if (!swept) {
        swept = true;
        const there = new Set(qs.docs.map((x) => x.id));
        Object.keys(known.days).forEach((date) => {
          if (there.has(date)) return;
          const r = removeDay(date, diary, gone);
          if (r) { changed = true; if (r === 2) pushBack = true; }
        });
      }
    }
    if (changed) { host().setState(Object.assign({}, host().state, { diary })); saveKnown(); }
    else if (noted) saveKnown();
    // Not from the offline cache: every day as the server holds it, now taken in. The days may go up.
    if (fromServer && !daysSeen) { daysSeen = true; pushBack = true; }
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
function takeLinkCore(next, cloud) {
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
// Overload's food log into this phone's state, by the rules of an import (planImport and applyImport in
// fuel.js). The two must stay the same: the same log brought by sign-in and by Paste from Overload, in either
// order, then ends byte for byte the same, and the second of the two finds nothing new. It only adds, with
// one exception for saved foods:
//   entries      by day and id: added when the phone does not hold that id on that day, at the end of the
//                day as an import adds them. Before v2.5 an entry edited across midnight was kept on both
//                days under one id, and v2.8 shows both. One deleted on the phone stays deleted (by id).
//   saved foods  by id. One the phone holds stays, and takes Overload's star when it has none. When
//                Overload's is one he corrected or typed in (src custom) and the phone's is the food list's
//                own (src usda or off), Overload's whole food takes its place, with the phone's last use, last
//                amount and star kept. A food made or corrected on the phone (src custom) keeps its numbers.
//                Not the star of a food whose star he took off in Fuel (deleted.fav), and not a correction of his
//                that he deleted in Fuel (deleted.custom), also after the food list's copy was logged again
//                (review findings data#3, data#4).
//   saved meals  by id; the phone's stay
//   targets, body weight   only when the phone has none
//   deleted on the phone   stays deleted
// Returns whether Overload's copy held any food.
function addFromOverload(next, from) {
  const food = next.food, gone = next.deleted;
  // A phone with no food of its own takes Overload's units and theme too, as an import at Welcome does. (Not
  // "at Welcome" itself: signing in from Welcome leaves it before the account has answered.)
  if (isEmpty(next)) {
    if (from.units === 'lb' || from.units === 'kg') next.settings.units = from.units;
    if (['system', 'dark', 'light'].includes(from.theme)) next.settings.theme = from.theme;
  }
  if (!hasTargets(food.targets) && hasTargets(from.targets)) ['kcal', 'protein', 'carbs', 'fat'].forEach((k) => { food.targets[k] = from.targets[k] === undefined ? null : from.targets[k]; });
  const unstarred = obj(gone.fav), uncorrected = obj(gone.custom);
  Object.keys(from.foods).forEach((id) => {
    const theirs = from.foods[id], mine = has(food.foods, id) ? food.foods[id] : null;
    if (!isObj(theirs) || has(gone.foods, id)) return;   // not a food (fuel.js drops it); deleted here: it does not come back
    const star = !!theirs.fav && !has(unstarred, id);   // Overload's star, unless he took this food's star off here
    if (!isObj(mine)) {
      if (theirs.src === 'custom' && has(uncorrected, id)) return;   // his correction, deleted here: it does not come back
      if (theirs.fav && !star) { const f = Object.assign({}, theirs); delete f.fav; food.foods[id] = f; } else food.foods[id] = theirs;
      return;
    }
    if (theirs.src === 'custom' && (mine.src === 'usda' || mine.src === 'off') && !has(uncorrected, id)) {
      const f = Object.assign({}, theirs);
      delete f.used; delete f.last; delete f.fav;
      if ('used' in mine) f.used = mine.used;
      if ('last' in mine) f.last = mine.last;
      if (mine.fav || star) f.fav = true;
      food.foods[id] = f;
    } else if (!mine.fav && star) mine.fav = true;
  });
  Object.keys(from.meals).forEach((id) => { if (!has(food.meals, id) && !has(gone.meals, id)) food.meals[id] = from.meals[id]; });
  const here = new Set(), held = new Set();   // day + id of every entry on the phone; the ids alone
  Object.keys(next.diary).forEach((d) => next.diary[d].forEach((e) => { here.add(d + '#' + e.id); held.add(e.id); }));
  Object.keys(from.days).forEach((date) => {
    const add = from.days[date].filter((e) => {
      if (has(gone.food, e.id) || here.has(date + '#' + e.id)) return false;
      here.add(date + '#' + e.id); held.add(e.id); return true;
    });
    if (add.length) next.diary[date] = (next.diary[date] || []).concat(add);   // a day nothing is added to stays exactly as it is
  });
  // Overload's deletion records come along, so that another copy of its log cannot bring those entries back
  // later. Except for an entry this phone holds: that one stays, so it must not be marked as deleted. They do
  // not filter what is brought, as with Paste: an entry still in one of Overload's days is one v2.8 shows
  // there (one copy of an entry kept on two days, whose other copy was removed in v2.8, is such an entry).
  // Not at all when the account held no food days (cloud sync was turned on in Overload after 2.8): they protect
  // nothing that came, and Copy my food log brings them with the log, so that signing in before or after
  // pasting it ends the same (review finding sync#5).
  const days = Object.keys(from.days).length;
  if (days) Object.keys(from.gone).forEach((id) => { if (!held.has(id) && !has(gone.food, id)) gone.food[id] = from.gone[id]; });
  if (!next.bodyweight.length && from.weight) {
    next.bodyweight = [{ date: from.weight.date, weight: inUnits(from.weight.weight, unitsOf({ units: from.units }), unitsOf(next.settings)) }];
  }
  // The note Settings shows under "From Overload" (fuel.js keeps the same one after an import). Only when
  // the account held food days: an account without them (cloud sync was turned on in Overload after 2.8)
  // has brought no log across, and Settings should go on offering Copy my food log.
  if (days && !next.moved) next.moved = { from: 'Overload account', at: Date.now(), days, entries: from.entries, madeAt: null };
  return !!(days || Object.keys(from.foods).length || Object.keys(from.meals).length);
}
// What a phone with nothing of its own would hold after the first link to an account new to Fuel: Overload's
// copy, as the account holds it. Its items are the noted copy of each document the first upload creates, so
// that this phone's own changes to that log are told from what it took from the account. Two phones that make
// their first link at the same moment both upload; the later upload, from a phone that changed nothing of
// Overload's copy, then leaves the other phone's changes standing (mergeItems with own).
function originOf(from) {
  const st = { settings: {}, food: { targets: {}, foods: {}, meals: {} }, diary: {}, deleted: { food: {}, foods: {}, meals: {} }, bodyweight: [], moved: null };
  addFromOverload(st, from);
  return st;
}

async function link() {
  const h = host();
  clearTimeout(linkTimer);
  forgetServer();
  if (!h || h.unreadable) return;   // the app could not read its saved data (or waits at Add to Home Screen): nothing syncs until he chooses what to do
  // Not on a page that started without saved data (see noteTrusted): with a note left in storage, the push
  // below would take "not here" for "deleted here" and empty the account. Without the note the account's
  // copy comes down first.
  const stored = noteTrusted ? loadKnown() : null;
  if (stored && stored.uid === user.uid) {
    known = stored;
    delete known.signedOut; known.email = user.email || '';
    saveKnown();
    listen();
    schedulePush();
    confirmLeft();
    report();
    return;
  }
  if (linking === user.uid) return;

  // First link: read what the account already holds, from the server itself
  // (not the offline cache). Until that read succeeds nothing is uploaded, so
  // a bad connection can never make this phone overwrite the cloud copy.
  const uid = user.uid;
  const fresh = freshNote(uid);
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
      if (isObj(cloud)) {
        fresh.core = hash(meta.data().core); takeLinkCore(next, cloud); brought = true;
        fresh.parts.core = { h: fresh.core, n: setText(hashesOf(coreItems(coreOf(cloud)), itemText)) };
      }
    }
    // Fuel's own days are merged entry by entry, the account's copy winning for the same entry, so neither
    // side's log is lost.
    ds.forEach((d) => {
      const j = d.data().data;
      if (!isDay(d.id) || typeof j !== 'string') return;
      let entries; try { entries = parse(j); } catch (e) { return; }   // one broken document must not block sign-in
      if (!Array.isArray(entries)) return;
      fresh.days[d.id] = hash(j);
      fresh.parts.days[d.id] = { h: fresh.days[d.id], n: setText(hashesOf(entryItems(entries), entryText)) };
      const merged = mergeDay(entries, next.diary[d.id], next.deleted.food);
      if (merged.length) next.diary[d.id] = merged; else delete next.diary[d.id];
      brought = true;
    });
    if (overload) {
      brought = addFromOverload(next, overload) || brought;
      const origin = originOf(overload);
      if (!fresh.parts.core) fresh.parts.core = { h: null, n: setText(hashesOf(coreItems(coreOf(origin)), itemText)) };
      Object.keys(origin.diary).forEach((date) => { if (!fresh.parts.days[date]) fresh.parts.days[date] = { h: null, n: setText(hashesOf(entryItems(origin.diary[date]), entryText)) }; });
    }
    applyDeleted(next);
    // What is on this phone is about to change: keep a copy of it first. (Not of a phone that holds nothing:
    // that would replace an earlier copy, which may be the one he needs.) Its text is taken in this call, from
    // the state as it still is: everything above changed only `next`, a copy, and setState comes after. The
    // copy is stored in the background; signing in does not wait for it.
    if (brought && !isEmpty(local) && h.safetyCopy) h.safetyCopy('cloud');
    known = fresh;
    coreSeen = true; daysSeen = true;   // read from the server itself just now, and merged
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

// The stored note says the phone is signed out (fuel.js reads it while this module has not loaded: a Reset or
// Restore then forgets the note, as when signed out here).
function markSignedOut() {
  try {
    const k = JSON.parse(localStorage.getItem(SYNC_KEY));
    if (isObj(k) && typeof k.uid === 'string' && k.uid && !k.signedOut) { k.signedOut = true; localStorage.setItem(SYNC_KEY, JSON.stringify(k)); }
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Public API used by fuel.js
// ---------------------------------------------------------------------------
window.__overloadSync = {
  get user() { return user ? { email: user.email, uid: user.uid } : null; },
  // Signed in and the account has been read: a note of this account was there (at once, offline too), or the first
  // link's read from the server worked. fuel.js holds Reset, Restore and the imports back while signed in and not
  // linked (review finding sync#6): the first link would merge the account's data back over them.
  get linked() { return !!(user && known); },
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
    stopListening(); forgetServer();
    // The stored note of what the cloud holds is kept (it names the account): signing back in to the same
    // account then sends the changes made in between instead of taking the cloud's older copy. It is marked
    // signed out, for fuel.js: it removes the note when Reset or Restore runs while signed out.
    if (known) saveKnown();
    known = null;
    markSignedOut();
    lastSync = null; lastError = ''; waiting = false;
    await signOut(auth);
  },
  pushNow() {
    clearTimeout(pushTimer);
    if (user && !known) { linkTries = 0; return link(); }
    readTries = 0;
    return push();
  }
};

onAuthStateChanged(auth, (u) => {
  user = u;
  if (u) link();
  else { stopListening(); forgetServer(); known = null; waiting = false; markSignedOut(); report(); }
  const h = host();
  if (h) { if (h.syncChanged) h.syncChanged(); else h.render(); }   // only the sync parts, not the whole screen
});

document.addEventListener('overload:save', schedulePush);
window.addEventListener('online', () => { report(); readTries = 0; if (user && !known && !linking) { linkTries = 0; link(); } else { schedulePush(); confirmLeft(); } });
// Without signal a change waits here (see push), and the server's copy is taken in again before it goes.
window.addEventListener('offline', () => { forgetServer(); report(); });

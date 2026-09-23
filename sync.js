/* Overload cloud sync (optional).
 *
 * Firebase Auth (email + password) and Firestore. The app keeps working from
 * localStorage; this module mirrors changes to the cloud and applies remote
 * changes back. Layout in Firestore:
 *
 *   users/{uid}/meta/state          { core: <json>, updatedAt }   settings, exercises, prescriptions, program
 *   users/{uid}/workouts/{workout}  { data: <json>, updatedAt }   one document per workout
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
const CORE_KEYS = ['settings', 'exercises', 'presc', 'program', 'active', 'bodyweight', 'templates'];
const BATCH_LIMIT = 400;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });

const host = () => window.__overload;
let user = null;
let known = null;          // { uid, core: hash|null, workouts: { id: hash } } — what the cloud is known to hold
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
    return k;
  } catch (e) { return null; }
}
function saveKnown() { try { known ? localStorage.setItem(SYNC_KEY, JSON.stringify(known)) : localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ } }
function coreOf(s) { const o = {}; CORE_KEYS.forEach((k) => { o[k] = s[k]; }); return o; }
function coreJson(s) { return JSON.stringify(coreOf(s)); }

function metaRef() { return doc(db, 'users', user.uid, 'meta', 'state'); }
function workoutRef(id) { return doc(db, 'users', user.uid, 'workouts', id); }
function workoutsCol() { return collection(db, 'users', user.uid, 'workouts'); }

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
  if (ch !== known.core) { ops.push((b) => b.set(metaRef(), { core: cj, updatedAt: now, v: 1 })); known.core = ch; }

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
function listen() {
  stopListening();
  unsubs.push(onSnapshot(metaRef(), { includeMetadataChanges: false }, (snap) => {
    if (!snap.exists() || snap.metadata.hasPendingWrites) return;
    const remote = snap.data().core;
    if (typeof remote !== 'string' || hash(remote) === known.core) return;
    let core; try { core = JSON.parse(remote); } catch (e) { return; }
    const next = Object.assign({}, host().state, core);
    known.core = hash(remote); saveKnown();
    host().setState(next);
  }, (e) => { lastError = friendly(e); report(); }));

  unsubs.push(onSnapshot(workoutsCol(), (qs) => {
    let changed = false;
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
        const i = list.findIndex((x) => x.id === id);
        if (i >= 0) list[i] = w; else list.push(w);
        known.workouts[id] = hash(j); changed = true;
      }
    });
    if (!changed) return;
    list.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    saveKnown();
    host().setState(Object.assign({}, host().state, { workouts: list }));
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
  const fresh = { uid, core: null, workouts: {} };
  linking = uid;
  inflight++; report();
  try {
    const [meta, ws] = await Promise.all([getDocFromServer(metaRef()), getDocsFromServer(workoutsCol())]);
    if (!user || user.uid !== uid) return;
    const local = h.state;
    const localHasHistory = local.workouts.some((w) => w.finishedAt);
    let next = JSON.parse(JSON.stringify(local));

    if (meta.exists() && typeof meta.data().core === 'string') {
      // Cloud already has data: it wins for settings/program; workouts are merged.
      fresh.core = hash(meta.data().core);
      Object.assign(next, JSON.parse(meta.data().core));
      if (!localHasHistory) next.workouts = [];
    }
    ws.forEach((d) => {
      const j = d.data().data; if (typeof j !== 'string') return;
      fresh.workouts[d.id] = hash(j);
      const w = JSON.parse(j);
      const i = next.workouts.findIndex((x) => x.id === d.id);
      if (i >= 0) next.workouts[i] = w; else next.workouts.push(w);
    });
    next.workouts.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    if (next.active && !next.workouts.some((w) => w.id === next.active)) next.active = null;

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

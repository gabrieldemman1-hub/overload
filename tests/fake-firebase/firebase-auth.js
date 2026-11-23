/* Stand-in for https://www.gstatic.com/firebasejs/<version>/firebase-auth.js. Tests only: see README.md.
 *
 * Email and password accounts kept by the test process (route.js). The signed-in user is remembered per
 * device (browser context) and per Firebase app name, the way the real SDK keeps one session per app in the
 * browser's storage: after a reload onAuthStateChanged reports the same user again.
 */
const bridge = (op, payload) => {
  if (typeof window.__fakeFirebase !== 'function') throw new Error('fake Firebase: this browser context is not attached to a fake cloud (tests/fake-firebase/route.js)');
  return window.__fakeFirebase(op, payload);
};
const fail = (code) => { const e = new Error('fake Firebase Auth: ' + code); e.name = 'FirebaseError'; e.code = code; return e; };

const auths = new Map();   // Firebase app name -> auth object, for this page

export function getAuth(app) {
  const name = (app && app.name) || '[DEFAULT]';
  if (!auths.has(name)) auths.set(name, { app, name, currentUser: null, subs: new Set(), ready: null });
  return auths.get(name);
}

// The remembered user is read once per page. Nothing is reported before that.
function ready(auth) {
  if (!auth.ready) auth.ready = Promise.resolve(bridge('auth.current', { app: auth.name })).then((u) => { auth.currentUser = u || null; });
  return auth.ready;
}
function change(auth, user) {
  auth.currentUser = user || null;
  [...auth.subs].forEach((f) => f(auth.currentUser));
}

// Like the SDK: the listener is called a moment later with the remembered user (or null), then at every
// sign-in and sign-out. Returns the function that stops it.
export function onAuthStateChanged(auth, next) {
  auth.subs.add(next);
  ready(auth).then(() => { if (auth.subs.has(next)) next(auth.currentUser); });
  return () => { auth.subs.delete(next); };
}

async function enter(op, auth, email, password) {
  await ready(auth);
  const r = await bridge(op, { app: auth.name, email: String(email == null ? '' : email), password: String(password == null ? '' : password) });
  if (r.error) throw fail(r.error);
  change(auth, r.user);
  return { user: r.user };
}
export function signInWithEmailAndPassword(auth, email, password) { return enter('auth.signIn', auth, email, password); }
export function createUserWithEmailAndPassword(auth, email, password) { return enter('auth.create', auth, email, password); }

export async function signOut(auth) {
  await ready(auth);
  await bridge('auth.signOut', { app: auth.name });
  change(auth, null);
}

export async function sendPasswordResetEmail(auth, email) {
  const r = await bridge('auth.reset', { app: auth.name, email: String(email == null ? '' : email) });
  if (r.error) throw fail(r.error);
}

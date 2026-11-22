# A fake Firebase for the sync tests

The apps' `sync.js` files import the Firebase SDK from `https://www.gstatic.com/firebasejs/<version>/`.
Tests must not contact an outside host, so a browser context that is *attached* to a fake cloud gets three
small stand-ins instead, and the accounts and documents live in the test process. Two contexts attached to
the same cloud are two phones on one account.

Nothing in this folder knows the name of an app, a Firebase app, a collection or a document. It was written
for Overload's `sync.js` (Firebase default app, `users/{uid}/meta/state`, `workouts`) and is meant to be used
unchanged for Fuel's (Firebase app named `fuel`, `users/{uid}/meta/fuel`, `fuelDays`).

| File | What |
| --- | --- |
| `route.js` | The cloud, in Node: `createCloud()`, `cloud.attach(context, name)`. The only file a test requires. |
| `firebase-app.js`, `firebase-auth.js`, `firebase-firestore.js` | The stand-ins that run in the page. Served for any SDK version. |
| `selftest.js` | `node tests/fake-firebase/selftest.js`: checks the behaviours listed below, without any app (24 checks). |

`tests/train-sync.js` is a full example with the real app, two versions of it and up to five phones.

## Using it

```js
const lib = require('./lib');
const { createCloud } = require('./fake-firebase/route');

const cloud = createCloud();                               // { rules: false } switches the security rule off
const phone = await lib.newPhone(browser, { now: fx.meta.now, timezoneId: fx.meta.tz });
const A = await cloud.attach(phone.context, 'A');          // before the first page is opened
const page = await lib.openApp(phone.context, url);
await page.waitForFunction(() => !!window.__overloadSync); // the sync module loads after the app
await page.evaluate(() => window.__overloadSync.createAccount('me@example.com', 'secret1'));

await page.clock.runFor(1100);                             // the apps push one second after a save
await cloud.idle();                                        // writes delivered, the other phones told

cloud.writes({ who: 'A' })                                 // every set and delete A issued, with its path
cloud.get('users/U1/meta/state')                           // a document, parsed
```

`attach` does two things to the context: it answers the three SDK addresses with the stand-ins (the route is
added after `lib.newPhone`'s own, so it wins over "abort everything that is not local"), and it exposes one
function, `window.__fakeFirebase`, through which the stand-ins reach `route.js`. Nothing is put into the
page's localStorage or IndexedDB: what the SDK would keep on the phone (the sign-in, the offline cache, the
queue of unsent writes) is kept per device in the test process, so it survives a reload of the page and a
change of the app's files, like the real thing, and the app's own storage stays exactly the app's.

### The cloud

| | |
| --- | --- |
| `cloud.attach(context, name)` | Makes the context a device. `name` is its name in the log. Returns the device (below). |
| `cloud.addAccount(email, password)` | An account that exists before any phone signs in. Returns its uid. |
| `cloud.idle()` | Resolves when nothing is in flight: every call answered, every page told about every change, no page with anything left to ask. Does not wait for timers inside the app. |
| `cloud.log` | Everything in order: sign-ins, reads, writes. |
| `cloud.mark()` | The current position in the log, for `{ from }`. |
| `cloud.writes(filter)` | Every `set` and `delete` that was **issued**: `{ n, who, app, uid, type, path, json, batch, state, rev, error }`. `state` is `applied`, `queued` (issued offline, not sent yet) or `rejected`. `app` is the Firebase app name (`[DEFAULT]`, `fuel`). `json` is the document's JSON text for a `set`. filter: `{ who, app, from, path: RegExp }`. |
| `cloud.reads(filter)` | Reads: `get` (one document from the server), `list` (a collection from the server), each with `via: 'get'` (asked once) or `'listen'` (a listener reading); and `listen` (a listener was started on that path). |
| `cloud.get(path)`, `cloud.text(path)` | A document, parsed, or its JSON text exactly as written. `undefined` when it does not exist. |
| `cloud.paths(prefix)`, `cloud.snapshot(prefix)` | The document paths below a prefix; `{ path: JSON text }` of them. Compare two snapshots (`JSON.stringify`) to prove that nothing below a path changed, byte for byte. |
| `cloud.set(path, data, who)`, `cloud.delete(path, who)` | A writer that is not a page (another app, the console). Every phone is told. Not subject to the rule. |
| `cloud.rev` | Goes up by one with every batch the server takes. |

Accounts get the uids `U1`, `U2`, … in the order they are created.

### A device

| | |
| --- | --- |
| `device.setOffline(flag)` | No network for the pages (`navigator.onLine`, the `online` / `offline` events, via `context.setOffline`) **and** no answer from the cloud. Back online, the queued writes are sent first, then every listener reads again. Use this, not `context.setOffline` alone. |
| `device.blockSdk(flag)` | The three SDK addresses are refused: the app's sync module does not load, as on a start without signal before the SDK was stored. |
| `device.rejectNext(code, n)` | The next `n` batches from this device are refused with `code` (default `'permission-denied'`, once). |
| `device.clearCache(app)` | Forget what the SDK had cached on this device (one Firebase app name, or all). |
| `device.user(app)` | Who is signed in for that Firebase app name (default `'[DEFAULT]'`), or `null`. |
| `device.apps` | The Firebase app names this device has used. |
| `device.queued(app)` | The writes waiting for the network: `[{ type, path }]`. |
| `device.sdkRequests` | Every SDK address the context asked for. |

A page whose files come from `route.fulfill` still loads while the device is offline (that is how
`tests/train-sync.js` serves the app, and it stands for "the service worker has the files"). A page served by
a real local server does not: `context.setOffline` cuts that too.

## What it models

Checked by `selftest.js` unless marked otherwise.

- **Auth.** Email and password accounts. `createUserWithEmailAndPassword`, `signInWithEmailAndPassword`,
  `signOut`, `sendPasswordResetEmail` (logged, sends nothing), `onAuthStateChanged` (called a moment after it
  is added with the remembered user or `null`, then at every sign-in and sign-out). The sign-in is remembered
  per device **and per Firebase app name**: two apps with different app names on one device have separate
  sessions, as with the real SDK. Error codes: `auth/invalid-email`, `auth/missing-password`,
  `auth/weak-password` (under 6 characters, on create), `auth/email-already-in-use`,
  `auth/invalid-credential` (unknown address or wrong password), `auth/network-request-failed` (offline).
- **The security rule** of `firestore.rules`: a signed-in user may read and write below `users/{own uid}/`
  and nothing else. A batch with one forbidden path is refused as a whole (`permission-denied`), a server read
  throws it, a listener gets it in its error callback and is dead afterwards.
- **Server reads.** `getDocFromServer`, `getDocsFromServer`: straight from the cloud; `unavailable` offline.
- **Writes.** `writeBatch(db)` with `set`, `delete`, `commit`; `setDoc`, `deleteDoc` as one-write batches.
  A batch is taken or refused as a whole. More than 500 writes: `invalid-argument`. A field whose value is
  `undefined`: `invalid-argument`. Documents are kept as the JSON text of what was written.
- **Paths.** `doc(db, ...segments)`, `collection(db, ...segments)`, also with a collection or document as the
  first argument. An empty segment or the wrong number of segments throws at once, as in the SDK (a food day
  whose key is empty or holds `/` is the case `dev/notes/sync.md` 1.10 warns about).
- **Listeners** (`onSnapshot` on a document or a collection, with or without an options object, or with an
  observer object):
  - first what the device has cached, marked `fromCache`, then the server's differences;
  - a document listener always gets a first snapshot, also when the document does not exist; a collection
    listener too, also when it is empty;
  - `docChanges()` gives `added`, `modified`, `removed`; the snapshot also has `docs`, `size`, `empty`,
    `forEach`;
  - the page's own write is reported to its listeners at once, marked `hasPendingWrites`;
  - a change of metadata alone is never reported (so the server's confirmation of one's own write is silent);
  - a batch that is refused puts the listeners back to what the server holds.
- **Offline.** Writes are queued per device and per Firebase app name; `commit()` does not settle while
  offline; the queue survives a reload of the page and is sent, in order, when the device is online again.
  A listener started offline reports the cached documents with the queued writes laid over them; a document
  that is not cached is reported as not existing, `fromCache`.
- **Several phones.** After every write that the server takes, every other page of every online device reads
  its listeners again.
- **`initializeApp(options, name)`**: the default name is `[DEFAULT]`; the same name with other options
  throws `app/duplicate-app`. (Not in the self-test.)

## What it does not model

- The real SDK's code, wire protocol, IndexedDB format, or timing. Listeners are served by reading the whole
  document or collection again after each change; the order of snapshots between different listeners is
  whatever that gives. Real latency is absent.
- `onSnapshot` with `includeMetadataChanges: true` (the option is accepted and ignored), queries (`where`,
  `orderBy`, `limit`), `getDoc` / `getDocs` (cache-or-server reads), transactions, `updateDoc`, `set` with
  `{ merge }` (throws `unimplemented`), field values such as `serverTimestamp()`, subcollection group queries.
- A server read made while this page has unconfirmed writes shows the server's copy without them.
- Types other than what JSON carries (dates, bytes, references), and the limits of Firestore: document size
  (1 MiB), write rate, index rules. Only the 500-writes-per-batch limit is there.
- Auth beyond the above: token expiry, email verification, password reset actually changing anything,
  several tabs of one device following each other's sign-in.
- Rules other than the one in `firestore.rules`. If the rules in the Firebase console differ, the fake is wrong.
- Whether the persistent cache works on a given phone (private browsing, a second tab): here it always does.
- The SDK loading further files from gstatic.

Statements in `dev/notes/sync.md` marked **(SDK)** rest on the SDK's documentation; this fake follows the same
documentation and proves nothing about the real SDK. A run against the Firebase emulator would.

## When a test hangs or passes for the wrong reason

- `cloud.idle()` cannot see a timer inside the app. Both `sync.js` files push one second after a save: move
  the page's clock (`page.clock.runFor(1100)`, with `lib.newPhone({ now })`) and call `idle()` again, in a
  loop, until `cloud.log.length` stops growing. `settle()` in `tests/train-sync.js` does exactly that and
  reports when two phones never stop writing to each other.
- A phone on v2.8 rewrites what it receives (it sorts deletion records) and sends the core again. Compare
  what **one write** carried (`write.json`) with what the cloud held before it, not the cloud's state some
  time after.
- Attach before the first page of the context is opened, and give every device its own name.

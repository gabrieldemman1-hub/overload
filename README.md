# Overload

A personal hypertrophy tracker for one phone. Log weight, sets and reps; the app
tells you what to lift next time based on the rep range and how you recovered.
Modelled on the RP Hypertrophy app's flow, but without mesocycles or deloads.

No backend, no accounts, no build step. Everything is stored in the browser on
the device it runs on.

## Progression rules

Rep range defaults to 10–12 (change it in Settings, or per exercise).

| What you logged                    | Next time                                        |
| ---------------------------------- | ------------------------------------------------ |
| Every set hit 12                   | Weight goes up one jump (2.5 lb), goal back to 10 |
| Some sets hit 12                   | Same weight, push every set to 12                |
| Every set at least 10              | Same weight, goal is your lowest set + 1         |
| A set fell below 10                | Same weight, build back to 10                    |

Feedback after each exercise (pump, joint pain, workload) and a soreness
check-in at the start of the next session for that muscle adjust the number of
sets:

| Feedback                                      | Sets |
| --------------------------------------------- | ---- |
| Still sore, or moderate+ joint pain, or "too much" | −1   |
| Recovered early and low pump                  | +1   |
| Never sore and workload felt easy             | +1   |
| Anything else                                 | keep |

Moderate joint pain blocks a weight increase for that session. "A lot" of joint
pain drops the weight two jumps and suggests swapping the exercise. Sets are
capped between 1 and the "Max sets" setting (default 6).

## Files

| File                   | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `index.html`           | App shell and bottom tab bar                 |
| `app.js`               | State, progression algorithm, all screens    |
| `styles.css`           | Dark theme with red accent                   |
| `sync.js`              | Optional cloud sync via Firebase             |
| `firestore.rules`      | Firestore security rules to paste in Firebase|
| `sw.js`                | Service worker so the app opens offline      |
| `manifest.webmanifest` | Home-screen install metadata                 |
| `icon*.png`, `icon.svg`| App icons                                    |

## Run it

Any static file server works. For example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`. Opening `index.html` directly from disk also
works (the service worker is skipped in that case).

## Put it on an iPhone

1. Host the folder somewhere with HTTPS. GitHub Pages is the easiest: push this
   folder to a repo, then Settings → Pages → deploy from the branch.
2. Open the page in Safari on the phone.
3. Tap Share, then **Add to Home Screen**.

It launches full screen, works offline, and keeps its data between launches.

## Cloud sync (optional)

Settings → Cloud sync lets you sign in with an email and password. After that
every change is mirrored to Firebase (Firestore) under your account and pulled
back on any device you sign in on. Offline changes queue and send later. The
app works exactly the same signed out; it just stays on one phone.

Data layout in Firestore:

| Document                          | Contents                                          |
| --------------------------------- | ------------------------------------------------- |
| `users/{uid}/meta/state`          | settings, exercises, prescriptions, program       |
| `users/{uid}/workouts/{id}`       | one document per workout                          |

Firebase project setup (one time, in the Firebase console):

1. Authentication → Sign-in method → enable **Email/Password**.
2. Firestore Database → Rules → paste the contents of `firestore.rules` → Publish.

`sync.js` holds the Firebase web config. Those values identify the project;
they are not secrets. Access is controlled by the rules above, which only let a
signed-in user read and write their own documents.

## Backups

Without cloud sync, data lives only in that browser's storage. Settings →
Export JSON saves a file you can re-import later. iOS can clear website data for a home-screen app if
you delete the app, so export now and then.

## Debugging

`window.__overload` exposes the live state and the `computeNext` function in the
browser console.

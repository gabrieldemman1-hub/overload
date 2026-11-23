/* Stand-in for https://www.gstatic.com/firebasejs/<version>/firebase-app.js. Tests only: see README.md.
 *
 * Nothing here knows about Overload or Fuel. An app is just a name: the default one is '[DEFAULT]', as in the
 * real SDK, and a second app on the same page must be given a name of its own.
 */
const apps = new Map();   // name -> app, for this page

export function initializeApp(options, name) {
  const appName = name == null ? '[DEFAULT]' : String(name);
  if (!appName) { const e = new Error('fake Firebase: an app name cannot be empty'); e.code = 'app/bad-app-name'; throw e; }
  const had = apps.get(appName);
  if (had) {
    // The real SDK hands back the same app for the same options and refuses different ones.
    if (JSON.stringify(had.options) === JSON.stringify(options || {})) return had;
    const e = new Error('fake Firebase: an app named ' + appName + ' already exists with other options'); e.code = 'app/duplicate-app'; throw e;
  }
  const app = { name: appName, options: Object.assign({}, options || {}) };
  apps.set(appName, app);
  return app;
}

export function getApp(name) {
  const app = apps.get(name == null ? '[DEFAULT]' : String(name));
  if (!app) { const e = new Error('fake Firebase: no app named ' + (name || '[DEFAULT]')); e.code = 'app/no-app'; throw e; }
  return app;
}

export function getApps() { return [...apps.values()]; }

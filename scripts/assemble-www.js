/* Collect the web app into www/ for Capacitor to bundle into the APK.
   The app lives at the repo root (so GitHub Pages can serve it); this copies
   just the runtime files into the native project's web directory. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

const items = ['index.html', 'css', 'js', 'icons', 'manifest.webmanifest', 'sw.js'];
for (const item of items) {
  const from = path.join(root, item);
  if (!fs.existsSync(from)) { console.warn('missing, skipped:', item); continue; }
  fs.cpSync(from, path.join(www, item), { recursive: true });
}

const count = fs.readdirSync(www).length;
console.log(`assembled www/ with ${count} entries`);

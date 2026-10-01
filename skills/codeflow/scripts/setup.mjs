// One-time setup for the CodeFlow kit on this machine. Safe to run again.
//   node setup.mjs
// Installs the two dependencies (playwright-core, ffmpeg-static) into ~/.codeflow/runtime (kept when the
// skill is updated), then checks that a browser (Chrome or Edge), ffmpeg and the font folders all work.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.join(os.homedir(), '.codeflow', 'runtime');
const ok = (m) => console.log('  ✓ ' + m), bad = (m) => console.log('  ✗ ' + m);
let fine = true;

const major = +process.versions.node.split('.')[0];
if (major < 18) { bad(`Node ${process.versions.node} is too old: install Node 18+ from nodejs.org`); process.exit(1); }
ok('Node ' + process.versions.node);

const deps = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies;
const has = (dir) => Object.keys(deps).every(d => fs.existsSync(path.join(dir, 'node_modules', d)));
if (!has(ROOT)) {                                   // a dev checkout keeps node_modules next to the kit
  const pkg = path.join(RUNTIME, 'package.json');
  const want = JSON.stringify({ name: 'codeflow-runtime', private: true, dependencies: deps }, null, 1);
  const same = fs.existsSync(pkg) && fs.readFileSync(pkg, 'utf8') === want;
  if (!same || !has(RUNTIME)) {
    console.log('  … installing playwright-core + ffmpeg-static (one time per computer, ~80 MB)');
    fs.mkdirSync(RUNTIME, { recursive: true });
    fs.writeFileSync(pkg, want);
    const r = spawnSync('npm install --no-audit --no-fund --loglevel error', { cwd: RUNTIME, stdio: 'inherit', shell: true });
    if (r.status !== 0) { bad('npm install failed. Check your internet connection and run setup again.'); process.exit(1); }
  }
}
ok('dependencies installed');

const { FFMPEG, closeBrowser, newPage } = await import('./kit/browser.mjs');
const v = spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' });
if (v.status === 0) ok('ffmpeg: ' + (v.stdout.split('\n')[0] || '').slice(0, 60)); else { fine = false; bad('ffmpeg not working (' + FFMPEG + ')'); }

try { const p = await newPage(200, 200); await p.close(); ok('browser (Chrome/Edge) starts'); }
catch (e) { fine = false; bad('no browser: install Google Chrome, or run: npx playwright-core install chromium  (' + e.message.split('\n')[0] + ')'); }
await closeBrowser();

const { fontIndex } = await import('./kit/fonts.mjs');
const n = Object.keys(fontIndex()).length;
if (n) ok(n + ' installed fonts found'); else { fine = false; bad('no fonts found in the system font folders'); }

console.log(fine ? '\nCodeFlow kit is ready.' : '\nFix the ✗ items above, then run setup again.');
process.exitCode = fine ? 0 : 1;

// Talks to the CodeFlow bridge running inside After Effects (see extension/server/server.js).
//   node kit/ae.mjs ping
//   node kit/ae.mjs build <spec.json> [--keep]        (--keep = don't replace the previous build)
//   node kit/ae.mjs save <file.aep>
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const APPDIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'Library/Application Support'), 'CodeFlow');

// every running After Effects with CodeFlow writes bridges/<port>.json (bridge.json = legacy/most recent).
// Newest first; stale files (dead port or old token) are skipped automatically.
function bridges() {
  const out = [], seen = new Set();
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const files = [];
  try { for (const f of fs.readdirSync(path.join(APPDIR, 'bridges'))) files.push(path.join(APPDIR, 'bridges', f)); } catch {}
  files.push(path.join(APPDIR, 'bridge.json'));
  let list = files.map(read).filter(Boolean).sort((a, b) => String(b.started).localeCompare(String(a.started)));
  if (process.env.CODEFLOW_PORT) list = list.filter(b => String(b.port) === String(process.env.CODEFLOW_PORT));
  for (const b of list) { const key = b.port + ':' + b.token; if (!seen.has(key)) { seen.add(key); out.push(b); } }
  if (!out.length) throw new Error('CodeFlow bridge not running: open After Effects with the CodeFlow extension installed.');
  return out;
}

// node:http instead of fetch: renders can take many minutes and fetch gives up after 5
async function call(route, body = {}) {
  let last;
  for (const b of bridges()) {
    try { return await callOne(b, route, body); }
    catch (e) { last = e; if (e.code !== 'ECONNREFUSED' && !/-> 403/.test(e.message)) throw e; }
  }
  throw last;
}
function callOne(b, route, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: b.port, path: route, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'x-codeflow-token': b.token } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data; try { data = JSON.parse(text); } catch { data = { ok: false, raw: text }; }
        // 402 = no CodeFlow license / free builds used up: pass the panel's message through as-is for the user
        if (res.statusCode === 402) reject(new Error(data.error || 'CodeFlow license needed: open Window > Extensions > CodeFlow in After Effects.'));
        else if (res.statusCode >= 400) reject(new Error(`bridge ${route} -> ${res.statusCode}: ${data.error || text}`));
        else resolve(data);
      });
    });
    req.on('error', reject);
    req.setTimeout(0);
    req.end(payload);
  });
}

export const ping = () => call('/ping');
export const build = (spec, options = {}) => call('/build', { spec: path.resolve(spec).split('\\').join('/'), options });
export const save = file => call('/save', { path: path.resolve(file).split('\\').join('/') });
export const evalJsx = script => call('/eval', { script });
export async function renderComp(comp, out, template = '') {
  const o = path.resolve(out).split('\\').join('/');
  try { return await call('/render', { comp, out: o, template }); }
  catch (e) {
    if (!/unknown route/.test(e.message)) throw e;
    // older running bridge without /render: go through /eval (dev mode only)
    const host = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension/host/codeflow.jsx').split('\\').join('/');
    const r = await evalJsx(`$.evalFile(new File(${JSON.stringify(host)})); codeflow.renderComp(${JSON.stringify(comp)}, ${JSON.stringify(o)}, ${JSON.stringify(template)})`);
    return typeof r.raw === 'string' ? JSON.parse(r.raw) : r;
  }
}

// CLI
const [, self, cmd, a] = process.argv;
if (self && path.basename(self) === 'ae.mjs') {
  (async () => {
    let out;
    if (cmd === 'ping') out = await ping();
    else if (cmd === 'build') out = await build(a, { replace: !process.argv.includes('--keep') });
    else if (cmd === 'save') out = await save(a);
    else if (cmd === 'eval') out = await evalJsx(a);
    else if (cmd === 'render') out = await renderComp(a, process.argv[4]);
    else if (cmd === 'evalfile') out = await evalJsx(fs.readFileSync(a, 'utf8'));
    else { console.log('usage: ae.mjs ping | build <spec> [--keep] | save <file.aep> | eval <jsx>'); return; }
    console.log(JSON.stringify(out, null, 1));
  })().catch(e => { console.error(e.message); process.exit(1); });
}

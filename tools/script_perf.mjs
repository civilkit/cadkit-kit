#!/usr/bin/env node
// Measure a Script tab run in headless Chrome: wall time, longest main-thread stall, JS heap, renderer memory, repeated runs.
//   node tools/script_perf.mjs [--example matx-frame|matx-case] [--runs 3] [--port 9900] [--vite-port 5600] [--out file.json]
// One headless Chrome (debugging port 9900-9949) and one vite (5600-5649); both are stopped at the end.
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, Page } from './ux/cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = process.env.PERF_SCRATCH ?? '/path/to/work/scratch-script0';
const a = process.argv.slice(2); const arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const LEGACY = a.includes('--legacy'), PROFILE = a.includes('--profile');
const EXAMPLE = arg('example', 'matx-frame'), RUNS = +arg('runs', 3), PORT = +arg('port', 9900), VPORT = +arg('vite-port', 5600), OUT = arg('out', null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rssMb = (marker) => { try { return Math.round(execSync(`ps -axo rss,command | grep -F -- "${marker}" | grep -v grep | awk '{s+=$1} END {print s/1024}'`).toString().trim()); } catch { return null; } };

const vite = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'apps/cad', '--config', 'vite.config.ts', '--port', String(VPORT), '--strictPort'], { cwd: ROOT, env: { ...process.env, VITE_CACHE_DIR: join(SCRATCH, 'vite-cache') }, stdio: 'ignore' });
const profile = join(SCRATCH, 'chrome-profile-perf'); mkdirSync(profile, { recursive: true });
const chrome = spawn(findChrome(), [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const stop = () => { try { chrome.kill('SIGTERM'); } catch {} try { vite.kill('SIGTERM'); } catch {} };
process.on('SIGINT', () => { stop(); process.exit(130); });
const result = { example: EXAMPLE, legacy: LEGACY, runs: [] };
try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://localhost:${VPORT}/`)).ok) break; } catch {} await sleep(500); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {} await sleep(250); }
  const page = await Page.open(PORT);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: `http://localhost:${VPORT}/${LEGACY ? '?legacyScript=1' : ''}` });
  for (let i = 0; i < 200 && !(await page.eval(`!!document.querySelector('.status, .rb-btn')`).catch(() => false)); i++) await sleep(300);
  await page.eval(`localStorage.clear(); 0`); await page.send('Page.reload');
  for (let i = 0; i < 200 && !(await page.eval(`!!document.querySelector('.status, .rb-btn')`).catch(() => false)); i++) await sleep(300);
  await sleep(1500);
  const click = async (sel, text) => { const p = await page.eval(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${JSON.stringify(text)} === '' || (e.getAttribute('aria-label') || e.textContent || '').trim() === ${JSON.stringify(text)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!p) throw new Error('no ' + text); await page.click(p.x, p.y); await sleep(200); };
  for (let i = 0; i < 40 && !(await page.eval(`!!document.querySelector('.script-panel select')`)); i++) { await click('button', 'Script').catch(() => {}); await sleep(500); }
  if (!(await page.eval(`!!document.querySelector('.script-panel select')`))) { writeFileSync(join(SCRATCH, 'perf-fail.png'), await page.screenshot()); throw new Error('Script panel not found; see perf-fail.png'); }
  await page.eval(`(() => { const s = document.querySelector('.script-panel select'); s.value = ${JSON.stringify(EXAMPLE)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
  // main-thread stall monitor
  await page.eval(`window.__stall = { max: 0, n: 0 }; (() => { let last = performance.now(); setInterval(() => { const t = performance.now(); const d = t - last - 50; if (d > window.__stall.max) window.__stall.max = d; if (d > 200) window.__stall.n++; last = t; }, 50); })(); 0`);
  const heap = () => page.eval(`(() => { try { gc(); } catch {} return Math.round(performance.memory.usedJSHeapSize / 1048576); })()`);
  result.heapStartMb = await heap(); result.rssStartMb = rssMb(profile);
  for (let run = 1; run <= RUNS; run++) {
    await page.eval(`window.__stall = { max: 0, n: 0 }; 0`);
    const t0 = Date.now(); const samples = []; let seenProgress = null;
    if (PROFILE) { await page.send('Profiler.enable'); await page.send('Profiler.setSamplingInterval', { interval: 1000 }); await page.send('Profiler.start'); }
    await click('.script-panel button.primary', '');
    await sleep(500);
    // the unsaved-changes question of a part that counts as modified: Don't save
    await page.eval(`(() => { const b = document.querySelectorAll('.discard-dlg button')[1]; if (b) b.click(); })()`);
    for (;;) {
      await sleep(1000);
      const st = await page.eval(`(() => ({ status: document.querySelector('.script-panel [role=status]')?.innerText ?? null, heap: Math.round(performance.memory.usedJSHeapSize / 1048576), busy: !!document.querySelector('.status .busy') }))()`).catch(() => null);
      if (!st) { samples.push({ t: Date.now() - t0, hung: true }); if (Date.now() - t0 > 900000) break; continue; }
      samples.push({ t: Date.now() - t0, ...st }); if (st.status) seenProgress = st.status;
      if (!st.status && Date.now() - t0 > 1500) break;
      if (Date.now() - t0 > 900000) break;
    }
    const wall = Date.now() - t0;
    if (PROFILE) {
      const { profile } = await page.send('Profiler.stop', {}, 120000);
      const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000); });
      console.log('PROFILE run ' + run + ' top self ms:\n' + [...self].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => `${Math.round(v)}\t${k}`).join('\n'));
    }
    const info = await page.eval(`(() => { const c = window.__cad?.controller; return { features: c?.document()?.features.length ?? null, history: c?.session?.history().length ?? null, triangles: c?.lastView?.mesh?.triFace?.length ?? null, facts: window.__cad?.store?.facts?.value ?? null }; })()`);
    const stall = await page.eval(`window.__stall`);
    await sleep(2000);
    const run_ = { run, wallMs: wall, lastProgress: seenProgress, maxStallMs: Math.round(stall.max), stallsOver200ms: stall.n, heapAfterMb: await heap(), rssAfterMb: rssMb(profile), ...info, heapPeakMb: Math.max(...samples.map((s) => s.heap ?? 0)), polls: samples.length };
    result.runs.push(run_); console.log(JSON.stringify(run_));
  }
  page.close();
} finally { stop(); }
if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));

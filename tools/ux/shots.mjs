#!/usr/bin/env node
// Post-change UX review toolchain: drive the app through the scenarios, save a PNG + metrics JSON per scenario/width/scheme, write report.md.
//   node tools/ux/shots.mjs --out <dir> [--baseline <dir>] [--url <url>] [--only a,b] [--quick] [--widths 1440,820] [--schemes light,dark]
// Without --url it starts the vite dev server of this checkout on a free port in 5500-5549 and stops it at the end.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, Page } from './cdp.mjs';
import { collectMetrics, findings, THRESHOLDS } from './metrics.mjs';
import { SCENARIOS, WS } from './scenarios.mjs';
import { diffPng } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRATCH = '/path/to/work/scratch-uxreview';
const args = (() => { const o = {}; const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; } return o; })();
const OUT = resolve(args.out ?? join(existsSync(SCRATCH) ? SCRATCH : ROOT, 'ux-shots'));
const WIDTHS = String(args.widths ?? (args.quick ? '1440' : '1440,820')).split(',').map((w) => ({ w: +w, h: +w >= 1200 ? 900 : 1000 }));
const SCHEMES = String(args.schemes ?? (args.quick ? 'light' : 'light,dark')).split(',');
const ONLY = args.only ? String(args.only).split(',') : null;
const CHROME_PORT = +(args['chrome-port'] ?? 9700 + Math.floor(Math.random() * 99));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Skip extends Error {}

/** Find the first visible element matching `sel` whose aria-label, title or text equals (else starts with) `text`; returns its centre. */
const FIND = (sel, text, scope) => `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const want = norm(${JSON.stringify(text ?? '')});
  const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'}; if (!root) return null;
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
  const els = [...root.querySelectorAll(${JSON.stringify(sel)})].filter(vis);
  const names = (e) => [e.getAttribute('aria-label'), e.title, e.textContent].map(norm);
  let hit = !want ? els[0] : els.find((e) => names(e).some((n) => n === want)) ?? els.find((e) => names(e).some((n) => n.startsWith(want))) ?? els.find((e) => names(e).some((n) => n.includes(want)));
  if (!hit) return null; hit.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = hit.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;

function makeCtx(page, base) {
  const ctx = {
    page, sleep,
    skip(why) { throw new Skip(why); },
    async idle(timeout = 60000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.eval(`!!document.querySelector('.status .ready')`)) return true; await sleep(150); } return false; },
    async settle(ms = 400) { await sleep(ms); await ctx.idle(); await sleep(150); },
    async click(sel, text, scope) { const p = await page.eval(FIND(sel, text, scope)); if (!p) return false; await page.click(p.x, p.y); await sleep(150); return true; },
    /** a row of the feature tree / outliner by (part of) its name */
    async clickRow(text, { dbl = false } = {}) {
      const p = await page.eval(FIND('.tree-wrap *, [role=treeitem], li, [class*=row], [class*=item]', text)); if (!p) return false;
      await page.click(p.x, p.y); if (dbl) { await sleep(60); await page.mouse('mousePressed', p.x, p.y).then(() => page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 2 })).then(() => page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 2 })); }
      await sleep(200); return true;
    },
    async pressKey(k, o) { await page.key(k, o); await sleep(150); },
    async canvasRect() { return page.eval(`(() => { const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`); },
    /** Fresh app state: set storage, reload, accept the restore prompt, wait until idle. */
    async open({ sample, doc, workspace = 'plasticity', mutate, wait = true, theme } = {}) {
      let d = doc;
      if (!d && sample) d = JSON.parse(readFileSync(join(ROOT, 'apps/cad/public/samples', sample.endsWith('.ckpart') ? sample : sample + '.ckpart'), 'utf8'));
      if (d && mutate) mutate(d);
      const items = { 'cad.workspace': JSON.stringify(WS[workspace] ?? workspace), 'cad.theme': JSON.stringify(theme ?? ctx.theme ?? 'light') };
      if (d) items['cad.autosave.v1'] = JSON.stringify({ name: d.name ?? sample ?? 'part', doc: d, savedAt: Date.now() });
      await page.eval(`localStorage.clear(); const it = ${JSON.stringify(items)}; for (const k in it) localStorage.setItem(k, it[k]); 0`);
      await page.send('Page.reload'); await sleep(800);
      for (let i = 0; i < 80 && !(await page.eval(`!!document.querySelector('.rb-btn, .tb-icon, .status')`)); i++) await sleep(150);
      if (d) { for (let i = 0; i < 30; i++) { if (await ctx.click('button', 'Restore')) break; await sleep(150); } }
      if (wait) await ctx.settle(500);
    },
  };
  return ctx;
}

async function startVite() {
  for (let port = 5500; port < 5550; port++) {
    try { await fetch(`http://localhost:${port}/`); continue; } catch { /* free */ }
    const cache = existsSync(SCRATCH) ? join(SCRATCH, 'vite-cache') : join(ROOT, 'node_modules/.vite-ux');
    const proc = spawn('npx', ['vite', 'apps/cad', '--config', 'vite.config.ts', '--port', String(port), '--strictPort'], { cwd: ROOT, env: { ...process.env, VITE_CACHE_DIR: cache }, stdio: 'ignore' });
    for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) return { url: `http://localhost:${port}/`, stop: () => proc.kill('SIGTERM') }; } catch { /* booting */ } await sleep(500); }
    proc.kill('SIGTERM'); throw new Error('vite did not start');
  }
  throw new Error('no free port in 5500-5549');
}

async function main() {
  const t0 = Date.now(); mkdirSync(OUT, { recursive: true });
  const vite = args.url ? null : await startVite(); const url = args.url ?? vite.url;
  const chrome = await launchChrome({ port: CHROME_PORT, profileDir: existsSync(SCRATCH) ? join(SCRATCH, 'chrome-profile') : undefined });
  const results = []; let exit = 0;
  try {
    const page = await Page.open(CHROME_PORT); const ctx = makeCtx(page, url);
    await page.setViewport(WIDTHS[0].w, WIDTHS[0].h, false); await page.goto(url);
    for (let i = 0; i < 100 && !(await page.eval(`!!document.querySelector('.status, .rb-btn')`).catch(() => false)); i++) await sleep(300);   // first load: dependency pre-bundling
    for (const sc of SCENARIOS.filter((s) => !ONLY || ONLY.includes(s.id))) {
      // the scenario runs once (at the first variant); the other widths and the dark scheme are captured from the same state without a reload
      const variants = WIDTHS.flatMap(({ w, h }) => SCHEMES.map((scheme) => ({ w, h, scheme }))).filter((v, i) => !args.quick ? (v.scheme === SCHEMES[0] || v.w === WIDTHS[0].w) : true);
      let state = 'pending', why = '';
      for (const { w, h, scheme } of variants) {
        const name = `${sc.id}--${w}-${scheme}`; const r = { scenario: sc.id, title: sc.title, w, scheme, name };
        const t1 = Date.now();
        try {
          if (state === 'skip') throw new Skip(why);
          if (state === 'error') throw new Error(why);
          ctx.theme = scheme; page.logs.length = 0;
          await page.setViewport(w, h, scheme === 'dark');
          if (state === 'pending') {
            try { await Promise.race([sc.run(ctx), sleep(120000).then(() => { throw new Error('scenario timed out'); })]); state = 'ran'; }
            catch (e) { if (e instanceof Skip) { state = 'skip'; why = e.message; } else { state = 'error'; why = String(e.message ?? e); } throw e; }
          } else { await page.eval(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(scheme)}); 0`); await sleep(500); }
          await sleep(200);
          writeFileSync(join(OUT, name + '.png'), await page.screenshot());
          r.metrics = await collectMetrics(page); r.findings = findings(r.metrics); r.logs = page.logs.slice(0, 5);
          writeFileSync(join(OUT, name + '.json'), JSON.stringify({ scenario: sc.id, title: sc.title, width: w, scheme, consoleErrors: r.logs, findings: r.findings, ...r.metrics }, null, 1));
          if (args.baseline && existsSync(join(args.baseline, name + '.png'))) { const d = diffPng(readFileSync(join(args.baseline, name + '.png')), readFileSync(join(OUT, name + '.png'))); r.diff = d.pct; if (d.sizeMismatch) r.diffNote = 'size ' + d.sizeMismatch.join(' vs '); if (d.image && d.pct > 0) writeFileSync(join(OUT, name + '.diff.png'), d.image); }
          else if (args.baseline) r.diffNote = 'no baseline';
        } catch (e) {
          if (e instanceof Skip) { r.skipped = e.message; if (variants[0].w === w && variants[0].scheme === scheme) console.warn(`SKIP ${sc.id}: ${e.message}`); }
          else { r.error = String(e.message ?? e).slice(0, 200); console.warn(`FAIL ${name}: ${r.error}`); try { writeFileSync(join(OUT, name + '.png'), await page.screenshot()); } catch { /* none */ } }
        }
        r.ms = Date.now() - t1; results.push(r); console.log(`${r.skipped ? 'skip' : r.error ? 'FAIL' : 'ok  '} ${name} ${r.ms}ms${r.findings ? ' findings=' + r.findings.length : ''}${r.diff !== undefined ? ' diff=' + r.diff + '%' : ''}`);
      }
    }
    page.close();
  } finally { chrome.close(); vite?.stop(); }
  writeFileSync(join(OUT, 'report.md'), report(results, Date.now() - t0));
  console.log(`report: ${join(OUT, 'report.md')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  process.exit(exit);
}

function report(results, ms) {
  const L = [`# UX review report`, '', `Run: ${new Date().toISOString()}, ${(ms / 1000).toFixed(0)} s, ${results.length} captures. Thresholds: ${JSON.stringify(THRESHOLDS)}`, '',
    '`sev` counts: blocker/major/minor/nit findings from the automatic metrics. Metrics are heuristics: a flag is a pointer to look at the screenshot, not a verdict.', ''];
  const sevCount = (f, s) => f.filter((x) => x[0] === s).length;
  L.push('## Summary', '', '| scenario | variant | shot | boxes | overlaps | tiny | unnamed | contrast | hidden tab stops | major/minor/nit | diff |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const png = `[${r.name}.png](${r.name}.png)`;
    if (r.skipped) { L.push(`| ${r.scenario} | ${r.w} ${r.scheme} | skipped: ${r.skipped} | | | | | | | | |`); continue; }
    if (r.error) { L.push(`| ${r.scenario} | ${r.w} ${r.scheme} | ERROR ${r.error.replace(/\|/g, '/')} | | | | | | | | |`); continue; }
    const m = r.metrics;
    L.push(`| ${r.scenario} | ${r.w} ${r.scheme} | ${png} | ${m.counts.floatingBoxes} | ${m.overlaps.length} | ${m.tinyTargets.filter((t) => !t.disabled).length} | ${m.unnamed.length} | ${m.lowContrastTextCount}+${m.lowContrastIcons.length} | ${m.focus.hidden} | ${sevCount(r.findings, 'major')}/${sevCount(r.findings, 'minor')}/${sevCount(r.findings, 'nit')} | ${r.diff !== undefined ? r.diff + '%' + (r.diff > 0 ? ` ([diff](${r.name}.diff.png))` : '') : r.diffNote ?? ''} |`);
  }
  L.push('', '## Findings per scenario', '');
  const byScenario = new Map(); for (const r of results) (byScenario.get(r.scenario) ?? byScenario.set(r.scenario, []).get(r.scenario)).push(r);
  for (const [id, rs] of byScenario) {
    L.push(`### ${id}`, '', rs[0].title, '');
    for (const r of rs) { if (r.skipped || r.error) { L.push(`- **${r.w} ${r.scheme}**: ${r.skipped ? 'skipped, ' + r.skipped : 'error, ' + r.error}`); continue; }
      L.push(`- **${r.w} ${r.scheme}** ([png](${r.name}.png), [json](${r.name}.json)): ${r.findings.length ? '' : 'no automatic findings'}${r.logs.length ? ` console errors: ${r.logs.length}` : ''}`);
      for (const [sev, t] of r.findings) L.push(`  - ${sev}: ${t}`); }
    L.push('');
  }
  return L.join('\n') + '\n';
}

main().catch((e) => { console.error(e); process.exit(1); });

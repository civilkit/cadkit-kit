#!/usr/bin/env node
// Screenshots for the user guide. Serves a pages build (default dist-docshots) and drives the app into each state.
//   WASM_SRC=<ck_wasm.wasm> CK_REBUILD=<kernel checkout> PAGES_OUT=dist-docshots PAGES_SKIP_LEAKCHECK=1 npm run build:pages
//   node tools/doc_shots.mjs [--out <guide/src/img>] [--only a,b] [--site dist-docshots] [--probe]
// Writes <out>/<name>.png and <out>/manifest.json ({name: {file, caption}}). Light theme, 1440x900, clipped to the panel where a shot is about one panel.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchChrome, Page } from './ux/cdp.mjs';
import { serve } from './pages_serve.mjs';
import { WS } from './ux/scenarios.mjs';
import { SHOTS } from './doc_shots_defs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = (() => { const o = {}; const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; } return o; })();
const OUT = resolve(args.out ?? '../wt-kit-scsync/guide/src/img');
const SITE = resolve(ROOT, args.site ?? 'dist-docshots');
const ONLY = args.only ? String(args.only).split(',') : null;
const PORT = 9800 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Skip extends Error {}

const FIND = (sel, text, scope) => `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase(); const want = norm(${JSON.stringify(text ?? '')});
  const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'}; if (!root) return null;
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
  const els = [...root.querySelectorAll(${JSON.stringify(sel)})].filter(vis);
  const names = (e) => [e.getAttribute('aria-label'), e.title, e.textContent].map(norm);
  let hit = !want ? els[0] : els.find((e) => names(e).some((n) => n === want)) ?? els.find((e) => names(e).some((n) => n.startsWith(want))) ?? els.find((e) => names(e).some((n) => n.includes(want)));
  if (!hit) return null; hit.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = hit.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, top: r.y, w: r.width, h: r.height }; })()`;

function makeCtx(page, url) {
  const ctx = {
    page, sleep, url,
    skip(why) { throw new Skip(why); },
    async idle(timeout = 60000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.eval(`!!document.querySelector('.status .ready')`)) return true; await sleep(150); } return false; },
    async settle(ms = 400) { await sleep(ms); await ctx.idle(); await sleep(250); },
    async find(sel, text, scope) { return page.eval(FIND(sel, text, scope)); },
    async clickMod(x, y, { ctrl = false, shift = false } = {}) {
      const m = (ctrl ? 2 : 0) | (shift ? 8 : 0); const k = shift ? { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 } : { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 };
      if (m) await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k, modifiers: m });
      await page.mouse('mouseMoved', x, y);
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, modifiers: m });
      if (m) await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k, modifiers: 0 });
      await sleep(250);
    },
    async snap(name) { const fs = await import('node:fs'); fs.writeFileSync('/private/tmp/claude-501/shots/' + name + '.png', await page.screenshot()); },
    /** Widen the floating left panel by dragging its bottom-right corner handle to the given width. */
    async widenPanel(w) { const r = await ctx.rect('.tree-wrap'); if (!r) return false; const x = r.x + r.w - 5, y = r.y + r.h - 5; await page.mouse('mouseMoved', x, y); await page.mouse('mousePressed', x, y); await page.mouse('mouseMoved', x + 60, y); await page.mouse('mouseMoved', r.x + w, y); await page.mouse('mouseReleased', r.x + w, y); await sleep(500); return true; },
    async scrollPanel(to = 'bottom') { await page.eval(`[...document.querySelectorAll('.tree-wrap, .tree-wrap *')].filter((e) => e.scrollHeight > e.clientHeight + 4 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)).forEach((e) => { e.scrollTop = ${to === 'bottom' ? 'e.scrollHeight' : '0'}; }); 0`); await sleep(300); },
    /** Click the nth (0-based) visible element matching sel whose label/text contains `text`. */
    async clickNth(sel, text, n, scope) { const p = await page.eval(`(() => { const want = ${JSON.stringify(text.toLowerCase())}; const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'}; const els = [...root.querySelectorAll(${JSON.stringify(sel)})].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && [e.getAttribute('aria-label'), e.title, e.textContent].some((t) => (t || '').trim().toLowerCase() === want); }); const e = els[${n}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!p) return false; await page.click(p.x, p.y); await sleep(300); return true; },
    async panelTab(name) { const ok = await ctx.click('.ptabs button', name); await sleep(500); return ok; },
    async click(sel, text, scope) { const p = await page.eval(FIND(sel, text, scope)); if (!p) return false; await page.click(p.x, p.y); await sleep(200); return true; },
    async dblclick(sel, text, scope) { const p = await page.eval(FIND(sel, text, scope)); if (!p) return false; await page.click(p.x, p.y); await sleep(60);
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 2 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 2 }); await sleep(250); return true; },
    async clickRow(text, o = {}) { const sel = '.tree-wrap *, [role=treeitem], li, [class*=row], [class*=item]'; return o.dbl ? ctx.dblclick(sel, text) : ctx.click(sel, text); },
    /** Feature-tree row whose name matches (exact, else contains); returns {act(label)} that presses the row's hover button (Edit, Remove, ...). */
    async rowAct(name, label) {
      const r = await page.eval(`(() => { const n = ${JSON.stringify(name.toLowerCase())}; const rows = [...document.querySelectorAll('.tree .row')]; const row = rows.find((r) => r.querySelector('.row-name')?.textContent.trim().toLowerCase() === n) ?? rows.find((r) => r.querySelector('.row-name')?.textContent.toLowerCase().includes(n)); if (!row) return null; row.scrollIntoView({ block: 'nearest' });
        const rr = row.getBoundingClientRect(); const out = { rx: rr.x + 40, ry: rr.y + rr.height / 2 };
        ${label ? `const b = [...row.querySelectorAll('button')].find((x) => (x.title || x.getAttribute('aria-label')) === ${JSON.stringify(label)}); if (!b) return null; const br = b.getBoundingClientRect(); out.bx = br.x + br.width / 2; out.by = br.y + br.height / 2;` : ''} return out; })()`);
      if (!r) return false;
      await page.mouse('mouseMoved', r.rx, r.ry); await sleep(150);
      if (label) { await page.click(r.bx, r.by); } else await page.click(r.rx, r.ry);
      return true;
    },
    async editRow(name) { if (!(await ctx.rowAct(name, 'Edit'))) return false; await sleep(400); return true; },
    async selRow(name) { const ok = await ctx.rowAct(name); await sleep(300); return ok; },
    async key(k, o) { await page.key(k, o); await sleep(150); },
    /** Type into the input that sits next to (or inside the same row as) a label's text. */
    /** Drag the top edge of the bottom drawer up to y (the drawer must be open). */
    async resizeDrawer(y) { const p = page; await p.mouse('mouseMoved', 700, 661); await p.mouse('mousePressed', 700, 661); await p.mouse('mouseMoved', 700, 600); await p.mouse('mouseMoved', 700, y); await p.mouse('mouseReleased', 700, y); await sleep(500); },
    async openDrawer(tab) { await ctx.key('\\'); await sleep(500); if (tab && !(await ctx.click('[role=tab]', tab))) throw new Skip('no drawer tab ' + tab); await ctx.settle(600); },
    /** Choose an option (by text) in the <select> that sits in the same row as a label. */
    async selectOption(label, option) {
      return page.eval(`(() => { const want = ${JSON.stringify(label.toLowerCase())}; const els = [...document.querySelectorAll('label, span, div, td, summary')].filter((e) => e.children.length < 3 && (e.textContent || '').trim().toLowerCase().startsWith(want)); for (const e of els) { let n = e; for (let i = 0; i < 3 && n; i++, n = n.parentElement) { const sel = n.querySelector && n.querySelector('select'); if (sel) { const o = [...sel.options].find((x) => x.textContent.trim() === ${JSON.stringify(option)}); if (!o) return false; sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); sel.dispatchEvent(new Event('input', { bubbles: true })); return true; } } } return false; })()`);
    },
    async fillField(label, value, { scope = '' } = {}) {
      const r = await page.eval(`(() => { const want = ${JSON.stringify(label.toLowerCase())}; const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document'}; const els = [...root.querySelectorAll('label, span, div, td')].filter((e) => e.children.length < 3 && (e.textContent || '').trim().toLowerCase().startsWith(want)); for (const e of els) { let n = e; for (let i = 0; i < 3 && n; i++, n = n.parentElement) { const inp = n.querySelector && n.querySelector('input:not([type=checkbox]):not([type=radio])'); if (inp) { const b = inp.getBoundingClientRect(); if (b.width > 0) return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } } } return null; })()`);
      if (!r) return false;
      await page.click(r.x, r.y); await page.eval('document.activeElement.select && document.activeElement.select(); 0'); await page.send('Input.insertText', { text: String(value) }); await page.key('Tab'); await sleep(300); return true;
    },
    async type(text) { await page.send('Input.insertText', { text }); await sleep(100); },
    async canvasRect() { return page.eval(`(() => { const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`); },
    async texts(sel) { return page.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => (e.getAttribute('aria-label')||e.title||e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60))`); },
    async rect(sel) { return page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`); },
    loadSample(sample) { return JSON.parse(readFileSync(join(ROOT, 'apps/cad/public/samples', sample.endsWith('.ckpart') ? sample : sample + '.ckpart'), 'utf8')); },
    async open({ sample, doc, workspace, mutate, wait = true } = {}) {
      let d = doc; if (!d && sample) d = ctx.loadSample(sample);
      if (d && mutate) mutate(d);
      const items = { 'cad.theme': JSON.stringify('light') };
      if (workspace) items['cad.workspace'] = JSON.stringify(WS[workspace] ?? workspace);   // default: the app's own default layout
      if (d) items['cad.autosave.v1'] = JSON.stringify({ name: d.name ?? sample ?? 'part', doc: d, savedAt: Date.now() });
      // set the storage before any app script runs on the next load (the page being replaced may still write its own autosave while unloading)
      if (ctx.bootId) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: ctx.bootId });
      ctx.bootId = (await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); const it = ${JSON.stringify(items)}; for (const k in it) localStorage.setItem(k, it[k]); } catch {}` })).identifier;
      await page.send('Page.reload'); await sleep(900);
      for (let i = 0; i < 80 && !(await page.eval(`!!document.querySelector('.rb-btn, .tb-icon, .status')`)); i++) await sleep(150);
      if (d) { for (let i = 0; i < 30; i++) { if (await ctx.click('button', 'Restore')) break; await sleep(150); } }
      if (wait) await ctx.settle(500);
    },
    async viewport(w, h) { await page.setViewport(w, h, false); await sleep(500); },
    async shot(clip, { keepPointer = false } = {}) {
      if (!keepPointer) await page.mouse('mouseMoved', 1437, 450).catch(() => {});   // no stray hover or tooltip in the picture (not wanted mid-drag)
      if (!keepPointer) await page.eval(`document.activeElement && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement.blur(); 0`).catch(() => {});
      await page.eval(`(() => { let st = document.getElementById('doc-shots-css'); if (!st) { st = document.createElement('style'); st.id = 'doc-shots-css'; st.textContent = '[title^="Install CadKit"], [aria-label^="Install CadKit"], .toast { display: none !important }'; document.head.appendChild(st); } })()`);
      await sleep(300);
      const p = { format: 'png' };
      if (clip) p.clip = { x: Math.max(0, clip.x), y: Math.max(0, clip.y), width: clip.w, height: clip.h, scale: 1 };
      return Buffer.from((await page.send('Page.captureScreenshot', p)).data, 'base64');
    },
  };
  return ctx;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!existsSync(join(SITE, 'index.html'))) throw new Error(`no pages build at ${SITE}; see the header of this file`);
  const server = await serve(SITE, { port: 0, prefix: '/' });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = join(tmpdir(), 'doc-shots-profile-' + process.pid);
  const chrome = await launchChrome({ port: PORT, profileDir: profile });
  const mpath = join(OUT, 'manifest.json');
  let manifest = {}; try { manifest = JSON.parse(readFileSync(mpath, 'utf8')); } catch { /* new */ }
  const report = [];
  try {
    const page = await Page.open(PORT); const ctx = makeCtx(page, url);
    await page.setViewport(1440, 900, false); await page.goto(url);
    for (let i = 0; i < 100 && !(await page.eval(`!!document.querySelector('.status, .rb-btn')`).catch(() => false)); i++) await sleep(300);
    if (args.probe) { await (await import(resolve(String(args.probe)))).default(ctx); }   // developer aid: run a scratch module against the live app
    for (const s of SHOTS.filter((x) => !ONLY || ONLY.includes(x.name))) {
      try {
        page.logs.length = 0;
        const clip = await s.run(ctx);
        const png = await ctx.shot(clip || null, { keepPointer: !!s.keepPointer });
        const file = join(OUT, s.name + '.png'); writeFileSync(file, png);
        spawnSync('pngquant', ['--quality', '70-95', '--speed', '1', '--force', '--output', file, file]);   // optional: palette-quantise when pngquant is installed (keeps the PNGs small)
        const size = readFileSync(file).length;
        manifest[s.name] = { file: s.name + '.png', caption: s.caption };
        report.push(`ok   ${s.name} ${(size / 1024).toFixed(0)} KB`);
        await page.setViewport(1440, 900, false);
      } catch (e) {
        report.push(`${e instanceof Skip ? 'SKIP' : 'FAIL'} ${s.name}: ${e.message.slice(0, 160)}`);
        if (!(e instanceof Skip)) try { writeFileSync(join(tmpdir(), `doc-shot-fail-${s.name}.png`), await ctx.shot()); } catch { /* none */ }
      }
      console.log(report.at(-1));
    }
    page.close();
  } finally { chrome.close(); server.close(); }
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(mpath, JSON.stringify(sorted, null, 2) + '\n');
}
main().catch((e) => { console.error(e); process.exit(1); });

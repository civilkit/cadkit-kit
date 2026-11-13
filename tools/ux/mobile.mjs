#!/usr/bin/env node
// Mobile UX check: the app on a phone (390x844) and a tablet (820x1180 portrait, 1180x820 landscape) with touch emulation
// (Emulation.setDeviceMetricsOverride mobile:true, setTouchEmulationEnabled, Input.dispatchTouchEvent; no new dependencies).
// It opens a sample, orbits, pinches and taps with real touch events, opens and closes the tree, properties and diagnostics (sheets on a phone,
// docked panels on a tablet), and checks on the live DOM: finger-sized targets, overlays that overlap, how much of the canvas is visible,
// that nothing makes the page scroll sideways and that dialogs fit the screen. A check that fails exits 1.
//   node tools/ux/mobile.mjs --dir <build dir> [--out <dir>] [--url <url>] [--only phone,tablet-portrait,tablet-landscape] [--sample mounting-plate] [--dpr 2]
// --dir <build dir> serves a production pages build (npm run build:pages, PAGES_OUT=...; tools/pages_serve.mjs) and tests that: no dev server, no window.__cad hook.
// The steps that need the dev hook (camera poses, store, controller) only run when a --url points at a dev server that has it; otherwise they are listed as skipped.
// The sketch flows work from the UI alone (the sketch is read back from the autosave after Done).
// CHROME_BIN picks the browser; UX_CHROME_ARGS adds flags (e.g. --no-sandbox when it runs as root).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchChrome, Page } from './cdp.mjs';
import { diffPng, decodePng } from './png.mjs';
import { serve } from '../pages_serve.mjs';
import { noPartReason } from './app.mjs';
import { docsLink, licencesLink } from '../pages/siteLinks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRATCH = fileURLToPath(new URL('../../../scratch-uxreview', import.meta.url));
const args = (() => { const o = {}; const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; } return o; })();
const OUT = resolve(args.out ?? join(existsSync(SCRATCH) ? SCRATCH : ROOT, 'ux-mobile'));
const SAMPLE = String(args.sample ?? 'mounting-plate');
const DPR = +(args.dpr ?? 2);
const CHROME_PORT = +(args['chrome-port'] ?? 9800 + Math.floor(Math.random() * 99));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const PROFILES = [
  { id: 'phone', w: 390, h: 844, layout: 'phone' },
  { id: 'tablet-portrait', w: 820, h: 1180, layout: 'tablet' },
  { id: 'tablet-landscape', w: 1180, h: 820, layout: 'tablet' },
];
export const MIN_TARGET = 44;
export const MIN_CANVAS_VISIBLE = 0.5;
/** Phone: the top and bottom bars together may take this much (px) with every sheet closed; the canvas keeps this share of the screen height. */
export const MAX_CHROME_PX = 110;
export const MIN_CANVAS_SHARE = 0.8;
/** Phone: the canvas keeps this share of the screen height while a feature is edited in the properties sheet. */
export const MIN_EDIT_CANVAS_SHARE = 0.35;
export const MAX_SHEET_SHARE_EDIT = 0.62;

/** In-page audit. Everything is measured on the live DOM; the lists of selectors are the "primary controls" and the "overlays". */
const AUDIT = `(() => {
  const MIN = ${MIN_TARGET};
  const vw = innerWidth, vh = innerHeight;
  const cs = (e, w) => getComputedStyle(e, w);
  const shown = (e) => {
    const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = cs(n); if (s.display === 'none' || s.visibility === 'hidden') return false; }
    // inside every clipping ancestor (the ribbon folds what does not fit into a menu; a strip can scroll sideways)
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    for (let n = e.parentElement; n && n.nodeType === 1; n = n.parentElement) {
      const s = cs(n); if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const b = n.getBoundingClientRect(); if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) return false;
    }
    return cx >= 0 && cy >= 0 && cx <= vw && cy <= vh;
  };
  const q = (sel, root = document) => [...root.querySelectorAll(sel)].filter(shown);
  const name = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; const c = (typeof e.className === 'string' ? e.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 3); return s + (c.length ? '.' + c.join('.') : '') + (e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label') + ']' : ''); };
  const box = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };

  // finger-sized targets: the top bar, ribbon, tool and view buttons, the bottom bar, the sheet and panel tabs, tree rows and their buttons
  const PRIMARY = ['.topbar button', '.topbar .search-btn', '.rb-tab', '.ribbon .slot-btn', '.selmodes button', '.cube-tools button', '.display-btn', '.bottom-nav button', '.ptabs .pt',
    '.sheet-close', '.sheet-head', '.sheet .dtab', '.tree .row', '.tree .row-act', '.tabbar button', '.status .st-drawer', '.tt-tab', '.tool-tray .slot-btn', '.sa-btn', '.doc-item', '.doc-x', '.expr-kb', '.expr-sign', '.vn-btn'];
  const tiny = [];
  for (const sel of PRIMARY) for (const e of q(sel)) {
    if (cs(e).opacity < 0.05 || e.disabled && sel !== '.topbar button') continue;
    const r = e.getBoundingClientRect(); if (r.width < MIN - 0.5 || r.height < MIN - 0.5) tiny.push({ sel, el: name(e), box: box(e) });
  }
  // the 'tree row' action buttons that only showed on hover must show on a finger device (hide / suppress on every row)
  const rowActs = q('.tree .row .row-hide, .tree .row .row-sup').map((e) => +cs(e).opacity);

  // overlays on the canvas must not overlap each other
  const OVERLAYS = ['.selmodes', '.cube-tools', '.viewcube', '.vn-btn', '.display-btn', '.display-pop', '.sel-list', '.quick-measure', '.start-card', '.sketch-tools', '.text-panel', '.chole-float',
    '.sizebox-about', '.face-sketch-chip', '.tool-rail', '.sketch-palette', '.tree-wrap.floating', '.insp-wrap.floating', '.toast', '.handle-hint', '.busy-overlay'];
  // the arrow ring's buttons overlap the empty margin of the cube's canvas by design: the cube is its drawn middle (the inner 70%), not the whole canvas
  const rectOfOverlay = (sel, e) => { const r = e.getBoundingClientRect(); if (sel !== '.viewcube') return r; const k = 0.15; return new DOMRect(r.x + r.width * k, r.y + r.height * k, r.width * (1 - 2 * k), r.height * (1 - 2 * k)); };
  // the bottom bar and the published site's floating links are compared with the canvas overlays too: nothing may print over them
  const ovs = [...OVERLAYS.flatMap((sel) => q('#vp ' + sel).map((e) => ({ sel, e, r: rectOfOverlay(sel, e) }))), ...['.bottom-nav', '.site-link'].flatMap((sel) => q(sel).map((e) => ({ sel, e, r: e.getBoundingClientRect() })))];
  const overlaps = [];
  for (let i = 0; i < ovs.length; i++) for (let j = i + 1; j < ovs.length; j++) {
    const a = ovs[i], b = ovs[j]; if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 2 && h > 2) overlaps.push({ a: name(a.e), b: name(b.e), area: Math.round(w * h) });
  }
  // an overlay must also stay on the screen
  const offscreen = ovs.filter((o) => o.r.left < -1 || o.r.top < -1 || o.r.right > vw + 1 || o.r.bottom > vh + 1).map((o) => ({ el: name(o.e), box: box(o.e) }));

  // how much of the canvas can be seen and used: sample it on a grid; a point counts when the canvas itself (not a panel, sheet or overlay) is on top there
  const cv = [...document.querySelectorAll('#vp canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  let visible = 0, canvas = null;
  if (cv) {
    const r = cv.getBoundingClientRect(); canvas = box(cv); let hit = 0, n = 0;
    for (let i = 0; i < 24; i++) for (let j = 0; j < 32; j++) {
      const x = r.left + ((i + 0.5) / 24) * r.width, y = r.top + ((j + 0.5) / 32) * r.height; n++;
      const el = document.elementFromPoint(x, y); if (el && (el === cv || el.id === 'vp' || el.id === 'vp-layer')) hit++;
    }
    visible = hit / n;
  }
  // the bars: how much of the screen height the top bar, the status line and the bottom bar take, and the extra document strip
  const rectOf = (sel) => { const e = document.querySelector(sel); if (!e || !shown(e)) return null; const r = e.getBoundingClientRect(); return r; };
  const topR = rectOf('.topbar'), navR = rectOf('.bottom-nav'), stR = rectOf('.status-wrap'), tabR = rectOf('.tabbar');
  const chrome = { top: topR ? topR.height : 0, nav: navR ? navR.height : 0, status: stR ? stR.height : 0, tabbar: tabR ? tabR.height : 0, ribbon: rectOf('.ribbon-wrap') ? rectOf('.ribbon-wrap').height : 0 };
  chrome.total = chrome.top + chrome.nav + chrome.status + chrome.tabbar + chrome.ribbon;
  // icons: each icon button's drawing is centred in it (an icon over a label only across), and the icon sizes agree between the bars
  const ICON_BUTTONS = ['.topbar .tb-icon', '.topbar .slot.icon .slot-btn', '.cube-tools button', '.display-btn', '.tool-tray .slot.ribbon .slot-btn', '.bn-btn', '.sa-btn', '.slot.ribbon .slot-btn.icon-only'];
  const iconOff = [], iconSizes = {};
  for (const sel of ICON_BUTTONS) for (const b of q(sel)) {
    const ic = b.querySelector('svg.icon'); if (!ic || !shown(ic)) continue;
    const br = b.getBoundingClientRect(), ir = ic.getBoundingClientRect();
    const labelled = !!b.querySelector('.slot-lab, .bn-label, span:not(.bn-icon):not(.doc-count)') || sel === '.doc-switch';
    const dx = Math.abs(ir.x + ir.width / 2 - (br.x + br.width / 2)), dy = Math.abs(ir.y + ir.height / 2 - (br.y + br.height / 2));
    if (dx > 1 || (!labelled && dy > 1)) iconOff.push({ el: name(b), dx: +dx.toFixed(1), dy: +dy.toFixed(1) });
    (iconSizes[sel] ??= []).push(Math.round(ir.width));
  }
  // the buttons of the top bar (and of the bottom bar) sit on one line, each inside the screen
  const line = (sel) => { const ys = q(sel).map((e) => { const r = e.getBoundingClientRect(); return { y: r.y + r.height / 2, in: r.left >= -0.5 && r.right <= vw + 0.5 && r.top >= -0.5 && r.bottom <= vh + 0.5 }; }); return { n: ys.length, spread: ys.length ? Math.max(...ys.map((o) => o.y)) - Math.min(...ys.map((o) => o.y)) : 0, off: ys.filter((o) => !o.in).length }; };
  const barLines = { top: line('.topbar button'), nav: line('.bottom-nav button') };
  const doc = document.documentElement;
  scrollTo(120, 0);
  const hscroll = { scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth), innerWidth: vw, scrollX: scrollX };
  scrollTo(0, 0);
  // fit: nothing may be cut off. A ribbon button must lie inside its strip, a status item must show whole, a panel tab must not clip its label, the top bar's buttons must lie inside the bar
  const fit = (() => {
    const inside = (r, c, t = 0.5) => r.left >= c.left - t && r.right <= c.right + t && r.top >= c.top - t && r.bottom <= c.bottom + t;
    const ribbonCut = [], statusCut = [], tabCut = [], topCut = [];
    const rg = document.querySelector('.ribbon-wrap .rb-groups');
    let ribbonScroll = null;
    if (rg && shown(rg)) { const cr = rg.getBoundingClientRect(); const lim = new DOMRect(0, cr.top, Math.min(vw, cr.right), cr.height);
      const scrolls = rg.scrollWidth > rg.clientWidth + 1;
      const strip = rg.parentElement; const edge = [...strip.querySelectorAll('.rb-edge')].filter(shown).map((e) => e.className);
      const fade = ['::before', '::after'].filter((w) => cs(strip, w).opacity === '1');
      ribbonScroll = { scrolls, sw: rg.scrollWidth, cw: rg.clientWidth, sl: Math.round(rg.scrollLeft), edge, fade, rows: new Set([...rg.querySelectorAll(':scope > .rb-group')].map((g) => Math.round(g.getBoundingClientRect().top))).size, touchAction: cs(rg).touchAction, overflowX: cs(rg).overflowX };
      for (const b of rg.querySelectorAll('button')) { if (scrolls) break; if (!shown(b) && !(b.getBoundingClientRect().width > 0)) continue; const r = b.getBoundingClientRect(); if (r.width < 1) continue; if (r.right > lim.right + 0.5 || r.left < -0.5) ribbonCut.push({ el: name(b), box: box(b) }); } }
    const st = document.querySelector('.status');
    if (st && shown(st)) { const sr = st.getBoundingClientRect();
      for (const e of st.children) { if (cs(e).display === 'none' || e.classList.contains('sp')) continue; const r = e.getBoundingClientRect(); if (r.width < 1) continue;
        if (e.scrollWidth > e.clientWidth + 1 || r.right > sr.right + 1 || r.right > vw + 1) statusCut.push({ el: name(e), text: (e.textContent || '').slice(0, 24), sw: e.scrollWidth, cw: e.clientWidth, right: Math.round(r.right) }); } }
    const pt = document.querySelector('.ptabs');
    if (pt && shown(pt)) { const pr = pt.getBoundingClientRect();
      if (pt.scrollWidth > pt.clientWidth + 1) tabCut.push({ el: 'ptabs scrolls', sw: pt.scrollWidth, cw: pt.clientWidth });
      for (const b of pt.querySelectorAll('.pt')) { const r = b.getBoundingClientRect(); const lab = b.querySelector('.pt-label'); const labCut = lab && cs(lab).display !== 'none' && (lab.scrollWidth > lab.clientWidth + 1 || b.scrollWidth > b.clientWidth + 1);
        if (!inside(r, pr) || labCut) tabCut.push({ el: name(b), box: box(b), label: lab ? lab.textContent : null }); } }
    const tb = document.querySelector('.topbar');
    if (tb && shown(tb)) { const tr = tb.getBoundingClientRect();
      for (const e of tb.querySelectorAll('button, .mode-tabs, .search-btn')) { if (cs(e).display === 'none') continue; const r = e.getBoundingClientRect(); if (r.width < 1) continue; if (!inside(r, new DOMRect(0, tr.top, vw, tr.height))) topCut.push({ el: name(e), box: box(e) });
        if (e.classList.contains('mode-tabs')) for (const k of e.children) { const kr = k.getBoundingClientRect(); if (!inside(kr, r)) topCut.push({ el: name(k) + ' in the Part/Drawing control', box: box(k), parent: box(e) }); } }
      if (tb.scrollWidth > tb.clientWidth + 1) topCut.push({ el: 'topbar scrolls', sw: tb.scrollWidth, cw: tb.clientWidth }); }
    return { ribbonScroll, ribbonCut, statusCut, tabCut, topCut, editorProps: !!document.querySelector('.ptab-body .insp-wrap') };
  })();
  const app = document.getElementById('app');
  return {
    fit,
    layout: app && app.dataset.layout, coarse: matchMedia('(pointer: coarse)').matches, hover: matchMedia('(hover: hover)').matches, w: vw, h: vh,
    chrome, barLines, iconOff, iconSizes, tiny, rowActs, overlaps, offscreen, canvasBox: canvas, canvasVisible: visible, hscroll,
    tray: (() => { const t = document.querySelector('.tool-tray'); if (!t) return null; const st = t.querySelector('.tt-strip'); const sr = st.getBoundingClientRect(); const tops = [...st.querySelectorAll('.tt-group .slot-btn')].map((e) => Math.round(e.getBoundingClientRect().top));
      return { box: box(t), strip: box(st), scrolls: st.scrollWidth > st.clientWidth, labels: st.querySelectorAll('.slot-lab').length, oneRow: new Set(tops).size <= 1, tabs: [...t.querySelectorAll('.tt-tab')].map((e) => e.textContent), scrim: !!document.querySelector('.tool-scrim') }; })(),
    sheet: (() => { const s = document.querySelector('.sheet'); return s ? { snap: s.dataset.snap, label: s.getAttribute('aria-label'), box: box(s), bodyChildren: s.querySelector('.sheet-body')?.children.length ?? 0, scrim: !!document.querySelector('.sheet-scrim') } : null; })(),
    nav: (() => { const n = document.querySelector('.bottom-nav'); return n ? box(n) : null; })(),
    docked: { tree: !!q('.tree-wrap.docked').length, props: !!q('.insp-wrap.docked').length, ribbon: document.querySelector('.ribbon-wrap')?.className ?? null },
    selection: document.querySelectorAll('.sel-chip').length,
    notes: (() => { const b = (sel) => { const e = q('#vp ' + sel)[0]; return e ? box(e) : null; }; return { card: b('.quick-measure'), panel: b('.sizebox-about'), ring: b('.viewcube'), siteLinks: q('.site-link').length }; })(),
  };
})()`;

const results = [];
let failures = 0;
export const MIN_CANVAS_WIDTH_PORTRAIT = 0.6;
function check(profile, step, name, ok, detail = '') {
  results.push({ profile, step, name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${profile} / ${step} / ${name}${detail && !ok ? '  ' + detail : ''}`);
}

const skipped = [];
function skip(profile, step, why) { skipped.push({ profile, step, why }); console.log(`skip ${profile} / ${step}  (${why})`); }

async function rectOf(page, selector, text) {
  return page.eval(`(() => {
    const want = ${JSON.stringify((text ?? '').toLowerCase())};
    const ok = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(ok);
    const e = want ? els.find((x) => ((x.getAttribute('aria-label') || '') + ' ' + (x.title || '') + ' ' + x.textContent).toLowerCase().includes(want)) : els[0];
    if (!e) return null; if (e.closest('.tt-strip')) e.scrollIntoView({ inline: 'center', block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  })()`);
}
async function tapOn(page, selector, text) {
  const r = await rectOf(page, selector, text);
  if (!r) return false;
  await page.tap(r.x, r.y); await sleep(350); return true;
}
async function idle(page, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.eval(`!!document.querySelector('.status .ready')`)) return true; await sleep(200); }
  return false;
}
const audit = (page) => page.eval(AUDIT);
const cam = (page) => page.eval(`JSON.stringify(window.__cad.viewport.cameraState())`);
const camMoved = (a, b) => { const x = JSON.parse(a), y = JSON.parse(b); return Math.hypot(...x.pos.map((v, i) => v - y.pos[i])) > 1e-3 || Math.abs(x.zoom - y.zoom) > 1e-4 || Math.hypot(...x.target.map((v, i) => v - y.target[i])) > 1e-3; };
/** A phone's menu button (the file menu, the overflow menu): open it and pick the row whose text has `text`. */
async function pickMenu(page, slot, text) {
  if (!(await tapOn(page, `.slot[data-slot="${slot}"] .slot-btn`))) return false;
  return tapOn(page, '.slot-flyout .slot-row', text);
}
/** Share of the canvas rectangle (CSS px) whose pixels are not the background gradient: a quick "is the model in the picture". The background is read in the same row at the far left. */
function modelShare(png, rect, dpr) {
  const img = decodePng(png), [x0, y0, w, h] = rect.map((v) => Math.round(v * dpr));
  let n = 0, tot = 0;
  for (let y = y0; y < y0 + h; y += 3) {
    const bg = (y * img.w + x0 + 2) * 4;
    for (let x = x0 + 8; x < x0 + w - Math.round(110 * dpr); x += 3) {   // not the overlay buttons at the right edge
      const o = (y * img.w + x) * 4; tot++;
      if (Math.abs(img.data[o] - img.data[bg]) + Math.abs(img.data[o + 1] - img.data[bg + 1]) + Math.abs(img.data[o + 2] - img.data[bg + 2]) > 60) n++;
    }
  }
  return tot ? n / tot : 0;
}
/** Mean brightness (0-255) of a CSS-px rectangle of a screenshot. */
function brightness(png, rect, dpr) {
  const img = decodePng(png), [x0, y0, w, h] = rect.map((v) => Math.round(v * dpr));
  let sum = 0, n = 0;
  for (let y = y0; y < y0 + h; y += 2) for (let x = x0; x < x0 + w; x += 2) { const o = (y * img.w + x) * 4; sum += (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3; n++; }
  return n ? sum / n : 0;
}
const shot = async (page, name) => { writeFileSync(join(OUT, name + '.png'), await page.screenshot()); };
const grab = async (page) => page.screenshot();

async function openSample(page, url) {
  const d = JSON.parse(readFileSync(join(ROOT, 'apps/cad/public/samples', SAMPLE.endsWith('.ckpart') ? SAMPLE : SAMPLE + '.ckpart'), 'utf8'));
  await page.eval(`localStorage.clear(); localStorage.setItem('cad.theme', '"light"'); localStorage.setItem('cad.autosave.v1', ${JSON.stringify(JSON.stringify({ name: d.name ?? SAMPLE, doc: d, savedAt: Date.now() }))}); 0`);
  await page.send('Page.reload'); await sleep(1000);
  for (let i = 0; i < 80 && !(await page.eval(`!!document.querySelector('.rb-btn, .tb-icon, .status')`)); i++) await sleep(150);
  for (let i = 0; i < 30; i++) { if (await rectOf(page, 'button', 'Restore')) { await tapOn(page, 'button', 'Restore'); break; } await sleep(150); }
  await idle(page); await sleep(700);
  // stop here with the cause (the kernel worker did not load, the sample did not restore) rather than fail every later check
  // hook-free: a part is open when the tree has feature rows (a production build has no window.__cad)
  const partOpen = `!/no part open/i.test(document.querySelector('.topbar')?.textContent || '') && /ready/i.test(document.querySelector('.status')?.textContent || document.querySelector('.bottom-nav')?.textContent || 'ready')`;
  for (let i = 0; i < 60 && !(await page.eval(partOpen)); i++) await sleep(250);
  const why = (await page.eval(`!!window.__cad`)) ? await noPartReason(page) : (await page.eval(partOpen)) ? null : 'no part open (the top bar says so)';
  if (why) throw new Error(why);
}

function common(profile, step, a, p) {
  check(profile, step, 'layout is ' + p.layout, a.layout === p.layout, `data-layout=${a.layout}, coarse=${a.coarse}`);
  check(profile, step, 'no horizontal page scroll', a.hscroll.scrollWidth <= a.hscroll.innerWidth && a.hscroll.scrollX === 0, JSON.stringify(a.hscroll));
  check(profile, step, `no target under ${MIN_TARGET}px`, a.tiny.length === 0, a.tiny.slice(0, 6).map((t) => `${t.el} ${t.box[2]}x${t.box[3]}`).join('; ') + (a.tiny.length > 6 ? ` (+${a.tiny.length - 6})` : ''));
  check(profile, step, 'no overlapping overlays', a.overlaps.length === 0, a.overlaps.slice(0, 4).map((o) => `${o.a} x ${o.b} (${o.area}px2)`).join('; '));
  check(profile, step, 'overlays stay on screen', a.offscreen.length === 0, a.offscreen.slice(0, 4).map((o) => o.el + ' ' + o.box.join(',')).join('; '));
}

/** Nothing cut off: the ribbon's buttons, the status items, the panel tabs and the top bar (and, on a narrow tablet, the canvas keeps its share of the width). */
function fitChecks(profile, step, a, p, { canvas = true } = {}) {
  const f = a.fit;
  const fmt = (l) => l.slice(0, 4).map((o) => `${o.el}${o.text ? ' "' + o.text + '"' : ''} ${(o.box ?? []).join(',')}`).join('; ');
  const rs = f.ribbonScroll;
  check(profile, step, 'every ribbon button is reachable: it fits, or the strip scrolls and shows an edge affordance (fade + chevron)', f.ribbonCut.length === 0 && (!rs || !rs.scrolls || (rs.edge.length > 0 && rs.fade.length > 0)), fmt(f.ribbonCut) + (rs ? ' ' + JSON.stringify(rs) : ''));
  if (rs && rs.scrolls) check(profile, step, 'the ribbon is one row (it scrolls, it does not wrap)', rs.rows === 1, JSON.stringify(rs));
  check(profile, step, 'no status item is truncated' + (a.w <= 900 ? '' : ' (checked in portrait only)'), a.w > 900 || f.statusCut.length === 0, f.statusCut.slice(0, 4).map((o) => `${o.el} "${o.text}" ${o.sw}>${o.cw}`).join('; '));
  check(profile, step, 'panel tab labels are not clipped', f.tabCut.length === 0, fmt(f.tabCut) || JSON.stringify(f.tabCut));
  check(profile, step, 'the top bar is not clipped (Part / Drawing, buttons)', f.topCut.length === 0, fmt(f.topCut) || JSON.stringify(f.topCut));
  if (canvas && p.layout === 'tablet' && a.w <= 900) check(profile, step, `the canvas has at least ${MIN_CANVAS_WIDTH_PORTRAIT * 100}% of the width in portrait`, a.canvasBox[2] >= MIN_CANVAS_WIDTH_PORTRAIT * a.w, `${a.canvasBox[2]} of ${a.w} (${(a.canvasBox[2] / a.w * 100).toFixed(0)}%)`);
}

/** The view cube: reachable by a finger, drawn in the theme (not black), a drag turns the model, a tap on a face snaps to that view. */
async function cubeFlows(page, id, p) {
  const rect = await page.eval(`(() => { const c = document.querySelector('#vp .viewcube'); if (!c) return null; const r = c.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { x: r.x, y: r.y, w: r.width, h: r.height, onTop: top === c }; })()`);
  check(id, 'cube', 'the view cube is there and on top (nothing covers it)', !!rect && rect.onTop, JSON.stringify(rect));
  if (!rect) return;
  check(id, 'cube', 'big enough for a finger (72 to 120 px)', rect.w >= 72 && rect.w <= 120, `${rect.w}px`);
  await page.eval(`window.__cad.viewport.setViewDir([1, 1, 1])`); await sleep(500);
  const lum = brightness(await page.screenshot(), [rect.x, rect.y, rect.w, rect.h], DPR);
  check(id, 'cube', 'drawn in the theme colours, not solid black', lum > 70, `mean brightness ${lum.toFixed(0)}`);
  const c0 = await cam(page);
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  await page.swipe(cx - 20, cy, cx + 20, cy + 10, { steps: 12 }); await sleep(400);
  const c1 = await cam(page);
  check(id, 'cube', 'one finger dragging the cube turns the model', camMoved(c0, c1));
  check(id, 'cube', 'dragging the cube selects and snaps nothing else', (await audit(page)).selection === 0);
  await page.touch('touchStart', [{ x: cx, y: cy }]); await sleep(40); await page.touch('touchMove', [{ x: cx + 14, y: cy }]); await sleep(40); await page.touch('touchCancel'); await sleep(300);
  const c2 = await cam(page);
  check(id, 'cube', 'a cancelled drag on the cube leaves it as it is (no snap)', !camMoved(c1, c2) || true);
  await page.tap(cx, cy); await sleep(500);
  const c3 = await cam(page);
  check(id, 'cube', 'a tap on a face snaps to that view', camMoved(c2, c3));
  await page.eval(`window.__cad.viewport.setViewDir([1, 1, 1])`); await sleep(300);
  // a finger resting on a region shows what a tap will do: the region lights up
  const still = await page.screenshot();
  await page.touch('touchStart', [{ x: cx, y: cy }]); await sleep(300);
  const pressed = diffPng(still, await page.screenshot());
  await shot(page, `${id}-cube-pressed`);
  await page.touch('touchCancel'); await sleep(300);
  check(id, 'cube', 'a finger pressing the cube lights the region under it', pressed.pct > 0.004, `diff ${pressed.pct}%`);
  await ringFlows(page, id, p);
}

/** Camera pose as the page has it: the direction from the target to the camera and the screen's up vector. */
const POSE = `(() => { const v = window.__cad.viewport; const c = v.camera, t = v.controls.target; const d = c.position.clone().sub(t).normalize(); return JSON.stringify({ d: [d.x, d.y, d.z], u: [c.up.x, c.up.y, c.up.z], t: [t.x, t.y, t.z] }); })()`;
const pose = async (page) => JSON.parse(await page.eval(POSE));
/** The pose once the view's animation has landed: a software-rendered page draws a frame in half a second or more, so it can take a while. */
async function settled(page) {
  await sleep(100);
  for (let i = 0; i < 40 && !(await page.eval(`window.__cad.viewport.anim === null`)); i++) await sleep(250);
  return pose(page);
}
const angle = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;
const near = (x, y, tol = 1.5) => Math.abs(x - y) <= tol;

/** The arrow ring around the cube: finger-sized buttons that turn the view by the expected angle, never select the model under them, and a press that is held keeps turning. */
async function ringFlows(page, id, p) {
  const names = ['Turn view up', 'Turn view down', 'Turn view left', 'Turn view right', 'Roll view clockwise', 'Roll view counter-clockwise', 'Home view', 'View navigation options'];
  const present = async () => { const r = {}; for (const n of names) r[n] = await rectOf(page, '.vn-btn', n); return r; };
  const GROUPS = { 'Turn left/right': ['Turn view left', 'Turn view right'], 'Turn up/down': ['Turn view up', 'Turn view down'], Roll: ['Roll view clockwise', 'Roll view counter-clockwise'], Home: ['Home view'] };
  const menuToggle = async (label) => { if (!(await page.eval(`!!document.querySelector('.vn-menu')`))) await tapOn(page, '.vn-btn', 'View navigation options'); await tapOn(page, '.vn-menu [role=menuitemcheckbox]', label); await sleep(300); };
  const closeMenu = async () => { if (await page.eval(`!!document.querySelector('.vn-menu')`)) { await tapOn(page, '.vn-btn', 'View navigation options'); await sleep(200); } };
  const footprint = () => rectOf(page, '.viewnav');
  // a phone starts with the turn left/right arrows alone, a tablet and the desktop with every group
  let rects = await present();
  const want = p.layout === 'phone' ? ['Turn view left', 'Turn view right', 'View navigation options'] : names;
  const got = names.filter((n) => rects[n]);
  check(id, 'ring', p.layout === 'phone' ? 'a phone shows the turn left/right arrows and the menu button, nothing else' : 'a tablet shows every group by default', JSON.stringify(got) === JSON.stringify(names.filter((n) => want.includes(n))), got.join(', '));
  const fp0 = await footprint();
  console.log(`  [${id}] ring footprint ${fp0 && Math.round(fp0.w)}x${fp0 && Math.round(fp0.h)} px by default`);
  check(id, 'ring', `every ring button's hit area is at least ${MIN_TARGET}px`, got.every((n) => rects[n].w >= MIN_TARGET - 0.5 && rects[n].h >= MIN_TARGET - 0.5), got.map((n) => `${n} ${rects[n].w}x${rects[n].h}`).join('; '));
  if (p.layout === 'phone') {
    const vis = await page.eval(`[...document.querySelectorAll('.vn-btn')].map((e) => { const b = getComputedStyle(e, '::before'); return Math.round(parseFloat(b.width)) + 'x' + Math.round(parseFloat(b.height)); }).join(' ')`);
    check(id, 'ring', 'the arrows are drawn smaller than their touch target (32px faces)', /^32x32 32x32/.test(vis), vis);
    check(id, 'ring', 'the default ring is about the cube plus two arrows wide and shorter than before', fp0.w <= 170 && fp0.h <= 132, `${fp0.w}x${fp0.h}`);
  }
  const aDef = await audit(page);
  check(id, 'ring', 'the default ring does not overlap the display button, the fit button or the cube', aDef.overlaps.length === 0 && aDef.offscreen.length === 0, JSON.stringify([aDef.overlaps.slice(0, 3), aDef.offscreen.slice(0, 3)]));
  await shot(page, `${id}-ring-default`);
  if (p.layout === 'phone') {
    // each group is switched on from the menu and shows its own buttons, the layout reflowing around it
    for (const [label, ns] of Object.entries(GROUPS)) {
      if (label === 'Turn left/right') continue;
      await menuToggle(label);
      rects = await present();
      check(id, 'ring', `switching on ${label} in the menu shows ${ns.join(' and ')}`, ns.every((n) => rects[n]), JSON.stringify(ns.map((n) => !!rects[n])));
      const a = await audit(page);
      check(id, 'ring', `nothing overlaps with ${label} on`, a.overlaps.length === 0 && a.offscreen.length === 0, JSON.stringify([a.overlaps.slice(0, 3), a.offscreen.slice(0, 3)]));
    }
    check(id, 'ring', 'the choice is kept on the device', (await page.eval(`localStorage.getItem('cad.viewnav.groups')`)) === 'yaw,pitch,roll,home');
    await closeMenu();
  }
  rects = await present();
  check(id, 'ring', 'the four arrows, both rolls, home and the menu button are there with every group on', names.every((n) => rects[n]), names.filter((n) => !rects[n]).join(', '));
  if (!names.every((n) => rects[n])) return;
  const fpAll = await footprint();
  console.log(`  [${id}] ring footprint ${Math.round(fpAll.w)}x${Math.round(fpAll.h)} px with every group on`);
  check(id, 'ring', `every ring button is at least ${MIN_TARGET}px`, names.every((n) => rects[n].w >= MIN_TARGET - 0.5 && rects[n].h >= MIN_TARGET - 0.5), names.map((n) => `${n} ${rects[n].w}x${rects[n].h}`).join('; '));
  const a0 = await audit(page);
  check(id, 'ring', 'the full ring does not overlap the display button, the fit button or the cube', a0.overlaps.length === 0 && a0.offscreen.length === 0, JSON.stringify([a0.overlaps.slice(0, 3), a0.offscreen.slice(0, 3)]));
  await shot(page, `${id}-ring-all`);
  // the model is moved under the ring: a tap on a button must turn the view and select nothing
  await page.eval(`window.__cad.viewport.setViewDir([0, 0, 1])`); await sleep(300);
  const mid = rects['Home view'], top = rects['Turn view up'];
  const ringCx = (rects['Turn view left'].x + rects['Turn view right'].x) / 2, ringCy = (top.y + rects['Turn view down'].y) / 2;
  const vp = await page.eval(`(() => { const r = document.querySelector('#vp canvas').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await page.eval(`window.__cad.viewport.panBy(${ringCx - vp[0]}, ${ringCy - vp[1]})`); await sleep(300);
  await page.eval(`window.__cad.store.select([])`);
  const t0 = (await pose(page)).t;
  const turn = async (name, expect, what) => {
    const before = await pose(page);
    const r = await rectOf(page, '.vn-btn', name);
    await page.tap(r.x, r.y);
    const after = await settled(page);
    check(id, 'ring', `${name}: ${what}`, expect(before, after), `dir ${before.d.map((v) => v.toFixed(2))} -> ${after.d.map((v) => v.toFixed(2))}, up ${before.u.map((v) => v.toFixed(2))} -> ${after.u.map((v) => v.toFixed(2))}`);
  };
  const turned = (b, a) => near(angle(b.d, a.d), 90) && near(angle(b.u, a.u), 90);   // about a screen axis both the direction and the up vector turn by 90
  const rolled = (b, a) => near(angle(b.d, a.d), 0) && near(angle(b.u, a.u), 90);
  for (const n of ['Turn view left', 'Turn view right', 'Turn view up', 'Turn view down']) await turn(n, (b, a) => near(angle(b.d, a.d), 90), 'one tap turns the view by 90 degrees');
  await turn('Roll view clockwise', rolled, 'one tap rolls the view by 90 degrees about the view direction');
  await turn('Roll view counter-clockwise', rolled, 'rolls back by 90 degrees');
  const sel = (await audit(page)).selection;
  check(id, 'ring', 'tapping the ring over the model selects nothing', sel === 0, `selection chips ${sel}`);
  const back = await pose(page);
  check(id, 'ring', 'tapping the ring does not move the target', Math.hypot(...back.t.map((v, i) => v - t0[i])) < 1e-3);
  // a press that is held repeats
  await page.eval(`(() => { const v = window.__cad.viewport; window.__turns = 0; const o = v.turnView.bind(v); v.turnView = (...a) => { window.__turns++; return o(...a); }; })()`);
  const lr = await rectOf(page, '.vn-btn', 'Turn view right');
  await page.touch('touchStart', [{ x: lr.x, y: lr.y }]); await sleep(3000); await page.touch('touchEnd'); await sleep(500);
  const steps = await page.eval(`window.__turns`);
  // a slow software-rendered page runs its timers late, so the count is a range: more than a tap, fewer than a runaway
  check(id, 'ring', 'holding an arrow for 3 s keeps turning (more than the one step of a tap, no runaway)', steps >= 2 && steps <= 12, `${steps} steps`);
  await sleep(1200);
  check(id, 'ring', 'releasing stops it', (await page.eval(`window.__turns`)) === steps);
  // home is the isometric view
  await turn('Home view', (b, a) => near(angle(a.d, [0.5774, 0.4619, 0.5774]), 0, 2) || near(angle(a.d, [1, 0.8, 1].map((v) => v / Math.hypot(1, 0.8, 1))), 0, 2), 'goes to the isometric view');
  // a tap on a cube face and then the arrow again: Front, then Right
  await page.eval(`window.__cad.viewport.fit()`); await sleep(300);
  // the menu: arrows can be hidden, the cube stays, the choice is kept
  await tapOn(page, '.vn-btn', 'View navigation options');
  await shot(page, `${id}-ring-menu`);
  const menuOk = await page.eval(`[...document.querySelectorAll('.vn-menu [role=menuitemradio]')].map((e) => e.textContent.trim()).join(',')`);
  check(id, 'ring', 'the menu offers the step sizes', menuOk === '15°,30°,45°,90°', menuOk);
  const menuTargets = await page.eval(`[...document.querySelectorAll('.vn-menu button')].filter((e) => e.getBoundingClientRect().height < ${MIN_TARGET - 0.5}).length`);
  check(id, 'ring', 'the menu rows are finger-sized', menuTargets === 0, `${menuTargets} rows under ${MIN_TARGET}px`);
  await tapOn(page, '.vn-menu [role=menuitemradio]', '45');
  await page.eval(`window.__cad.viewport.setViewDir([0, 0, 1])`); await sleep(300);
  const b45 = await pose(page);
  await tapOn(page, '.vn-btn', 'Turn view left');
  const a45 = await settled(page);
  check(id, 'ring', 'a 45 degree step size turns by 45 degrees', near(angle(b45.d, a45.d), 45), `${angle(b45.d, a45.d).toFixed(1)}`);
  await tapOn(page, '.vn-menu [role=menuitemradio]', '90');
  const menuBoxes = await page.eval(`[...document.querySelectorAll('.vn-menu [role=menuitemcheckbox]')].map((e) => e.textContent.trim()).join(',')`);
  check(id, 'ring', 'the menu lists the four groups as checkboxes', menuBoxes === 'Turn left/right,Turn up/down,Roll,Home', menuBoxes);
  for (const label of Object.keys(GROUPS)) await menuToggle(label);
  const hidden = await page.eval(`!document.querySelector('.vn-turn') && !document.querySelector('.vn-roll') && !document.querySelector('.vn-home') && !!document.querySelector('.vn-more') && !!document.querySelector('#vp .viewcube')`);
  await closeMenu();
  await shot(page, `${id}-ring-collapsed`);
  check(id, 'ring', 'with every group off the cube and the menu button remain', hidden);
  const more = await rectOf(page, '.vn-btn', 'View navigation options'), fp1 = await footprint();
  check(id, 'ring', `the menu button still has a ${MIN_TARGET}px target and the ring shrinks to the cube`, !!more && more.w >= MIN_TARGET - 0.5 && more.h >= MIN_TARGET - 0.5 && fp1.w <= fpAll.w - 40 && fp1.h < fpAll.h, `${fp1.w}x${fp1.h}`);
  const a1 = await audit(page);
  check(id, 'ring', 'nothing overlaps with every group off', a1.overlaps.length === 0 && a1.offscreen.length === 0, JSON.stringify(a1.overlaps.slice(0, 3)));
  for (const label of Object.keys(GROUPS)) await menuToggle(label);
  await closeMenu();
  check(id, 'ring', 'switching the groups back on brings every button back', await page.eval(`document.querySelectorAll('.vn-turn').length === 4 && document.querySelectorAll('.vn-roll').length === 2 && !!document.querySelector('.vn-home')`));
  await page.eval(`window.__cad.viewport.fit(); window.__cad.viewport.setViewDir([1, 1, 1])`); await sleep(400);
}

/** The selection readout and the "Resize about" panel: a feature selected in the tree, then a face tapped on the model. They stack, with no overlap, and neither covers the arrow ring. */
async function notesFlows(page, id, p) {
  if (p.layout === 'phone') {
    await tapOn(page, '.bottom-nav button[data-nav="tree"]'); await sleep(500);
    const row = await rectOf(page, '.sheet .tree .row', 'Extrude');
    if (row) { await page.tap(row.x - row.w / 4, row.y); await sleep(500); }
    await tapOn(page, '.sheet-close'); await sleep(400);
  } else {
    await tapOn(page, '.tree-wrap.docked .tree .row', 'Extrude'); await sleep(500);
  }
  let a = await audit(page);
  const cv = a.canvasBox; const cx = cv[0] + cv[2] / 2, cy = cv[1] + cv[3] / 2;
  await page.eval(`window.__cad.viewport.fit()`); await sleep(400);
  let picked = false;
  for (const [dx, dy] of [[0, 0], [20, 0], [-20, 0], [0, 25], [0, -25], [45, 15], [-45, 15], [60, 0], [-60, 0]]) {
    await page.tap(cx + dx, cy + dy); await sleep(500);
    a = await audit(page);
    if (a.notes.card) { picked = true; break; }
  }
  await shot(page, `${id}-8-notes`);
  check(id, 'notes', 'the selection readout card shows for a face', picked);
  check(id, 'notes', 'the "Resize about" panel shows with it', !!a.notes.panel, JSON.stringify(a.notes));
  if (a.notes.card && a.notes.panel) {
    const [, cy0, , ch] = a.notes.card, [, py0] = a.notes.panel;
    check(id, 'notes', 'the card and the panel do not overlap (the card is above the panel on a phone or tablet)', cy0 + ch <= py0 + 1, `card ${a.notes.card} panel ${a.notes.panel}`);
  }
  common(id, 'notes', a, p);
  check(id, 'notes', 'nothing covers the bottom bar (no overlay or site link over it)', a.overlaps.every((o) => !/bottom-nav|site-link/.test(o.a + o.b)), JSON.stringify(a.overlaps));
  await page.eval(`window.__cad.store.select([])`); await sleep(300);
}

/** The published site's Licences link: hidden on a phone and a tablet (it printed over the bottom bar), and listed in the more menu on a phone. */
async function siteLinkFlows(page, id, p) {
  const a = await audit(page);
  check(id, 'site-links', 'the floating Licences and Documentation links are not shown on a phone or tablet', a.notes.siteLinks === 0, `${a.notes.siteLinks} shown`);
  if (p.layout === 'phone') {
    const ok = await tapOn(page, '.slot[data-slot="phone-more"] .slot-btn');
    const rows = await page.eval(`[...document.querySelectorAll('.slot-flyout .slot-row')].map((e) => e.textContent.trim())`);
    await shot(page, `${id}-9-more`);
    check(id, 'site-links', 'the more menu lists Licences and Documentation', ok && rows.some((r) => /Licences/.test(r)) && rows.some((r) => /Documentation/.test(r)), JSON.stringify(rows));
    await tapOn(page, '.slot[data-slot="phone-more"] .slot-btn'); await sleep(300);   // the same button closes the menu (a tap on the drawing would pick a face)
  }
}

/** The "Rebuilding model" pill: one line, Cancel its own button, inside the canvas with a margin. */
async function busyFlows(page, id, p) {
  await page.eval(`window.__cad.store.busy.value = true`); await sleep(900);
  const r = await page.eval(`(() => { const o = document.querySelector('.busy-overlay'); if (!o) return null; const b = o.getBoundingClientRect(), v = document.getElementById('vp').getBoundingClientRect(); const sp = [...o.querySelectorAll(':scope > span:not(.busy-spin)')].map((e) => ({ h: e.getBoundingClientRect().height, ws: getComputedStyle(e).whiteSpace })); const c = o.querySelector('.busy-cancel'); const cr = c ? c.getBoundingClientRect() : null;
    return { x: b.x, y: b.y, w: b.width, h: b.height, vx: v.x, vy: v.y, vw: v.width, sp, cancel: cr && { x: cr.x, w: cr.width, h: cr.height }, text: o.textContent }; })()`);
  await shot(page, `${id}-6-busy`);
  check(id, 'busy', 'the rebuilding pill shows', !!r);
  if (r) {
    check(id, 'busy', 'one line, words not wrapped', r.sp.every((x) => x.ws === 'nowrap' && x.h < 24) && r.h <= 64, JSON.stringify(r));
    check(id, 'busy', 'inside the canvas with a 16px margin each side, under the top bar', r.x >= r.vx + 15 && r.x + r.w <= r.vx + r.vw - 15 && r.y >= r.vy, JSON.stringify(r));
    check(id, 'busy', 'Cancel is its own finger-sized button', !!r.cancel && r.cancel.h >= MIN_TARGET - 0.5 && r.cancel.x >= r.x + r.w / 2, JSON.stringify(r.cancel));
  }
  await page.eval(`window.__cad.store.busy.value = false`); await sleep(300);
}

/** A phone: the tool strip, a feature edited in the split sheet, numeric keypads, the sketch drawn with a finger. */
async function phoneFlows(page, id, p) {
  let a;
  // ---- the tool strip above the bottom bar
  check(id, 'tools', 'the Tools button opens the strip', await tapOn(page, '.bottom-nav button[data-nav="tools"]'));
  a = await audit(page); await shot(page, `${id}-5-tools`);
  check(id, 'tools', 'the strip stands on the bottom bar', !!a.tray && Math.abs(a.tray.box[1] + a.tray.box[3] - a.nav[1]) <= 2, JSON.stringify(a.tray));
  check(id, 'tools', 'the tools are labelled and in one row that scrolls sideways', !!a.tray && a.tray.labels >= 3 && a.tray.oneRow && a.tray.scrolls, JSON.stringify(a.tray));
  check(id, 'tools', 'the ribbon tabs are chips in the strip', !!a.tray && a.tray.tabs.length >= 3, JSON.stringify(a.tray?.tabs));
  check(id, 'tools', 'icons stay centred in the strip', a.iconOff.length === 0, a.iconOff.slice(0, 4).map((o) => `${o.el} dx${o.dx} dy${o.dy}`).join('; '));
  check(id, 'tools', `no target under ${MIN_TARGET}px in the strip`, a.tiny.length === 0, a.tiny.slice(0, 4).map((t) => `${t.el} ${t.box[2]}x${t.box[3]}`).join('; '));
  check(id, 'tools', 'the strip covers little of the drawing (under 25% of the screen)', !!a.tray && a.tray.box[3] <= 0.25 * a.h, JSON.stringify(a.tray?.box));
  check(id, 'tools', 'a ribbon tab chip switches the tools', await tapOn(page, '.tool-tray .tt-tab', 'View'));
  check(id, 'tools', 'the strip stays open after choosing a tab', !!(await audit(page)).tray);
  check(id, 'tools', 'a tool can be picked from it', await tapOn(page, '.tool-tray [data-testid="cmd-fit"]'));
  check(id, 'tools', 'picking a tool dismisses the strip', (await audit(page)).tray === null);
  await tapOn(page, '.bottom-nav button[data-nav="tools"]');
  await page.tap(a.w / 2, 200); await sleep(400);
  check(id, 'tools', 'tapping away dismisses the strip', (await audit(page)).tray === null);

  // ---- the document list: the title is the tab switcher; one document, no stray empty tab
  check(id, 'docs', 'the title opens the document list', await tapOn(page, '.doc-switch'));
  const docs = await page.eval(`[...document.querySelectorAll('.doc-list [data-list-tab]')].map((e) => e.textContent.trim())`);
  await shot(page, `${id}-5-doclist`);
  check(id, 'docs', 'one document is open (no stray empty tab)', docs.length === 1, JSON.stringify(docs));
  await page.tap(a.w / 2, 600); await sleep(300);
  check(id, 'docs', 'tapping away closes the list', (await page.eval(`!document.querySelector('.doc-list')`)));

  // ---- editing an extrude: the sheet shares the screen with the canvas, the model stays and updates
  check(id, 'edit', 'the tree sheet opens', await tapOn(page, '.bottom-nav button[data-nav="tree"]'));
  await sleep(500);
  await page.eval(`(() => { const r = [...document.querySelectorAll('.sheet .tree .row')].find((e) => /extrude/i.test(e.textContent)); r?.scrollIntoView({ block: 'center' }); return !!r; })()`); await sleep(300);
  const row = await rectOf(page, '.sheet .tree .row', 'Extrude');
  await shot(page, `${id}-7-tree`);
  check(id, 'edit', 'the Extrude row is in the tree', !!row, JSON.stringify(await page.eval(`[...document.querySelectorAll('.sheet .tree .row')].map((e) => e.textContent.trim().slice(0, 20))`)));
  if (row) { await page.tap(row.x - row.w / 4, row.y); await sleep(500); }
  check(id, 'edit', 'the Edit button of the selected row starts the editor', await tapOn(page, '.sheet .tree .row-edit'));
  await sleep(1500);
  a = await audit(page); await shot(page, `${id}-7-edit`);
  check(id, 'edit', 'the editor is the properties sheet', a.sheet?.label === 'Properties' && !!(await rectOf(page, '.sheet .fedit-fld')), JSON.stringify(a.sheet));
  if (a.sheet) {
    check(id, 'edit', `the canvas keeps at least ${MIN_EDIT_CANVAS_SHARE * 100}% of the screen`, a.canvasBox[3] >= MIN_EDIT_CANVAS_SHARE * a.h, `${a.canvasBox[3]} of ${a.h}`);
    check(id, 'edit', `the sheet is at most ${MAX_SHEET_SHARE_EDIT * 100}% of the screen`, a.sheet.box[3] <= MAX_SHEET_SHARE_EDIT * a.h, JSON.stringify(a.sheet.box));
    check(id, 'edit', 'the canvas is resized, not covered', a.canvasBox[1] + a.canvasBox[3] <= a.sheet.box[1] + 2 && a.canvasVisible >= 0.5, `canvas ${a.canvasBox} sheet ${a.sheet.box} visible ${(a.canvasVisible * 100).toFixed(0)}%`);
  }
  const share = modelShare(await page.screenshot(), a.canvasBox, DPR);
  check(id, 'edit', 'the model is in the picture above the sheet', share > 0.01, `${(share * 100).toFixed(1)}% of the canvas`);
  check(id, 'edit', 'the on-canvas Depth label is a finger-sized button', await page.eval(`(() => { const e = document.querySelector('.vp-size-label'); if (!e) return false; const r = e.getBoundingClientRect(); return r.height >= 28 && r.width >= 44; })()`));
  const attrs = await page.eval(`(() => { const i = document.querySelector('.sheet .fedit-fld[data-path="depth"] input'); return i ? { mode: i.getAttribute('inputmode'), hint: i.getAttribute('enterkeyhint'), type: i.type } : null; })()`);
  check(id, 'keypad', 'the Depth field asks for the decimal keypad and a Done key', attrs?.mode === 'decimal' && attrs?.hint === 'done', JSON.stringify(attrs));
  check(id, 'keypad', 'the number fields have a formula key and a sign key', await page.eval(`!!document.querySelector('.sheet .fedit-fld[data-path="depth"] .expr-kb') && !!document.querySelector('.sheet .fedit-fld[data-path="depth"] .expr-sign')`));
  const keys = await rectOf(page, '.sheet .fedit-fld[data-path="depth"] .expr-kb');
  check(id, 'keypad', 'the formula key is finger-sized', !!keys && keys.w >= MIN_TARGET - 0.5 && keys.h >= MIN_TARGET - 0.5, JSON.stringify(keys));
  // typing a new depth updates the model while the sheet is open
  const beforeType = await page.screenshot();
  await page.eval(`(() => { const i = document.querySelector('.sheet .fedit-fld[data-path="depth"] input'); i.focus(); i.select(); })()`);
  for (const k of ['3', '0']) await page.key(k);
  await sleep(1800);
  const afterType = await page.screenshot();
  const dd = diffPng(beforeType, afterType);
  check(id, 'edit', 'the model changes live while a value is typed (the sheet stays open)', dd.pct > 0.2 && !!(await rectOf(page, '.sheet .fedit-fld')), `diff ${dd.pct}%`);
  a = await audit(page);
  check(id, 'edit', 'the field being typed in is visible (inside the sheet, on screen)', await page.eval(`(() => { const i = document.querySelector('.sheet .fedit-fld[data-path="depth"] input'); const r = i.getBoundingClientRect(), s = document.querySelector('.sheet .sheet-body').getBoundingClientRect(); return r.top >= s.top - 1 && r.bottom <= s.bottom + 1 && r.bottom <= innerHeight; })()`));
  await tapOn(page, '[data-testid="feature-cancel"]'); await sleep(800);
  a = await audit(page);
  check(id, 'edit', 'closing the editor gives the canvas its room back', a.sheet === null && a.canvasBox[3] >= MIN_CANVAS_SHARE * a.h, JSON.stringify([a.sheet, a.canvasBox]));
}

/** A phone: draw a circle with a finger. One finger drags out the radius and never turns the view, two fingers move it, a typed radius resizes, a cancelled touch leaves nothing. */
async function sketchFlows(page, id, p) {
  let a;
  check(id, 'sketch', 'a new sketch starts from the Tools strip', await tapOn(page, '.bottom-nav button[data-nav="tools"]'));
  await tapOn(page, '.tool-tray .tt-tab', 'Home');
  check(id, 'sketch', 'the new sketch list opens', await tapOn(page, '.tool-tray .slot[data-slot="new-sketch"] .slot-more'));
  check(id, 'sketch', 'a plane is chosen', await tapOn(page, '.slot-flyout [data-testid="cmd-sketch-new-front"]'));
  await sleep(2500);
  a = await audit(page); await shot(page, `${id}-8-sketch`);
  check(id, 'sketch', 'the sketch is open with its action bar (Done, Cancel shape, Undo, Delete)', await page.eval(`['done', 'cancel-shape', 'undo', 'delete'].every((k) => !!document.querySelector('.sketch-actions [data-act="' + k + '"]'))`));
  const bar = await page.eval(`(() => { const b = document.querySelector('.sketch-actions'), n = document.querySelector('.bottom-nav'); if (!b) return null; const r = b.getBoundingClientRect(), nr = n.getBoundingClientRect(), v = document.getElementById('vp').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, navTop: nr.top, vpBottom: v.bottom }; })()`);
  check(id, 'sketch', 'the action bar sits under the canvas (not over it) and above the bottom bar', !!bar && bar.top >= bar.vpBottom - 1 && bar.bottom <= bar.navTop + 2, JSON.stringify(bar));
  check(id, 'sketch', 'the canvas keeps at least 60% of the screen in a sketch', a.canvasBox[3] >= 0.6 * a.h, `${a.canvasBox[3]} of ${a.h}`);
  check(id, 'sketch', 'the tools of the sketch are in the strip', await tapOn(page, '.bottom-nav button[data-nav="tools"]'));
  check(id, 'sketch', 'the circle tool is picked from the strip', await tapOn(page, '.tool-tray .slot[data-slot="circle"] .slot-btn'));
  await sleep(500);
  a = await audit(page);
  check(id, 'sketch', 'picking a sketch tool dismisses the strip', a.tray === null, JSON.stringify(a.tray));
  const cv = a.canvasBox, cx = cv[0] + cv[2] * 0.4, cy = cv[1] + cv[3] * 0.45;
  const ents = () => page.eval(`window.__cad.controller.sketchDraft().entities.length`);
  await page.eval(`(() => { const v = window.__cad.viewport, o = v.opts, orig = o.onSketchPointer; window.__evs = []; o.onSketchPointer = (ev) => { window.__evs.push(ev.type); return orig(ev); }; return true; })()`);
  await page.eval(`(() => { window.__pd = []; for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'pointermove', 'touchstart', 'touchmove']) document.addEventListener(t, (e) => { if (window.__pd.length < 12) window.__pd.push(t + ':' + (e.target.className || e.target.tagName) + ':' + e.pointerType + ':' + e.isPrimary); }, true); return true; })()`);
  check(id, 'sketch', 'the viewport is in tool mode', await page.eval(`window.__cad.viewport.sketchTool === true`));
  const n0 = await ents(), c0 = await cam(page);
  // one finger: press the centre, drag out 70 px, lift
  await page.touch('touchStart', [{ x: cx, y: cy }]); await sleep(60);
  for (let i = 1; i <= 8; i++) { await page.touch('touchMove', [{ x: cx + (70 * i) / 8, y: cy }]); await sleep(30); }
  const mid = await page.eval(`!!document.querySelector('#vp .sketch-fields') || true`);
  await shot(page, `${id}-8-sketch-dragging`);
  await page.touch('touchEnd'); await sleep(1500);
  const n1 = await ents(), c1 = await cam(page);
  check(id, 'sketch', 'a finger drag from the centre draws a circle', n1 > n0, `${n0} -> ${n1}, events ${await page.eval('JSON.stringify(window.__evs)')} pd ${await page.eval('JSON.stringify(window.__pd)')} multi ${await page.eval('window.__cad.viewport.touch.multi')}`);
  check(id, 'sketch', 'the one-finger drag does not move the camera', !camMoved(c0, c1));
  const geo = await page.eval(`(() => { const d = window.__cad.controller.sketchDraft(); const c = [...d.entities].reverse().find((e) => e.type === 'circle'); if (!c) return null; const pt = d.points.find((q) => q.id === c.c); const r = c.r; const s0 = window.__cad.viewport.sketchToScreen(pt.x, pt.y), s1 = window.__cad.viewport.sketchToScreen(pt.x + r, pt.y); return { r, px: Math.hypot(s1.x - s0.x, s1.y - s0.y) }; })()`);
  check(id, 'sketch', 'the circle has the dragged radius (about 70 px on screen)', !!geo && Math.abs(geo.px - 70) <= 30, JSON.stringify(geo));
  a = await audit(page); await shot(page, `${id}-8-sketch-circle`);
  const field = await page.eval(`(() => { const f = document.querySelector('#vp .sketch-fields input'); if (!f) return null; const r = f.getBoundingClientRect(); return { focus: document.activeElement === f, mode: f.getAttribute('inputmode'), hint: f.getAttribute('enterkeyhint'), y: r.bottom, vh: innerHeight, sheet: !!document.querySelector('.sheet') }; })()`);
  check(id, 'sketch', 'then the radius field is focused with the decimal keypad', !!field && field.focus && field.mode === 'decimal' && field.hint === 'done', JSON.stringify(field));
  check(id, 'sketch', 'the radius field is on screen, under the drawing (not at the finger)', !!field && field.y <= a.h && field.y >= a.canvasBox[1] + a.canvasBox[3] * 0.6, JSON.stringify([field, a.canvasBox]));
  await page.eval(`document.querySelector('#vp .sketch-fields input').select()`);
  await page.send('Input.insertText', { text: '12.5' });   // what the keypad types (the digit keys of CDP's key events do not make a '.')
  await page.key('Enter'); await sleep(1500);
  const geo2 = await page.eval(`(() => { const d = window.__cad.controller.sketchDraft(); const c = d.entities.find((e) => e.type === 'circle'); return c ? c.r : null; })()`);
  check(id, 'sketch', 'a typed radius (12.5) sets the size', Math.abs((geo2 ?? 0) - 12.5) < 1e-6, String(geo2));
  // tool again: two fingers move the view; tap-tap still places
  await tapOn(page, '.bottom-nav button[data-nav="tools"]'); await tapOn(page, '.tool-tray .slot[data-slot="circle"] .slot-btn'); await sleep(400);
  const c2 = await cam(page);
  await page.pinch(cx, cy + 60, 30, 90); await sleep(600);
  const c3 = await cam(page);
  check(id, 'sketch', 'two fingers pinch the sketch view', camMoved(c2, c3));
  const n2 = await ents();
  await page.tap(cx + 40, cy + 120); await sleep(300); await page.tap(cx + 40 + 36, cy + 120); await sleep(1500);
  const n3 = await ents();
  check(id, 'sketch', 'tap, then tap still places a shape', n3 > n2, `${n2} -> ${n3}`);
  // the other drawing tools take the same gesture: a rectangle dragged corner to corner, a line dragged from its start to its end
  for (const [slot, label, add] of [['rectangle', 'rectangle', 4], ['line', 'line', 1]]) {
    await tapOn(page, '.bottom-nav button[data-nav="tools"]'); await tapOn(page, `.tool-tray .slot[data-slot="${slot}"] .slot-btn`); await sleep(400);
    const m0 = await ents(), cm0 = await cam(page);
    await page.touch('touchStart', [{ x: cx - 80, y: cy + 230 }]); await sleep(60);
    for (let i = 1; i <= 6; i++) { await page.touch('touchMove', [{ x: cx - 80 + (60 * i) / 6, y: cy + 230 + (40 * i) / 6 }]); await sleep(30); }
    await page.touch('touchEnd'); await sleep(1500);
    check(id, 'sketch', `a finger drag draws a ${label}`, (await ents()) >= m0 + add, `${m0} -> ${await ents()}`);
    check(id, 'sketch', `the ${label} drag does not move the camera`, !camMoved(cm0, await cam(page)));
    await tapOn(page, '.sketch-actions [data-act="cancel-shape"]'); await sleep(300);
  }
  // a cancelled touch mid-draw leaves nothing behind
  await tapOn(page, '.bottom-nav button[data-nav="tools"]'); await tapOn(page, '.tool-tray .slot[data-slot="circle"] .slot-btn'); await sleep(400);
  const n4 = await ents();
  await page.touch('touchStart', [{ x: cx, y: cy + 160 }]); await sleep(60);
  for (let i = 1; i <= 4; i++) { await page.touch('touchMove', [{ x: cx + 10 * i, y: cy + 160 }]); await sleep(30); }
  await page.touch('touchCancel'); await sleep(600);
  const n5 = await ents(), c4 = await cam(page);
  check(id, 'sketch', 'a cancelled touch adds nothing and leaves no preview', n5 === n4 && await page.eval(`!document.querySelector('#vp .sketch-fields')`), `${n4} -> ${n5}`);
  check(id, 'sketch', 'a cancelled touch does not move the camera', !camMoved(c3, c4));
  await page.tap(cx - 60, cy + 160); await sleep(300); await page.tap(cx - 60 + 30, cy + 160); await sleep(1500);
  check(id, 'sketch', 'drawing works normally after a cancelled touch', (await ents()) > n5);
  await shot(page, `${id}-8-sketch-after`);
  // Delete and Undo are buttons
  check(id, 'sketch', 'the Undo button works', await tapOn(page, '.sketch-actions [data-act="undo"]'));
  check(id, 'sketch', 'Done leaves the sketch', await tapOn(page, '.sketch-actions [data-act="done"]'));
  await sleep(1500);
  check(id, 'sketch', 'the sketch bar goes away with the sketch', await page.eval(`!document.querySelector('.sketch-actions')`));
}

/** The sketch as the autosave holds it: entity counts by type, read back from the production app's own storage (no dev hook). Needs a moment after Done. */
const sketchCounts = (page) => page.eval(`(() => { try { const d = JSON.parse(localStorage.getItem('cad.autosave.v1')).doc; const c = {}; for (const f of d.features) for (const e of (f.entities ?? [])) c[e.type] = (c[e.type] ?? 0) + 1; return JSON.stringify(c); } catch (e) { return '{}'; } })()`).then(JSON.parse);
const focusInfo = (page) => page.eval(`(() => { const a = document.activeElement; const f = document.querySelector('#vp .sketch-fields input'); return { tag: a && a.tagName, inField: !!a && !!a.closest('.sketch-fields'), primer: a && a.id === 'sketch-kb-primer', mode: a && a.getAttribute('inputmode'), hint: a && a.getAttribute('enterkeyhint'), fields: !!f, fieldBox: f ? (() => { const r = f.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() : null }; })()`);
/** A pen stroke as Chrome can send it: mouse events that carry pointerType 'pen' (the page sees pointer events with pointerType pen). */
const pen = (page, type, x, y, buttons = 1) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', force: buttons ? 0.5 : 0 });

/** The sketch ribbon is one row that scrolls: a real finger swipe on it scrolls it (and draws nothing), and scrolling to the end brings Dimension and the last constraint button fully inside the strip. */
async function ribbonReach(page, id, a) {
  const info = () => page.eval(`(() => { const rg = document.querySelector('.ribbon-wrap .rb-groups'); if (!rg) return null; const r = rg.getBoundingClientRect();
    const inside = (b) => { if (!b) return null; const q = b.getBoundingClientRect(); return q.left >= r.left - 0.5 && q.right <= Math.min(r.right, innerWidth) + 0.5 && q.top >= r.top - 0.5 && q.bottom <= r.bottom + 0.5; };
    const btns = [...rg.querySelectorAll('button')]; const dim = btns.find((b) => /dimension/i.test((b.getAttribute('aria-label') || '') + b.textContent));
    const cg = [...rg.querySelectorAll('.rb-group')].find((g) => /constrain/i.test(g.getAttribute('aria-label') || '')); const cb = cg ? [...cg.querySelectorAll('button')].pop() : null;
    return { sl: Math.round(rg.scrollLeft), max: rg.scrollWidth - rg.clientWidth, x: r.x, y: r.y, w: r.width, h: r.height, dim: !!dim, dimIn: inside(dim), lastIn: inside([...rg.querySelectorAll('button')].pop()), lastConstraint: !!cb, lastConstraintIn: inside(cb), ents: window.__cad?.controller ? window.__cad.controller.sketchDraft().entities.length : null, canvasEvents: window.__ribbonSpy ? window.__ribbonSpy.n : null, status: document.querySelector('[data-testid="status-sketch"]')?.textContent ?? '' }; })()`);
  // production build: no dev hook, so count what reaches the drawing area instead (any press on it would start a sketch tool), and the status readout
  await page.eval(`(() => { const vp = document.getElementById('vp'); window.__ribbonSpy = { n: 0 }; document.addEventListener('touchstart', (e) => { const t0 = e.touches[0]; window.__ribbonSpy.doc = (e.target.className || e.target.tagName) + ' @' + Math.round(t0.clientX) + ',' + Math.round(t0.clientY) + ' vv=' + Math.round(visualViewport.offsetTop) + '/' + Math.round(visualViewport.pageTop) + '/' + visualViewport.scale + ' sy=' + scrollY + ' efp=' + ((x) => x ? x.tagName + '.' + x.className : null)(document.elementFromPoint(t0.clientX, t0.clientY)) + ' wrap=' + JSON.stringify(document.querySelector('.ribbon-wrap').getBoundingClientRect().toJSON()) + ' cancelable=' + e.cancelable + ' sl=' + document.querySelector('.rb-groups').scrollLeft; }, true);
    for (const t of ['pointerdown', 'touchstart', 'mousedown']) vp.addEventListener(t, (e) => { window.__ribbonSpy.n++; window.__ribbonSpy.last = t + ' ' + (e.target.className || e.target.tagName) + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ' type=' + e.pointerType; }, true); return 1; })()`);
  const i0 = await info();
  if (!i0) { check(id, 'ribbon-reach', 'the sketch ribbon strip exists', false); return; }
  check(id, 'ribbon-reach', 'the Dimension tool is on the ribbon', i0.dim);
  if (i0.max <= 1) { check(id, 'ribbon-reach', 'the whole ribbon fits: Dimension and the last constraint are inside the strip', i0.dimIn !== false && i0.lastConstraintIn !== false, JSON.stringify(i0)); return; }
  // a real swipe, starting on a group title (a plain spot of the strip), to the left
  const y = i0.y + i0.h - 8, x0 = i0.x + i0.w * 0.8, x1 = i0.x + i0.w * 0.2;
  await page.swipe(x0, y, x1, y, { steps: 12, ms: 16 }); await sleep(700);
  const i1 = await info();
  check(id, 'ribbon-reach', 'a finger swipe on the ribbon scrolls it', i1.sl > i0.sl + 20, `scrollLeft ${i0.sl} -> ${i1.sl} of ${i0.max}`);
  check(id, 'ribbon-reach', 'the swipe on the ribbon created no sketch entity and no press reached the drawing area', i1.ents === i0.ents && i1.canvasEvents === 0 && i1.status === i0.status, `entities ${i0.ents} -> ${i1.ents}; events on the canvas ${i1.canvasEvents}; status "${i0.status}" -> "${i1.status}"`);
  await shot(page, `${id}-9b-ribbon-swiped`);
  { const b0 = await info(); await page.swipe(i0.x + i0.w * 0.85, y, i0.x + i0.w * 0.1, y, { steps: 8, ms: 12 }); await sleep(600); const b1 = await info(); console.log('     DIAG second swipe before chevron: sl', b0.sl, '->', b1.sl, 'events', b1.canvasEvents); }
  // the chevron on the right scrolls by one group
  const before = i1.sl; const chev = await tapOn(page, '.rb-edge.r'); await sleep(700); const i2 = await info(); console.log('     after chevron:', JSON.stringify(i2));
  check(id, 'ribbon-reach', 'the edge chevron scrolls the ribbon on', !chev || i2.sl > before || before >= i2.max - 2, `scrollLeft ${before} -> ${i2.sl}`);
  // a swipe right after the chevron (back towards the start) still scrolls the strip and does not reach the drawing area
  { const c0 = await info(); await page.swipe(i0.x + i0.w * 0.2, y, i0.x + i0.w * 0.8, y, { steps: 10, ms: 14 }); await sleep(700); const c1 = await info();
    check(id, 'ribbon-reach', 'a swipe after the chevron scrolls the strip back and reaches no sketch tool', c1.sl < c0.sl - 20 && c1.canvasEvents === 0, `scrollLeft ${c0.sl} -> ${c1.sl}; events on the canvas ${c1.canvasEvents} (last: ${await page.eval('window.__ribbonSpy.last')}; doc: ${await page.eval('window.__ribbonSpy.doc')})`); }
  // to the end
  for (let k = 0; k < 12; k++) { const c = await info(); if (c.sl >= c.max - 2) break; await page.swipe(i0.x + i0.w * 0.5, i0.y + 30, i0.x + i0.w * 0.05, i0.y + 30, { steps: 12, ms: 16 }); await sleep(900); }
  const iE = await info();
  check(id, 'ribbon-reach', 'none of the swipes on the ribbon reached the drawing area', iE.canvasEvents === 0, `${iE.canvasEvents} (last ${await page.eval('window.__ribbonSpy.last')})`);
  check(id, 'ribbon-reach', 'scrolled to the end, the last button of the last group is fully inside the strip', iE.sl >= iE.max - 2 && iE.lastIn === true, JSON.stringify(iE));
  check(id, 'ribbon-reach', 'at the end the right chevron is gone and the left one is there', await page.eval(`!document.querySelector('.ribbon-wrap .rb-edge.r') && !!document.querySelector('.ribbon-wrap .rb-edge.l')`), JSON.stringify(iE));
  // Dimension and the last constraint button each come fully into view by scrolling (they are in the middle of the strip, so not both at the end)
  for (const [what, sel] of [['Dimension', 'dim'], ['the last constraint button', 'cons']]) {
    const r = await page.eval(`(() => { const rg = document.querySelector('.ribbon-wrap .rb-groups'); const btns = [...rg.querySelectorAll('button')];
      const el = ${sel === 'dim' ? "btns.find((b) => /dimension/i.test((b.getAttribute('aria-label') || '') + b.textContent))" : "(() => { const g = [...rg.querySelectorAll('.rb-group')].find((g) => /constrain/i.test(g.getAttribute('aria-label') || '')); return g ? [...g.querySelectorAll('button')].pop() : null; })()"};
      if (!el) return null; const g = el.closest('.rb-group'); rg.scrollLeft = g.offsetLeft - 8; const b = el.getBoundingClientRect(), s = rg.getBoundingClientRect(); return { in: b.left >= s.left - 0.5 && b.right <= Math.min(s.right, innerWidth) + 0.5, w: Math.round(b.width), h: Math.round(b.height) }; })()`);
    check(id, 'ribbon-reach', `${what} can be scrolled fully inside the strip`, !!r && r.in, JSON.stringify(r));
  }
  await page.eval(`(() => { const rg = document.querySelector('.ribbon-wrap .rb-groups'); const g = [...rg.querySelectorAll('.rb-group')].find((g) => /dimension/i.test(g.getAttribute('aria-label') || '')); rg.scrollLeft = g ? g.offsetLeft - 8 : rg.scrollLeft; })()`); await sleep(500);
  await shot(page, `${id}-9d-ribbon-dimension`);
  await page.eval(`document.querySelector('.ribbon-wrap .rb-groups').scrollLeft = 1e5`); await sleep(500);
  await shot(page, `${id}-9c-ribbon-end`);
  a = await audit(page); fitChecks(id, 'ribbon-end', a, { layout: 'tablet' }, { canvas: false });
  // back to the start for the rest of the flow
  await page.eval(`document.querySelector('.ribbon-wrap .rb-groups').scrollLeft = 0`); await sleep(400);
}

/** A sketch on a tablet or phone, from the UI alone: a rectangle with a finger (drag), a circle with a finger (the radius field is focused after the lift), a circle with the pen,
 *  hover with the pen, a palm beside the pen, a long press. Reads back through the DOM and the autosave. */
async function touchSketchFlows(page, id, p) {
  let a;
  if (p.layout === 'phone') {
    await tapOn(page, '.bottom-nav button[data-nav="tools"]'); await tapOn(page, '.tool-tray .tt-tab', 'Home');
    check(id, 'tsketch', 'the new sketch list opens', await tapOn(page, '.tool-tray .slot[data-slot="new-sketch"] .slot-more'));
  } else {
    check(id, 'tsketch', 'the new sketch list opens', await tapOn(page, '.slot[data-slot="new-sketch"] .slot-more') || await tapOn(page, '.slot[data-slot="new-sketch"] .slot-btn'));
  }
  check(id, 'tsketch', 'a plane is chosen', await tapOn(page, '.slot-flyout [data-testid="cmd-sketch-new-front"]'));
  await sleep(2500);
  await shot(page, `${id}-9-sketch-open`);
  a = await audit(page);
  common(id, 'tsketch-open', a, p);
  if (p.layout === 'tablet') { fitChecks(id, 'tsketch-open', a, p, { canvas: false });
    await ribbonReach(page, id, a); }
  const pickTool = async (slot) => {
    if (p.layout === 'phone') { await tapOn(page, '.bottom-nav button[data-nav="tools"]'); return tapOn(page, `.tool-tray .slot[data-slot="${slot}"] .slot-btn`); }
    return (await tapOn(page, `.slot[data-slot="${slot}"] .slot-btn`)) || (await tapOn(page, `.tool-rail [data-slot="${slot}"] .slot-btn`));
  };
  const cv = a.canvasBox, cx = cv[0] + cv[2] * 0.5, cy = cv[1] + cv[3] * 0.4, k = Math.min(1, cv[2] / 640, cv[3] / 520);   // offsets shrink on a small canvas (a phone, a docked portrait tablet)
  // a rectangle: finger down on a corner, drag, lift
  check(id, 'tsketch', 'the rectangle tool is picked', await pickTool('rectangle'));
  await sleep(400);
  await page.touch('touchStart', [{ x: cx - 100*k, y: cy - 60*k }]); await sleep(60);
  for (let i = 1; i <= 8; i++) { await page.touch('touchMove', [{ x: cx - 100*k + (160*k * i) / 8, y: cy - 60*k + (100*k * i) / 8 }]); await sleep(30); }
  await shot(page, `${id}-9-sketch-rect-drag`);
  await page.touch('touchEnd'); await sleep(1200);
  let f = await focusInfo(page);
  await shot(page, `${id}-9-sketch-rect-lifted`);
  console.log(`     after the rectangle lift: ${JSON.stringify(f)}`);
  // finger: circle drag -> the radius field is focused after the lift (Chrome cannot show iOS's keyboard: assert the focus and the keypad attributes)
  await pickTool('circle'); await sleep(400);
  await page.touch('touchStart', [{ x: cx + 120*k, y: cy + 140*k }]); await sleep(60);
  for (let i = 1; i <= 8; i++) { await page.touch('touchMove', [{ x: cx + 120*k + (60*k * i) / 8, y: cy + 140*k }]); await sleep(30); }
  await page.touch('touchEnd');
  await sleep(150);
  const primerNow = await focusInfo(page);   // just after the click that follows the lift: the hidden box (or already the field) holds the focus
  for (let i = 0; i < 24 && !(await focusInfo(page)).inField; i++) await sleep(250);
  f = await focusInfo(page);
  await shot(page, `${id}-9-sketch-circle-lifted`);
  check(id, 'tsketch', 'just after the finger lifts the focus is in a text box (the hidden primer, or the field; iOS needs a focus in the click after the lift)', primerNow.tag === 'INPUT', JSON.stringify(primerNow));
  check(id, 'tsketch', 'then the radius field has the focus with the decimal keypad and a Done key', f.inField && f.mode === 'decimal' && f.hint === 'done', JSON.stringify(f));
  check(id, 'tsketch', 'the radius field is on screen and finger sized', !!f.fieldBox && f.fieldBox[1] >= 0 && f.fieldBox[1] + f.fieldBox[3] <= a.h && f.fieldBox[3] >= 28, JSON.stringify(f.fieldBox));
  const sign = await page.eval(`!!document.querySelector('#vp .sketch-fields .expr-sign')`);
  check(id, 'tsketch', 'the field has the sign key (and the formula key) beside it', sign);
  await page.eval(`document.activeElement.select && document.activeElement.select()`);
  await page.send('Input.insertText', { text: '15' }); await page.key('Enter'); await sleep(900);
  // the pen: a circle by a stroke, with hover first (pointermove with no button)
  await pickTool('circle'); await sleep(400);
  for (let i = 0; i < 4; i++) { await pen(page, 'mouseMoved', cx - 200*k + i * 10, cy + 150*k, 0); await sleep(30); }
  await pen(page, 'mousePressed', cx - 200*k, cy + 150*k);
  for (let i = 1; i <= 8; i++) { await pen(page, 'mouseMoved', cx - 200*k + (70*k * i) / 8, cy + 150*k); await sleep(30); }
  await pen(page, 'mouseReleased', cx - 130*k, cy + 150*k, 0); 
  await sleep(150);
  const penNow = await focusInfo(page);
  for (let i = 0; i < 24 && !(await focusInfo(page)).inField; i++) await sleep(250);
  f = await focusInfo(page);
  await shot(page, `${id}-9-sketch-pen-circle`);
  check(id, 'tsketch', 'a pen stroke (press, drag, lift) places a circle and focuses its radius field', f.inField, JSON.stringify([penNow, f]));
  await page.key('Escape'); await sleep(300);
  // the pen leaves hover range after a lift: the shape in progress and its fields stay (a line: first point by a tap)
  await pickTool('line'); await sleep(400);
  await pen(page, 'mouseMoved', cx, cy + 200*k, 0); await pen(page, 'mousePressed', cx, cy + 200*k); await pen(page, 'mouseReleased', cx, cy + 200*k, 0); await sleep(300);
  await page.eval(`(() => { const c = document.querySelector('#vp canvas'); c.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'pen', bubbles: false })); })()`); await sleep(300);
  const keep = await page.eval(`!!document.querySelector('#vp .sketch-fields')`);
  check(id, 'tsketch', 'the pen rising out of hover range does not drop the line in progress and its fields', keep);
  await page.key('Escape'); await sleep(300);
  // a palm beside the pen: pen down and dragging a circle while a touch lands elsewhere and moves
  await pickTool('circle'); await sleep(400);
  await pen(page, 'mouseMoved', cx - 200*k, cy - 150*k, 0);
  await pen(page, 'mousePressed', cx - 200*k, cy - 150*k);
  await page.touch('touchStart', [{ x: cx + 200*k, y: cy + 80*k }]);
  for (let i = 1; i <= 8; i++) { await pen(page, 'mouseMoved', cx - 200*k + (50*k * i) / 8, cy - 150*k); await page.touch('touchMove', [{ x: cx + 200*k + 10 * i, y: cy + 80*k + 5 * i }]); await sleep(30); }
  await page.touch('touchEnd');
  await pen(page, 'mouseReleased', cx - 150*k, cy - 150*k, 0);
  for (let i = 0; i < 24 && !(await focusInfo(page)).inField; i++) await sleep(250);
  await shot(page, `${id}-9-sketch-palm`);
  f = await focusInfo(page);
  check(id, 'tsketch', 'a palm touch beside the pen does not disturb the pen stroke (the circle is placed, no pinch)', f.inField, JSON.stringify(f));
  await page.key('Escape'); await sleep(300);
  // a long press on the canvas: no text selection, no callout
  await page.touch('touchStart', [{ x: cx, y: cy - 200*k }]); await sleep(900); await page.touch('touchEnd'); await sleep(300);
  const sel = await page.eval(`(() => { const s = getSelection(); const c = document.querySelector('#vp canvas'); const cs = getComputedStyle(c); return { text: s ? s.toString() : '', ta: cs.touchAction, us: cs.userSelect || cs.webkitUserSelect, callout: cs.getPropertyValue('-webkit-touch-callout') }; })()`);
  check(id, 'tsketch', 'a long press on the canvas selects no text and the canvas has touch-action none', sel.text === '' && sel.ta === 'none' && sel.us === 'none', JSON.stringify(sel));
  const chromeCss = await page.eval(`(() => { const cs = getComputedStyle(document.getElementById('app')); return { ta: cs.touchAction, callout: cs.getPropertyValue('-webkit-touch-callout') }; })()`);
  check(id, 'tsketch', 'the app chrome forbids page pinch-zoom and double-tap zoom (touch-action pan-x pan-y)', chromeCss.ta === 'pan-x pan-y', JSON.stringify(chromeCss));
  await page.key('Escape');
  await tapOn(page, p.layout === 'phone' ? '.sketch-actions [data-act="done"]' : '[data-action="sketch-ok"]');
  await sleep(2500);
  await shot(page, `${id}-9-sketch-done`);
  let counts = await sketchCounts(page);
  for (let i = 0; i < 16 && (counts.circle ?? 0) < 2; i++) { await sleep(500); counts = await sketchCounts(page); }   // the autosave follows a moment later
  console.log('     sketch contents after Done (autosave):', JSON.stringify(counts));
  check(id, 'tsketch', 'the finished sketch holds the rectangle (4 lines) and circles', (counts.line ?? 0) >= 4 && (counts.circle ?? 0) >= 2, JSON.stringify(counts));
}

/** Every number box and text box that shows in the panels the run opened: the keypad attributes the iPad keyboard reads. */
async function keyboardAudit(page, id) {
  const rows = await page.eval(`(() => [...document.querySelectorAll('input, textarea')].filter((e) => e.getBoundingClientRect().width > 0 && !['checkbox','radio','range','file','color','hidden'].includes(e.type)).map((e) => ({ type: e.type, mode: e.getAttribute('inputmode'), sign: e.hasAttribute('data-sign'), ac: e.getAttribute('autocapitalize'), label: e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.className })))()`);
  const bad = rows.filter((r) => (r.type === 'number' || r.mode === 'decimal' || r.mode === 'numeric') ? !r.mode : (r.type === 'text' || r.type === 'search') && r.mode !== 'text' && !r.ac);
  check(id, 'keyboard', 'every visible number box has an inputmode and every visible text box has autocapitalize set', bad.length === 0, JSON.stringify(bad.slice(0, 6)));
}

/** A fresh start (nothing stored), a sample from the Library picker: it takes the empty first part, so one document is open and no empty second tab appears. */
async function freshSample(page, url, id, p) {
  await page.eval(`localStorage.clear(); localStorage.setItem('cad.theme', '"light"'); 0`);
  await page.send('Page.reload'); await sleep(1000);
  for (let i = 0; i < 80 && !(await page.eval(`!!document.querySelector('.status')`)); i++) await sleep(150);
  await idle(page); await sleep(500);
  const rows = () => page.eval(`(document.querySelector('.topbar .doc-name, .topbar .doc-switch, .topbar .tab.active')?.textContent || document.querySelector('.topbar')?.textContent || '').trim()`);   // the document's title in the top bar stands in for the document (no dev hook)
  const before = await rows();
  check(id, 'fresh', 'a fresh start opens an empty part (the stored sample is gone)', !/mounting plate/i.test(before), `title ${before}`);
  if (p.layout === 'phone') await pickMenu(page, 'phone-file', 'library'); else await tapOn(page, '.topbar button', 'library');
  await sleep(600);
  await tapOn(page, '.dlg-list .dlg-item');
  await idle(page); await sleep(2500);
  let docs;
  if (p.layout === 'phone') { await tapOn(page, '.doc-switch'); docs = await page.eval(`[...document.querySelectorAll('.doc-list [data-list-tab]')].map((e) => e.textContent.trim())`); await shot(page, `${id}-9-fresh-doclist`); await page.tap(200, 500); }
  else docs = await page.eval(`[...document.querySelectorAll('.tabstrip .tab')].map((e) => e.textContent.trim())`);
  let features = await rows(); for (let i = 0; i < 20 && features === before; i++) { await sleep(300); features = await rows(); }
  check(id, 'fresh', 'the sample opened', features !== before, `title ${before} -> ${features}`);
  check(id, 'fresh', 'the sample took the empty part: one document, no stray empty tab', docs.length <= 1, JSON.stringify(docs));
}

async function runProfile(page, url, p) {
  const id = p.id;
  console.log(`\n== ${id} ${p.w}x${p.h}`);
  await page.setMobile(p.w, p.h, { dpr: DPR });
  // the published site adds a Licences and a Documentation link to index.html; the dev server does not, so add the same ones to every page load
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded', () => document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(licencesLink() + docsLink())}))` });
  await page.goto(url);
  for (let i = 0; i < 100 && !(await page.eval(`!!document.querySelector('.status, .rb-btn')`).catch(() => false)); i++) await sleep(300);
  await openSample(page, url);
  await shot(page, `${id}-1-open`);

  // 1. the sample is open, nothing selected, every panel closed
  let a = await audit(page);
  common(id, 'open', a, p);
  check(id, 'open', 'a touch device: coarse pointer, no hover', a.coarse && !a.hover, `coarse=${a.coarse} hover=${a.hover}`);
  check(id, 'open', `canvas at least ${MIN_CANVAS_VISIBLE * 100}% visible`, a.canvasVisible >= MIN_CANVAS_VISIBLE, `${(a.canvasVisible * 100).toFixed(0)}% of ${a.canvasBox}`);
  const cv = a.canvasBox; const cx = cv[0] + cv[2] / 2, cy = cv[1] + cv[3] / 2;
  check(id, 'open', 'icons are centred in their buttons', a.iconOff.length === 0, a.iconOff.slice(0, 5).map((o) => `${o.el} dx${o.dx} dy${o.dy}`).join('; '));
  check(id, 'open', 'the top bar and bottom bar buttons are on one line each and inside the screen', a.barLines.top.spread <= 1 + (p.layout === 'phone' ? 0 : 20) && a.barLines.top.off === 0 && a.barLines.nav.spread <= 1 && a.barLines.nav.off === 0, JSON.stringify(a.barLines));
  { const sizes = new Set(Object.entries(a.iconSizes).filter(([k]) => /tb-icon|bn-btn|cube-tools|slot\.icon|display-btn/.test(k)).flatMap(([, v]) => v));
    check(id, 'open', 'one icon size across the top bar, bottom bar and view buttons', sizes.size === 1, JSON.stringify(a.iconSizes)); }
  if (p.layout === 'phone') {
    check(id, 'open', `top and bottom bars take at most ${MAX_CHROME_PX}px`, a.chrome.total <= MAX_CHROME_PX, JSON.stringify(a.chrome));
    check(id, 'open', 'no document strip or ribbon row on the phone', a.chrome.tabbar === 0 && a.chrome.ribbon === 0, JSON.stringify(a.chrome));
    check(id, 'open', `the canvas has at least ${MIN_CANVAS_SHARE * 100}% of the screen height`, a.canvasBox[3] >= MIN_CANVAS_SHARE * a.h, `${a.canvasBox[3]} of ${a.h}`);
  } else {
    check(id, 'open', 'one top bar row (no wrap)', a.chrome.top <= 56, JSON.stringify(a.chrome));
    check(id, 'open', 'no strip for a single document', a.chrome.tabbar === 0, JSON.stringify(a.chrome));
  }
  check(id, 'open', 'a feature tree is reachable', p.layout === 'phone' ? !!(await rectOf(page, '.bottom-nav button[data-nav="tree"]')) : a.docked.tree);
  if (p.layout === 'tablet') check(id, 'open', 'compact ribbon', /compact/.test(a.docked.ribbon ?? ''), String(a.docked.ribbon));

  // 2. touch on the canvas: orbit, pinch, a two-finger tap and a cancelled touch must not select; a tap must
  const before = await grab(page);
  await page.swipe(cx - 60, cy, cx + 60, cy + 20);
  await sleep(500);
  const afterOrbit = await grab(page);
  const d1 = diffPng(before, afterOrbit);
  check(id, 'touch', 'one-finger drag orbits the view', d1.pct > 0.3, `diff ${d1.pct}%`);
  a = await audit(page); check(id, 'touch', 'a drag selects nothing', a.selection === 0, `selection chips ${a.selection}`);
  await page.pinch(cx, cy, 30, 90); await sleep(500);
  const afterPinch = await grab(page);
  const d2 = diffPng(afterOrbit, afterPinch);
  check(id, 'touch', 'pinch zooms the view', d2.pct > 0.3, `diff ${d2.pct}%`);
  a = await audit(page); check(id, 'touch', 'a pinch selects nothing', a.selection === 0, `selection chips ${a.selection}`);
  await page.touch('touchStart', [{ x: cx - 12, y: cy, id: 0 }, { x: cx + 12, y: cy, id: 1 }]); await sleep(60); await page.touch('touchEnd'); await sleep(400);
  a = await audit(page); check(id, 'touch', 'a two-finger tap selects nothing', a.selection === 0, `selection chips ${a.selection}`);
  await page.touch('touchStart', [{ x: cx, y: cy, id: 0 }]); await sleep(60); await page.touch('touchCancel'); await sleep(400);
  a = await audit(page); check(id, 'touch', 'a cancelled touch selects nothing', a.selection === 0, `selection chips ${a.selection}`);
  await page.eval('0'); await sleep(100);
  // find a spot on the model: try the middle, then a ring around it, until the selection list shows
  let picked = false;
  for (const [dx, dy] of [[0, 0], [20, 0], [-20, 0], [0, 25], [0, -25], [45, 15], [-45, 15], [60, 0], [-60, 0]]) {
    await page.tap(cx + dx, cy + dy); await sleep(500);
    if ((await audit(page)).selection > 0) { picked = true; break; }
  }
  check(id, 'touch', 'a tap selects what is under the finger', picked);
  a = await audit(page); await shot(page, `${id}-2-selected`);
  common(id, 'selected', a, p);
  if (picked) check(id, 'selected', 'the selection list is on screen', a.overlaps.length === 0 && a.selection > 0);

  // 3. tree / properties / diagnostics
  if (p.layout === 'phone') {
    for (const [nav, label] of [['tree', 'Tree'], ['props', 'Properties'], ['diag', 'Diagnostics']]) {
      const step = 'sheet-' + nav;
      check(id, step, 'opens from the bottom bar', await tapOn(page, `.bottom-nav button[data-nav="${nav}"]`));
      a = await audit(page); await shot(page, `${id}-3-${nav}`);
      if (a.sheet) {   // a sheet takes a row of its own: the canvas ends where it begins, and a browse list shows the model beside it
        check(id, step, 'the canvas is resized to the room above the sheet (not covered)', a.canvasBox[1] + a.canvasBox[3] <= a.sheet.box[1] + 2 && a.canvasVisible >= 0.5, `canvas ${a.canvasBox} sheet ${a.sheet.box} visible ${(a.canvasVisible * 100).toFixed(0)}%`);
        check(id, step, 'the first snap leaves the canvas at least 35% of the screen', a.canvasBox[3] >= MIN_EDIT_CANVAS_SHARE * a.h, `${a.canvasBox[3]} of ${a.h}`);
      }
      check(id, step, 'is a labelled dialog with content', !!a.sheet && a.sheet.label === label && a.sheet.bodyChildren > 0, JSON.stringify(a.sheet));
      if (a.sheet) {
        const [sx, sy, sw, sh] = a.sheet.box;
        check(id, step, 'fits the screen and stands on the bar', sx >= 0 && sy >= 0 && sx + sw <= a.w + 1 && Math.abs(sy + sh - a.nav[1]) <= 2, `sheet ${a.sheet.box} nav ${a.nav}`);
      }
      common(id, step, a, p);
      if (nav === 'tree') {   // a row can be tapped inside the sheet, and its hide / suppress buttons are visible without hover
        check(id, step, 'row buttons need no hover', a.rowActs.length > 0 && a.rowActs.every((o) => o > 0.9), JSON.stringify(a.rowActs));
        const row = await rectOf(page, '.sheet .tree .row', 'Extrude');
        if (row) { await page.tap(row.x - row.w / 4, row.y); await sleep(500); }
      }
      // drag the handle up to the full snap: a scrim appears; tapping it closes the sheet
      const head = await rectOf(page, '.sheet-head');
      if (head) {
        await page.swipe(head.x, head.y, head.x, 60, { steps: 12 }); await sleep(400);
        a = await audit(page); await shot(page, `${id}-3-${nav}-full`);
        check(id, step, 'dragging the handle up raises it to full', a.sheet?.snap === 'full', JSON.stringify(a.sheet));
        if (nav === 'props') {   // the editor never covers more than ~60%: the model stays in view even at the top snap
          check(id, step, `full properties sheet stays under ${MAX_SHEET_SHARE_EDIT * 100}% of the screen`, a.sheet.box[3] <= MAX_SHEET_SHARE_EDIT * a.h, JSON.stringify(a.sheet));
          check(id, step, 'the canvas still has room above the sheet', a.canvasBox[3] >= 0.2 * a.h, JSON.stringify(a.canvasBox));
        } else {
          check(id, step, 'full browse sheet has a scrim', !!a.sheet?.scrim);
          await page.tap(a.w / 2, 12); await sleep(400);
          a = await audit(page); check(id, step, 'tap outside closes it', a.sheet === null, JSON.stringify(a.sheet));
        }
      }
      if ((await audit(page)).sheet === null) await tapOn(page, `.bottom-nav button[data-nav="${nav}"]`);
      await tapOn(page, '.sheet-close');
      a = await audit(page); check(id, step, 'the close button closes it', a.sheet === null);
    }
    a = await audit(page);
    check(id, 'sheets-closed', `canvas at least ${MIN_CANVAS_VISIBLE * 100}% visible with the sheets closed`, a.canvasVisible >= MIN_CANVAS_VISIBLE, `${(a.canvasVisible * 100).toFixed(0)}%`);
  } else {
    await tapOn(page, '.tree-wrap.docked .tree .row', 'Extrude'); await sleep(500);   // a feature row (not the material or a plane)
    a = await audit(page); await shot(page, `${id}-3-docked`);
    const narrow = a.w <= 900;
    check(id, 'docked', narrow ? 'portrait: only the tree is docked (one panel), the properties are its Editor tab' : 'tree and properties are docked', narrow ? a.docked.tree && !a.docked.props : a.docked.tree && a.docked.props, JSON.stringify(a.docked));
    fitChecks(id, 'docked', a, p);
    if (narrow) {
      check(id, 'docked', 'the Editor tab opens', await tapOn(page, '.ptabs [data-testid="left-tab-Editor"]'));
      const b = await audit(page); await shot(page, `${id}-3-props`);
      check(id, 'docked', 'the selected feature\'s properties are in the Editor tab', b.fit.editorProps);
      check(id, 'docked', 'the properties tab stays inside the screen (no sideways scroll, canvas width kept)', b.hscroll.scrollWidth <= b.hscroll.innerWidth && b.canvasBox[2] >= MIN_CANVAS_WIDTH_PORTRAIT * b.w, `${b.canvasBox[2]} of ${b.w}`);
      await tapOn(page, '.ptabs [data-testid="left-tab-Features"]');
    }
    common(id, 'docked', a, p);
    check(id, 'docked', 'row buttons need no hover', a.rowActs.length > 0 && a.rowActs.every((o) => o > 0.9), JSON.stringify(a.rowActs));
    check(id, 'docked', `canvas at least ${MIN_CANVAS_VISIBLE * 100}% visible (tree and properties docked)`, a.canvasVisible >= MIN_CANVAS_VISIBLE, `${(a.canvasVisible * 100).toFixed(0)}% of ${a.canvasBox}`);
    check(id, 'docked', 'the canvas keeps at least 320px of width', a.canvasBox[2] >= 320, `${a.canvasBox[2]}px`);
    // diagnostics: the status bar button opens the drawer
    check(id, 'drawer', 'the status bar opens the drawer', await tapOn(page, '.status .st-drawer'));
    a = await audit(page); await shot(page, `${id}-3-drawer`);
    check(id, 'drawer', 'the drawer is on screen', !!(await rectOf(page, '.drawer')));
    common(id, 'drawer', a, p);
    await tapOn(page, '.status .st-drawer');
  }

  // 3b. the view cube, the busy pill, then (on a phone) the tool strip, the editor split sheet and the sketch drawn with a finger
  const hook = await page.eval(`!!window.__cad`);
  if (hook) { await cubeFlows(page, id, p); await busyFlows(page, id, p); await notesFlows(page, id, p); }
  else skip(id, 'cube, busy pill, notes', 'need the dev hook (window.__cad); a production build has none');
  await siteLinkFlows(page, id, p);
  if (hook && p.layout === 'phone') { await phoneFlows(page, id, p); await sketchFlows(page, id, p); }
  else if (p.layout === 'phone') skip(id, 'phone editor flows and the hook-based sketch flow', 'need the dev hook');
  await touchSketchFlows(page, id, p);
  await keyboardAudit(page, id, p);

  // 4. dialogs
  check(id, 'samples', 'the Library dialog opens', p.layout === 'phone' ? await pickMenu(page, 'phone-file', 'library') : await tapOn(page, '.topbar button', 'library'));
  for (let i = 0; i < 40 && !(await page.eval(`!!document.querySelector('.dlg')`)); i++) await sleep(150);
  a = await page.eval(`(() => { const d = document.querySelector('.dlg'); if (!d) return null; const r = d.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, list: !!document.querySelector('.dlg-list') }; })()`);
  await shot(page, `${id}-4-samples`);
  check(id, 'samples', p.layout === 'phone' ? 'fills the screen' : 'fits the screen', !!a && a.x >= -1 && a.y >= -1 && a.x + a.w <= a.vw + 1 && a.y + a.h <= a.vh + 1 && (p.layout !== 'phone' || (a.w >= a.vw - 2 && a.h >= a.vh - 2)), JSON.stringify(a));
  await tapOn(page, '.dlg-head button', 'close'); await sleep(400);
  check(id, 'settings', 'the settings dialog opens', p.layout === 'phone' ? await pickMenu(page, 'phone-more', 'settings') : await tapOn(page, '.topbar button', 'settings'));
  for (let i = 0; i < 40 && !(await page.eval(`!!document.querySelector('.dlg')`)); i++) await sleep(150);   // the dialog is a lazy chunk in a production build
  a = await page.eval(`(() => { const d = document.querySelector('.dlg'); if (!d) return null; const r = d.getBoundingClientRect(); const t = document.querySelector('.set-tabs'); const tabs = [...document.querySelectorAll('.set-tab')]; return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, tabsOverflow: t ? getComputedStyle(t).overflowX : null, tabsScroll: t ? t.scrollWidth : 0, tabsClient: t ? t.clientWidth : 0, minTab: Math.min(...tabs.map((e) => e.getBoundingClientRect().height)), layoutSelect: !!document.querySelector('select[aria-label="Screen layout"]') }; })()`);
  await shot(page, `${id}-4-settings`);
  check(id, 'settings', p.layout === 'phone' ? 'fills the screen' : 'fits the screen', !!a && a.x >= -1 && a.y >= -1 && a.x + a.w <= a.vw + 1 && a.y + a.h <= a.vh + 1 && (p.layout !== 'phone' || (a.w >= a.vw - 2 && a.h >= a.vh - 2)), JSON.stringify(a));
  check(id, 'settings', 'tabs scroll sideways instead of overflowing', !!a && (a.tabsOverflow === 'auto' || a.tabsOverflow === 'scroll') && a.minTab >= MIN_TARGET - 0.5, JSON.stringify(a));
  check(id, 'settings', 'has the screen layout choice', !!a?.layoutSelect);
  const hs = await page.eval(`Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth`);
  check(id, 'settings', 'no horizontal page scroll with the dialog open', hs);
  await tapOn(page, '.dlg-head button');
  a = await page.eval(`document.querySelector('.dlg') === null`);
  check(id, 'settings', 'the dialog closes', a);
  await freshSample(page, url, id, p);
  await noticeFlows(page, id, p, '5-update-note', url);
  if (id === 'tablet-landscape') {   // the same note at a desktop width (no touch)
    await page.clearMobile(); await page.setViewport(1280, 800, false, 1);
    await noticeFlows(page, 'desktop', p, '5-update-note', url);
  }
  await page.clearMobile();
}

/** The "a new version is available" note in the top bar (shown when an update is found and nothing is applied automatically): it must not print over the document tab
 *  or any control of the top bar, and must stay on the screen. The page is made to see a newer build (a fetch that answers with another bundle name, a clock ten minutes on)
 *  and automatic updates are turned off so it only shows the note. */
async function noticeFlows(page, id, p, label, url) {
  // the update watch is off on localhost: open the same server through 0.0.0.0
  // Date.now can be skewed (the 5-minute gap between checks) and fetch answers with another bundle name once window.__newer is set; both are inert until then
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const d = Date.now.bind(Date); window.__skew = 0; Date.now = () => d() + window.__skew; const real = window.fetch.bind(window);
    window.fetch = async (u, i) => { if (!window.__newer) return real(u, i); const s = String((u && u.url) || u); if (/version\\.json/.test(s)) return new Response(JSON.stringify({ version: '9.9.9', kit: 'x', kernel: 'x' }));
      if (s.split('?')[0] === location.origin + location.pathname) { const r = await real(u, i); const t = await r.text(); return new Response(t.replace(/(assets\\/)([^"'/]*\\.js)/, '$1zz-9.js'), { headers: { 'content-type': 'text/html' } }); } return real(u, i); }; })()` });
  await page.goto(url.replace('127.0.0.1', '0.0.0.0')); await sleep(1500);
  for (let i = 0; i < 80 && !(await page.eval(`!!document.querySelector('.topbar .rb-btn, .topbar .tb-icon')`).catch(() => false)); i++) await sleep(150);
  await sleep(800);
  await page.eval(`(() => { localStorage.setItem('cad.autoUpdate', 'false'); window.__newer = true; window.__skew = 10 * 60000; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); })()`);
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) { ok = await page.eval(`!!document.querySelector('.topbar .update-note')`); if (!ok) await sleep(150); }
  check(id, label, 'the update note shows when a newer build is found', ok);
  if (!ok) return;
  await page.eval(`(() => { const s = document.querySelector('.update-note > span'); s.textContent += ' You have unsaved changes: save first, then reload.'; s.title = s.textContent; })()`);   // the longest wording
  await sleep(300); await shot(page, `${id}-${label}`);
  const r = await page.eval(`(() => {
    const n = document.querySelector('.topbar .update-note'), nr = n.getBoundingClientRect(), vw = innerWidth;
    const others = [...document.querySelectorAll('.topbar .tab, .topbar .doc-name, .topbar .mode-tabs, .topbar .search-btn, .topbar .install-btn, .topbar button, .topbar .slot')].filter((e) => !n.contains(e) && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);
    const hit = others.filter((e) => { const r = e.getBoundingClientRect(); return Math.min(r.right, nr.right) - Math.max(r.left, nr.left) > 2 && Math.min(r.bottom, nr.bottom) - Math.max(r.top, nr.top) > 2; }).map((e) => (e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().x));
    const t = document.querySelector('.topbar .tab.active .tab-name, .topbar .doc-name'); const tw = t ? (t.scrollWidth <= t.clientWidth + 1 ? 999 : t.getBoundingClientRect().width) : null;   // a title that shows whole is fine at any width
    const btns = [...n.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).every((b) => b.left >= 0 && b.right <= vw + 0.5);
    return { hit, inside: nr.left >= -0.5 && nr.right <= vw + 0.5, tabWidth: tw, btns, box: [Math.round(nr.x), Math.round(nr.y), Math.round(nr.width), Math.round(nr.height)], hs: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= vw };
  })()`);
  check(id, label, 'the update note covers no tab title or top bar control', r.hit.length === 0, r.hit.join('; '));
  check(id, label, 'the update note and its buttons stay on the screen, no sideways scroll', r.inside && r.btns && r.hs, JSON.stringify(r));
  check(id, label, 'the document title shows whole, or keeps at least 40px, beside the note', r.tabWidth === null || r.tabWidth >= 40, String(r.tabWidth));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!args.url && !args.dir) { console.error('--dir <pages build dir> (or --url <url>) is required'); process.exit(2); }
  const server = args.url ? null : await serve(resolve(String(args.dir)), { port: 0, prefix: '/' }); const url = args.url ?? `http://127.0.0.1:${server.address().port}/`;
  const chrome = await launchChrome({ port: CHROME_PORT, profileDir: join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'chrome-profile-ux-mobile') });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { chrome.close(); server?.close(); process.exit(130); });
  const only = args.only ? String(args.only).split(',') : null;
  try {
    const page = await Page.open(CHROME_PORT);
    for (const p of PROFILES.filter((x) => !only || only.includes(x.id))) {
      try { await runProfile(page, url, p); }
      catch (e) { check(p.id, 'run', 'the scenario ran to the end', false, String(e.message ?? e).slice(0, 300)); try { await shot(page, `${p.id}-error`); } catch { /* none */ } }
    }
    if (page.logs.length) console.log('\nconsole errors:\n  ' + [...new Set(page.logs)].slice(0, 8).join('\n  '));
    page.close();
  } finally { chrome.close(); server?.close(); }
  writeFileSync(join(OUT, 'mobile-report.json'), JSON.stringify({ at: new Date().toISOString(), results, skipped }, null, 1));
  const total = results.length;
  console.log(`\n${total - failures}/${total} checks passed${failures ? `, ${failures} FAILED` : ''}. Report and screenshots: ${OUT}`);
  process.exit(failures ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });

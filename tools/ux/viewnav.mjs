#!/usr/bin/env node
// Desktop check of the view cube and its arrow ring, with a mouse: the buttons are there and reachable, a click turns the view by the expected
// angle and selects nothing, the region under the pointer lights up, and the selection readout and the "Resize about" panel do not overlap
// (also in a narrow window). tools/ux/mobile.mjs does the same with touch on a phone and a tablet.
//   node tools/ux/viewnav.mjs [--out <dir>] [--sample mounting-plate]
// CK_REBUILD, CHROME_BIN and UX_CHROME_ARGS as for mobile.mjs. Exits 1 when a check fails.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, Page } from './cdp.mjs';
import { diffPng } from './png.mjs';
import { startVite } from './vite.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = (() => { const o = {}; const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; } return o; })();
const OUT = resolve(args.out ?? join(ROOT, 'ux-viewnav'));
const SAMPLE = String(args.sample ?? 'mounting-plate');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (id, name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} / ${name}${detail && !ok ? '  ' + detail : ''}`); };
const angle = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;
const POSE = `(() => { const v = window.__cad.viewport; const c = v.camera, t = v.controls.target; const d = c.position.clone().sub(t).normalize(); return JSON.stringify({ d: [d.x, d.y, d.z], u: [c.up.x, c.up.y, c.up.z] }); })()`;
const pose = async (page) => JSON.parse(await page.eval(POSE));
const rectOf = (page, sel, text = '') => page.eval(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getBoundingClientRect().width > 0 && (${JSON.stringify(text.toLowerCase())} === '' || ((x.getAttribute('aria-label') || '') + ' ' + x.textContent).toLowerCase().includes(${JSON.stringify(text.toLowerCase())}))); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
const selection = (page) => page.eval(`document.querySelectorAll('.sel-chip').length`);

async function open(page, url) {
  const d = JSON.parse(readFileSync(join(ROOT, 'apps/cad/public/samples', SAMPLE + '.ckpart'), 'utf8'));
  await page.goto(url);
  await page.eval(`localStorage.clear(); localStorage.setItem('cad.theme', '"light"'); localStorage.setItem('cad.autosave.v1', ${JSON.stringify(JSON.stringify({ name: d.name ?? SAMPLE, doc: d, savedAt: Date.now() }))}); 0`);
  await page.send('Page.reload'); await sleep(1500);
  for (let i = 0; i < 60; i++) { const r = await rectOf(page, 'button', 'Restore'); if (r) { await page.click(r.x, r.y); break; } await sleep(200); }
  for (let i = 0; i < 200 && !(await page.eval(`!!document.querySelector('.status .ready')`)); i++) await sleep(300);
  await sleep(800);
}

async function run(page, url, w, h) {
  const id = `${w}x${h}`;
  console.log(`\n== ${id}`);
  await page.setViewport(w, h, false);
  await open(page, url);
  const names = ['Turn view up', 'Turn view down', 'Turn view left', 'Turn view right', 'Roll view clockwise', 'Roll view counter-clockwise', 'Home view', 'View navigation options'];
  const rects = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await rectOf(page, '.vn-btn', n)])));
  check(id, 'the arrows, rolls, home and menu buttons are there', names.every((n) => rects[n]));
  if (!names.every((n) => rects[n])) return;
  check(id, 'the buttons are at least 28 px', names.every((n) => rects[n].w >= 28 && rects[n].h >= 28), names.map((n) => `${rects[n].w}`).join(','));
  const cube = await rectOf(page, '#vp .viewcube');
  const cx = cube.x, cy = cube.y;
  // hover: the region under the pointer lights up
  await page.mouse('mouseMoved', 20, 400); await sleep(300);
  const calm = await page.screenshot();
  await page.mouse('mouseMoved', cx, cy); await sleep(300);
  const hover = await page.screenshot();
  writeFileSync(join(OUT, `${id}-cube-hover.png`), hover);
  check(id, 'hovering the cube lights the region under the pointer', diffPng(calm, hover).pct > 0.005, `diff ${diffPng(calm, hover).pct}%`);
  // the ring's buttons turn the view by a step and select nothing
  await page.eval(`window.__cad.viewport.setViewDir([0, 0, 1])`); await sleep(300);
  for (const [n, what] of [['Turn view left', 90], ['Turn view right', 90], ['Turn view up', 90], ['Turn view down', 90]]) {
    const b = await pose(page); const r = rects[n];
    await page.click(r.x, r.y); await sleep(500);
    const a = await pose(page);
    check(id, `${n}: a click turns the view by ${what} degrees`, Math.abs(angle(b.d, a.d) - what) < 1.5, `${angle(b.d, a.d).toFixed(1)}`);
  }
  { const b = await pose(page); await page.click(rects['Roll view clockwise'].x, rects['Roll view clockwise'].y); await sleep(500); const a = await pose(page);
    check(id, 'Roll view clockwise: the view direction stays and the up vector turns by 90 degrees', angle(b.d, a.d) < 1 && Math.abs(angle(b.u, a.u) - 90) < 1.5, `${angle(b.d, a.d).toFixed(1)} ${angle(b.u, a.u).toFixed(1)}`); }
  await page.click(rects['Roll view counter-clockwise'].x, rects['Roll view counter-clockwise'].y); await sleep(500);
  check(id, 'clicking the ring selects nothing', (await selection(page)) === 0);
  await page.click(rects['Home view'].x, rects['Home view'].y); await sleep(500);
  const home = await pose(page);
  check(id, 'Home goes to the isometric view', angle(home.d, [1, 0.8, 1].map((v) => v / Math.hypot(1, 0.8, 1))) < 2, home.d.map((v) => v.toFixed(2)).join(','));
  // the menu's step size applies to the next click
  await page.click(rects['View navigation options'].x, rects['View navigation options'].y); await sleep(300);
  const r45 = await rectOf(page, '.vn-menu [role=menuitemradio]', '45');
  check(id, 'the menu lists the step sizes', !!r45);
  if (r45) {
    await page.click(r45.x, r45.y); await sleep(300);
    await page.eval(`window.__cad.viewport.setViewDir([0, 0, 1])`); await sleep(300);
    const b = await pose(page);
    await page.click(rects['Turn view left'].x, rects['Turn view left'].y); await sleep(600);
    const a = await pose(page);
    check(id, 'a 45 degree step turns the view by 45 degrees', Math.abs(angle(b.d, a.d) - 45) < 1.5, `${angle(b.d, a.d).toFixed(1)}`);
    const r90 = await rectOf(page, '.vn-menu [role=menuitemradio]', '90');
    if (r90) await page.click(r90.x, r90.y);
    await page.click(rects['View navigation options'].x, rects['View navigation options'].y); await sleep(300);
  }
  // nothing in the top right corner overlaps
  const o = await page.eval(`(() => { const sels = ['.display-btn', '.cube-tools button', '.vn-btn']; const els = sels.flatMap((s) => [...document.querySelectorAll('#vp ' + s)]).map((e) => ({ n: e.className + ' ' + (e.getAttribute('aria-label') || ''), r: e.getBoundingClientRect() })).filter((x) => x.r.width > 0);
    const bad = []; for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i].r, b = els[j].r; const ow = Math.min(a.right, b.right) - Math.max(a.left, b.left), oh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ow > 1 && oh > 1) bad.push(els[i].n + ' x ' + els[j].n); } return bad; })()`);
  check(id, 'the display button, the ring and the fit and projection buttons do not overlap', o.length === 0, o.join('; '));
  // the menu's groups: switching Roll off removes both roll arrows and nothing else, and it comes back
  const countOf = (sel) => page.eval(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  check(id, 'the desktop starts with every group (4 arrows, 2 rolls, home)', (await countOf('.vn-turn')) === 4 && (await countOf('.vn-roll')) === 2 && (await countOf('.vn-home')) === 1);
  const toggleRoll = async () => { const m = await rectOf(page, '.vn-menu [role=menuitemcheckbox]', 'Roll'); if (m) { await page.click(m.x, m.y); await sleep(300); } return !!m; };
  const opened = await rectOf(page, '.vn-menu');
  if (!opened) { await page.click(rects['View navigation options'].x, rects['View navigation options'].y); await sleep(300); }
  check(id, 'the menu lists Roll as a checkbox', await toggleRoll());
  check(id, 'Roll off removes the roll arrows only', (await countOf('.vn-roll')) === 0 && (await countOf('.vn-turn')) === 4 && (await countOf('.vn-home')) === 1);
  await toggleRoll();
  check(id, 'Roll on brings them back', (await countOf('.vn-roll')) === 2);
  await page.click(rects['View navigation options'].x, rects['View navigation options'].y); await sleep(300);
  await page.eval(`window.__cad.viewport.fit()`); await sleep(500);
  writeFileSync(join(OUT, `${id}-ring.png`), await page.screenshot());
  // the readout card and the Resize about panel: a feature selected, then a face
  const row = await rectOf(page, '.tree .row', 'Extrude');
  if (row) await page.click(row.x, row.y);
  await sleep(500);
  const cv = await rectOf(page, '#vp canvas');
  let card = null;
  for (const [dx, dy] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30], [60, 20], [-60, 20]]) {
    await page.click(cv.x + dx, cv.y + dy); await sleep(600);
    card = await rectOf(page, '#vp .quick-measure'); if (card) break;
  }
  const panel = await rectOf(page, '#vp .sizebox-about');
  writeFileSync(join(OUT, `${id}-notes.png`), await page.screenshot());
  check(id, 'the readout card and the Resize about panel both show', !!card && !!panel, JSON.stringify({ card: !!card, panel: !!panel }));
  if (card && panel) {
    const ow = Math.min(card.r, panel.r) - Math.max(card.l, panel.l), oh = Math.min(card.b, panel.b) - Math.max(card.t, panel.t);
    check(id, 'the card and the panel do not overlap', !(ow > 1 && oh > 1), JSON.stringify({ card, panel }));
    const ring = await rectOf(page, '.viewnav');
    for (const [n, r] of [['card', card], ['panel', panel]]) {
      const w = Math.min(r.r, ring.r) - Math.max(r.l, ring.l), hh = Math.min(r.b, ring.b) - Math.max(r.t, ring.t);
      check(id, `the ${n} does not cover the arrow ring`, !(w > 1 && hh > 1));
    }
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const scratch = fileURLToPath(new URL('../../../scratch-uxreview', import.meta.url));
  const vite = await startVite(ROOT, scratch);
  const chrome = await launchChrome({ port: 9700 + Math.floor(Math.random() * 99) });
  try {
    const page = await Page.open(chrome.port);
    for (const [w, h] of [[1440, 900], [900, 700]]) await run(page, vite.url, w, h);
    page.close();
  } finally { chrome.close(); vite.stop(); }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });

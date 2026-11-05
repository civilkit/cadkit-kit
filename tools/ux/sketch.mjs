#!/usr/bin/env node
// End-to-end sketch scenarios in a desktop browser (1440x900, mouse and keys, the classic layout). Each one starts from a fresh page, drives the
// app as a user does (command search, sketch tool keys, clicks on the canvas, the tree, the feature editor) and checks the model the kernel built.
//   a  draw a rectangle and a circle in a new sketch, finish it, extrude it: the volume is the rectangle less the circle times the depth
//   b  delete that extrude and sketch, start a new sketch: no constraints, dimensions or drawing of the old one are left
//   c  a ring circle with six petals touching it (synthetic part): the Extrude editor lists each petal under Shapes and ticks the
//      kernel's default (the outer circle and the hole's disc: even-odd nesting), one petal ticked extrudes that petal only, every
//      box but the hole extrudes the full disc less the hole, and every box ticked fills the hole too (the whole disc)
//   node tools/ux/sketch.mjs [--only a,b,c] [--out <dir>] [--url <url>]
// Without --url it starts the vite dev server of this checkout. CK_REBUILD, CHROME_BIN and UX_CHROME_ARGS as for mobile.mjs.
// Prints one line per check (a failure with a short reason), the time of each scenario, and exits 1 when a check fails.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchChrome, Page } from './cdp.mjs';
import { decodePng } from './png.mjs';
import { startVite } from './vite.mjs';
import { openDoc, idle } from './app.mjs';
import { WS } from './scenarios.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRATCH = fileURLToPath(new URL('../../../scratch-uxreview', import.meta.url));
const args = (() => { const o = {}; const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); o[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; } return o; })();
const OUT = resolve(args.out ?? join(existsSync(SCRATCH) ? SCRATCH : ROOT, 'ux-sketch'));
const CHROME_PORT = +(args['chrome-port'] ?? 9700 + Math.floor(Math.random() * 99));
const W = 1440, H = 900;
/** A scenario that runs longer than this fails (the brief: each under a minute). */
const LIMIT_MS = 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const results = [];
function check(sc, name, ok, detail = '') {
  results.push({ sc, name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${sc} / ${name}${!ok && detail ? '  -- ' + detail : ''}`);
  return !!ok;
}
/** Stop the scenario with a reason (the later checks would only fail for the same cause). */
class Stop extends Error {}
const must = (sc, name, ok, detail) => { if (!check(sc, name, ok, detail)) throw new Stop(name); };

// ---- page helpers --------------------------------------------------------------------------------------------------------------------------
const js = (v) => JSON.stringify(v);
/** Centre of the first visible element matching `sel` (and holding `text`, when given), or null. */
const rectOf = (page, sel, text = '') => page.eval(`(() => { const want = ${js(text.toLowerCase())}; const e = [...document.querySelectorAll(${js(sel)})].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!want || ((x.getAttribute('aria-label') || '') + ' ' + x.textContent).toLowerCase().includes(want)); }); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
async function clickOn(page, sel, text = '', { dbl = false } = {}) {
  const r = await rectOf(page, sel, text);
  if (!r) return false;
  await page.mouse('mouseMoved', r.x, r.y);
  await page.mouse('mousePressed', r.x, r.y); await page.mouse('mouseReleased', r.x, r.y);
  if (dbl) await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 2 }).then(() => page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 2 }));
  await sleep(250); return true;
}
const waitFor = async (page, expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.eval(expr).catch(() => false)) return true; await sleep(150); } return false; };
const doc = (page) => page.eval(`(() => { const d = window.__cad.controller.document(); return d ? JSON.parse(JSON.stringify(d)) : null; })()`);
const draft = (page) => page.eval(`(() => { const d = window.__cad.controller.sketchDraft(); return d ? JSON.parse(JSON.stringify(d)) : null; })()`);
const volume = async (page) => { await idle(page); return page.eval(`window.__cad.controller.massProps().then((m) => m?.volume ?? null)`); };
const shot = async (page, name) => { try { writeFileSync(join(OUT, name + '.png'), await page.screenshot()); } catch { /* none */ } };
/** The model's error and warning notices, for a failure's reason. */
const notices = (page) => page.eval(`[...document.querySelectorAll('.toast, .fedit-hint, [role=alert]')].map((e) => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 200)`).catch(() => '');
/** Nothing focused, so the app's keys (F, the sketch tool letters, Delete) reach it. */
const blur = (page) => page.eval(`document.activeElement?.blur?.(); 0`);
/** Type into the focused field the way a keyboard does. */
const type = (page, text) => page.send('Input.insertText', { text });

/** Run a command by its name through the command search (F): the highlighted row must be that command. */
async function command(page, label) {
  await blur(page); await page.key('f');
  if (!(await waitFor(page, `!!document.querySelector('.pal input')`, 3000))) return `the command search did not open`;
  await type(page, label); await sleep(250);
  const hi = await page.eval(`document.querySelector('.pal .it.on')?.textContent.trim() ?? ''`);
  if (!hi.toLowerCase().startsWith(label.toLowerCase())) { await page.key('Escape'); return `the command search offers "${hi}" for "${label}"`; }
  await page.key('Enter'); await sleep(400);
  return null;
}

/** Screen point (CSS px, page coordinates) of a sketch point in mm; sketchToScreen gives canvas coordinates. */
const S = (page, x, y) => page.eval(`(() => { const p = window.__cad.viewport.sketchToScreen(${x}, ${y}); const r = document.querySelector('#vp canvas').getBoundingClientRect(); if (!p) return null; const q = { x: r.left + p.x, y: r.top + p.y }; return { ...q, inside: q.x > r.left && q.x < r.right && q.y > r.top && q.y < r.bottom }; })()`);
async function clickAt(page, x, y) {
  const p = await S(page, x, y);
  if (!p) throw new Error('the viewport has no sketch frame');
  await page.mouse('mouseMoved', p.x + 3, p.y + 3); await sleep(60);
  await page.mouse('mouseMoved', p.x, p.y); await sleep(120);
  await page.mouse('mousePressed', p.x, p.y); await page.mouse('mouseReleased', p.x, p.y); await sleep(250);
  return p;
}
async function newSketchTop(page, sc) {
  const err = await command(page, 'New sketch: top plane');
  must(sc, 'a new sketch on the top plane starts (command search)', !err && await waitFor(page, `!!window.__cad.controller.sketchDraft() && !!window.__cad.viewport.sketchToScreen(0, 0)`), err ?? await notices(page));
  await sleep(600);
}
/** Zoom out with the mouse wheel until the square of half-size `ext` (mm) round the sketch origin is on the canvas, with a margin. */
async function showExtent(page, sc, ext) {
  const box = await page.eval(`(() => { const r = document.querySelector('#vp canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  let a, b;
  for (let i = 0; i < 25; i++) {
    a = await S(page, -ext * 1.3, -ext * 1.3); b = await S(page, ext * 1.3, ext * 1.3);
    if (a?.inside && b?.inside) return;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 240 }); await sleep(200);
  }
  must(sc, `the wheel zooms out to show +-${ext} mm`, false, `corners at ${js(a)} and ${js(b)}`);
}
async function finishSketch(page, sc) {
  must(sc, 'the sketch is finished with the OK button', await clickOn(page, '[data-action="sketch-ok"]'), 'no sketch OK button');
  must(sc, 'the sketch closes', await waitFor(page, `!window.__cad.controller.sketchDraft()`), await notices(page));
  await idle(page);
}
/** Set a number field of the open feature editor. */
async function setField(page, path, value) {
  const ok = await page.eval(`(() => { const i = document.querySelector('.fedit-fld[data-path="${path}"] input'); if (!i) return false; i.focus(); i.select(); return true; })()`);
  if (!ok) return false;
  await type(page, String(value)); await page.key('Tab'); await sleep(300); return true;
}
async function confirmEditor(page, sc) {
  must(sc, 'the editor is confirmed with OK', await clickOn(page, '[data-testid="feature-ok"]'), 'no OK button in the feature editor');
  must(sc, 'the editor closes', await waitFor(page, `!document.querySelector('[data-testid="feature-ok"]')`, 20000), await notices(page));
  await idle(page);
}
/** The screen box (CSS px) round the old rectangle and circle of scenario a, with a margin. */
const oldArea = async (page) => { const a = await S(page, RECT.x0 - 5, RECT.y0 - 5), b = await S(page, RECT.x1 + 5, RECT.y1 + 5); return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) }; };
/** Share (%) of the pixels in `box` whose colour differs by more than 24 in a channel between two screenshots of the same size. */
function changedPct(aBuf, bBuf, box) {
  const a = decodePng(aBuf), b = decodePng(bBuf), k = a.w / W;
  let n = 0, all = 0;
  for (let y = Math.round(box.y0 * k); y < Math.round(box.y1 * k); y++) for (let x = Math.round(box.x0 * k); x < Math.round(box.x1 * k); x++) {
    const o = (y * a.w + x) * 4; all++;
    if (Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2])) > 24) n++;
  }
  return all ? (100 * n) / all : 100;
}
const near = (got, want, rel = 0.002) => typeof got === 'number' && Math.abs(got - want) <= rel * Math.abs(want);

// ---- the scenarios ------------------------------------------------------------------------------------------------------------------------
const CLASSIC = { 'cad.workspace': js(WS.classic) };
const RECT = { x0: -30, y0: -20, x1: 30, y1: 20 }, CIRCLE = { x: 0, y: 0, r: 10 }, DEPTH = 10;

/** Scenario a's drawing: a rectangle (two clicks), a circle (a click and a typed radius), finished; then Extrude with a typed depth. */
async function drawAndExtrude(page, sc, { fresh = true } = {}) {
  if (fresh) await openDoc(page, null, CLASSIC);
  await newSketchTop(page, sc);
  await showExtent(page, sc, 30);
  await blur(page); await page.key('r'); await sleep(200);
  await clickAt(page, RECT.x0, RECT.y0); await clickAt(page, RECT.x1, RECT.y1); await sleep(400);
  let d = await draft(page);
  must(sc, 'the rectangle tool (R) draws four lines with two clicks', d && d.entities.filter((e) => e.type === 'line').length === 4, `entities ${JSON.stringify(d?.entities.map((e) => e.type))}`);
  await blur(page); await page.key('c'); await sleep(200);
  await clickAt(page, CIRCLE.x, CIRCLE.y);
  // the radius is typed: the field under the drawing takes it and Enter places the circle with that radius dimension
  const typed = await waitFor(page, `!!document.querySelector('#vp .sketch-fields input')`, 3000);
  if (typed) { await page.eval(`(() => { const i = document.querySelector('#vp .sketch-fields input'); i.focus(); i.select(); })()`); await type(page, String(CIRCLE.r)); await page.key('Enter'); }
  else await clickAt(page, CIRCLE.x + CIRCLE.r, CIRCLE.y);
  await sleep(600);
  d = await draft(page);
  const circle = d?.entities.find((e) => e.type === 'circle');
  must(sc, `the circle tool (C) draws a circle of radius ${CIRCLE.r}`, circle && Math.abs(circle.r - CIRCLE.r) < 1e-6, `circle ${JSON.stringify(circle)}, radius field ${typed ? 'used' : 'missing'}`);
  await page.mouse('mouseMoved', 5, H - 5); await sleep(300);
  const drawn = await page.screenshot();
  writeFileSync(join(OUT, `${sc}-sketch.png`), drawn);
  await finishSketch(page, sc);
  const err = await command(page, 'Extrude');
  must(sc, 'Extrude opens its editor (command search)', !err && await waitFor(page, `!!document.querySelector('.fedit-fld[data-path="depth"] input')`), err ?? await notices(page));
  must(sc, `the depth is typed (${DEPTH})`, await setField(page, 'depth', DEPTH));
  await confirmEditor(page, sc);
  return { d, drawn };
}

const SCENARIOS = {
  async a(page) {
    const sc = 'a';
    const { d } = await drawAndExtrude(page, sc);
    const f = await doc(page);
    const types = f.features.map((x) => x.type);
    check(sc, 'the part holds the sketch and the extrude', types.join(',') === 'sketch,extrude', types.join(','));
    const xs = d.points.filter((p) => d.entities.some((e) => e.type === 'line' && (e.p1 === p.id || e.p2 === p.id)));
    const bb = [Math.min(...xs.map((p) => p.x)), Math.min(...xs.map((p) => p.y)), Math.max(...xs.map((p) => p.x)), Math.max(...xs.map((p) => p.y))];
    const w = bb[2] - bb[0], h = bb[3] - bb[1];
    check(sc, `the rectangle is where it was clicked (${RECT.x0},${RECT.y0} to ${RECT.x1},${RECT.y1})`, [RECT.x0, RECT.y0, RECT.x1, RECT.y1].every((v, i) => Math.abs(bb[i] - v) < 0.5), bb.map((v) => v.toFixed(2)).join(','));
    const want = (w * h - Math.PI * CIRCLE.r ** 2) * DEPTH;
    const v = await volume(page);
    await shot(page, `${sc}-extruded`);
    check(sc, `the volume is the rectangle less the circle times ${DEPTH} (${want.toFixed(1)} mm3)`, near(v, want), `volume ${v}; ${await notices(page)}`);
  },

  async b(page) {
    const sc = 'b';
    // the picture of a new sketch on an empty part, at the zoom the drawing uses, to compare the one after the deletes with
    await openDoc(page, null, CLASSIC);
    await newSketchTop(page, sc);
    await showExtent(page, sc, 30);
    const cleanBox = await oldArea(page), cleanCam = await page.eval(`window.__cad.viewport.cameraState()`);
    await page.mouse('mouseMoved', 5, H - 5); await sleep(400);
    const clean = await page.screenshot();
    await clickOn(page, '[data-action="sketch-cancel"]'); await waitFor(page, `!window.__cad.controller.sketchDraft()`);
    const { d: old, drawn } = await drawAndExtrude(page, sc, { fresh: false });
    check(sc, 'the old sketch had constraints', old.constraints.length > 0, `constraints ${old.constraints.map((c) => c.type).join(',')}`);
    // the picture check below sees a drawing: the sketch as drawn differs from the empty one in that area
    const seen = changedPct(clean, drawn, cleanBox);
    check(sc, 'the leftover check sees the drawn sketch (control)', seen >= 0.3, `${seen.toFixed(2)}%`);
    // delete the extrude, then the sketch: select the row in the tree, press Delete
    for (const type of ['extrude', 'sketch']) {
      const id = (await doc(page)).features.find((x) => x.type === type)?.id;
      must(sc, `the ${type} row is selected in the tree`, id && await clickOn(page, `.tree .row[data-id="${id}"]`), `no ${type} row`);
      await page.key('Delete'); await sleep(300);
      // a confirmation, when the app asks
      for (const label of ['Delete', 'OK', 'Yes']) if (await clickOn(page, '.dlg button, [role=dialog] button', label)) break;
      must(sc, `Delete removes the ${type}`, await waitFor(page, `!window.__cad.controller.document().features.some((f) => f.id === ${js(id)})`, 10000), await notices(page));
      await idle(page);
    }
    check(sc, 'the part has no features left', (await doc(page)).features.length === 0, js((await doc(page)).features.map((f) => f.type)));
    await newSketchTop(page, sc);
    const d = await draft(page);
    check(sc, 'the new sketch has no entities', d.entities.length === 0, `${d.entities.length} entities`);
    check(sc, 'the new sketch has no constraints or dimensions', d.constraints.length === 0, d.constraints.map((c) => c.type).join(','));
    const annots = await page.eval(`document.querySelectorAll('#vp .sketch-annots .annot, #vp .sketch-annots .dimg, #vp .sketch-fields').length`);
    check(sc, 'no dimension or constraint labels are drawn', annots === 0, `${annots} labels`);
    const overlay = await page.eval(`(() => { const v = window.__cad.viewport.sketchEdit; return v ? (v.entities?.length ?? v.polylines?.length ?? 0) : -1; })()`);
    check(sc, 'the viewport draws no curves of the old sketch', overlay <= 0, `${overlay} curves in the sketch overlay`);
    // where the old rectangle and circle were, the canvas is drawn as in a new sketch on an empty part (seen from the same camera)
    await page.eval(`window.__cad.viewport.setCameraState(${js(cleanCam)})`); await sleep(500);
    const box = await oldArea(page);
    await page.mouse('mouseMoved', 5, H - 5); await sleep(400);
    const now = await page.screenshot();
    await shot(page, `${sc}-new-sketch`);
    const same = Math.abs(box.x0 - cleanBox.x0) < 1 && Math.abs(box.x1 - cleanBox.x1) < 1 && Math.abs(box.y0 - cleanBox.y0) < 1;
    const pct = same ? changedPct(clean, now, box) : 100;
    check(sc, 'nothing of the old sketch is drawn where it was', pct < 0.3, same ? `${pct.toFixed(2)}% of the pixels there differ from a new sketch on an empty part (${sc}-clean.png, ${sc}-new-sketch.png in ${OUT})` : `the view is not at the same place and zoom as the empty one: ${js(box)} vs ${js(cleanBox)}`);
    if (pct >= 0.3) writeFileSync(join(OUT, `${sc}-clean.png`), clean);
  },

  async c(page) {
    const sc = 'c';
    const depth = 5;
    await openDoc(page, null, CLASSIC);
    const base = await doc(page);
    const sketch = { id: 'F1', type: 'sketch', name: 'Flower', plane: { kind: 'std', id: 'top' }, ...ringPetals(), constraints: [] };
    await openDoc(page, { ...base, name: 'Ring petals', features: [sketch], seq: Math.max(base.seq ?? 1, 2) }, CLASSIC);
    must(sc, 'the synthetic part opens with its sketch', (await doc(page)).features.some((f) => f.id === 'F1'));
    must(sc, 'the sketch row is selected in the tree', await clickOn(page, '.tree .row[data-id="F1"]'), 'no sketch row');
    const err = await command(page, 'Extrude');
    must(sc, 'Extrude opens its editor', !err && await waitFor(page, `!!document.querySelector('.fedit-fld[data-path="depth"] input')`), err ?? await notices(page));
    await setField(page, 'depth', depth);
    const listed = await page.eval(`[...document.querySelectorAll('.fedit-shape[data-shape]')].map((e) => ({ id: e.dataset.shape, label: e.textContent.trim(), on: e.querySelector('input').checked }))`);
    await shot(page, `${sc}-shapes`);
    // a petal's shape is named by a curve of its own: one of its two sides or its round end
    const petalOf = (id) => { const m = /^(?:s(\d)[ab]|e(\d))$/.exec(id); return m ? +(m[1] ?? m[2]) : -1; };
    const petals = Array.from({ length: 6 }, (_, i) => listed.find((s) => petalOf(s.id) === i));
    must(sc, 'each of the six petals is listed under Shapes', petals.every(Boolean), `Shapes: ${listed.map((s) => s.id).join(', ') || 'none'}`);
    // with no regions the boxes show what the kernel builds by default: even-odd nesting, so the ring and the petals are holes of the outer circle, and the hole's disc an island
    const byDefault = listed.filter((s) => s.on).map((s) => s.id).sort();
    check(sc, 'by default the outer circle and the hole are ticked (the kernel default: even-odd nesting)', byDefault.join(',') === 'hole,outer', `ticked: ${byDefault.join(', ')}`);
    // tick one petal only: switch every other ticked shape off (tick the petal first: the last ticked box cannot be switched off)
    if (!petals[0].on) await clickOn(page, `.fedit-shape[data-shape="${petals[0].id}"] input`);
    for (const s of listed) if (s.id !== petals[0].id && s.on) await clickOn(page, `.fedit-shape[data-shape="${s.id}"] input`);
    const on = await page.eval(`[...document.querySelectorAll('.fedit-shape[data-shape] input:checked')].map((e) => e.closest('.fedit-shape').dataset.shape)`);
    must(sc, 'only the first petal is ticked', on.length === 1 && on[0] === petals[0].id, `ticked: ${on.join(', ')}`);
    await confirmEditor(page, sc);
    const one = await volume(page);
    await shot(page, `${sc}-one-petal`);
    check(sc, `one petal ticked: the volume is that petal times ${depth} (${(PETAL_AREA * depth).toFixed(1)} mm3)`, near(one, PETAL_AREA * depth), `volume ${one?.toFixed(1)} (an area of ${(one / depth).toFixed(1)} mm2; a petal is ${PETAL_AREA.toFixed(1)}, the ring's disc ${(Math.PI * RING_R ** 2).toFixed(1)})`);
    // edit it again and tick every box but the hole, then the hole too
    const areas = `the disc less the hole is ${(Math.PI * (OUTER_R ** 2 - HOLE_R ** 2)).toFixed(1)}, the whole disc ${(Math.PI * OUTER_R ** 2).toFixed(1)}, the disc outside the ring and petals plus the hole ${(Math.PI * (OUTER_R ** 2 - RING_R ** 2 + HOLE_R ** 2) - 6 * PETAL_AREA).toFixed(1)}`;
    const tickAll = async (except, what) => {
      const ext = (await doc(page)).features.find((f) => f.type === 'extrude');
      must(sc, `the extrude opens again for editing (${what})`, ext && await clickOn(page, `.tree .row[data-id="${ext.id}"]`, '', { dbl: true }) && await waitFor(page, `!!document.querySelector('.fedit-shape')`), 'no editor');
      const flip = await page.eval(`[...document.querySelectorAll('.fedit-shape[data-shape]')].filter((e) => e.querySelector('input').checked === (e.dataset.shape === ${js(except)})).map((e) => e.dataset.shape)`);
      // tick first, then untick, so the last ticked box is never the one switched off
      for (const id of [...flip.filter((x) => x !== except), ...flip.filter((x) => x === except)]) await clickOn(page, `.fedit-shape[data-shape="${id}"] input`);
      const ok = await page.eval(`[...document.querySelectorAll('.fedit-shape[data-shape]')].every((e) => e.querySelector('input').checked === (e.dataset.shape !== ${js(except)}))`);
      must(sc, `${what} is ticked`, ok);
      await confirmEditor(page, sc);
      return volume(page);
    };
    const rest = await tickAll('hole', 'every shape but the hole');
    await shot(page, `${sc}-all-but-hole`);
    const disc = Math.PI * (OUTER_R ** 2 - HOLE_R ** 2) * depth;
    check(sc, `every box but the hole: the volume is the full disc less the hole (${disc.toFixed(1)} mm3)`, near(rest, disc), `volume ${rest?.toFixed(1)} (an area of ${(rest / depth).toFixed(1)} mm2; ${areas})`);
    const full = await tickAll(null, 'every shape');
    await shot(page, `${sc}-all`);
    const whole = Math.PI * OUTER_R ** 2 * depth;
    check(sc, `every box ticked: the hole is filled, the volume is the whole disc (${whole.toFixed(1)} mm3)`, near(full, whole), `volume ${full?.toFixed(1)} (an area of ${(full / depth).toFixed(1)} mm2; ${areas})`);
  },
};

// ---- the synthetic ring of petals (the same layout as packages/sketch/src/tools/petals-fixture.ts ringPetals) ---------------------------
const RING_R = 20, HALF_W = 4, REACH = 30, OUTER_R = 40, HOLE_R = 4;
/** Six stadium-shaped petals whose open outlines (two sides and a round end) start and end on a ring circle (T-junctions, no shared points),
 *  a hole in the middle and an outer circle. */
function ringPetals(n = 6) {
  const points = [{ id: 'O', x: 0, y: 0 }], entities = [];
  let k = 0;
  const pt = (x, y) => { const id = 'p' + ++k; points.push({ id, x, y }); return id; };
  const baseX = Math.sqrt(RING_R ** 2 - HALF_W ** 2);
  for (let i = 0; i < n; i++) {
    const th = (i * 2 * Math.PI) / n, cs = Math.cos(th), sn = Math.sin(th);
    const at = (x, y) => pt(x * cs - y * sn, x * sn + y * cs);
    const b1 = at(baseX, -HALF_W), b2 = at(baseX, HALF_W), t1 = at(REACH, -HALF_W), t2 = at(REACH, HALF_W), c = at(REACH, 0);
    entities.push({ id: `s${i}a`, type: 'line', p1: b1, p2: t1 }, { id: `e${i}`, type: 'arc', c, p1: t1, p2: t2 }, { id: `s${i}b`, type: 'line', p1: t2, p2: b2 });
  }
  entities.push({ id: 'ring', type: 'circle', c: 'O', r: RING_R }, { id: 'hole', type: 'circle', c: 'O', r: HOLE_R }, { id: 'outer', type: 'circle', c: 'O', r: OUTER_R });
  return { points, entities };
}
/** One petal: the stadium from the ring out (a rectangle and a half disc) less the sliver of the ring's disc inside the rectangle. */
const PETAL_AREA = (() => {
  const baseX = Math.sqrt(RING_R ** 2 - HALF_W ** 2);
  const sliver = RING_R ** 2 * Math.acos(baseX / RING_R) - baseX * HALF_W;
  return (REACH - baseX) * 2 * HALF_W + (Math.PI * HALF_W ** 2) / 2 - sliver;
})();

async function main() {
  mkdirSync(OUT, { recursive: true });
  const vite = args.url ? null : await startVite(ROOT, SCRATCH); const url = args.url ?? vite.url;
  const chrome = await launchChrome({ port: CHROME_PORT, width: W, height: H });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { chrome.close(); vite?.stop(); process.exit(130); });
  const only = args.only ? String(args.only).split(',') : Object.keys(SCENARIOS);
  const times = {};
  try {
    for (const id of only) {
      if (!SCENARIOS[id]) { check(id, 'is a scenario', false, `known: ${Object.keys(SCENARIOS).join(', ')}`); continue; }
      console.log(`\n== ${id}`);
      const page = await Page.open(CHROME_PORT);
      const t0 = Date.now();
      try {
        await page.setViewport(W, H, false);
        await page.goto(url);
        await SCENARIOS[id](page);
      } catch (e) {
        if (!(e instanceof Stop)) check(id, 'the scenario ran to the end', false, String(e.message ?? e).split('\n')[0].slice(0, 300));
        await shot(page, `${id}-error`);
      }
      times[id] = (Date.now() - t0) / 1000;
      check(id, `took under ${LIMIT_MS / 1000} s`, times[id] * 1000 < LIMIT_MS, `${times[id].toFixed(1)} s`);
      if (page.logs.length) console.log('  console errors: ' + [...new Set(page.logs)].slice(0, 3).map((l) => l.split('\n')[0].slice(0, 160)).join(' / '));
      page.close();
    }
  } finally { chrome.close(); vite?.stop(); }
  writeFileSync(join(OUT, 'sketch-report.json'), JSON.stringify({ at: new Date().toISOString(), times, results }, null, 1));
  console.log(`\ntimes: ${Object.entries(times).map(([k, v]) => `${k} ${v.toFixed(1)} s`).join(', ')}`);
  console.log(`${results.length - failures}/${results.length} checks passed${failures ? `, ${failures} FAILED` : ''}. Screenshots: ${OUT}`);
  process.exit(failures ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });

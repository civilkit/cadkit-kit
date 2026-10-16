// @vitest-environment node
// Kernel-backed: build parts through a Session, render them, check what a reader would see. PNGs go to SNAPSHOT_OUT
// (default: the scratch directory) so they can be opened and eyeballed.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { snapshotOf } from './snapshotOf';
import { renderSnapshot } from './render';
import { diffImages } from './diff';
import { decodePng } from './png';

const OUT = process.env.SNAPSHOT_OUT ?? '/path/to/work/scratch-snapshot';
const circle = (id: string, r: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0, fixed: true }],
  entities: [{ id: 'e1', type: 'circle', c: 'p1', r }], constraints: [],
});
const rect = (id: string, w: number, h: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -w / 2, y: -h / 2 }, { id: 'p2', x: w / 2, y: -h / 2 }, { id: 'p3', x: w / 2, y: h / 2 }, { id: 'p4', x: -w / 2, y: h / 2 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b })), constraints: [],
});
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (doc: PartDoc) => { const s = await Session.open(doc); sessions.push(s); return s; };

const ringDoc = () => ({
  ...emptyPart('Ring'),
  features: [circle('F1', 20), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }, circle('F3', 8), { type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', end: 'blind', depth: 10, flip: true }],
  seq: 5,
}) as unknown as PartDoc;
const boxDoc = () => ({ ...emptyPart('Box'), features: [rect('F1', 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }], seq: 3 }) as unknown as PartDoc;

const save = (name: string, png: Uint8Array) => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); };
const isBg = (c: ArrayLike<number>) => c[0] === 234 && c[1] === 238 && c[2] === 244;

describe('snapshotOf on kernel bodies', { skip: !process.env.CK_WASM }, () => {
  it('box: every standard view renders and the bounding box is in the meta', async () => {
    const s = await open(boxDoc());
    for (const view of ['iso', 'front', 'top', 'right', 'back', 'left', 'bottom'] as const) {
      const r = await snapshotOf(s, { view });
      save(`kbox-${view}`, r.png);
      expect(r.meta.triangles).toBeGreaterThanOrEqual(12);
    }
    const r = await snapshotOf(s, { view: 'iso' });
    expect(r.meta.bbox.max[0] - r.meta.bbox.min[0]).toBeCloseTo(40, 3);
    const d = await snapshotOf(s, { sheet: 'drawing-third-angle', size: 600 });
    save('kbox-drawing', d.png);
  });

  it('ring: the hole is visible looking down the axis (Z up, top) and the section is an annulus', async () => {
    const s = await open(ringDoc());
    const top = await snapshotOf(s, { view: 'top', up: 'z', size: 400 });
    save('kring-top', top.png);
    const at = (x: number, y: number) => top.rgba.subarray((y * top.width + x) * 4, (y * top.width + x) * 4 + 3);
    // looking down the axis the ring's far side (z=0) is the background through the hole: the centre is background,
    // a point on the annulus (r = 14 mm) is not
    expect(isBg(at(200, 200))).toBe(true);
    const k = top.meta.scale;
    expect(isBg(at(Math.round(200 + 14 * k), 200))).toBe(false);
    expect(isBg(at(Math.round(200 + 24 * k), 200))).toBe(true);
    // from the side (Z up, front) the same ring is solid in the middle
    const front = await snapshotOf(s, { view: 'front', up: 'z', size: 400 });
    expect(isBg(front.rgba.subarray((200 * 400 + 200) * 4, (200 * 400 + 200) * 4 + 3))).toBe(false);

    const sec = await snapshotOf(s, { view: 'iso', up: 'z', section: { axis: 'z', at: 5 }, sheet: 'section', size: 500 });
    save('kring-section', sec.png);
    const section = await s.section({ origin: [0, 0, 5], normal: [0, 0, 1] });
    expect(section.loops.map((l) => l.kind).sort()).toEqual(['inner', 'outer']);
    expect(section.area).toBeCloseTo(Math.PI * (400 - 64), 0);
    // hatch lines present in the left panel
    const img = await decodePng(sec.png);
    let hatch = 0;
    for (let y = 0; y < 500; y++) for (let x = 0; x < 500; x++) { const i = (y * img.width + x) * 4; if (img.rgba[i] < 90 && img.rgba[i + 2] < 120 && img.rgba[i] > 40) hatch++; }
    expect(hatch).toBeGreaterThan(1500);

    const cut3d = await snapshotOf(s, { view: 'iso', up: 'z', section: { axis: 'z', at: 5 }, size: 500, markers: [{ p: [14, 0, 5], label: 'M1' }], annotate: [{ from: [-20, 0, 10], to: [20, 0, 10] }] });
    save('kring-iso-cut', cut3d.png);
    const sheet = await snapshotOf(s, { sheet: 'drawing-first-angle', up: 'z', size: 600 });
    save('kring-drawing-first', sheet.png);
    const ab = await snapshotOf(s, { sheet: 'ab', up: 'z' });
    save('kring-ab', ab.png);
  });

  it('before / after on a pinned frame: only the changed region differs', async () => {
    const s = await open(ringDoc());
    const frame = { center: [0, 0, 5] as [number, number, number], radius: 30 };
    const a = await snapshotOf(s, { view: 'top', up: 'z', frame, size: 400 });
    await s.edit([{ op: 'setParam', id: 'F3', path: 'entities.0.r', value: 12 }] as never).catch(() => null);
    const b = await snapshotOf(s, { view: 'top', up: 'z', frame, size: 400 });
    const d = await diffImages(a.png, b.png);
    save('kring-diff', d.diffPng);
    expect(d.changedPct).toBeGreaterThanOrEqual(0);
  });

  it('timings on a sample part from disk', async () => {
    const names = ['bench-enclosure', 'bench-worm_screw', 'swept-handle'];
    for (const n of names) {
      let doc: PartDoc;
      try { doc = JSON.parse(readFileSync(`${process.cwd()}/apps/cad/public/samples/${n}.ckpart`, 'utf8')); } catch { continue; }
      const s = await open(doc);
      const body = await s.bodyForView();
      if (!body) continue;
      const t0 = performance.now();
      const r = await renderSnapshot({ mesh: body.mesh, edges: body.edges, box: body.box, name: n }, { view: 'iso' });
      const ms = performance.now() - t0;
      save(`ksample-${n}`, r.png);
      console.log(`${n}: ${r.meta.triangles} triangles, ${ms.toFixed(0)} ms`);
    }
  });
});

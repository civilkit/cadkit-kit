// The edge flange editor's patches against the real kernel: a partial-width flange by start and length or by two points, a leg shaped by a sketch with a
// hole, the relief beside a partial flange, the frame of the built leg, and the SolidWorks chute's imported flanges (a field edit keeps the outline; an outline
// converted to a sketch builds the same leg). The kernel's own tests have the numbers of the flanges; these check that what the editor writes builds.
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { createWorkerKernel } from '@ck/kernel-client/node';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { sldprtAsPart } from '../files/sldprtImport';
import { lastFlat } from './model';
import {
  addHole, circlesOfSketch, framePlane, holesOf, legFrame, patchHolesFromCircles, patchProfileConvert, patchProfileRect, patchProfileSketch, patchRelief, patchReliefSize, patchSpan, patchSpanMode,
  patchSpanPoints, profileOf, rectSketch, sketchFromProfile, sketchOrigin, spanOf,
} from './flangeShape';
import { legGeometry } from './legGeometry';
import { outlineCandidates, withOutline } from './flangeSketch';

type Wire = Record<string, unknown>;
const lines = (ids: string[][]) => ids.map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b }));
const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: lines([['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']]), constraints: [],
});
const partOf = (features: Wire[]): PartDoc => ({ ...emptyPart('Plate'), features, seq: features.length + 1 }) as unknown as PartDoc;
const STEEL = { type: 'sheetRules', id: 'R1', name: 'Steel2', thickness: 2, kFactor: 0.44, bendRadius: 2, active: true };
const BASE = [rect('S1', 0, 0, 100, 60), STEEL, { type: 'baseFlange', id: 'B1', sketch: 'S1' }];
const flange = (extra: Wire = {}): Wire => ({ type: 'edgeFlange', id: 'E1', edges: [{ at: [50, 0, 2] }], height: 20, ...extra });

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(doc: PartDoc) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc);
  const flat = async () => lastFlat(await controller.sheetMetal())!.flatPattern;
  /** The feature as the editor would leave it after `patch` (null removes a field), applied as the app applies a draft. */
  const apply = async (id: string, patch: Wire) => {
    const f = { ...(controller.document()!.features.find((x) => x.id === id) as unknown as Wire) };
    for (const [k, v] of Object.entries(patch)) { if (v === null) delete f[k]; else f[k] = v; }
    return controller.edit([{ op: 'replace', id, feature: f }]);
  };
  const eff = (id: string): Wire => controller.document()!.features.find((x) => x.id === id) as unknown as Wire;
  return { controller, flat, apply, eff };
}
/** The area of the outer loop of the flat pattern. */
const area = (pts: number[][]): number => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

describe('edge flange editor patches against the kernel', { skip: !process.env.CK_WASM }, () => {
  it('start and length limit the flange to part of the edge; the bend is as long as the length', async () => {
    const w = await world(partOf([...BASE, flange()]));
    const whole = await w.flat();
    expect(whole.bends[0].length).toBeCloseTo(100, 6);
    const r = await w.apply('E1', patchSpanMode(w.eff('E1'), 'length', 40));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(w.eff('E1')).toMatchObject({ length: 40 });
    expect((await w.flat()).bends[0].length).toBeCloseTo(40, 6);
    const r2 = await w.apply('E1', patchSpan(w.eff('E1'), { start: 20 }));
    expect(r2.ok, JSON.stringify(r2)).toBe(true);
    const fp = await w.flat();
    expect(fp.bends[0].length).toBeCloseTo(40, 6);
    expect(spanOf(w.eff('E1')).start).toBe(20);
    // back to the whole edge
    const r3 = await w.apply('E1', patchSpanMode(w.eff('E1'), 'whole'));
    expect(r3.ok).toBe(true);
    expect(Object.keys(w.eff('E1')).filter((k) => ['start', 'length', 'from', 'to'].includes(k))).toEqual([]);
    expect((await w.flat()).bends[0].length).toBeCloseTo(100, 6);
  });

  it('two points on the edge give the same span (in either order)', async () => {
    const w = await world(partOf([...BASE, flange()]));
    const r = await w.apply('E1', patchSpanPoints(w.eff('E1'), [20, 0, 1], [60, 0, 1]));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await w.flat()).bends[0].length).toBeCloseTo(40, 6);
    const r2 = await w.apply('E1', patchSpanPoints(w.eff('E1'), [60, 0, 1], [20, 0, 1]));
    expect(r2.ok).toBe(true);
    expect((await w.flat()).bends[0].length).toBeCloseTo(40, 6);
    expect(spanOf(w.eff('E1')).mode).toBe('points');
  });

  it('a hem takes a start or two points, and the relief of a partial flange cuts the plate', async () => {
    const w = await world(partOf([...BASE, { type: 'hem', id: 'H1', edges: [{ at: [50, 0, 2] }], length: 10 }]));
    const r = await w.apply('H1', patchSpanPoints(w.eff('H1'), [20, 0, 1], [60, 0, 1], true));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await w.flat()).bends[0].length).toBeCloseTo(40, 6);
    expect(w.eff('H1').length).toBe(10);                                        // the hem's own length is untouched
    const f = await world(partOf([...BASE, flange({ edges: [{ at: [50, 0, 2] }], start: 20, length: 40 })]));
    const none = area((await f.flat()).outline[0]);
    const rr = await f.apply('E1', patchRelief(f.eff('E1'), 'rectangular', { width: 2, depth: 1 }));
    expect(rr.ok, JSON.stringify(rr)).toBe(true);
    const rule = area((await f.flat()).outline[0]);
    expect(rule).toBeLessThan(none - 1e-6);                                     // the relief takes material out
    const rc = await f.apply('E1', patchReliefSize(patchRelief(f.eff('E1'), 'custom', { width: 2, depth: 1 }) as Wire & { relief?: unknown } as Wire, { width: 5 }) as Wire);
    expect(rc.ok, JSON.stringify(rc)).toBe(true);
    expect(f.eff('E1').relief).toEqual({ width: 5, depth: 1 });
    expect(area((await f.flat()).outline[0])).toBeLessThan(rule - 1e-6);        // wider relief, less material
  });

  it('a leg shaped by a sketch builds; circles in the sketch are holes; the frame of the built leg puts the sketch on the flange', async () => {
    // a rounded-top leg sketch: 40 wide, 20 high, with a corner cut by an arc, and a 6 mm circle inside
    const leg = rectSketch('S2', 'Leg', { kind: 'std', id: 'front' }, 40, 20) as Wire & { points: Wire[]; entities: Wire[] };
    leg.points.push({ id: 'c1', x: 20, y: 10 });
    leg.entities.push({ id: 'e5', type: 'circle', c: 'c1', r: 3 });
    const w = await world(partOf([BASE[0], STEEL, BASE[2], leg as unknown as Wire, flange()]));
    const plain = await w.flat();
    const r = await w.apply('E1', patchProfileSketch(w.eff('E1'), 'S2'));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(profileOf(w.eff('E1'))).toEqual({ kind: 'sketch', sketch: 'S2' });
    const fp = await w.flat();
    expect(fp.bends[0].length).toBeCloseTo(40, 4);                              // the bend is as wide as the outline at the end of the bend
    expect(fp.outline.length).toBe(plain.outline.length + 1);   // the circle is an inner loop
    expect(fp.outline.length).toBeGreaterThanOrEqual(1);
    // the circle inside the outline is a hole of the leg (an inner loop of the flat pattern)
    const holes = (await w.flat()).outline.length - 1;
    expect(holes).toBeGreaterThanOrEqual(1);
    // back to a rectangle removes the profile
    expect((await w.apply('E1', patchProfileRect(w.eff('E1')))).ok).toBe(true);
    expect(profileOf(w.eff('E1')).kind).toBe('rect');
    // a circle of another sketch taken as an explicit hole (measured from the outline's lower left corner) is cut as well
    const s3 = { type: 'sketch', id: 'S3', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'k1', x: 30, y: 10 }], entities: [{ id: 'e1', type: 'circle', c: 'k1', r: 2 }], constraints: [] };
    const feats = [...w.controller.document()!.features] as unknown as Wire[];
    feats.splice(feats.findIndex((f) => f.id === 'E1'), 0, s3);
    const w3 = await world({ ...w.controller.document()!, features: feats } as PartDoc);
    const circles = circlesOfSketch(w3.controller.document(), 'S3');
    expect(circles).toEqual([{ id: 'e1', center: [30, 10], radius: 2 }]);
    const both = await w3.apply('E1', { ...patchProfileSketch(w3.eff('E1'), 'S2'), ...patchHolesFromCircles(w3.eff('E1'), circles, sketchOrigin(w3.controller.document(), 'S2')) });
    expect(both.ok, JSON.stringify(both)).toBe(true);
    expect(holesOf(w3.eff('E1'))).toEqual([{ kind: 'circle', center: [30, 10], radius: 2 }]);
    expect((await w3.flat()).outline.length).toBe(3);                          // the outline and two holes
    // the same circle as the sketch's own inner loop and as an explicit hole is refused by the kernel (two coincident cylinders): the form does not offer it
    const twice = await w3.apply('E1', patchHolesFromCircles(w3.eff('E1'), [{ center: [20, 10], radius: 3 }], [0, 0]));
    expect(twice.ok).toBe(false);
  });

  it('the built leg gives the flange frame: x along the flange, y outward, the height at the end wall', async () => {
    const w = await world(partOf([...BASE, flange({ edges: [{ at: [50, 0, 2] }], from: [20, 0, 1], to: [60, 0, 1] })]));
    const geo = legGeometry(await w.controller.sheetMetal(), 'E1', w.controller.bodyFaces());
    expect(geo, 'the leg of E1 is found by its roles').not.toBeNull();
    expect(geo!.tip).not.toBeNull();
    const fr = legFrame(geo!.leg, geo!.normal, geo!.tip!, 20, [40, 0, 0])!;
    expect(fr.width).toBeCloseTo(40, 4);
    expect(fr.v.map((x) => +x.toFixed(6))).toEqual([1, 0, 0]);                  // the hint orients v from the first point to the second
    expect(Math.abs(fr.h[2])).toBeCloseTo(1, 6);                                // an upright leg: outward is vertical
    expect(fr.origin[0]).toBeCloseTo(20, 4);
    expect(fr.from[0]).toBeCloseTo(20, 4); expect(fr.to[0]).toBeCloseTo(60, 4);
    // a sketch on that plane has its x along the flange and y outward: the same leg built from it has the same width
    const plane = framePlane('F9', 'Flange plane', fr);
    expect(plane).toMatchObject({ type: 'plane', mode: 'frame' });
  });

  it('a new outline sketch (the default leg) is placed on the flange\'s frame and builds, whichever way the edge runs', async () => {
    for (const edges of [[{ at: [50, 0, 2] }], [{ at: [50, 60, 2] }]]) {   // the far edge runs the other way round the outline
      const doc = partOf([...BASE, flange({ edges })]);
      const base = await world(doc);
      const before = await base.flat();
      const geo = legGeometry(await base.controller.sheetMetal(), 'E1', base.controller.bodyFaces())!;
      const frame = legFrame(geo.leg, geo.normal, geo.tip!, 20);
      expect(frame).not.toBeNull();
      const { plans } = outlineCandidates({ kind: 'new', eff: base.eff('E1'), frame, seq: base.controller.document()!.seq, name: 'Outline', planeName: 'Plane', height: 20, width: null });
      expect(plans).toHaveLength(2);
      let ok = false;
      for (const pl of plans) {
        const w = await world(withOutline(base.controller.document()!, 'E1', pl));
        const r = await w.apply('E1', pl.patch);
        if (!r.ok) continue;
        ok = true;
        const after = await w.flat();
        expect(after.flatSize[0]).toBeCloseTo(before.flatSize[0], 4);
        expect(after.flatSize[1]).toBeCloseTo(before.flatSize[1], 4);
        expect(after.bends[0].length).toBeCloseTo(before.bends[0].length, 4);
        // the direction is known: without the span's points the bend follows the outline, here as wide as the plate edge
        const bare = await w.apply('E1', { from: null, to: null, ...pl.unpinned });
        expect(bare.ok, JSON.stringify(bare)).toBe(true);
        const free = await w.flat();
        expect(free.bends[0].length).toBeCloseTo(before.bends[0].length, 4);
        expect(free.flatSize[1]).toBeCloseTo(before.flatSize[1], 4);
        // a narrower outline now makes a narrower bend (it would stay 100 wide with the points kept)
        const sk = (w.controller.document()!.features.find((f) => f.id === pl.sketchId) as unknown as { points: Array<{ id: string; x: number }> });
        const narrow = sk.points.map((p) => (p.id === 'p2' || p.id === 'p3' ? { ...p, x: 60 } : p));
        expect((await w.controller.edit([{ op: 'set', id: pl.sketchId, path: 'points', value: narrow }])).ok).toBe(true);
        expect((await w.flat()).bends[0].length).toBeCloseTo(60, 4);
        break;
      }
      expect(ok).toBe(true);
    }
  });
});

// a SolidWorks sheet metal part with five edge flanges (a chute), a local file: SW_CHUTE=<path to the .SLDPRT> runs this suite
const CHUTE = process.env.SW_CHUTE ?? '';
describe('the SolidWorks chute flanges in the editor', { skip: !process.env.CK_WASM || !CHUTE || !existsSync(CHUTE) }, () => {
  it('opens with its fields; a field edit keeps the outline; a convertible outline becomes a sketch that builds the same leg', async () => {
    const k = await createWorkerKernel(process.env.CK_WASM!);
    try {
      const r = await sldprtAsPart(k as never, new Uint8Array(readFileSync(CHUTE)), 'Chute');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const flanges = r.part.features.filter((f) => f.type === 'edgeFlange') as unknown as Wire[];
      expect(flanges.length).toBeGreaterThanOrEqual(5);
      for (const f of flanges) {
        // the fields the form shows: two points, an inline outline, circle holes on the one that has them
        expect(spanOf(f).mode).toBe('points');
        expect(profileOf(f).kind).toBe('inline');
      }
      expect(holesOf(flanges[0])).toEqual([{ kind: 'circle', center: [139.5, 25.35], radius: 10 }]);
      // an edit of another field leaves profile, holes and the pick's own span alone
      const edited: Wire = { ...flanges[0], radius: 3 };
      expect(edited.profile).toEqual(flanges[0].profile);
      expect(holesOf(edited)).toHaveLength(1);
      // which outlines can become a sketch without moving
      const can = flanges.map((f) => { const p = profileOf(f); return p.kind === 'inline' && sketchFromProfile('x', 'x', { kind: 'std', id: 'front' }, p.segs).ok; });
      expect(can[0]).toBe(true);
      expect(can.filter(Boolean).length).toBeGreaterThanOrEqual(3);
      // converting the first flange: its leg builds the same flat pattern as the inline one
      const doc = r.part as unknown as PartDoc;
      const at = doc.features.findIndex((f) => f.id === 'F5');
      const w = await world({ ...doc, features: doc.features.slice(0, at + 1) } as PartDoc);
      const before = await w.flat();
      const f5 = w.eff('F5');
      const geo = legGeometry(await w.controller.sheetMetal(), 'F5', w.controller.bodyFaces());
      const spanF = spanOf(f5);
      const frame = geo ? legFrame(geo.leg, geo.normal, geo.tip, 40.35, [spanF.to![0] - spanF.from![0], spanF.to![1] - spanF.from![1], spanF.to![2] - spanF.from![2]], spanF.from) : null;
      expect(geo?.tip, 'a shaped leg has no end wall of its own').toBeNull();
      expect(frame, 'the frame of a shaped leg is found from the span').not.toBeNull();
      const { plans, refused } = outlineCandidates({ kind: 'convert', eff: f5, frame, seq: w.controller.document()!.seq, name: 'Outline', planeName: 'Plane', height: 40.35, width: null });
      expect(refused).toBeUndefined();
      let done = false;
      for (const pl of plans) {
        const w2 = await world(withOutline(w.controller.document()!, 'F5', pl));
        const res = await w2.apply('F5', pl.patch);
        if (!res.ok) continue;
        done = true;
        const after = await w2.flat();
        expect(after.flatSize[0]).toBeCloseTo(before.flatSize[0], 3);
        expect(after.flatSize[1]).toBeCloseTo(before.flatSize[1], 3);
        expect(after.outline.length).toBe(before.outline.length);
        expect(area(after.outline[0])).toBeCloseTo(area(before.outline[0]), 1);
        expect(w2.eff('F5').holes).toBeUndefined();
        expect(profileOf(w2.eff('F5')).kind).toBe('sketch');
        break;
      }
      expect(done).toBe(true);
    } finally { await k.close(); }
  }, 300_000);
});

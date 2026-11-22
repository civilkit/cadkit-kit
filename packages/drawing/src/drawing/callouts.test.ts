import { describe, expect, it } from 'vitest';
import { dimText, emptyDrawing, type DDim, type DView, type ViewData } from './model';
import { autoDims } from './geom';
import { holeInfos } from './kernel';
import { dimMeasure, dimTextBoxes, placer, type RenderCtx } from './render';
import { settleCallouts } from './placement';
import { tidyDims } from './headless';

const v = (id: string, extra: Partial<DView> = {}): DView => ({ id, kind: 'std', label: id, x: [1, 0, 0], y: [0, 1, 0], pos: [100, 100], scale: null, hidden: true, tangent: false, centerlines: true, showLabel: true, ...extra });
const ring = (cx: number, cy: number, r: number, e: number) => { const p: number[] = []; for (let i = 0; i <= 32; i++) p.push(cx + r * Math.cos((i / 32) * 2 * Math.PI), cy + r * Math.sin((i / 32) * 2 * Math.PI)); return { k: 'e' as const, v: true, p, e }; };
const edge = (faces: string[], cx: number, cy: number) => ({ faces, at: [cx, cy, 0], mid: [cx, cy], ends: [[cx, cy], [cx, cy]] });
const plate = (circles: Array<{ c: [number, number]; r: number; faces: string[] }>): ViewData => ({
  min: [0, 0], max: [60, 40],
  lines: [{ k: 'e', v: true, p: [0, 0, 60, 0, 60, 40, 0, 40, 0, 0], e: 0 }, ...circles.map((c, i) => ring(c.c[0], c.c[1], c.r, i + 1))],
  edges: [edge(['F1.C0', 'F1.C1'], 0, 0), ...circles.map((c) => edge(c.faces, c.c[0], c.c[1]))],
});
const calloutOf = (dims: DDim[], at: [number, number]) => dims.find((d) => d.kind === 'callout' && Math.hypot(d.a[0] - at[0], d.a[1] - at[1]) < 1e-6)!;
const doc = emptyDrawing('P');
const shown = (d: DDim) => dimText(dimMeasure(d, doc), d.text);

describe('hole callouts follow the feature that made the circle (not its radius)', () => {
  const feats = [
    { type: 'hole', id: 'H5', size: 'M3', end: 'through', kind: 'simple' },
    { type: 'hole', id: 'H7', size: 'M2.5', end: 'through', kind: 'simple' },
  ] as never;
  const holes = holeInfos(feats);
  it('2 x M3 (H5) and 4 x M2.5 (H7) on one face: every circle gets the text of its own feature', () => {
    const g = plate([
      { c: [10, 10], r: 1.5, faces: ['H5.S.h1', 'F1.C0'] }, { c: [50, 10], r: 1.5, faces: ['H5.S.h2', 'F1.C0'] },
      { c: [10, 30], r: 1.25, faces: ['H7.S.h1', 'F1.C0'] }, { c: [20, 30], r: 1.25, faces: ['H7.S.h2', 'F1.C0'] }, { c: [40, 30], r: 1.25, faces: ['H7.S.h3', 'F1.C0'] }, { c: [50, 30], r: 1.25, faces: ['H7.S.h4', 'F1.C0'] },
    ]);
    const dims = autoDims(g, v('V1'), holes);
    expect(calloutOf(dims, [10, 10]).feature).toBe('H5');
    expect(calloutOf(dims, [50, 10]).feature).toBe('H5');
    for (const x of [10, 20, 40, 50]) expect(calloutOf(dims, [x, 30]).feature).toBe('H7');
  });
  it('also when the face the circle sits on is named after the other hole feature (it was last changed by it) and when the radii are swapped', () => {
    // the plate face was re-made by H5, so H7's circles list it first; H7's holes are the BIGGER ones here
    const g = plate([
      { c: [10, 10], r: 1.0, faces: ['H5.S.h1', 'H5.F.top'] },
      { c: [30, 10], r: 2.0, faces: ['H5.F.top', 'H7.S.h1'] },
      { c: [50, 10], r: 2.0, faces: ['H7.S.h2', 'H5.F.top'] },
    ]);
    const dims = autoDims(g, v('V1'), holes);
    expect(calloutOf(dims, [10, 10]).feature).toBe('H5');
    expect(calloutOf(dims, [30, 10]).feature).toBe('H7');
    expect(calloutOf(dims, [50, 10]).feature).toBe('H7');
  });
  it('a feature id that is a prefix of another (H1 / H12) is not confused', () => {
    const hs = holeInfos([{ type: 'hole', id: 'H1', diameter: 3, end: 'through' }, { type: 'hole', id: 'H12', diameter: 4, end: 'through' }] as never);
    const dims = autoDims(plate([{ c: [10, 10], r: 2, faces: ['H12.S.h1', 'F1.C0'] }]), v('V1'), hs);
    expect(calloutOf(dims, [10, 10]).feature).toBe('H12');
  });
});

describe('callouts for a sketch circle + cut', () => {
  const thru = { type: 'extrude', op: 'cut', id: 'X7', sketch: 'S1', end: 'throughBoth' };
  const blind = { type: 'extrude', op: 'cut', id: 'X8', sketch: 'S2', end: 'blind', depth: 8 };
  const g = plate([{ c: [10, 10], r: 3, faces: ['X7.S.h1', 'F1.C0'] }, { c: [40, 20], r: 3, faces: ['X8.S.h1', 'F1.C0'] }]);
  it('a through cut reads "Ø6 THRU", a blind one "Ø6 ↧ 8", and neither is a thread or hole feature callout', () => {
    const hs = holeInfos([thru, blind] as never);
    const dims = autoDims(g, v('V1'), hs);
    const t = calloutOf(dims, [10, 10]), b = calloutOf(dims, [40, 20]);
    expect(shown(t)).toBe('Ø6 THRU');
    expect(shown(b)).toBe('Ø6 ↧ 8');
    expect(t.feature).toBeUndefined();
    expect(dims.filter((d) => d.kind === 'diameter')).toHaveLength(0);
    expect(hs.every((h) => !h.thread)).toBe(true);
  });
  it('the text keeps following the circle: a bigger circle reads Ø8 THRU', () => {
    const dims = autoDims(plate([{ c: [10, 10], r: 4, faces: ['X7.S.h1', 'F1.C0'] }]), v('V1'), holeInfos([thru] as never));
    expect(shown(calloutOf(dims, [10, 10]))).toBe('Ø8 THRU');
  });
  it('can be switched off: the circle is then a plain diameter, as before', () => {
    const dims = autoDims(g, v('V1'), holeInfos([thru, blind] as never, undefined, { sketchCuts: false }));
    expect(dims.filter((d) => d.kind === 'callout')).toHaveLength(0);
    expect(dims.filter((d) => d.kind === 'diameter')).toHaveLength(2);
  });
  it('cuts that are not simple holes (up to face, adds, a circle that is not the cut wall) stay plain diameters', () => {
    const hs = holeInfos([{ ...thru, op: 'add' }, { ...blind, end: 'upToFace' }] as never);
    expect(hs).toHaveLength(0);
    const hs2 = holeInfos([thru] as never);
    const dims = autoDims(plate([{ c: [10, 10], r: 3, faces: ['X7.E.1', 'F1.C0'] }]), v('V1'), hs2);
    expect(dims.some((d) => d.kind === 'diameter')).toBe(true);
  });
  it('the headless tidy drops tiny sketch-circle callouts like tiny diameters, and keeps hole feature callouts', () => {
    const g2 = plate([{ c: [10, 10], r: 2, faces: ['X7.S.h1', 'F1.C0'] }, { c: [30, 10], r: 2, faces: ['H5.S.h1', 'F1.C0'] }, { c: [40, 20], r: 8, faces: ['X7.S.h2', 'F1.C0'] }]);
    const dims = autoDims(g2, v('V1'), holeInfos([thru, { type: 'hole', id: 'H5', size: 'M3', end: 'through', kind: 'simple' }] as never));
    const out = tidyDims(dims, g2, 10).filter((d) => d.kind === 'callout');
    expect(out.map((d) => d.feature ?? 'plain')).toEqual(['H5', 'plain']);
  });
  it('a hole feature still wins over nothing: real holes keep their own text', () => {
    const hs = holeInfos([{ type: 'hole', id: 'H5', size: 'M3', end: 'through', kind: 'simple' }, thru] as never);
    const dims = autoDims(plate([{ c: [10, 10], r: 1.5, faces: ['H5.S.h1', 'F1.C0'] }]), v('V1'), hs);
    expect(calloutOf(dims, [10, 10]).feature).toBe('H5');
  });
});

describe('a callout does not land on a dimension text', () => {
  const overlap = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const setup = () => {
    const g = plate([{ c: [30, 20], r: 2, faces: ['H5.S.h1', 'F1.C0'] }]);
    const view = v('V1');
    const holes = holeInfos([{ type: 'hole', id: 'H5', size: 'M3', end: 'through', kind: 'simple' }] as never);
    const callout = autoDims(g, view, holes).find((d) => d.kind === 'callout')!;
    const d0 = { ...emptyDrawing('P'), views: [view] };
    const ctx: RenderCtx = { doc: d0, data: { V1: g }, callout: (f) => holes.find((h) => h.feature === f)?.text ?? null };
    return { g, view, callout, d0, ctx, holes };
  };
  it('the default spot of the callout text is taken by a dimension text: the callout moves clear of it, still attached to its circle', () => {
    const { g, view, callout, d0, ctx } = setup();
    const [own] = dimTextBoxes(ctx, callout, view, g);
    // a linear dimension whose text sits on that spot
    const P = placer(d0, view, g);
    const cx = (own[0] + own[2]) / 2, cy = (own[1] + own[3]) / 2;
    const u = (x: number) => 30 + (x - P(30, 20)[0]);      // 1:1 scale: sheet mm = view units
    const w = 20 - (cy - P(30, 20)[1]);
    const lin: DDim = { id: 'DL', view: 'V1', kind: 'linear', a: [u(cx) - 4, w], b: [u(cx) + 4, w], orient: 'h', offset: 0 };
    expect(dimTextBoxes(ctx, lin, view, g).some((b) => overlap(b, own))).toBe(true);     // the set-up really collides
    const placed = settleCallouts({ ...d0, dims: [lin, callout] }, { V1: g }, ctx.callout).dims;
    const moved = placed.find((d) => d.id === callout.id)!;
    expect(moved.angle).not.toBe(callout.angle);
    expect(moved.a).toEqual(callout.a);
    expect(moved.feature).toBe('H5');
    const after = dimTextBoxes(ctx, moved, view, g), lb = dimTextBoxes(ctx, lin, view, g);
    for (const b of after) for (const o of lb) expect(overlap(b, o)).toBe(false);
    expect(placed.find((d) => d.id === 'DL')).toEqual(lin);
  });
  it('callouts that would sit on each other are separated too, and a free callout stays where it was', () => {
    const { g, view, callout, d0, ctx } = setup();
    const twin: DDim = { ...callout, id: 'DT' };
    const placed = settleCallouts({ ...d0, dims: [callout, twin] }, { V1: g }, ctx.callout).dims;
    const a = dimTextBoxes(ctx, placed[0], view, g), b = dimTextBoxes(ctx, placed[1], view, g);
    for (const x of a) for (const y of b) expect(overlap(x, y)).toBe(false);
    expect(placed[0].angle).toBe(callout.angle);
    const alone = settleCallouts({ ...d0, dims: [callout] }, { V1: g }, ctx.callout).dims;
    expect(alone[0]).toEqual(callout);
  });
});

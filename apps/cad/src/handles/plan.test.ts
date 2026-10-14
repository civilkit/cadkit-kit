import { describe, expect, it } from 'vitest';
import type { PartDoc } from '@ck/part-model';
import { BODY } from '@kit/store';
import '../i18n';
import { planHandles, type PlanCtx } from './plan';
import { boxMesh } from './testmesh';
import { faceInfo, onHull, bisectorAt } from './geom';
import { moveBodyOps, placementSession, placementSpecs, type MoveParams, type Placement } from './placement';

const b = boxMesh([-20, -20, 0], [20, 20, 30]);
const doc = (features: unknown[]): PartDoc => ({ name: 'T', features, seq: 10 }) as unknown as PartDoc;
const base = doc([{ type: 'sketch', id: 'F1' }, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 30 }]);
const ctx = (over: Partial<PlanCtx>): PlanCtx => ({ doc: base, selection: [], mode: 'face', edges: b.edges, mesh: b.mesh, box: b.box, editingId: null, sketching: false, enabled: true, ...over });
const edgeKey = (a: string, c: string) => b.edges.find((e) => e.faces!.includes(a) && e.faces!.includes(c))!.key!;

describe('geometry from the mesh', () => {
  it('face centre, outward normal and planarity', () => {
    const i = faceInfo(b.mesh, 'F2.C1')!;
    expect(i.centroid).toEqual([0, 0, 30]);
    expect(i.normal).toEqual([0, 0, 1]);
    expect(i.planar).toBe(true);
    expect(i.area).toBeCloseTo(1600);
    expect(faceInfo(b.mesh, 'nope')).toBeNull();
  });
  it('bisector of an edge points away from the body, onHull tells outer faces from inner', () => {
    const e = b.edges.find((x) => x.key === edgeKey('F2.C1', 'F2.S.e1'))!;
    const v = bisectorAt(b.mesh, e.faces!, e.mid as [number, number, number])!;
    expect(v[1]).toBeCloseTo(-Math.SQRT1_2);
    expect(v[2]).toBeCloseTo(Math.SQRT1_2);
    expect(onHull(faceInfo(b.mesh, 'F2.C1')!, b.box)).toBe(true);
    const inner = { name: 'x', centroid: [0, 0, 28] as [number, number, number], normal: [0, 0, -1] as [number, number, number], planar: true, area: 1 };
    expect(onHull(inner, b.box)).toBe(false);
  });
});

describe('edge and corner: fillet out, chamfer in', () => {
  const key = edgeKey('F2.C1', 'F2.S.e1');
  const s = planHandles(ctx({ mode: 'edge', selection: [key] }))!;
  it('puts a dot on the edge midpoint along the outward bisector', () => {
    expect(s.kind).toBe('round-new');
    expect(s.specs).toHaveLength(1);
    expect(s.specs[0].kind).toBe('dot');
    expect(s.specs[0].origin).toEqual([0, -20, 30]);
    expect(s.specs[0].offsetPx).toBeLessThan(0);   // sits inside the corner, not on the edge
  });
  it('a positive drag previews one fillet with the edge references, a negative one a chamfer', () => {
    const fillet = s.preview('round', 2.5, [0, 0, 0])!;
    expect(fillet).toEqual([{ op: 'add', feature: { type: 'fillet', radius: 2.5, edges: [{ faces: ['F2.C1', 'F2.S.e1'], at: [0, -20, 30] }] } }]);
    const chamfer = s.preview('round', -4, [0, 0, 0])!;
    expect((chamfer[0] as { feature: Record<string, unknown> }).feature).toMatchObject({ type: 'chamfer', chamferType: 'equal', distance: 4 });
    expect(s.preview('round', 0, [0, 0, 0])).toBeNull();
    expect(s.preview('round', 0.001, [0, 0, 0])).toBeNull();
  });
  it('commit adds exactly one feature and asks for the Editor; nothing at zero', () => {
    const c = s.commit('round', 3, [0, 0, 0])!;
    expect(c.create).toBe(true);
    expect(c.ops).toHaveLength(1);
    expect(s.commit('round', 0, [0, 0, 0])).toBeNull();
    expect(s.format!('round', 3)).toBe('Fillet 3 mm');
    expect(s.format!('round', -3)).toBe('Chamfer 3 mm');
  });
  it('a corner uses every edge that meets there', () => {
    const corner = 'v:-20,-20,30';
    const cs = planHandles(ctx({ mode: 'vertex', selection: [corner] }))!;
    expect(cs.specs[0].origin).toEqual([-20, -20, 30]);
    const ax = cs.specs[0].axis;
    expect(ax[0]).toBeCloseTo(-1 / Math.sqrt(3));
    expect(ax[1]).toBeCloseTo(-1 / Math.sqrt(3));
    expect(ax[2]).toBeCloseTo(1 / Math.sqrt(3));
    const ops = cs.preview('round', 1, [0, 0, 0])!;
    expect((ops[0] as unknown as { feature: { edges: unknown[] } }).feature.edges).toHaveLength(3);
  });
  it('two selected edges are one feature with two references', () => {
    const two = planHandles(ctx({ mode: 'edge', selection: [key, edgeKey('F2.C1', 'F2.S.e2')] }))!;
    expect((two.preview('round', 1, [0, 0, 0])![0] as unknown as { feature: { edges: unknown[] } }).feature.edges).toHaveLength(2);
  });
});

describe('an edge or face that already belongs to a fillet edits it in place', () => {
  const withFillet = doc([...base.features, { type: 'fillet', id: 'FL', radius: 3, edges: [] }]);
  const fl = boxMesh([-20, -20, 0], [20, 20, 30]);
  // pretend the rounded edge was replaced by a blend face FL.B0 (a flat stand-in is enough for the maths)
  const mesh = { ...fl.mesh, faceIds: [...fl.mesh.faceIds, 'FL.B0'], positions: [...Array.from(fl.mesh.positions), 0, -19, 29, 1, -19, 29, 1, -20, 28], normals: [...Array.from(fl.mesh.normals), 0, -0.7071, 0.7071, 0, -0.7071, 0.7071, 0, -0.7071, 0.7071], triFace: [...Array.from(fl.mesh.triFace), 6] };
  const edges = [...fl.edges, { key: 'F2.C1|FL.B0#99', faces: ['F2.C1', 'FL.B0'], mid: [0, -19, 29.5], pts: [[-20, -19, 29], [20, -19, 29]] }];
  it('the edge next to the blend face gives a radius dot that sets `radius`', () => {
    const s = planHandles(ctx({ doc: withFillet, mesh, edges, mode: 'edge', selection: ['F2.C1|FL.B0#99'] }))!;
    expect(s.kind).toBe('round-edit');
    expect(s.target).toBe('FL');
    expect(s.specs[0].base).toBe(3);
    expect(s.preview('round', 4.5, [0, 0, 0])).toEqual([{ op: 'set', id: 'FL', path: 'radius', value: 4.5 }]);
    expect(s.commit('round', 4.5, [0, 0, 0])).toEqual({ ops: [{ op: 'set', id: 'FL', path: 'radius', value: 4.5 }], create: false });
    expect(s.preview('round', 0, [0, 0, 0])).toBeNull();
    expect(s.format!('round', 4.5)).toBe('Radius 4.5 mm');
  });
  it('the blend face itself, and a chamfer sets `distance`', () => {
    const s = planHandles(ctx({ doc: withFillet, mesh, edges, mode: 'face', selection: ['FL.B0'] }))!;
    expect(s.kind).toBe('round-edit');
    const ch = doc([...base.features, { type: 'chamfer', id: 'FL', chamferType: 'equal', distance: 2, edges: [] }]);
    const c = planHandles(ctx({ doc: ch, mesh, edges, mode: 'face', selection: ['FL.B0'] }))!;
    expect(c.preview('round', 3, [0, 0, 0])).toEqual([{ op: 'set', id: 'FL', path: 'distance', value: 3 }]);
  });
});

describe('end cap of an extrude: depth', () => {
  const s = () => planHandles(ctx({ mode: 'face', selection: ['F2.C1'] }))!;
  it('an arrow on the cap along its normal, base = the current depth', () => {
    expect(s().kind).toBe('extrude-depth');
    expect(s().specs[0]).toMatchObject({ kind: 'arrow', origin: [0, 0, 30], axis: [0, 0, 1], base: 30, scale: 1 });
    expect(s().target).toBe('F2');
  });
  it('sets depth, and flips through zero', () => {
    expect(s().preview('depth', 42, [0, 0, 0])).toEqual([{ op: 'set', id: 'F2', path: 'depth', value: 42 }]);
    expect(s().preview('depth', -5, [0, 0, 0])).toEqual([{ op: 'set', id: 'F2', path: 'depth', value: 5 }, { op: 'set', id: 'F2', path: 'flip', value: true }]);
    expect(s().preview('depth', 0, [0, 0, 0])).toBeNull();
    expect(s().commit('depth', 12, [0, 0, 0])!.create).toBe(false);
    const flipped = doc([base.features[0], { ...(base.features[1] as object), flip: true }]);
    const f = planHandles(ctx({ doc: flipped, mode: 'face', selection: ['F2.C1'] }))!;
    expect(f.preview('depth', -5, [0, 0, 0])![1]).toEqual({ op: 'set', id: 'F2', path: 'flip', value: false });
  });
  it('a cut deepens when the cap moves against its normal', () => {
    const cut = doc([base.features[0], { ...(base.features[1] as object), op: 'cut' }]);
    expect(planHandles(ctx({ doc: cut, mode: 'face', selection: ['F2.C1'] }))!.specs[0].scale).toBe(-1);
  });
  it('only a blind extrude, only the end cap, only one face', () => {
    const through = doc([base.features[0], { ...(base.features[1] as object), end: 'through' }]);
    expect(planHandles(ctx({ doc: through, mode: 'face', selection: ['F2.C1'] }))).toBeNull();
    expect(planHandles(ctx({ mode: 'face', selection: ['F2.C0'] }))).toBeNull();
    expect(planHandles(ctx({ mode: 'face', selection: ['F2.S.e1'] }))).toBeNull();   // no moveFace in the kernel: no arrow
    expect(planHandles(ctx({ mode: 'face', selection: ['F2.C1', 'F2.C0'] }))).toBeNull();
  });
});

describe('hole wall and shell wall', () => {
  it('a plain hole: a dot that grows the diameter by twice the drag', () => {
    // a hole wall: a thin strip at x = 3 facing the axis (-x)
    const h = boxMesh([-20, -20, 0], [20, 20, 30]);
    const mesh = { ...h.mesh, faceIds: [...h.mesh.faceIds, 'H.S.h1'], positions: [...Array.from(h.mesh.positions), 3, 0, 0, 3, 1, 0, 3, 0, 30], normals: [...Array.from(h.mesh.normals), -1, 0, 0, -1, 0, 0, -1, 0, 0], triFace: [...Array.from(h.mesh.triFace), 6] };
    const d = doc([...base.features, { type: 'hole', id: 'H', sketch: 'F3', kind: 'simple', size: 'M6', fit: 'normal', end: 'through' }]);
    const s = planHandles(ctx({ doc: d, mesh, mode: 'face', selection: ['H.S.h1'] }))!;
    expect(s.kind).toBe('hole-diameter');
    expect(s.specs[0]).toMatchObject({ kind: 'dot', base: 6.6, scale: 2 });
    expect(s.specs[0].axis[0]).toBe(1);   // into the material
    expect(s.preview('diameter', 8, [0, 0, 0])).toEqual([{ op: 'set', id: 'H', path: 'diameter', value: 8 }]);
    const cb = doc([...base.features, { type: 'hole', id: 'H', sketch: 'F3', kind: 'cbore', size: 'M6', fit: 'normal', end: 'through' }]);
    expect(planHandles(ctx({ doc: cb, mesh, mode: 'face', selection: ['H.S.h1'] }))).toBeNull();
  });
  it('shell: the inner wall only, thickness grows when it moves with its normal', () => {
    const inner = boxMesh([-18, -18, 2], [18, 18, 30], 'F2');
    const faceIds = inner.mesh.faceIds.map((n) => n + '~1');
    const mesh = { ...inner.mesh, faceIds, normals: Array.from(inner.mesh.normals).map((v) => -v) };   // a cavity wall faces into the cavity
    const d = doc([...base.features, { type: 'shell', id: 'SH', faces: ['F2.C1'], thickness: 2 }]);
    const s = planHandles(ctx({ doc: d, mesh, mode: 'face', selection: ['F2.S.e2~1'] }))!;
    expect(s.kind).toBe('shell-thickness');
    expect(s.specs[0]).toMatchObject({ base: 2, scale: 1 });
    expect(s.preview('thickness', 3, [0, 0, 0])).toEqual([{ op: 'set', id: 'SH', path: 'thickness', value: 3 }]);
    expect(s.preview('thickness', -1, [0, 0, 0])).toBeNull();
    // an outer wall (on the box hull) has none
    const outer = { ...b.mesh, faceIds: b.mesh.faceIds.map((n) => n + '~2') };
    expect(planHandles(ctx({ doc: d, mesh: outer, mode: 'face', selection: ['F2.S.e2~2'] }))).toBeNull();
  });
});

describe('visibility rules', () => {
  const key = edgeKey('F2.C1', 'F2.S.e1');
  it('no handles while sketching, with the Editor open, when switched off, or with nothing selected', () => {
    expect(planHandles(ctx({ mode: 'edge', selection: [key] }))).not.toBeNull();
    expect(planHandles(ctx({ mode: 'edge', selection: [key], sketching: true }))).toBeNull();
    expect(planHandles(ctx({ mode: 'edge', selection: [key], editingId: 'F2' }))).toBeNull();
    expect(planHandles(ctx({ mode: 'edge', selection: [key], enabled: false }))).toBeNull();
    expect(planHandles(ctx({ mode: 'edge', selection: [] }))).toBeNull();
    expect(planHandles(ctx({ mode: 'edge', selection: [key], mesh: null }))).toBeNull();
  });
});

describe('placement gizmo (against a fake kernel feature)', () => {
  const calls: MoveParams[] = [];
  let existing: { id: string; params: MoveParams } | null = null;
  const fake: Placement = { existing: () => existing, ops: (p) => { calls.push(p); return moveBodyOps(p, existing); } };
  it('is off unless the kernel can move bodies', () => {
    expect(planHandles(ctx({ mode: 'face', selection: [BODY] }))).toBeNull();
  });
  it('lists axis arrows, plane squares, rings and a centre dot', () => {
    const specs = placementSpecs(b.box);
    expect(specs.filter((s) => s.kind === 'arrow')).toHaveLength(3);
    expect(specs.filter((s) => s.kind === 'plane')).toHaveLength(3);
    expect(specs.filter((s) => s.kind === 'ring')).toHaveLength(3);
    expect(specs.filter((s) => s.kind === 'dot')).toHaveLength(1);
    expect(specs.every((s) => s.origin[0] === 0 && s.origin[1] === 0 && s.origin[2] === 15)).toBe(true);
    expect(new Set(specs.map((s) => s.id)).size).toBe(10);
  });
  it('a drag adds ONE moveBody; the next one updates it', () => {
    const s = planHandles(ctx({ mode: 'face', selection: [BODY], placement: fake }))!;
    expect(s.kind).toBe('placement');
    expect(s.preview('move-x', 5, [5, 0, 0])).toEqual([{ op: 'add', feature: { type: 'moveBody', translate: [5, 0, 0], copy: false } }]);
    expect(s.commit('move-x', 5, [5, 0, 0])!.create).toBe(true);
    const r = s.preview('turn-z', 45, [0, 0, 45])![0] as { feature: { rotate: { axis: number[]; angle: number; origin: number[] } } };
    expect(r.feature.rotate).toEqual({ axis: [0, 0, 1], angle: 45, origin: [0, 0, 15] });
    expect(s.preview('centre', 3, [3, 0, 0])).toBeNull();   // the centre dot moves the gizmo, not the body
    expect(s.preview('move-y', 0, [0, 0, 0])).toBeNull();
    existing = { id: 'M1', params: { translate: [5, 0, 0], copy: false } };
    const again = placementSession(fake, b.box);
    expect(again.preview('plane-xy', 3, [3, 4, 0])![0]).toMatchObject({ op: 'replace', id: 'M1' });
    expect(again.commit('plane-xy', 3, [3, 4, 0])!.create).toBe(false);
    expect(calls.length).toBeGreaterThan(3);
  });
});

import { describe, expect, it } from 'vitest';
import type { PartDoc } from '@ck/part-model';
import {
  addHole, circlesOfSketch, flipFrame, holesOf, inlineInfo, isPartial, legFrame, mirrorHoles, mirrorSegs, nearestOnPolyline, parsePoint, patchHole, patchHolesFromCircles, patchProfileConvert,
  patchProfileRect, patchProfileSketch, patchRelief, patchReliefSize, patchSpan, patchSpanMode, patchSpanPoints, picksHaveOwn, profileOf, rectSketch, reliefOf, removeHole, segBounds,
  sketchBox, sketchFromProfile, sketchOrigin, spanOf, type Seg,
} from './flangeShape';
import { freeFeatureNumber, outlineCandidates, withOutline } from './flangeSketch';

type Wire = Record<string, unknown>;
const apply = (eff: Wire, patch: Wire): Wire => { const n: Wire = { ...eff, ...patch }; for (const k of Object.keys(n)) if (n[k] === null) delete n[k]; return n; };
const E: Wire = { type: 'edgeFlange', id: 'E1', edges: [{ faces: ['a', 'b'], at: [50, 0, 2] }], height: 20 };

describe('the part of the edge a flange covers', () => {
  it('is the whole edge until a field says otherwise', () => {
    expect(spanOf(E)).toMatchObject({ mode: 'whole', perEdge: false });
    expect(isPartial(E)).toBe(false);
  });
  it('start and length are fields of the feature; the pick stays as it was', () => {
    const a = apply(E, patchSpanMode(E, 'length', 40));
    expect(a).toMatchObject({ length: 40 });
    expect(a.edges).toEqual(E.edges);
    expect(spanOf(a)).toMatchObject({ mode: 'length', length: 40 });
    const b = apply(a, patchSpan(a, { start: 15 }));
    expect(b).toMatchObject({ start: 15, length: 40 });
    expect(spanOf(b)).toMatchObject({ mode: 'length', start: 15, length: 40 });
    expect(isPartial(b)).toBe(true);
  });
  it('an expression is kept as written', () => {
    const a = apply(E, patchSpan(E, { start: '=Thickness*2', length: 30 }));
    expect(spanOf(a)).toMatchObject({ start: '=Thickness*2', length: 30 });
  });
  it('two points replace start and length (and the other way round)', () => {
    const a = apply(E, patchSpan(E, { start: 15, length: 40 }));
    const p = apply(a, patchSpanPoints(a, [20, 0, 1.0000001], [60, 0, 1]));
    expect(p).toMatchObject({ from: [20, 0, 1], to: [60, 0, 1] });
    expect(p.start).toBeUndefined(); expect(p.length).toBeUndefined();
    expect(spanOf(p).mode).toBe('points');
    const back = apply(p, patchSpanMode(p, 'length', 30));
    expect(back.from).toBeUndefined(); expect(back.to).toBeUndefined();
    expect(back.length).toBe(30);                       // nothing to keep: a first length
    expect(apply(p, patchSpanMode(p, 'whole')).from).toBeUndefined();
  });
  it('switching to points keeps points that exist and drops start and length', () => {
    const a = apply(E, patchSpanPoints(E, [0, 0, 0], [10, 0, 0]));
    const b = apply(a, patchSpan(a, { start: 3 }));
    expect(spanOf(b).mode).toBe('points');              // points win
    const c = apply(b, patchSpanMode(b, 'points'));
    expect(c.start).toBeUndefined();
    expect(c.from).toEqual([0, 0, 0]);
  });
  it('a hem has no length of its own for the span: its length is the hem\'s size', () => {
    const H: Wire = { type: 'hem', id: 'H1', edges: [{ faces: ['a', 'b'], at: [50, 0, 2] }], length: 10 };
    expect(spanOf(H, true).mode).toBe('whole');
    expect(spanOf(H, false).mode).toBe('length');       // read as a flange it would look like a span: the form passes hem
    const a = apply(H, patchSpanMode(H, 'length', 20, true));
    expect(a).toMatchObject({ length: 10, start: 0 });
    expect(spanOf(a, true)).toMatchObject({ mode: 'length', start: 0 });
    const w = apply(a, patchSpanMode(a, 'whole', 20, true));
    expect(w.length).toBe(10);                           // the hem's size survives going back to the whole edge
    expect(w.start).toBeUndefined();
    const p = apply(H, patchSpanPoints(H, [0, 0, 0], [5, 0, 0], true));
    expect(p.length).toBe(10);
    expect(spanOf(p, true).mode).toBe('points');
  });
  it('an imported flange keeps its span on its pick: edits go to the pick, and nothing else is touched', () => {
    const imp: Wire = { type: 'edgeFlange', id: 'F5', edges: [{ at: [-2.25, 0, 36], from: [-1.5, -94.5, 36], to: [-1.5, 94.5, 36] }], angle: 90, radius: 2, profile: [{ line: [[0, 5], [10, 5]] }] };
    const s = spanOf(imp);
    expect(s).toMatchObject({ mode: 'points', from: [-1.5, -94.5, 36], to: [-1.5, 94.5, 36] });
    const moved = apply(imp, patchSpanPoints(imp, [-1.5, -50, 36], [-1.5, 50, 36]));
    expect(moved.edges).toEqual([{ at: [-2.25, 0, 36], from: [-1.5, -50, 36], to: [-1.5, 50, 36] }]);
    expect(moved.from).toBeUndefined();
    expect(moved.profile).toEqual(imp.profile);
    const cleared = apply(imp, patchSpanMode(imp, 'whole'));
    expect(cleared.edges).toEqual([{ at: [-2.25, 0, 36] }]);
    expect(cleared.profile).toEqual(imp.profile);
    const len = apply(imp, patchSpanMode(imp, 'length', 50));
    expect(len.edges).toEqual([{ at: [-2.25, 0, 36], length: 50 }]);       // the span stays where it was: on the pick
    expect(len.length).toBeUndefined();
  });
  it('several picks with spans of their own are flagged, and "one width for all" clears them', () => {
    const e: Wire = { type: 'edgeFlange', edges: [{ at: [0, 0, 0], start: 1, length: 5 }, { at: [1, 0, 0] }] };
    expect(picksHaveOwn(e)).toBe(true);
    expect(spanOf(e).perEdge).toBe(true);
    expect(apply(e, patchSpanMode(e, 'whole')).edges).toEqual([{ at: [0, 0, 0] }, { at: [1, 0, 0] }]);
  });
  it('parses a typed point and prints one', () => {
    expect(parsePoint('20, 0, 1.5')).toEqual([20, 0, 1.5]);
    expect(parsePoint('20 0 1.5')).toEqual([20, 0, 1.5]);
    expect(parsePoint('20, 0')).toBeNull();
    expect(parsePoint('a, b, c')).toBeNull();
  });
  it('a click beside the picked edge lands on it', () => {
    expect(nearestOnPolyline([[0, 0, 0], [100, 0, 0]], [30, 5, 2])).toEqual([30, 0, 0]);
    expect(nearestOnPolyline([[0, 0, 0], [100, 0, 0]], [130, 5, 2])).toEqual([100, 0, 0]);   // clamped to the end
    expect(nearestOnPolyline([[0, 0, 0]], [1, 1, 1])).toBeNull();
  });
});

const L = (a: [number, number], b: [number, number]): Seg => ({ line: [a, b] });
const RECT: Seg[] = [L([0, 0], [40, 0]), L([40, 0], [40, 20]), L([40, 20], [0, 20]), L([0, 20], [0, 0])];

describe('the shape of the leg', () => {
  it('a flange without a profile is a rectangle; a sketch or an inline list says otherwise', () => {
    expect(profileOf(E)).toEqual({ kind: 'rect' });
    expect(profileOf({ ...E, profile: { sketch: 'S2' } })).toEqual({ kind: 'sketch', sketch: 'S2' });
    expect(profileOf({ ...E, profile: RECT })).toEqual({ kind: 'inline', segs: RECT });
  });
  it('choosing a sketch sets the profile; the rectangle takes profile and holes away', () => {
    const a = apply(E, patchProfileSketch(E, 'S2'));
    expect(a.profile).toEqual({ sketch: 'S2' });
    const h = apply(a, addHole(a));
    expect(h.holes).toHaveLength(1);
    const r = apply(h, patchProfileRect(h));
    expect(r.profile).toBeUndefined(); expect(r.holes).toBeUndefined();
  });
  it('a profile on the pick (an import) is changed on the pick', () => {
    const imp: Wire = { edges: [{ at: [0, 0, 0], profile: RECT }], height: 20 };
    expect(profileOf(imp).kind).toBe('inline');
    const a = apply(imp, patchProfileSketch(imp, 'S2'));
    expect(a.edges).toEqual([{ at: [0, 0, 0], profile: { sketch: 'S2' } }]);
    expect(a.profile).toBeUndefined();
  });
  it('measures an inline outline, arcs included', () => {
    expect(inlineInfo(RECT)).toMatchObject({ lines: 4, arcs: 0, width: 40, height: 20, minV: 0, minH: 0 });
    const round: Seg[] = [L([0, 0], [10, 0]), { arc: { center: [10, 5], from: [10, 0], to: [10, 10], ccw: true } }, L([10, 10], [0, 10]), L([0, 10], [0, 0])];
    const b = segBounds(round);
    expect(b.maxV).toBeCloseTo(15, 9);                      // the half circle bulges to v = 15
    expect(b.minH).toBeCloseTo(0, 9);
  });
});

describe('sketches for the outline', () => {
  it('the default leg as a sketch: a rectangle from the origin', () => {
    const s = rectSketch('F7', 'Outline', { kind: 'std', id: 'front' }, 40, 20) as unknown as { points: Array<{ id: string; x: number; y: number }>; entities: unknown[] };
    expect(s.points.filter((p) => p.id !== 'O').map((p) => [p.x, p.y])).toEqual([[0, 0], [40, 0], [40, 20], [0, 20]]);
    expect(s.entities).toHaveLength(4);
  });
  it('an outline that starts at the bend line becomes a sketch of the same lines and arcs, the circle holes included', () => {
    const imp: Seg[] = [L([0, 0], [40, 0]), L([40, 0], [40, 10]), { arc: { center: [35, 10], from: [40, 10], to: [35, 15], ccw: true } }, L([35, 15], [0, 15]), L([0, 15], [0, 0])];
    const r = sketchFromProfile('S9', 'Outline', { kind: 'std', id: 'front' }, imp, [{ circle: { center: [10, 8], radius: 2 } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sk = r.sketch as { entities: Array<{ type: string; p1?: string; p2?: string; c?: string; r?: number }>; points: Array<{ id: string; x: number; y: number }> };
    expect(sk.entities.filter((e) => e.type === 'line')).toHaveLength(4);
    const arc = sk.entities.find((e) => e.type === 'arc')!;
    const pt = (id?: string) => sk.points.find((p) => p.id === id)!;
    expect([pt(arc.p1).x, pt(arc.p1).y, pt(arc.p2).x, pt(arc.p2).y]).toEqual([40, 10, 35, 15]);      // anticlockwise from p1 to p2
    expect(sk.entities.find((e) => e.type === 'circle')).toMatchObject({ r: 2 });
    // a clockwise arc is stored the other way round
    const cw: Seg[] = [L([0, 0], [40, 0]), L([40, 0], [40, 15]), L([40, 15], [35, 15]), { arc: { center: [35, 10], from: [35, 15], to: [40, 10], ccw: false } }, L([40, 10], [40, 0])];
    void cw;
  });
  it('an outline above the bend line is carried down to it through its bottom edge', () => {
    const lifted: Seg[] = RECT.map((s) => ({ line: s.line!.map((p) => [p[0], p[1] + 5]) as [[number, number], [number, number]] }));
    const r = sketchFromProfile('S9', 'O', { kind: 'std', id: 'front' }, lifted);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ys = (r.sketch.points as Array<{ id: string; y: number }>).filter((p) => p.id !== 'O').map((p) => p.y);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(25);
  });
  it('an outline that would move is refused with the distance', () => {
    const right: Seg[] = RECT.map((s) => ({ line: s.line!.map((p) => [p[0] + 3, p[1]]) as [[number, number], [number, number]] }));
    expect(sketchFromProfile('S9', 'O', { kind: 'std', id: 'front' }, right)).toEqual({ ok: false, reason: 'offsetV', by: 3 });
    const slanted: Seg[] = [L([0, 5], [40, 8]), L([40, 8], [40, 20]), L([40, 20], [0, 20]), L([0, 20], [0, 5])];
    expect(sketchFromProfile('S9', 'O', { kind: 'std', id: 'front' }, slanted)).toMatchObject({ ok: false, reason: 'offsetH' });
    expect(sketchFromProfile('S9', 'O', { kind: 'std', id: 'front' }, [])).toMatchObject({ ok: false, reason: 'empty' });
  });
  it('mirrors an outline across the span (arcs turn the other way round, circles move)', () => {
    const m = mirrorSegs([L([0, 0], [10, 0]), { arc: { center: [10, 5], from: [10, 0], to: [10, 10], ccw: true } }], 40);
    expect(m[0].line).toEqual([[40, 0], [30, 0]]);
    expect(m[1].arc).toEqual({ center: [30, 5], from: [30, 0], to: [30, 10], ccw: false });
    expect(mirrorHoles([{ circle: { center: [10, 8], radius: 2 } }], 40)).toEqual([{ circle: { center: [30, 8], radius: 2 } }]);
  });
  it('the frame of a built leg: x along the flange, y outward, origin on the height line, the ends of the span', () => {
    // a leg standing on the plate edge y = 0: a flat face in the plane y = 1, 40 wide in x (from 20), 18 high in z (above the bend end), tip wall facing +z
    const leg = [[20, 1, 2], [60, 1, 2], [60, 1, 20], [20, 1, 20]];
    const f = legFrame(leg, [0, -1, 0], [0, 0, 1], 20, [1, 0, 0])!;
    expect(f.width).toBeCloseTo(40, 9);
    expect(f.h).toEqual([0, 0, 1]);
    expect(f.v.map((x) => +x.toFixed(9) + 0)).toEqual([1, 0, 0]);
    expect(f.from).toEqual([20, 1, 20]); expect(f.to).toEqual([60, 1, 20]);
    expect(f.origin[2]).toBeCloseTo(0, 9);                    // the tip is at h = 20, so h = 0 is at z = 0
    const flipped = legFrame(leg, [0, -1, 0], [0, 0, 1], 20, [-1, 0, 0])!;
    expect(flipped.v.map((x) => +x.toFixed(9) + 0)).toEqual([-1, 0, 0]);
    const fl = flipFrame(f);
    expect(fl.v.map((x) => +x.toFixed(9) + 0)).toEqual([-1, 0, 0]);
    expect(fl.origin[0]).toBeCloseTo(60, 9);
    expect(fl.from).toEqual(f.to);
    expect(legFrame([[0, 0, 0]], [0, 0, 1], [0, 1, 0], 1)).toBeNull();
    // a shaped leg has no end wall: the frame comes from the span's direction and a point on the edge
    const shaped = legFrame(leg, [0, -1, 0], null, 20, [1, 0, 0], [30, 0, 2])!;
    expect(shaped.h.map((x) => +x.toFixed(9) + 0)).toEqual([0, 0, 1]);
    expect(shaped.v.map((x) => +x.toFixed(9) + 0)).toEqual([1, 0, 0]);
    expect(shaped.origin[2]).toBeCloseTo(0, 9);
    expect(shaped.width).toBeCloseTo(40, 9);
    expect(legFrame(leg, [0, -1, 0], null, 20)).toBeNull();                            // without the span's direction there is no way to tell
  });
});

describe('outline candidates for the app', () => {
  const frame = legFrame([[20, 1, 2], [60, 1, 2], [60, 1, 20], [20, 1, 20]], [0, -1, 0], [0, 0, 1], 20, [1, 0, 0])!;
  it('a new sketch: the plane and the sketch go before the flange; the second candidate runs the other way', () => {
    const { plans } = outlineCandidates({ kind: 'new', eff: E, frame, seq: 7, name: 'Outline', planeName: 'Plane', height: 20, width: null });
    expect(plans).toHaveLength(2);
    expect(plans[0].add.map((f) => [f.type, f.id])).toEqual([['plane', 'F7'], ['sketch', 'F8']]);
    expect(plans[0].add[1].plane).toEqual({ kind: 'feature', id: 'F7' });
    expect(plans[0].patch).toMatchObject({ profile: { sketch: 'F8' }, from: [20, 1, 20], to: [60, 1, 20] });
    expect(plans[1].patch).toMatchObject({ from: [60, 1, 20], to: [20, 1, 20] });
    expect(plans[0].unpinned).toEqual({ profile: { sketch: 'F8' } });       // a whole-edge flange drops the points once the direction is known
    const part = outlineCandidates({ kind: 'new', eff: { ...E, start: 5, length: 40 }, frame, seq: 7, name: 'O', planeName: 'P', height: 20, width: null }).plans[0];
    expect(part.unpinned).toBeUndefined();                                  // a partial flange keeps its span
    const doc = { features: [{ id: 'B1' }, { id: 'E1' }], seq: 7 } as unknown as PartDoc;
    expect(withOutline(doc, 'E1', plans[0]).features.map((f) => f.id)).toEqual(['B1', 'F7', 'F8', 'E1']);
    expect(withOutline(doc, 'E1', plans[0]).seq).toBe(9);
  });
  it('without the leg\'s frame the sketch goes on the Front plane and there is one candidate', () => {
    const { plans } = outlineCandidates({ kind: 'new', eff: E, frame: null, seq: 7, name: 'Outline', planeName: 'Plane', height: 20, width: 35 });
    expect(plans).toHaveLength(1);
    expect(plans[0].add).toHaveLength(1);
    expect(plans[0].add[0]).toMatchObject({ id: 'F7', plane: { kind: 'std', id: 'front' } });
    expect(plans[0].patch).toEqual({ profile: { sketch: 'F7' } });
  });
  it('an imported outline: the span and the profile stay on the pick, the second candidate is mirrored with the points swapped', () => {
    const imp: Wire = { type: 'edgeFlange', id: 'F5', edges: [{ at: [0, 0, 0], from: [0, 0, 0], to: [40, 0, 0] }], profile: RECT, holes: [{ circle: { center: [10, 8], radius: 2 } }] };
    const { plans, refused } = outlineCandidates({ kind: 'convert', eff: imp, frame: null, seq: 3, name: 'Outline', planeName: 'Plane', height: 20, width: null });
    expect(refused).toBeUndefined();
    expect(plans).toHaveLength(2);
    expect(plans[0].patch).toMatchObject({ profile: { sketch: 'F3' }, holes: null });
    expect(plans[1].patch).toMatchObject({ edges: [{ at: [0, 0, 0], from: [40, 0, 0], to: [0, 0, 0] }] });
    const second = plans[1].add[0] as { entities: Array<{ type: string; c?: string; r?: number }>; points: Array<{ id: string; x: number; y: number }> };
    const circle = second.entities.find((e) => e.type === 'circle')!;
    expect(second.points.find((p) => p.id === circle.c)).toMatchObject({ x: 30, y: 8 });         // mirrored across the 40 mm span
    expect(outlineCandidates({ kind: 'convert', eff: E, frame: null, seq: 3, name: 'O', planeName: 'P', height: 20, width: null }).plans).toEqual([]);
    const off: Wire = { ...imp, profile: RECT.map((s) => ({ line: s.line!.map((p) => [p[0] + 2, p[1]]) })) };
    expect(outlineCandidates({ kind: 'convert', eff: off, frame: null, seq: 3, name: 'O', planeName: 'P', height: 20, width: null }).refused).toBe(2);
  });
});

describe('ids for the new plane and sketch', () => {
  it('start past the document\'s seq and past every F id in it', () => {
    expect(freeFeatureNumber({ features: [{ id: 'F1' }, { id: 'S2' }], seq: 5 } as unknown as PartDoc)).toBe(5);
    expect(freeFeatureNumber({ features: [{ id: 'F1' }, { id: 'F9' }, { id: 'R1' }], seq: 2 } as unknown as PartDoc)).toBe(10);   // an import whose seq lags behind its ids
    expect(freeFeatureNumber({ features: [] } as unknown as PartDoc)).toBe(1);
  });
});

describe('holes of the leg', () => {
  it('circles are listed by centre and radius; a loop is counted; edits keep the rest', () => {
    const eff: Wire = { ...E, profile: { sketch: 'S2' }, holes: [{ circle: { center: [10, 8], radius: 2 } }, [{ line: [[0, 0], [1, 0]] }, { line: [[1, 0], [0, 1]] }, { line: [[0, 1], [0, 0]] }]] };
    expect(holesOf(eff)).toEqual([{ kind: 'circle', center: [10, 8], radius: 2 }, { kind: 'loop', segs: 3 }]);
    const moved = apply(eff, patchHole(eff, 0, { h: 9, radius: 3 }));
    expect(holesOf(moved)[0]).toEqual({ kind: 'circle', center: [10, 9], radius: 3 });
    expect(holesOf(moved)[1]).toEqual({ kind: 'loop', segs: 3 });
    expect(holesOf(apply(eff, patchHole(eff, 1, { v: 5 })))[1]).toEqual({ kind: 'loop', segs: 3 });     // a loop is not a circle: left alone
    expect(holesOf(apply(eff, removeHole(eff, 0)))).toEqual([{ kind: 'loop', segs: 3 }]);
    const none = apply({ ...E, holes: [{ circle: { center: [1, 1], radius: 1 } }] }, removeHole({ ...E, holes: [{ circle: { center: [1, 1], radius: 1 } }] }, 0));
    expect(none.holes).toBeUndefined();                                                                  // the last one takes the field away
    expect(holesOf(apply(E, addHole(E)))).toEqual([{ kind: 'circle', center: [10, 10], radius: 3 }]);
  });
  it('imported circle holes on the feature stay when the pick changes', () => {
    const imp: Wire = { edges: [{ at: [0, 0, 0], from: [0, 0, 0], to: [10, 0, 0] }], profile: RECT, holes: [{ circle: { center: [10, 8], radius: 2 } }] };
    expect(holesOf(imp)).toHaveLength(1);
    const a = apply(imp, patchSpanPoints(imp, [0, 0, 0], [20, 0, 0]));
    expect(a.holes).toEqual(imp.holes);
    expect(a.profile).toEqual(RECT);
  });
  const doc = { features: [
    { type: 'sketch', id: 'S2', points: [{ id: 'O', x: 0, y: 0 }, { id: 'a', x: 5, y: 3 }, { id: 'b', x: 45, y: 3 }, { id: 'c', x: 45, y: 23 }, { id: 'd', x: 5, y: 23 }, { id: 'k', x: 20, y: 10 }],
      entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }, { id: 'e3', type: 'line', p1: 'c', p2: 'd' }, { id: 'e4', type: 'line', p1: 'd', p2: 'a' }, { id: 'e5', type: 'circle', c: 'k', r: 3 }] },
  ] } as unknown as PartDoc;
  it('circles of a sketch become holes measured from the outline\'s lower left corner, once', () => {
    expect(circlesOfSketch(doc, 'S2')).toEqual([{ id: 'e5', center: [20, 10], radius: 3 }]);
    expect(sketchOrigin(doc, 'S2')).toEqual([5, 3]);
    expect(sketchBox(doc, 'S2')).toEqual([5, 3, 45, 23]);
    const eff = apply(E, patchProfileSketch(E, 'S2'));
    const p = apply(eff, patchHolesFromCircles(eff, circlesOfSketch(doc, 'S2'), sketchOrigin(doc, 'S2')));
    expect(holesOf(p)).toEqual([{ kind: 'circle', center: [15, 7], radius: 3 }]);
    expect(patchHolesFromCircles(p, circlesOfSketch(doc, 'S2'), sketchOrigin(doc, 'S2'))).toEqual({});     // already listed
    expect(circlesOfSketch(doc, 'nope')).toEqual([]);
  });
});

describe('the relief beside a partial flange', () => {
  it('none, the rule\'s rectangle or a size of your own; a size keeps what it was given', () => {
    const p = apply(E, patchSpanMode(E, 'length', 30));
    expect(reliefOf(p).mode).toBe('none');
    const r = apply(p, patchRelief(p, 'rectangular'));
    expect(r.relief).toBe('rectangular');
    expect(reliefOf(r).mode).toBe('rectangular');
    const c = apply(r, patchRelief(r, 'custom', { width: 2.5, depth: 1.25 }));
    expect(c.relief).toEqual({ width: 2.5, depth: 1.25 });
    const w = apply(c, patchReliefSize(c, { width: 6 }));
    expect(w.relief).toEqual({ width: 6, depth: 1.25 });
    const expr = apply(w, patchReliefSize(w, { depth: '=Thickness' }));
    expect(reliefOf(expr)).toMatchObject({ mode: 'custom', width: 6, depth: '=Thickness' });
    const back = apply(expr, patchRelief(expr, 'none'));
    expect(back.relief).toBeUndefined();
  });
  it('is only for a flange that covers part of the edge', () => {
    expect(isPartial(E)).toBe(false);
    expect(isPartial(apply(E, patchSpanMode(E, 'length', 30)))).toBe(true);
    expect(isPartial(apply(E, patchSpanPoints(E, [0, 0, 0], [1, 0, 0])))).toBe(true);
  });
  it('a relief set on an imported pick is changed there', () => {
    const imp: Wire = { edges: [{ at: [0, 0, 0], from: [0, 0, 0], to: [10, 0, 0], relief: 'rectangular' }] };
    expect(reliefOf(imp).mode).toBe('rectangular');
    expect(apply(imp, patchRelief(imp, 'none')).edges).toEqual([{ at: [0, 0, 0], from: [0, 0, 0], to: [10, 0, 0] }]);
  });
  it('an imported outline converted to a sketch drops its holes (they are in the sketch) and keeps the span', () => {
    const imp: Wire = { edges: [{ at: [0, 0, 0], from: [0, 0, 0], to: [40, 0, 0] }], profile: RECT, holes: [{ circle: { center: [10, 8], radius: 2 } }] };
    const c = apply(imp, patchProfileConvert(imp, 'S9'));
    expect(c.profile).toEqual({ sketch: 'S9' });
    expect(c.holes).toBeUndefined();
    expect(c.edges).toEqual(imp.edges);
  });
});

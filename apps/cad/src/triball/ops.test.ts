import { describe, expect, it } from 'vitest';
import type { PartDoc } from '@ck/part-model';
import { axisAngle, compose, fromRigid, mulV, rotMat, specOf, toRigid, type MoveSpec } from './rigid';
import { bodyRefs, copyOps, copySource, existingMove, faceMoveOps, mirrorOps, mirrorPlaneId, motionOf, moveOps, repeatOps, shiftSketchOps, resolveTarget } from './ops';
import { WORLD_AXES } from '@kit/viewport';
import { DEFAULT_TRI_PREFS, loadTriPrefs, sanitizeTriPrefs, saveTriPrefs } from './triballPrefs';

const doc = (features: unknown[]): PartDoc => ({ name: 'p', features } as unknown as PartDoc);
const apply = (m: MoveSpec, p: [number, number, number]) => { const r = toRigid(m); const q = mulV(r.R, p); return [q[0] + r.t[0], q[1] + r.t[1], q[2] + r.t[2]]; };
const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 7));

describe('rigid motions', () => {
  it('axis and angle round trip, including a half turn and no turn', () => {
    for (const [axis, deg] of [[[0, 0, 1], 30], [[1, 2, 3], 120], [[0, 1, 0], 180], [[1, 1, 0], 179.9999999], [[0, 0, 1], 0]] as Array<[number[], number]>) {
      const n = Math.hypot(...axis);
      const back = axisAngle(rotMat(axis as never, deg));
      if (deg === 0) { expect(back.angle).toBe(0); continue; }
      expect(back.angle).toBeCloseTo(deg, 5);
      close(back.axis, axis.map((x) => x / n));
    }
  });
  it('composing two moves equals applying them in turn, with different centres and axes', () => {
    const a: MoveSpec = { translate: [3, -2, 1], rotate: { axis: [1, 0, 0], origin: [5, 5, 5], angle: 40 } };
    const b: MoveSpec = { translate: [0, 4, 0], rotate: { axis: [0, 1, 1], origin: [-3, 1, 2], angle: -75 } };
    const total = fromRigid(compose(toRigid(a), toRigid(b)));
    for (const p of [[1, 2, 3], [-4, 0, 9], [0, 0, 0]] as Array<[number, number, number]>) close(apply(total, p), apply(b, apply(a, p) as never));
  });
  it('reads a feature back, and refuses expressions', () => {
    expect(specOf({ translate: [1, 2, 3] })).toEqual({ translate: [1, 2, 3] });
    expect(specOf({ translate: ['=w', 0, 0] })).toBeNull();
    expect(specOf({ rotate: { axis: [0, 0, 1], angle: '=a' } })).toBeNull();
    expect(specOf({ rotate: { axis: [0, 0, 1], angle: 10 } })?.rotate?.origin).toEqual([0, 0, 0]);
  });
});

describe('what a move edits', () => {
  const move = { type: 'moveBody', id: 'M1', translate: [10, 0, 0], copy: false };
  it('adds a feature, or folds into the existing one only when it is the last, a move, not a copy, over the same bodies', () => {
    expect(moveOps(doc([{ type: 'extrude', id: 'F2' }]), { translate: [1, 0, 0] }, undefined)![0].op).toBe('add');
    const folded = moveOps(doc([{ type: 'extrude', id: 'F2' }, move]), { translate: [0, 5, 0] }, undefined)!;
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ op: 'replace', id: 'M1', feature: { translate: [10, 5, 0] } });
    expect(moveOps(doc([move, { type: 'fillet', id: 'F3' }]), { translate: [0, 5, 0] }, undefined)![0].op).toBe('add');                  // not the last
    expect(moveOps(doc([{ ...move, copy: true }]), { translate: [0, 5, 0] }, undefined)![0].op).toBe('add');                              // a copy
    expect(moveOps(doc([{ ...move, translate: ['=w', 0, 0] }]), { translate: [0, 5, 0] }, undefined)![0].op).toBe('add');               // an expression
    expect(moveOps(doc([{ ...move, bodies: [{ face: 'F2.C1' }] }]), { translate: [0, 5, 0] }, undefined)![0].op).toBe('add');            // other bodies
    expect(moveOps(doc([move]), { translate: [0, 5, 0] }, [{ face: 'F2.C1' }])![0].op).toBe('add');
  });
  it('editing a chosen move feature folds into it even when it is not the last', () => {
    const d = doc([move, { type: 'fillet', id: 'F3' }]);
    expect(existingMove(d, undefined, 'M1')?.id).toBe('M1');
    expect(moveOps(d, { translate: [0, 5, 0] }, undefined, 'M1')![0].op).toBe('replace');
    expect(existingMove(doc([{ type: 'fillet', id: 'F3' }]), undefined, 'F3')).toBeNull();
  });
  it('folding a rotation drops the rotate field again when the total is a pure move', () => {
    const rot = { type: 'moveBody', id: 'M1', translate: [0, 0, 0], rotate: { axis: [0, 0, 1], origin: [0, 0, 0], angle: 30 }, copy: false };
    const back = moveOps(doc([rot]), { translate: [0, 0, 0], rotate: { axis: [0, 0, 1], origin: [0, 0, 0], angle: -30 } }, undefined)!;
    expect((back[0] as unknown as { feature: Record<string, unknown> }).feature.rotate).toBeUndefined();
  });
  it('no motion makes no op', () => {
    expect(moveOps(doc([]), { translate: [0, 0, 0] }, undefined)).toBeNull();
    expect(copyOps({ translate: [0, 0, 1e-12] }, undefined)).toBeNull();
  });
  it('a gesture becomes a translation, or a rotation about the ball origin', () => {
    const f = { origin: [1, 2, 3] as [number, number, number], axes: WORLD_AXES };
    const v = { distance: 4, d1: 0, d2: 0, angle: 30, vec: [4, 0, 0] as [number, number, number], dir: [0, 0, 1] as [number, number, number] };
    expect(motionOf({ kind: 'axis', axis: 0 }, v, f)).toEqual({ translate: [4, 0, 0] });
    expect(motionOf({ kind: 'spin', axis: 2 }, v, f)).toEqual({ translate: [0, 0, 0], rotate: { axis: [0, 0, 1], origin: [1, 2, 3], angle: 30 } });
  });
  it('bodies: every lump until copies exist, then only the original', () => {
    expect(bodyRefs(['F2.C1', 'F2.S.e1'])).toBeUndefined();
    expect(bodyRefs(['F2.C1@M2.1', 'F2.C1'])).toEqual([{ face: 'F2.C1' }]);
    expect(copySource(['F2.C1@M2.1', 'F2.S.e1'])).toEqual([{ face: 'F2.S.e1' }]);
  });
  it('a pattern makes one copy per step from the original, spaced and turned as typed', () => {
    const lin = repeatOps({ kind: 'linear', number: 3, distance: 12, angle: 0, stepUp: 0, dir: [0, 2, 0], origin: [0, 0, 0] }, [{ face: 'A' }]);
    expect(lin.map((o) => (o as unknown as { feature: { translate: number[]; copy: boolean; bodies: unknown } }).feature)).toEqual([1, 2, 3].map((i) => ({ type: 'moveBody', bodies: [{ face: 'A' }], translate: [0, 12 * i, 0], copy: true })));
    const rad = repeatOps({ kind: 'radial', number: 2, distance: 0, angle: 60, stepUp: 1.5, dir: [0, 0, 1], origin: [5, 6, 0] }, undefined);
    expect(rad.map((o) => (o as unknown as { feature: { rotate: { angle: number; origin: number[] }; translate: number[] } }).feature)).toEqual([
      { type: 'moveBody', translate: [0, 0, 1.5], rotate: { axis: [0, 0, 1], origin: [5, 6, 0], angle: 60 }, copy: true },
      { type: 'moveBody', translate: [0, 0, 3], rotate: { axis: [0, 0, 1], origin: [5, 6, 0], angle: 120 }, copy: true },
    ]);
    expect(repeatOps({ kind: 'linear', number: 0, distance: 1, angle: 0, stepUp: 0, dir: [1, 0, 0], origin: [0, 0, 0] }, undefined)).toEqual([]);
  });
});

describe('faces, sketches, mirror', () => {
  it('a planar face is translated, a curved one offset; a repeat on the same faces updates the last feature', () => {
    expect(faceMoveOps(doc([]), ['A'], true, [0, 0, 1], 2)![0]).toMatchObject({ op: 'add', feature: { type: 'moveFace', mode: 'translate', translate: [0, 0, 2] } });
    expect(faceMoveOps(doc([]), ['A'], false, [0, 0, 1], 2)![0]).toMatchObject({ feature: { mode: 'offset', distance: 2 } });
    const d = doc([{ type: 'moveFace', id: 'M', faces: ['A'], mode: 'translate', translate: [0, 0, 2] }]);
    expect(faceMoveOps(d, ['A'], true, [0, 0, 1], 3)![0]).toMatchObject({ op: 'replace', id: 'M', feature: { translate: [0, 0, 5] } });
    expect(faceMoveOps(d, ['B'], true, [0, 0, 1], 3)![0].op).toBe('add');
    expect(faceMoveOps(d, ['A'], true, [0, 0, 1], 0)).toBeNull();
  });
  it('a sketch shifts by the in-plane part only, leaving fixed points', () => {
    const sk = { type: 'sketch', id: 'S', plane: { kind: 'std', id: 'top' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 1, y: 1 }] };
    const op = shiftSketchOps(doc([sk]), { id: 'S', o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, -1] }, [2, 7, 3])![0] as unknown as { feature: { points: Array<{ x: number; y: number }> } };
    expect(op.feature.points).toEqual([{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 3, y: -2 }]);
    expect(shiftSketchOps(doc([sk]), { id: 'S', o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, -1] }, [0, 9, 0])).toBeNull();
  });
  it('targets: a feature on a standard plane yields a sketch target; one on a face does not; edges never', () => {
    const d = doc([{ type: 'sketch', id: 'S', plane: { kind: 'std', id: 'right' }, points: [{ id: 'a', x: 2, y: 4 }] }, { type: 'extrude', id: 'E', sketch: 'S' },
      { type: 'sketch', id: 'S2', plane: { kind: 'face', id: 'E.C1' }, points: [{ id: 'a', x: 0, y: 0 }] }, { type: 'hole', id: 'H', sketch: 'S2' }]);
    const base = { doc: d, mode: 'face', mesh: { positions: [], normals: [], triFace: [], faceIds: [] }, box: { min: [0, 0, 0], max: [2, 2, 2] } };
    const r = resolveTarget({ ...base, selection: [], selectedFeature: 'E' });
    expect(r).toMatchObject({ ok: true, target: { kind: 'feature', sketch: { id: 'S', u: [0, 0, -1], v: [0, 1, 0] } } });
    expect(r.ok && r.target.frame.axes[2].map((x) => x + 0)).toEqual([1, 0, 0]);
    expect(resolveTarget({ ...base, selection: [], selectedFeature: 'H' })).toEqual({ ok: false, reason: 'feature' });
    expect(resolveTarget({ ...base, selection: ['a|b'], mode: 'edge', selectedFeature: null })).toEqual({ ok: false, reason: 'edges' });
    expect(resolveTarget({ ...base, doc: null as never, selection: [], selectedFeature: null })).toEqual({ ok: false, reason: 'noBody' });
  });
  it('mirror needs a standard plane through the origin; the copy mirrors the last solid feature', () => {
    const f = { origin: [0, 3, 4] as [number, number, number], axes: WORLD_AXES };
    expect(mirrorPlaneId(f, 0)).toBe('right'); expect(mirrorPlaneId(f, 1)).toBeNull(); expect(mirrorPlaneId({ ...f, origin: [0, 0, 0] }, 2)).toBe('front');
    expect(mirrorPlaneId({ origin: [0, 0, 0], axes: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]] }, 0)).toBe('top');
    expect(mirrorPlaneId({ origin: [0, 0, 0], axes: [[0.6, 0.8, 0], [-0.8, 0.6, 0], [0, 0, 1]] }, 0)).toBeNull();
    expect(mirrorOps(doc([{ type: 'sketch', id: 'S' }, { type: 'extrude', id: 'E' }, { type: 'sketch', id: 'S3' }]), 'right')![0]).toMatchObject({ feature: { type: 'mirror', seeds: ['E'], plane: { kind: 'std', id: 'right' }, body: true } });
    expect(mirrorOps(doc([{ type: 'sketch', id: 'S' }]), 'right')).toBeNull();
  });
});

describe('snap increments', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it('defaults to 10 mm and 15 degrees, keeps good values, drops bad ones, and round trips', () => {
    expect(sanitizeTriPrefs(null)).toEqual(DEFAULT_TRI_PREFS);
    expect(DEFAULT_TRI_PREFS.angle).toBe(15);
    expect(sanitizeTriPrefs({ distance: 2.5, angle: 45 })).toEqual({ distance: 2.5, angle: 45 });
    expect(sanitizeTriPrefs({ distance: -1, angle: 'x' })).toEqual(DEFAULT_TRI_PREFS);
    expect(sanitizeTriPrefs({ distance: 5, angle: 999 }).angle).toBe(180);
    const s = mem();
    saveTriPrefs({ distance: 5, angle: 30 }, s);
    expect(loadTriPrefs(s)).toEqual({ distance: 5, angle: 30 });
    expect(loadTriPrefs({ getItem: () => '{oops' })).toEqual(DEFAULT_TRI_PREFS);
  });
});

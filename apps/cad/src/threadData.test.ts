import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyOpsLocal, cylinderOfFace, holeThreadOps, holeThreadSize, holeWallFace, isHoleWall, nearestSizes, newThread, patchLength,
  patchSize, patchStandard, suggestedSize, threadOps, warningsById, type EdgeLike, type ThreadRow,
} from './threadData';

const row = (size: string, major: number, tapDrill: number, pitch = 1): ThreadRow => ({
  size, standard: 'metric', major, pitch, minorInternal: major - 1.0825 * pitch, minorExternal: major - 1.2269 * pitch, tapDrill, classInternal: '6H', classExternal: '6g',
});
const ROWS = [row('M4', 4, 3.3, 0.7), row('M5', 5, 4.2, 0.8), row('M6', 6, 5), row('M8', 8, 6.8, 1.25), row('M10', 10, 8.5, 1.5)];

/** A circle of 24 points around `c`, in the plane normal to `axis` ('y' or 'x'), closed. */
function circle(c: number[], r: number, axis: 'x' | 'y' | 'z' = 'y'): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const u = Math.cos(a) * r, v = Math.sin(a) * r;
    pts.push(axis === 'y' ? [c[0] + u, c[1], c[2] + v] : axis === 'x' ? [c[0], c[1] + u, c[2] + v] : [c[0] + u, c[1] + v, c[2]]);
  }
  return pts;
}
const edge = (key: string, faces: string[], pts: number[][]): EdgeLike => ({ key, faces, pts });
const line = (key: string, faces: string[]): EdgeLike => edge(key, faces, [[0, 0, 0], [10, 0, 0]]);

describe('cylinderOfFace', () => {
  const edges = [
    edge('a', ['F2.C0', 'F4.S.c1'], circle([20, 0, -20], 2.5)),
    edge('b', ['F2.C1', 'F4.S.c1'], circle([20, 20, -20], 2.5)),
    line('c', ['F2.C0', 'F2.S.e1']),
  ];
  it('reads radius and axis from the two circles of a cylinder wall', () => {
    const c = cylinderOfFace('F4.S.c1', edges)!;
    expect(c.radius).toBeCloseTo(2.5, 6);
    expect(Math.abs(c.axisDir[1])).toBeCloseTo(1, 6);
    expect(c.axisPoint[0]).toBeCloseTo(20, 6);
    expect(c.internal).toBeUndefined();   // the kernel decides
  });
  it('a flat face with a round hole (one circle) is not a cylinder', () => {
    expect(cylinderOfFace('F2.C0', edges)).toBeNull();
  });
  it('a hole wall by its name is internal', () => {
    const c = cylinderOfFace('F10.S.h1', [edge('a', ['F10.S.h1', 'F8.C0'], circle([5, 0, 5], 3.4)), edge('b', ['F10.S.h1', 'F10.S.h2'], circle([5, 14, 5], 3.4))])!;
    expect(c.internal).toBe(true);
    expect(c.radius).toBeCloseTo(3.4, 6);
    expect(isHoleWall('F10.S.h1')).toBe(true);
    expect(isHoleWall('F4.S.c1')).toBe(false);
  });
  it('a lone circle counts for a face named like a cylinder (a blind shaft with a dome)', () => {
    expect(cylinderOfFace('F4.S.c1', [edge('a', ['F4.S.c1', 'F4.C0'], circle([0, 0, 0], 5))])!.radius).toBeCloseTo(5, 6);
  });
  it('two circles of different radius (a cone) and a ring are not cylinders', () => {
    expect(cylinderOfFace('F4.S.x1', [edge('a', ['F4.S.x1'], circle([0, 0, 0], 5)), edge('b', ['F4.S.x1'], circle([0, 10, 0], 3))])).toBeNull();
    expect(cylinderOfFace('F2.C0', [edge('a', ['F2.C0'], circle([0, 0, 0], 5)), edge('b', ['F2.C0'], circle([0, 0, 0], 3))])).toBeNull();
  });
  it('lines, open arcs, other faces and no edges give null', () => {
    expect(cylinderOfFace('F4.S.c1', [line('l', ['F4.S.c1'])])).toBeNull();
    expect(cylinderOfFace('F4.S.c1', [edge('arc', ['F4.S.c1'], circle([0, 0, 0], 5).slice(0, 12))])).toBeNull();
    expect(cylinderOfFace('F9.S.c1', edges)).toBeNull();
    expect(cylinderOfFace('F4.S.c1', [])).toBeNull();
  });
  it('works for an axis along x', () => {
    const e = [edge('a', ['W'], circle([0, 1, 2], 4, 'x')), edge('b', ['W'], circle([30, 1, 2], 4, 'x'))];
    const c = cylinderOfFace('W', e)!;
    expect(Math.abs(c.axisDir[0])).toBeCloseTo(1, 6);
    expect(c.radius).toBeCloseTo(4, 6);
  });
});

describe('nearestSizes and the new thread', () => {
  it('internal: nearest tap drill; external: nearest major diameter', () => {
    expect(nearestSizes(ROWS, 6.8, true)[0].size).toBe('M8');
    expect(nearestSizes(ROWS, 8, false)[0].size).toBe('M8');
    expect(nearestSizes(ROWS, 5.1, true)[0].size).toBe('M6');
    expect(nearestSizes(ROWS, 5.1, false)[0].size).toBe('M5');
    expect(nearestSizes(ROWS, 5, undefined).slice(0, 2).map((r) => r.size).sort()).toEqual(['M5', 'M6']);   // unknown: either reading
  });
  it('newThread: metric, nearest size, full, right hand, cosmetic, the class of the reading', () => {
    expect(newThread('F4.S.c1', 5.05, ROWS, true)).toEqual({ type: 'thread', face: 'F4.S.c1', standard: 'metric', size: 'M6', class: '6H', length: 'full', hand: 'right', modeled: false });
    expect(newThread('F4.S.c1', 10, ROWS, false)).toMatchObject({ size: 'M10', class: '6g' });
    expect(newThread('F4.S.c1', 10, [], false)).toBeNull();
    expect(threadOps('F4.S.c1', 10, ROWS, false)).toEqual([{ op: 'add', feature: expect.objectContaining({ type: 'thread', size: 'M10' }) }]);
    expect(threadOps('F4.S.c1', 10, [], false)).toBeNull();
  });
});

describe('hole thread', () => {
  const hole = { type: 'hole', id: 'F10', sketch: 'F9', size: 'M8', fit: 'tap' };
  it('a tapped metric hole has a thread size, a plain one does not', () => {
    expect(holeThreadSize(hole)).toBe('M8');
    expect(holeThreadSize({ ...hole, fit: 'normal' })).toBeNull();
    expect(holeThreadSize({ ...hole, diameter: 5, size: undefined })).toBeNull();
  });
  it('the thread goes on the wall face S.h1 with the hole size', () => {
    expect(holeWallFace('F10')).toBe('F10.S.h1');
    expect(holeThreadOps(hole, ROWS)).toEqual([{ op: 'add', feature: { type: 'thread', face: 'F10.S.h1', standard: 'metric', size: 'M8', class: '6H', length: 'full', hand: 'right', modeled: false } }]);
    expect(holeThreadOps({ ...hole, fit: 'close' })).toBeNull();
  });
});

describe('patches', () => {
  it('size sets the size and the class of the reading', () => {
    expect(patchSize(ROWS[3], 'M8', true)).toEqual({ size: 'M8', class: '6H' });
    expect(patchSize(ROWS[3], 'M8', false)).toEqual({ size: 'M8', class: '6g' });
    expect(patchSize(undefined, 'M99', true)).toEqual({ size: 'M99' });
  });
  it('standard picks the nearest size of the new standard', () => {
    expect(patchStandard('metric', ROWS, 6.8, true)).toEqual({ standard: 'metric', size: 'M8', class: '6H' });
    expect(patchStandard('metric', ROWS, null, true)).toMatchObject({ size: 'M4' });
  });
  it('length: full, a number, or nothing for rubbish', () => {
    expect(patchLength('full')).toEqual({ length: 'full' });
    expect(patchLength(' 12.5 ')).toEqual({ length: 12.5 });
    expect(patchLength('')).toEqual({ length: 'full' });
    expect(patchLength('-3')).toBeNull();
    expect(patchLength('abc')).toBeNull();
  });
});

describe('warnings', () => {
  const list = [['F5', { code: 'threadDiameterMismatch', params: { hint: 'hole is 6.5, M6 tap drill is 5: drill the hole to 5, or choose M8 (tap drill 6.8)', nearest: 'M8' } }], ['F6', { code: 'threadModelFallback', params: { hint: 'tapered' } }], ['F6', { code: 'x', params: { hint: 'second' } }]];
  it('warningsById keeps the first per feature and joins the hints', () => {
    const w = warningsById(list);
    expect(Object.keys(w)).toEqual(['F5', 'F6']);
    expect(w.F5).toMatchObject({ code: 'threadDiameterMismatch', hint: expect.stringContaining('choose M8') });
    expect(w.F6.code).toBe('threadModelFallback');
    expect(w.F6.hint).toBe('tapered; second');
    expect(w.F6.all).toHaveLength(2);
  });
  it('rubbish gives nothing, a missing hint falls back to the code', () => {
    expect(warningsById(undefined)).toEqual({});
    expect(warningsById([['F1', { code: 'c' }], 7, ['F2']])).toMatchObject({ F1: { code: 'c', hint: 'c' }, F2: { code: 'warning' } });
  });
  it('suggestedSize reads nearest as a name, an object or a list', () => {
    expect(suggestedSize({ nearest: 'M8' })).toBe('M8');
    expect(suggestedSize({ nearest: { size: 'M8', tapDrill: 6.8 } })).toBe('M8');
    expect(suggestedSize({ nearest: ['M8', 'M10'] })).toBe('M8');
    expect(suggestedSize({})).toBeNull();
    expect(suggestedSize(null)).toBeNull();
  });
});

describe('applyOpsLocal', () => {
  const feats = [{ id: 'F1', type: 'sketch' }, { id: 'F5', type: 'thread', size: 'M6' }];
  it('add, set, replace, remove on a copy', () => {
    const out = applyOpsLocal(feats, [{ op: 'set', id: 'F5', path: 'size', value: 'M8' }, { op: 'add', feature: { type: 'thread', id: 'F6' } as never }])!;
    expect(out.map((f) => f.size ?? f.id)).toEqual(['F1', 'M8', 'F6']);
    expect(feats[1].size).toBe('M6');
    expect(applyOpsLocal(feats, [{ op: 'replace', id: 'F5', feature: { type: 'thread', size: 'M10' } as never }])![1]).toEqual({ type: 'thread', size: 'M10', id: 'F5' });
    expect(applyOpsLocal(feats, [{ op: 'remove', id: 'F5' }])).toHaveLength(1);
  });
  it('null for what it cannot do (nested path, unknown id, move)', () => {
    expect(applyOpsLocal(feats, [{ op: 'set', id: 'F5', path: 'a.b', value: 1 }])).toBeNull();
    expect(applyOpsLocal(feats, [{ op: 'set', id: 'Fx', path: 'a', value: 1 }])).toBeNull();
    expect(applyOpsLocal(feats, [{ op: 'move', id: 'F5', to: 0 }])).toBeNull();
  });
});

describe('the threaded-bolt sample', () => {
  const dir = resolve(process.cwd(), 'apps/cad/public/samples');
  it('is listed in index.json and holds a shaft thread and a tapped-hole thread', () => {
    const index = JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8')) as Array<{ id: string; file: string }>;
    const entry = index.find((e) => e.id === 'threaded-bolt')!;
    expect(entry.file).toBe('threaded-bolt.ckpart');
    const doc = JSON.parse(readFileSync(resolve(dir, entry.file), 'utf8')) as { features: Array<Record<string, unknown>> };
    const threads = doc.features.filter((f) => f.type === 'thread');
    expect(threads.map((f) => [f.face, f.size])).toEqual([['F4.S.c1', 'M10'], ['F10.S.h1', 'M8']]);
    expect(doc.features.find((f) => f.id === 'F10')).toMatchObject({ type: 'hole', size: 'M8', fit: 'tap' });
  });
});

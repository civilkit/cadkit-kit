import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLEARANCE_DEFAULT, CLEARANCE_MAX, applyOpsLocal, clearanceOf, cylinderOfFace, holeThreadOps, holeThreadSize, holeWallFace, isHoleWall, nearestSizes, newThread, patchLength,
  patchClearance, patchSize, patchStandard, suggestedSize, threadOps, warningsById, type EdgeLike, type ThreadRow,
} from './threadData';

// the editor's remembered choices live in localStorage and feed newThread (modeled): every test starts and ends without them, in any file order
const clearPrefs = (): void => { try { localStorage.clear(); } catch { /* none */ } };
beforeEach(clearPrefs);
afterEach(clearPrefs);

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

describe('printed-thread clearance', () => {
  it('a feature without the field has none; the sign is the direction', () => {
    expect(clearanceOf({})).toEqual({ dir: 'none', mm: 0 });
    expect(clearanceOf({ clearance: 0.2 })).toEqual({ dir: 'wider', mm: 0.2 });
    expect(clearanceOf({ clearance: -0.15 })).toEqual({ dir: 'narrower', mm: 0.15 });
    expect(clearanceOf({ clearance: 'x' })).toEqual({ dir: 'none', mm: 0 });
    expect(clearanceOf({ clearance: 5 }).mm).toBe(CLEARANCE_MAX);
  });
  it('patches: wider is positive, narrower negative, none removes the field, the size is held to its range', () => {
    expect(patchClearance('wider', 0.2)).toEqual({ clearance: 0.2 });
    expect(patchClearance('narrower', 0.1)).toEqual({ clearance: -0.1 });
    expect(patchClearance('none', 0.3)).toEqual({ clearance: null });
    expect(patchClearance('wider', 0)).toEqual({ clearance: 0.01 });
    expect(patchClearance('narrower', 9)).toEqual({ clearance: -CLEARANCE_MAX });
    expect(patchClearance('wider', NaN)).toEqual({ clearance: CLEARANCE_DEFAULT });
  });
  it('a new thread starts with no clearance', () => {
    expect(newThread('F1.S.c1', 6, ROWS, false)).not.toHaveProperty('clearance');
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
  it('the detail (what is wrong) comes before the hint (what to do)', () => {
    const w = warningsById([['F1', { code: 'unknownField', params: { detail: 'sketch has no field `origin`; it is ignored', fields: ['origin'], hint: 'check the field names' } }], ['F2', { code: 'unknownField', params: { detail: 'extrude has no field `x`; it is ignored' } }]]);
    expect(w.F1.hint).toBe('sketch has no field `origin`; it is ignored. check the field names');
    expect(w.F2.hint).toBe('extrude has no field `x`; it is ignored');
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

// ---- the polished editor's helpers ----
import {
  classOptions, clampLength, customLengthDefault, faceExtent, filterSizes, fitStatus, loadThreadPrefs, modelFallbackReason, quickSizes,
  readoutRows, rememberSize, saveThreadPrefs, sizeLabel, startMatters,
} from './threadData';
import { boxMesh } from './handles/testmesh';

describe('quickSizes', () => {
  it('the standard\'s short list, only sizes the table has; the last used size first (once)', () => {
    expect(quickSizes('metric', ROWS)).toEqual(['M4', 'M5', 'M6', 'M8', 'M10']);
    expect(quickSizes('metric', ROWS, 'M10')).toEqual(['M10', 'M4', 'M5', 'M6', 'M8']);
    expect(quickSizes('metric', ROWS, 'M5')).toEqual(['M5', 'M4', 'M6', 'M8', 'M10']);
    expect(quickSizes('metric', [], 'M10')).toEqual(['M10', 'M3', 'M4', 'M5', 'M6', 'M8', 'M12'].filter((s, i, a) => a.indexOf(s) === i));
    expect(quickSizes('metric', ROWS, 'M7')).toEqual(['M4', 'M5', 'M6', 'M8', 'M10']);     // a last size the table lacks is dropped
  });
  it('lists for the other standards use the kernel\'s names', () => {
    expect(quickSizes('UNC', [])).toEqual(['#6-32', '#8-32', '#10-24', '1/4-20', '5/16-18', '3/8-16', '1/2-13']);
    expect(quickSizes('BSP', [])).toEqual(['G1/8', 'G1/4', 'G3/8', 'G1/2']);
    expect(quickSizes('nope', [row('A', 1, 1), row('B', 2, 1)])).toEqual(['A', 'B']);
  });
});

describe('sizeLabel and filterSizes', () => {
  it('shows the pitch next to the size, coarse and fine', () => {
    expect(sizeLabel(row('M10', 10, 8.5, 1.5))).toBe('M10 × 1.5 coarse');
    expect(sizeLabel({ ...row('M10x1.25', 10, 8.7, 1.25), standard: 'metric-fine' })).toBe('M10 × 1.25 fine');
    expect(sizeLabel({ ...row('1/4-20', 6.35, 5.1, 1.27), standard: 'UNC' })).toBe('1/4-20 · 1.27 mm');
  });
  it('empty query: nearest to the diameter first; no diameter: table order', () => {
    expect(filterSizes(ROWS, '', 6.9, true).map((r) => r.size).slice(0, 2)).toEqual(['M8', 'M10']);
    expect(filterSizes(ROWS, '', null).map((r) => r.size)).toEqual(['M4', 'M5', 'M6', 'M8', 'M10']);
  });
  it('matches the name, then a name part, then the diameter', () => {
    const many = [...ROWS, row('M12', 12, 10.2, 1.75), row('M1', 1, 0.75, 0.25)];
    expect(filterSizes(many, 'm1', null).map((r) => r.size)).toEqual(['M10', 'M12', 'M1']);
    expect(filterSizes(many, '10', null).map((r) => r.size)).toEqual(['M10']);
    expect(filterSizes(many, '1', null).map((r) => r.size).sort()).toEqual(['M1', 'M10', 'M12']);
    expect(filterSizes(many, 'zzz', null)).toEqual([]);
    expect(filterSizes(many, ' M 8 ', null).map((r) => r.size)).toEqual(['M8']);
  });
  it('x and the multiplication sign are the same, so fine sizes can be typed', () => {
    const fine = [{ ...row('M10x1', 10, 9, 1), standard: 'metric-fine' }, { ...row('M10x1.25', 10, 8.7, 1.25), standard: 'metric-fine' }];
    expect(filterSizes(fine, '10 × 1.25', null).map((r) => r.size)).toEqual(['M10x1.25']);
    expect(filterSizes(fine, '10x1', null).map((r) => r.size)).toEqual(['M10x1', 'M10x1.25']);
  });
});

describe('readoutRows', () => {
  const m10 = row('M10', 10, 8.5, 1.5);
  it('a shaft: major, root (d3), pitch', () => {
    expect(readoutRows(m10, false).map((r) => r.key)).toEqual(['major', 'root', 'pitch']);
    expect(readoutRows(m10, false)[1].value).toBe('8.16 mm');
  });
  it('a hole: tap drill, minor (D1), pitch; unknown kind shows all four', () => {
    expect(readoutRows(m10, true).map((r) => r.key)).toEqual(['tapDrill', 'minor', 'pitch']);
    expect(readoutRows({ ...m10, tapDrillName: '#7' }, true)[0].value).toBe('8.5 mm (#7)');
    expect(readoutRows(m10, undefined).map((r) => r.key)).toEqual(['major', 'minor', 'tapDrill', 'pitch']);
  });
});

describe('classOptions', () => {
  it('internal first for a hole, external first for a shaft; keeps an unknown current one', () => {
    expect(classOptions(ROWS[0], undefined, true)).toEqual(['6H', '6g']);
    expect(classOptions(ROWS[0], undefined, false)).toEqual(['6g', '6H']);
    expect(classOptions(ROWS[0], '7H', true)).toEqual(['6H', '6g', '7H']);
    expect(classOptions(undefined, '7H')).toEqual(['7H']);
  });
});

describe('fitStatus', () => {
  const m10 = row('M10', 10, 8.5, 1.5);
  it('green for a known diameter; null when the face or the kind is unknown', () => {
    expect(fitStatus(10, false, m10, null)).toEqual({ ok: true, kind: 'shaft', face: 10, size: 'M10', against: 10 });
    expect(fitStatus(8.5, true, m10, null)).toEqual({ ok: true, kind: 'hole', face: 8.5, size: 'M10', against: 8.5 });
    expect(fitStatus(null, true, m10, null)).toBeNull();
    expect(fitStatus(10, undefined, m10, null)).toBeNull();
  });
  it('the kernel\'s mismatch warning wins, with its suggestion', () => {
    const w = { code: 'threadDiameterMismatch', hint: 'h', params: { nearest: ['M8', 'M6'] } };
    expect(fitStatus(10, false, m10, w)).toEqual({ ok: false, hint: 'h', suggest: 'M8' });
    expect(fitStatus(10, false, m10, { code: 'x', hint: 'all', all: [{ code: 'threadModelFallback', hint: 'f' }, w] })).toEqual({ ok: false, hint: 'h', suggest: 'M8' });
    expect(fitStatus(10, false, m10, { code: 'threadModelFallback', hint: 'f' })).toMatchObject({ ok: true });
  });
});

describe('length', () => {
  it('clampLength holds the value between one pitch and the face length', () => {
    expect(clampLength(12, 30, 1.5)).toBe(12);
    expect(clampLength(99, 30, 1.5)).toBe(30);
    expect(clampLength(0.2, 30, 1.5)).toBe(1.5);
    expect(clampLength(-4, 30)).toBe(0.1);
    expect(clampLength(99, null, 1)).toBe(99);
    expect(clampLength(5, 0.05, 1)).toBe(5);              // a nonsense face length does not pin the value
  });
  it('the Custom start is 8 pitches, held to the face', () => {
    expect(customLengthDefault(1.5, 30)).toBe(12);
    expect(customLengthDefault(1.5, 6)).toBe(6);
    expect(customLengthDefault(undefined, null)).toBe(8);
  });
  it('model fallback reason: only when asked for, the entry is cosmetic, and the kernel said why', () => {
    const w = { code: 'threadModelFallback', hint: 'NPT is tapered' };
    expect(modelFallbackReason(true, false, w)).toBe('NPT is tapered');
    expect(modelFallbackReason(true, false, { code: 'x', hint: 'a', all: [w] })).toBe('NPT is tapered');
    expect(modelFallbackReason(true, true, w)).toBeNull();
    expect(modelFallbackReason(false, false, w)).toBeNull();
    expect(modelFallbackReason(true, false, null)).toBeNull();
  });
});

describe('faceExtent', () => {
  // a vertical shaft wall `S.c1`: circles at y = 0 and y = 30, a cap on top (normal +y), a shoulder below (normal -y... pointing away from the shaft)
  const ring = (y: number) => circle([0, y, 0], 5, 'y');
  const edges: EdgeLike[] = [{ key: 'a', faces: ['S.c1', 'CAP'], pts: ring(30) }, { key: 'b', faces: ['S.c1', 'SHOULDER'], pts: ring(0) }];
  const mesh = (capN: number, shN: number) => {
    const b = boxMesh([-5, 0, -5], [5, 30, 5], 'S');
    // reuse a box only for its mesh arrays: rename the +y and -y faces to the CAP and the SHOULDER, with the wanted normals
    const ids = b.mesh.faceIds.map((n) => (n === 'S.S.e3' ? 'CAP' : n === 'S.S.e1' ? 'SHOULDER' : n));
    const normals = Array.from(b.mesh.normals);
    Array.from(b.mesh.triFace).forEach((fi, t) => { const n = b.mesh.faceIds[fi]; if (n === 'S.S.e3' || n === 'S.S.e1') for (let k = 0; k < 3; k++) { normals[t * 9 + k * 3] = 0; normals[t * 9 + k * 3 + 1] = n === 'S.S.e3' ? capN : shN; normals[t * 9 + k * 3 + 2] = 0; } });
    return { ...b.mesh, faceIds: ids, normals };
  };
  it('length along the axis, from the circles', () => {
    expect(faceExtent('S.c1', edges, null)).toEqual({ length: 30, open: null });
    expect(faceExtent('nope', edges, null)).toBeNull();
  });
  it('open ends: a plane across the end whose normal points to the extent is closed (shoulder, blind bottom)', () => {
    // top cap faces away (+y): open; the shoulder at the bottom faces up into the shaft (+y): closed
    expect(faceExtent('S.c1', edges, mesh(1, 1))!.open).toEqual([false, true]);
    expect(faceExtent('S.c1', edges, mesh(-1, -1))!.open).toEqual([true, false]);
    expect(faceExtent('S.c1', edges, mesh(1, -1))!.open).toEqual([true, true]);
  });
  it('Start matters for both open or neither, or when unknown', () => {
    expect(startMatters(null)).toBe(true);
    expect(startMatters({ length: 3, open: null })).toBe(true);
    expect(startMatters({ length: 3, open: [true, true] })).toBe(true);
    expect(startMatters({ length: 3, open: [false, false] })).toBe(true);
    expect(startMatters({ length: 3, open: [true, false] })).toBe(false);
  });
});

describe('remembered choices', () => {
  it('round-trip through localStorage and survive a broken one', () => {
    localStorage.clear();
    expect(loadThreadPrefs()).toEqual({});
    saveThreadPrefs({ modeled: true });
    rememberSize('metric', 'M10');
    rememberSize('UNC', '1/4-20');
    expect(loadThreadPrefs()).toEqual({ modeled: true, lastSize: { metric: 'M10', UNC: '1/4-20' } });
    localStorage.setItem('ck.thread.prefs', '{broken');
    expect(loadThreadPrefs()).toEqual({});
    localStorage.clear();
  });
});

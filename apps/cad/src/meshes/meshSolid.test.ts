// Convert mesh to solid, the pure part: options -> request, reply -> report / refusal, the preview body, the marks, number formatting.
import { describe, expect, it } from 'vitest';
import type { ViewSurface } from '@kit/viewport';
import { meshToStl, readStl } from '@kit/io';
import { cube } from '../../../../packages/io/src/testmesh';
import { base64ToBytes, meshRecFromStl } from './meshDoc';
import {
  DEFAULT_MESH_SOLID_OPTIONS, MAX_TRIANGLES, MESH_SOLID_TAG, PREVIEW_ID, crossLines, fmtArea, fmtDeviation, fmtLength, fmtMs, fmtPercent, fmtVolume, marksOf,
  meshSolidRequest, parseTol, suggestDecimateTol, previewSurface, readOutcome, requestOpts, runMeshToSolid, plainNum, triangleLimit, withPreview, worldMesh,
  type MeshSolidOptions,
} from './meshSolid';

const opts = (o: Partial<MeshSolidOptions> = {}): MeshSolidOptions => ({ ...DEFAULT_MESH_SOLID_OPTIONS, ...o });
const box = () => meshRecFromStl(readStl(meshToStl({ positions: cube(10) }).data as Uint8Array), 'mesh1', 'Box', 'mm');

describe('requestOpts: only what the user changed goes to the kernel', () => {
  it('the defaults send no opts at all', () => {
    expect(requestOpts(opts())).toBeUndefined();
  });
  it('close on with nothing else changed is `close: true`', () => {
    expect(requestOpts(opts({ close: true }))).toEqual({ close: true });
  });
  it('close sub-options become an object; switched-off sub-options are not sent', () => {
    expect(requestOpts(opts({ close: true, closeTolerance: 0.05, maxHoleEdges: 40 }))).toEqual({ close: { tolerance: 0.05, maxHoleEdges: 40 } });
    expect(requestOpts(opts({ close: true, fill: false, maxHoleEdges: 40 }))).toEqual({ close: { fill: false } });
    // close off: its sub-options stay home
    expect(requestOpts(opts({ close: false, closeTolerance: 0.05, fill: false }))).toBeUndefined();
  });
  it('advanced tolerances and the analytic switch', () => {
    expect(requestOpts(opts({ planeTol: 0.01, angleTolDeg: 1, fitTol: 0.02, analytic: false }))).toEqual({ planeTol: 0.01, angleTolDeg: 1, fitTol: 0.02, analytic: false });
  });
  it('field text: empty is the default, junk and zero are invalid, edges must be whole', () => {
    expect(parseTol('')).toEqual({ value: null, invalid: false });
    expect(parseTol(' 0.5 ')).toEqual({ value: 0.5, invalid: false });
    expect(parseTol('0').invalid).toBe(true);
    expect(parseTol('-1').invalid).toBe(true);
    expect(parseTol('abc').invalid).toBe(true);
    expect(parseTol('12.5', true).invalid).toBe(true);
    expect(parseTol('12', true)).toEqual({ value: 12, invalid: false });
  });
  it('the triangle limit: warn above 20k, refuse above the kernel limit', () => {
    expect(triangleLimit(12)).toBe('ok');
    expect(triangleLimit(20000)).toBe('ok');
    expect(triangleLimit(50000)).toBe('warn');
    expect(triangleLimit(MAX_TRIANGLES)).toBe('warn');
    expect(triangleLimit(MAX_TRIANGLES + 1)).toBe('over');
  });
});

describe('meshSolidRequest and worldMesh', () => {
  it('sends the welded mesh as little-endian base64 on the preview tag', () => {
    const rec = box();
    const m = meshSolidRequest(worldMesh(rec), opts({ close: true }), { name: 'Box' });
    expect(m).toMatchObject({ type: 'meshToSolid', tag: MESH_SOLID_TAG, name: 'Box', opts: { close: true } });
    const v = new Float32Array(base64ToBytes(m.positionsF32 as string).buffer);
    const i = new Uint32Array(base64ToBytes(m.indicesU32 as string).buffer);
    expect(v.length).toBe(8 * 3);
    expect(i.length).toBe(12 * 3);
    expect(Math.max(...v)).toBe(10);
    expect('opts' in meshSolidRequest(worldMesh(rec), opts(), { name: 'Box' })).toBe(false);
  });
  it('applies the placement, so the solid lands where the mesh is drawn', () => {
    const rec = { ...box(), pos: [100, 0, 0] as [number, number, number], rot: [0, 0, 90] as [number, number, number], scale: 2 };
    const v = worldMesh(rec).vertices;
    const xs: number[] = [], ys: number[] = [];
    for (let k = 0; k < v.length; k += 3) { xs.push(v[k]); ys.push(v[k + 1]); }
    // 10 mm cube, doubled, turned 90 degrees about Z (x -> y, y -> -x), then moved 100 along X
    expect(Math.min(...xs)).toBeCloseTo(80, 4); expect(Math.max(...xs)).toBeCloseTo(100, 4);
    expect(Math.min(...ys)).toBeCloseTo(0, 4); expect(Math.max(...ys)).toBeCloseTo(20, 4);
  });
  it('an unplaced record is sent as it is (no copy)', () => {
    const rec = box();
    expect(worldMesh(rec).vertices.length).toBe(24);
  });
});

const IMPORT = {
  format: 'mesh', triangles: 128, faces: 3, faceTypes: { cylinder: 1, plane: 2 }, flipped: 2, collapsed: 0,
  volume: { mesh: 780.33, body: 785.398, relative: 0.0065 },
  analytic: { applied: true, faceted: 0, fitted: [{ kind: 'cylinder' }], declined: [] },
  deviation: { max: 0.02397, rms: 0.01446 },
};

describe('Decimate: the request and the report', () => {
  it('goes into opts.decimate only when on and with a tolerance; the target and the crease angle only when set', () => {
    expect(requestOpts(opts({ decimate: false, decimateTol: 0.1 }))).toBeUndefined();
    expect(requestOpts(opts({ decimate: true, decimateTol: null }))).toBeUndefined();
    expect(requestOpts(opts({ decimate: true, decimateTol: 0.1 }))).toEqual({ decimate: { tol: 0.1 } });
    expect(requestOpts(opts({ decimate: true, decimateTol: 0.05, decimateTarget: 15000, decimateKeepAngle: 30 }))).toEqual({ decimate: { tol: 0.05, targetTriangles: 15000, keepAngleDeg: 30 } });
    expect(requestOpts(opts({ decimate: true, decimateTol: 0.05, close: true }))).toEqual({ decimate: { tol: 0.05 }, close: true });
  });
  it('the triangle limit rises to the input cap with it on, and still warns above 20 000', () => {
    expect(triangleLimit(250000)).toBe('over');
    expect(triangleLimit(250000, true)).toBe('warn');
    expect(triangleLimit(2_500_000, true)).toBe('over');
    expect(triangleLimit(5000, true)).toBe('ok');
  });
  it('a starting tolerance is 0.05 percent of the diagonal, two digits, at least 0.001 mm; none without a size', () => {
    expect(suggestDecimateTol(200)).toBe(0.1);
    expect(suggestDecimateTol(1234)).toBe(0.62);
    expect(suggestDecimateTol(1)).toBe(0.001);
    expect(suggestDecimateTol(undefined)).toBeNull();
    expect(suggestDecimateTol(0)).toBeNull();
  });
  it('the reply\'s import.decimation is read into the report', () => {
    const decimation = { triangles: 14800, vertices: 7400, inputTriangles: 120000, inputVertices: 60000, tol: 0.1, stoppedBy: 'tolerance', deviation: { max: 0.043, rms: 0.01 } };
    const o = readOutcome({ ok: true, result: { body: {}, import: { faces: 9, faceTypes: { plane: 9 }, decimation } } }, 4000);
    expect(o.ok && o.report.decimation).toEqual({ inputTriangles: 120000, triangles: 14800, tol: 0.1, deviation: 0.043, stoppedBy: 'tolerance' });
    const none = readOutcome({ ok: true, result: { body: {}, import: { faces: 9, faceTypes: { plane: 9 } } } }, 0);
    expect(none.ok && none.report.decimation).toBeNull();
  });
});

describe('readOutcome: the reply as the panel shows it', () => {
  it('a solid: faces by kind, faceted count, deviation, volume, repairs, time', () => {
    const o = readOutcome({ ok: true, result: { errors: [], body: { faces: [] }, import: IMPORT } }, 180);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.report).toMatchObject({
      triangles: 128, faces: 3, diagonal: 0, kinds: { planar: 2, faceted: 0, cylinder: 1, cone: 0, sphere: 0, other: 0 }, analyticSkipped: null, budgetExhausted: false,
      deviation: { max: 0.02397, rms: 0.01446 }, volume: { mesh: 780.33, body: 785.398, relative: 0.0065 }, closing: null, ms: 180,
      repairs: [{ key: 'flipped', n: 2 }],
    });
  });
  it('kinds the panel has no row for count as other, and so do faces the counts leave out', () => {
    const o = readOutcome({ ok: true, result: { body: {}, import: { faces: 9, faceTypes: { plane: 4, torus: 2 } } } }, 0);
    expect(o.ok && o.report.kinds).toEqual({ planar: 4, faceted: 0, cylinder: 0, cone: 0, sphere: 0, other: 5 });
  });
  it('the facets left on curved areas are told apart from the true planes (the kernel counts them as planes)', () => {
    const o = readOutcome({ ok: true, result: { body: {}, import: { faces: 32550, faceTypes: { plane: 32550 }, analytic: { applied: true, faceted: 32548 } } } }, 0);
    expect(o.ok && o.report.kinds).toMatchObject({ planar: 2, faceted: 32548 });
  });
  it('an analytic fit that did not run says why', () => {
    const o = readOutcome({ ok: true, result: { body: {}, import: { faces: 6, faceTypes: { plane: 6 }, analytic: { applied: false, reason: 'analytic: false', faceted: 0 } } } }, 0);
    expect(o.ok && o.report.analyticSkipped).toBe('analytic: false');
  });
  it('closing: the invented geometry with the place of each filled hole', () => {
    const closing = { tol: 0.0017, openEdges: 4, mergedVertices: 0, stitched: 0, filledHoles: 1, filledTriangles: 2, filledArea: 100, holes: [{ edges: 4, area: 100, planar: true, method: 'ear', at: [10, 5, 5] }] };
    const o = readOutcome({ ok: true, result: { body: {}, import: { ...IMPORT, closing } } }, 5);
    expect(o.ok && o.report.closing).toEqual({ openEdges: 4, mergedVertices: 0, stitched: 0, filledHoles: 1, filledTriangles: 2, filledArea: 100, holes: [{ edges: 4, area: 100, planar: true, method: 'ear', at: [10, 5, 5] }] });
    expect(marksOf(o)).toEqual([{ kind: 'hole', at: [10, 5, 5] }]);
  });
  it('a refusal keeps the kernel text verbatim and the places it names', () => {
    const params = { message: '4 open edges in 1 gap(s): the mesh does not enclose a volume', hint: 'close the holes in a mesh tool', openEdges: 4, positions: [[10, 5, 0], [10, 10, 5], 'junk'] };
    const o = readOutcome({ ok: true, result: { errors: [['import', { code: 'meshNotWatertight', params }]], body: null } }, 12);
    expect(o).toEqual({ ok: false, refusal: { code: 'meshNotWatertight', message: params.message, hint: params.hint, reason: null, positions: [[10, 5, 0], [10, 10, 5]], holes: [], ms: 12 } });
    expect(marksOf(o).map((m) => m.kind)).toEqual(['gap', 'gap']);
  });
  it('failed holes come first in the marks, then the positions', () => {
    const params = { message: 'm', hint: 'h', reason: 'edges', holes: [{ code: 'meshHoleTooLarge', reason: 'edges', edges: 600, area: 12, at: [1, 2, 3] }, { reason: 'area', edges: 8 }], positions: [[4, 5, 6]] };
    const o = readOutcome({ ok: true, result: { errors: [['import', { code: 'meshHoleTooLarge', params }]] } }, 0);
    expect(!o.ok && 'refusal' in o && o.refusal.holes).toEqual([{ reason: 'edges', edges: 600, area: 12, at: [1, 2, 3] }, { reason: 'area', edges: 8, area: null, at: null }]);
    expect(marksOf(o)).toEqual([{ kind: 'failed', at: [1, 2, 3] }, { kind: 'gap', at: [4, 5, 6] }]);
  });
  it('a trap, a transport error and a missing body are failures, never a throw', () => {
    expect(readOutcome({ trap: 'unreachable' }, 0)).toEqual({ ok: false, failed: 'unreachable' });
    expect(readOutcome({ ok: false, error: { message: 'unknown request type' } }, 0)).toEqual({ ok: false, failed: 'unknown request type' });
    expect(readOutcome({ ok: true, result: { errors: [] } }, 0)).toEqual({ ok: false, failed: 'the kernel answered without a body' });
    expect(readOutcome(null, 0)).toMatchObject({ ok: false });
  });
  it('runMeshToSolid: a throwing kernel is a failure', async () => {
    const o = await runMeshToSolid({ request: async () => { throw new Error('worker gone'); } }, worldMesh(box()), opts(), { name: 'Box' });
    expect(o).toEqual({ ok: false, failed: 'worker gone' });
  });
});

describe('the preview in the viewport', () => {
  const body = { faces: [{ id: 'mesh.F0' }], mesh: { positions: new Float32Array(9), normals: new Float32Array(9), triFace: new Int32Array(1) }, edges: [{ key: 'mesh.E0', pts: [[0, 0, 0], [1, 0, 0]] }], box: { min: [0, 0, 0], max: [1, 1, 0] } };
  it('the body becomes a surface entry whose names cannot meet the part`s', () => {
    const s = previewSurface(body)!;
    expect(s.id).toBe(PREVIEW_ID);
    expect(s.mesh.faceIds).toEqual(['m2s:mesh.F0']);
    expect(s.edges[0].key).toBe('m2s:mesh.E0');
    expect(previewSurface({ faces: [], mesh: { positions: new Float32Array(0) } })).toBeNull();
  });
  it('is attached beside the part, the box grows, and a part without a body gets one to carry it', () => {
    const s = previewSurface(body)!;
    const part = { mesh: { triFace: new Int32Array(3) }, box: { min: [-5, -5, -5], max: [0, 0, 0] }, surfaces: [] as ViewSurface[] };
    const out = withPreview(part, s)!;
    expect(out.surfaces!.map((x) => x.id)).toEqual([PREVIEW_ID]);
    expect(out.box).toEqual({ min: [-5, -5, -5], max: [1, 1, 0] });
    expect(withPreview(withPreview(part, s), s)!.surfaces!.length).toBe(1);
    const alone = withPreview(null, s)!;
    expect(alone.box).toEqual(body.box);
    expect(withPreview(part, null)).toBe(part);
  });
  it('a cross is three segments through the point', () => {
    const l = crossLines([1, 2, 3], 0.5);
    expect(l.length).toBe(6);
    expect(l[0]).toEqual([0.5, 2, 3]);
    expect(l[5]).toEqual([1, 2, 3.5]);
  });
});

// numbers never wrap: the thousands and the unit are joined by no-break spaces (written `_` here)
const nb = (x: string | null): string | null => (x === null ? null : x.replace(/\u00a0/g, '_'));
describe('numbers in the display unit', () => {
  it('significant digits as plain decimals, never in exponent form', () => {
    expect(plainNum(0.023969)).toBe('0.024');
    expect(plainNum(0.019, 2)).toBe('0.019');
    expect(plainNum(785.398)).toBe('785');
    expect(plainNum(1.5)).toBe('1.5');
    expect(nb(plainNum(12345.6))).toBe('12_346');
    expect(plainNum(1.6e-7)).toBe('0.00000016');
    expect(plainNum(1.6e-15)).toBe('0');   // beyond twelve decimals: nothing a length here can mean
    expect(plainNum(-0.5)).toBe('-0.5');
    expect(plainNum(0)).toBe('0');
  });
  it('lengths, areas and volumes in mm or inches', () => {
    expect(nb(fmtLength(0.023969))).toBe('0.024_mm');
    expect(nb(fmtLength(25.4, 'in'))).toBe('1_in');
    expect(nb(fmtArea(100))).toBe('100_mm²');
    expect(nb(fmtVolume(8000))).toBe('8_000_mm³');
    expect(nb(fmtVolume(1000, 'cm'))).toBe('1_cm³');
  });
  it('deviation: rounding noise of an exact conversion is no number at all', () => {
    expect(fmtDeviation(3.2e-15)).toBeNull();
    expect(fmtDeviation(5e-7)).toBeNull();
    expect(fmtDeviation(0.001, 'mm', 17.3)).toBeNull();          // under 1e-4 of the size
    expect(nb(fmtDeviation(0.0193, 'mm', 17.3))).toBe('0.019_mm');
    expect(nb(fmtDeviation(0.0254, 'in'))).toBe('0.001_in');
  });
  it('relative change as a signed percent, null when it rounds to nothing', () => {
    expect(nb(fmtPercent(0.006454))).toBe('+0.65_%');
    expect(nb(fmtPercent(-0.0004))).toBe('-0.040_%');
    expect(fmtPercent(5.7e-16)).toBeNull();
  });
  it('time', () => {
    expect(nb(fmtMs(180.4))).toBe('180_ms');
    expect(nb(fmtMs(2400))).toBe('2.4_s');
    expect(nb(fmtMs(42000))).toBe('42_s');
  });
});

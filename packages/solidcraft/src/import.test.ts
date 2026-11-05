import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importSolidcraft, importSolidcraftDocument, type EdgeResolver, type FaceResolver } from './import';

// Sample files are not part of this repository: they are read from the corpus folder next to the kit (cadkit/corpus/solidcraft, see its
// README) and the tests that need them are skipped when it is absent. Everything else here builds its documents in the test.
const CORPUS = join(process.cwd(), '..', 'corpus', 'solidcraft');
const have = existsSync(CORPUS);
const FILES: Record<string, string> = { 'slot-fillet-no-fillet': 'from-app/slot-fillet-no-fillet', 'sample-plate': 'from-app/Sample Plate' };
const fixture = (n: string) => new Uint8Array(readFileSync(join(CORPUS, `${FILES[n] ?? n}.solidcraft`)));

describe('slot file (sketch, extrude, box cut)', { skip: !have }, () => {
  it('converts every feature, closes the profile by merging coincident points, and flips the cut', async () => {
    const r = await importSolidcraft(fixture('slot-fillet-no-fillet'), 'slot');
    expect(r.refused).toBeUndefined();
    expect(r.rows.map((x) => `${x.type}:${x.status}`)).toEqual(['sketch:converted', 'extrude:converted', 'box:converted']);
    expect(r.geometryComplete).toBe(true);
    const f = r.part!.features as Array<Record<string, any>>;
    const sk = f.find((x) => x.type === 'sketch')!;
    // two lines and two arcs, five coincident pairs merged: origin + 8 distinct points would be 11 -> 4 corner points + 2 arc centres
    expect(sk.entities.map((e: any) => e.type)).toEqual(['line', 'arc', 'line', 'arc']);
    const used = new Set(sk.entities.flatMap((e: any) => [e.p1, e.p2]));
    expect(used.size).toBe(4);   // each arc/line end is shared with its neighbour
    expect(sk.plane).toEqual({ kind: 'std', id: 'right' });
    const ex = f.filter((x) => x.type === 'extrude');
    expect(ex[0]).toMatchObject({ op: 'add', end: 'blind', depth: 14 });
    expect(ex[0].flip).toBeUndefined();
    expect(ex[1]).toMatchObject({ op: 'cut', depth: 20, flip: true });   // a cut goes against the plane normal; the box cuts upwards
  });
});

describe('sample plate (parameters, offset planes, a cut, a fillet)', { skip: !have }, () => {
  it('without the kernel the fillet is reported and kept as a placeholder', async () => {
    const r = await importSolidcraft(fixture('sample-plate'), 'plate');
    const fillet = r.rows.find((x) => x.type === 'fillet')!;
    expect(fillet.status).toBe('unsupported');
    expect(fillet.reason).toMatch(/kernel/);
    expect(r.geometryComplete).toBe(false);
    expect(r.summary).toMatchObject({ converted: 8, unsupported: 1 });
    const ph = (r.part!.features as Array<Record<string, any>>).find((x) => x.type === 'importedUnsupported')!;
    expect(ph).toMatchObject({ suppressed: true, name: 'Fillet1' });
    expect(ph.original.radius).toBe('6 mm');
  });
  it('evaluates parameter expressions: depth "thickness" is 8, the bore depth "thickness + 14 mm" is 22 and goes down', async () => {
    const r = await importSolidcraft(fixture('sample-plate'), 'plate', { placeholders: false });
    const ex = (r.part!.features as Array<Record<string, any>>).filter((x) => x.type === 'extrude');
    expect(ex.map((e) => [e.op, e.depth, !!e.flip])).toEqual([['add', '=thickness', false], ['cut', '=thickness', true], ['add', 14, false], ['cut', '=thickness+14', false]]);   // parameters stay live (4ddfbee): the depth is the expression; its value (8, 22) is checked against the kernel in import.kernel.test.ts
    // the boss and bore sketches sit on offset planes at 8 and 22
    const planes = (r.part!.features as Array<Record<string, any>>).filter((x) => x.type === 'plane').map((p) => p.offset);
    expect(planes).toEqual([8, 22]);
  });
  it('a resolver supplies the fillet edges', async () => {
    let asked: unknown[] = [];
    const resolver: EdgeResolver = async (_part, points) => { asked = points; return points.map((p) => ({ faces: ['a', 'b'], at: p })); };
    const r = await importSolidcraft(fixture('sample-plate'), 'plate', { resolver });
    expect(r.geometryComplete).toBe(true);
    expect(asked).toHaveLength(4);
    const fl = (r.part!.features as Array<Record<string, any>>).find((x) => x.type === 'fillet')!;
    expect(fl.radius).toBe(6);
    expect(fl.edges).toHaveLength(4);
  });
  it('a resolver that finds nothing leaves the fillet out with the reason', async () => {
    const r = await importSolidcraft(fixture('sample-plate'), 'plate', { resolver: async (_p, pts) => pts.map(() => null) });
    expect(r.rows.find((x) => x.type === 'fillet')).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/not found/) });
  });
});

describe('what is refused or reported', () => {
  it('components become inserted parts placed by their occurrence transform (rows are the images of the axes, translation last); a joint is reported as skipped', async () => {
    const box = { id: 3, name: 'Box1', type: 'box', component: 1, corner: [0, 0, 0], length: '10', width: '10', height: '10', operation: 'new_body' };
    const r = await importSolidcraftDocument({
      format: 'solidcraft/30', units: 'mm', features: [box], components: [{ id: 1, name: 'Leaf', parent: 0 }],
      // turned 90 degrees about their X axis, then moved by (0, 29, 37)
      occurrences: [{ id: 2, component: 1, name: 'Leaf:1', grounded: false, transform: [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 29, 37, 1]] }],
      assembly: { joints: [{ id: 1, name: 'Hinge', kind: 'revolute' }] },
    }, 'asm');
    const ins = r.part!.features.find((f) => f.type === 'insertPart') as Record<string, any>;
    expect(ins.fixed).toBe(false);
    expect(ins.place).toEqual({ o: [0, 37, -29], x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] });
    expect(ins.part.features.some((f: any) => f.type === 'extrude' || f.type === 'box')).toBe(true);
    expect(r.rows.find((x) => x.name === 'Hinge')).toMatchObject({ status: 'skipped' });
    expect(r.geometryComplete).toBe(true);
  });
  it('an older file is the bare JSON document, with or without a byte order mark', async () => {
    const json = JSON.stringify({ format: 'solidcraft/1', units: 'mm', params: [], features: [] });
    for (const text of [json, '\n  ' + json, '\ufeff' + json]) {
      const r = await importSolidcraft(new TextEncoder().encode(text), 'old');
      expect(r.refused, JSON.stringify(text.slice(0, 6))).toBeUndefined();
      expect(r.part?.features).toEqual([]);
    }
    expect((await importSolidcraft(new TextEncoder().encode('{"format": '), 'old')).refused).toMatch(/not valid JSON/);
  });
  it('not a zip, no document, bad JSON, wrong format, wrong units', async () => {
    expect((await importSolidcraft(new Uint8Array([1, 2, 3]), 'x')).refused).toMatch(/not a SolidCraft file/);
    expect((await importSolidcraftDocument({ format: 'other/1', features: [] }, 'x')).refused).toMatch(/unknown document format/);
    expect((await importSolidcraftDocument({ format: 'solidcraft/30', units: 'in', features: [] }, 'x')).refused).toMatch(/only mm/);
    expect((await importSolidcraftDocument({ format: 'solidcraft/30' } as never, 'x')).refused).toMatch(/no feature list/);
    expect((await importSolidcraftDocument({ format: 'solidcraft/30', params: [{ name: 'a', expr: 'b' }], features: [] }, 'x')).refused).toMatch(/parameter/);
    // a parameter listed before the one it uses is fine; a cycle and an undefined name are still refused
    const ok = await importSolidcraftDocument({ format: 'solidcraft/30', params: [{ name: 'a', expr: 'b+1' }, { name: 'b', expr: '2' }], features: [] }, 'x');
    expect(ok.refused).toBeUndefined();
    expect((await importSolidcraftDocument({ format: 'solidcraft/30', params: [{ name: 'a', expr: 'b' }, { name: 'b', expr: 'a' }], features: [] }, 'x')).refused).toMatch(/parameter/);
  });
  const sketch = (id: number, extra: Record<string, unknown> = {}) => ({
    id, name: `S${id}`, type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XY' },
    sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [10, 0] }, { id: 'p3', pos: [10, 10] }, { id: 'p4', pos: [0, 10] }],
      curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }],
      constraints: [{ id: 'k1', type: 'coincident', p: 0, q: 1 }, { id: 'k2', type: 'horizontal', l: 0 }, { id: 'k3', type: 'vertical', l: 1 }, { id: 'k4', type: 'length', l: 0, value: 10, param: 'd1' }], ...extra },
  });
  const extrude = (id: number, sk: number, over: Record<string, unknown> = {}) => ({ id, name: `E${id}`, type: 'extrude', suppressed: false, sketch: sk, profiles: { type: 'all' }, operation: 'new_body', extent: { convention: 'total_distance', direction: 'positive', distance: '5' }, ...over });
  const doc = (features: unknown[]) => ({ format: 'solidcraft/30', units: 'mm', params: [], features });

  it('Z-up to Y-up: a sketch on their ground plane XY is on our top plane, one on XZ is on front with the normal reversed, YZ is right', async () => {
    const on = (name: string) => ({ ...sketch(1), plane: { type: 'origin', name } });
    const planes: Record<string, unknown> = {};
    for (const n of ['XY', 'XZ', 'YZ']) planes[n] = (await importSolidcraftDocument(doc([on(n), extrude(2, 1)]), 'p')).part!.features;
    expect((planes.XY as any[])[0].plane).toEqual({ kind: 'std', id: 'top' });
    expect((planes.XZ as any[])[0].plane).toEqual({ kind: 'std', id: 'front' });
    expect((planes.YZ as any[])[0].plane).toEqual({ kind: 'std', id: 'right' });
    // XY: their positive extrude runs along our +Y (up), no flip. XZ: their normal is our -Z, so the same extrude is flipped.
    expect((planes.XY as any[])[1].flip).toBeUndefined();
    expect((planes.XZ as any[])[1].flip).toBe(true);
    // XZ mirrors the sketch plane (their y is our -y): points are mirrored and an arc runs the other way round
    const arc = { ...on('XZ'), sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'a', pos: [2, 0] }, { id: 'b', pos: [0, 2] }, { id: 'c', pos: [0, 0] }], curves: [{ id: 'a1', type: 'arc', a: 1, b: 2, c: 3 }], constraints: [] } };
    const sk = (await importSolidcraftDocument(doc([arc]), 'a')).part!.features[0] as Record<string, any>;
    expect(sk.points.find((p: any) => p.id === 'p2')).toMatchObject({ x: 0, y: -2 });
    // their arc runs counter-clockwise from (2, 0) to (0, 2); on the mirrored plane it starts at the mirror of its END, so the ends swap
    const at = (id: string) => { const q = sk.points.find((x: any) => x.id === id); return [q.x, q.y]; };
    expect([at(sk.entities[0].p1), at(sk.entities[0].p2)]).toEqual([[0, -2], [2, 0]]);
    // their YZ plane (x = +Y, y = +Z) is our right plane as it is: nothing swaps, so a horizontal stays horizontal
    const yz = { ...on('YZ'), sketch: { ...sketch(1).sketch, constraints: [{ id: 'k', type: 'horizontal', l: 0 }] } };
    expect((await importSolidcraftDocument(doc([yz]), 'y')).part!.features[0]).toMatchObject({ constraints: [{ type: 'horizontal' }] });
    // the plane that does swap: their XZ keeps x but reverses y (no swap either), so only a face plane turned a quarter does; see the face-plane tests
  });
  it('constraints: horizontal, vertical, length are carried; coincident merges; the origin point is the sketch origin', async () => {
    const r = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1)]), 'sq');
    const sk = (r.part!.features as Array<Record<string, any>>)[0];
    expect(sk.constraints.map((k: any) => k.type)).toEqual(['horizontal', 'vertical', 'distance']);
    expect(sk.constraints[2]).toMatchObject({ value: 10 });
    expect(sk.entities[0].p1).toBe('O');   // p1 is coincident with the origin
    expect(r.summary.notes).toBe(0);
  });
  it('an unknown constraint is dropped with a note; the feature still converts', async () => {
    const r = await importSolidcraftDocument(doc([sketch(1, { constraints: [{ id: 'k', type: 'tangent', p: 0, q: 1 }] }), extrude(2, 1)]), 'sq');
    expect(r.rows[0]).toMatchObject({ status: 'converted', notes: [expect.stringMatching(/tangent constraint dropped/)] });
    expect(r.summary.notes).toBe(1);
  });
  it('a spline is carried: through its points (fit) or as the control polygon of a B-spline (control), sharing the ends with the line that closes it', async () => {
    const pts = [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [10, 0] }, { id: 'p3', pos: [8, 5] }, { id: 'p4', pos: [2, 5] }];
    const withSpline = (spline: Record<string, unknown>) => sketch(1, { points: pts, curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 's1', type: 'spline', construction: false, pts: [2, 3, 4, 1], ...spline }], constraints: [] });
    const fit = await importSolidcraftDocument(doc([withSpline({ control: false }), extrude(2, 1)]), 'f');
    expect(fit.geometryComplete).toBe(true);
    expect((fit.part!.features[0] as Record<string, any>).entities[1]).toEqual({ id: 'e2', type: 'spline', pts: ['p2', 'p3', 'p4', 'p1'] });
    const cv = await importSolidcraftDocument(doc([withSpline({ control: true, degree: 3, closed: false }), extrude(2, 1)]), 'c');
    expect(cv.geometryComplete).toBe(true);
    expect((cv.part!.features[0] as Record<string, any>).entities[1]).toEqual({ id: 'e2', type: 'cvspline', pts: ['p2', 'p3', 'p4', 'p1'], degree: 3 });
    // a spline of one point cannot be drawn
    expect((await importSolidcraftDocument(doc([withSpline({ pts: [2] })]), 'x')).rows[0].reason).toMatch(/sketch curve "spline"/);
  });
  it('a cut with profiles "all" on a sketch that holds an outline around other shapes gets a note; a plain sketch or a join does not', async () => {
    const withCircle = sketch(2, { points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [10, 0] }, { id: 'p3', pos: [10, 10] }, { id: 'p4', pos: [0, 10] }, { id: 'p5', pos: [5, 5] }],
      curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }, { id: 'c1', type: 'circle', c: 5, r: 2 }] });
    const r = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1), withCircle, extrude(3, 2, { operation: 'cut' }), extrude(4, 2, { operation: 'join' }), sketch(5), extrude(6, 5, { operation: 'cut' })]), 'n');
    const note = (name: string) => r.rows.find((x) => x.name === name)?.notes ?? [];
    expect(note('E3')).toEqual([expect.stringMatching(/all profiles selected; the file does not name the regions/)]);
    expect(note('E4')).toEqual([]);
    expect(note('E6')).toEqual([]);
  });
  it('a control-vertex spline used as a sweep path is sampled from its B-spline curve (clamped: ends on the end control points, the middle inside the polygon); a fit spline keeps its points', async () => {
    const pts = [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [0, 15] }, { id: 'p3', pos: [30, 30] }, { id: 'p4', pos: [0, 45] }];
    const path = (spline: Record<string, unknown>) => sketch(1, { points: pts, curves: [{ id: 's1', type: 'spline', pts: [1, 2, 3, 4], ...spline }], constraints: [] });
    const imp = async (spline: Record<string, unknown>) => {
      const r = await importSolidcraftDocument(doc([path(spline)]), 'p');
      return { row: r.rows[0], s3: r.part!.features.find((f) => f.type === 'sketch3d') as Record<string, any> };
    };
    const fit = await imp({ control: false });
    expect(fit.s3.points).toHaveLength(4);
    expect(fit.row.notes ?? []).toEqual([]);
    const cv = await imp({ control: true, degree: 3 });
    expect(cv.s3.entities[0].type).toBe('spline');
    expect(cv.s3.points.length).toBeGreaterThan(8);
    expect(cv.row.notes).toEqual([expect.stringMatching(/control-vertex spline path \(degree 3\)/)]);
    const P = cv.s3.points as Array<Record<string, number>>, first = P[0], last = P[P.length - 1];
    // clamped: the ends are the first and last control points (their y is our -z or +z: the sketch lies in their XY plane)
    expect([first.x, first.y, Math.abs(first.z)]).toEqual([0, 0, 0]);
    expect(Math.hypot(last.x, last.y, Math.abs(last.z) - 45)).toBeLessThan(1e-9);
    // the curve follows the polygon without reaching its corner: sideways offset (their x) peaks well below 30 but above 5
    const side = Math.max(...P.map((q) => Math.abs(q.x)));
    expect(side).toBeLessThan(30);
    expect(side).toBeGreaterThan(5);
    // a degree that needs more points than the sketch has is reported
    const tooHigh = await importSolidcraftDocument(doc([path({ control: true, degree: 5 })]), 'p');
    expect(tooHigh.rows[0].status).toBe('unsupported');
  });
  describe('imported geometry (a STEP body kept by a converter)', () => {
    const STEP = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
    const sha = async (t: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, '0')).join('');
    const imp = (over: Record<string, unknown> = {}) => ({ id: 3, name: 'Original', type: 'import', suppressed: false, step: '', step_blob: 'blobs/x.step', ...over });
    const blob = async (p: string) => (p === 'blobs/x.step' ? new TextEncoder().encode(STEP) : null);
    it('becomes an importStep feature holding the STEP text, turned to Y up, with the sketches kept after it', async () => {
      const r = await importSolidcraftDocument(doc([imp(), sketch(4)]), 'x', { blob });
      expect(r.rows[0]).toMatchObject({ status: 'converted', notes: [expect.stringMatching(/STEP body stored in the file/)] });
      expect(r.rows[1].status).toBe('converted');
      const f = r.part!.features as Array<Record<string, any>>;
      const key = await sha(STEP);
      expect(f[0]).toMatchObject({ type: 'importStep', id: 'F1', blob: key });
      expect(f[1]).toMatchObject({ type: 'moveBody', bodies: [{ feature: 'F1' }], rotate: { axis: 'x', angle: -90 } });
      expect(f[2].type).toBe('sketch');
      expect(r.part!.blobs).toEqual({ [key]: STEP });
      expect(r.geometryComplete).toBe(true);
    });
    it('inline STEP text works without an archive; the same text twice is one blob', async () => {
      const r = await importSolidcraftDocument(doc([imp({ step: STEP, step_blob: undefined }), imp({ id: 9, step: STEP, step_blob: undefined, name: 'Again' })]), 'x');
      expect(Object.keys(r.part!.blobs!)).toHaveLength(1);
      expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted']);
      // two bodies: both are named, so what comes later can find them
      const f = (r.part!.features as Array<Record<string, any>>).filter((x) => x.type === 'importStep');
      expect(f.map((x) => x.body)).toEqual(['Body1', 'Body2']);
    });
    it('without the data it is reported (not as "no feature") and kept as a placeholder; a suppressed one is skipped', async () => {
      const r = await importSolidcraftDocument(doc([imp(), sketch(4)]), 'x');
      expect(r.rows[0]).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/STEP data could not be read/) });
      expect(r.rows[0].reason).not.toMatch(/no feature/);
      expect(r.rows[1].status).toBe('converted');
      expect((r.part!.features as Array<Record<string, any>>)[0].type).toBe('importedUnsupported');
      expect(r.part!.blobs).toBeUndefined();
      const bad = await importSolidcraftDocument(doc([imp()]), 'x', { blob: async () => new TextEncoder().encode('not step') });
      expect(bad.rows[0].status).toBe('unsupported');
      expect((await importSolidcraftDocument(doc([imp({ suppressed: true })]), 'x')).rows[0].status).toBe('skipped');
    });
  });
  it('an unsupported sketch takes its extrude with it, and the numbering of the rest is intact', async () => {
    const bad = sketch(1); bad.sketch.curves[0] = { id: 'l1', type: 'conic', a: 1, b: 2 } as never;
    const r = await importSolidcraftDocument(doc([bad, extrude(2, 1), sketch(3), extrude(4, 3)]), 'x');
    expect(r.rows.map((x) => x.status)).toEqual(['unsupported', 'unsupported', 'converted', 'converted']);
    expect(r.rows[1].reason).toMatch(/depends on sketch 1/);
    const types = (r.part!.features as Array<Record<string, any>>).map((x) => x.type);
    expect(types).toEqual(['importedUnsupported', 'importedUnsupported', 'sketch', 'extrude']);
    const ids = (r.part!.features as Array<Record<string, any>>).map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('a cut with nothing to cut, an unknown operation and a suppressed feature are reported', async () => {
    const r = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1), sketch(3), extrude(4, 3, { operation: 'imprint' }), { ...sketch(5), suppressed: true }]), 'x');
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted', 'converted', 'unsupported', 'skipped']);
    expect(r.rows[3].reason).toMatch(/operation "imprint"/);
    const first = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1, { operation: 'cut' })]), 'x');
    expect(first.rows[1].reason).toMatch(/nothing to cut/);
  });
  it('a name a rename freed (format 33) is skipped by the counter of unnamed bodies', async () => {
    const make = async (extra: object) => ((await importSolidcraftDocument({ ...doc([sketch(1), extrude(2, 1, { operation: 'new_body' }), sketch(3), extrude(4, 3, { operation: 'new_body' })]), ...extra }, 'x')).part!.features as Array<Record<string, any>>).filter((x) => x.op === 'newBody').map((x) => x.body);
    expect(await make({ reserved_body_names: ['Body2'] })).toEqual(['Body1', 'Body3']);
    expect(await make({})).toEqual(['Body1', 'Body2']);   // a file saved before format 33 has no such list and keeps the plain counter
  });
  it('a scale of a named body becomes a scale feature: their axes are turned into ours (their y is our z), `factors` wins over the dead `factor`', async () => {
    const r = await importSolidcraftDocument(doc([
      sketch(1), extrude(2, 1, { body_names: ['Shaft'] }),
      { id: 3, name: 'Scale1', type: 'scale', suppressed: false, bodies: ['Shaft'], factor: '1', factors: ['1', '1.5', '2'], origin: [10, 20, 30] },
      { id: 4, name: 'Scale2', type: 'scale', suppressed: false, bodies: ['Shaft'], factor: '2', origin: [0, 0, 0] },
      { id: 5, name: 'Same', type: 'scale', suppressed: false, bodies: ['Shaft'], factors: ['1', '1', '1'], origin: [0, 0, 0] },
      { id: 6, name: 'Nobody', type: 'scale', suppressed: false, bodies: ['Gone'], factor: '2', origin: [0, 0, 0] },
    ]), 'x');
    const f = r.part!.features as Array<Record<string, any>>;
    expect(f.find((x) => x.name === 'Scale1')).toMatchObject({ type: 'scale', bodies: [{ body: 'Shaft' }], factor: [1, 2, 1.5], at: [10, 30, -20] });
    expect(f.find((x) => x.name === 'Scale2')).toMatchObject({ type: 'scale', factor: 2, at: [0, 0, 0] });
    expect(f.find((x) => x.name === 'Same')).toBeUndefined();   // a factor of one changes nothing
    expect(r.rows.find((x) => x.name === 'Nobody')).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/does not exist/) });
  });
  it('a component\'s move of a body transferred into it runs where the body was made (the transfer is not a copy), when both sit at the identity', async () => {
    const id4 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const make = async (occ: number[][]) => importSolidcraftDocument({
      ...doc([
        sketch(1), extrude(2, 1, { body_names: ['A'] }),
        { id: 3, name: 'Transfer', type: 'body_transfer', suppressed: false, component: 5, from: 0, to: 5, bodies: ['A'], transform: id4 },
        { id: 4, name: 'Nudge', type: 'move', suppressed: false, component: 5, bodies: ['A'], translate: ['5', '0', '0'] },
      ]),
      components: [{ id: 5, name: 'Arm' }], occurrences: [{ id: 9, name: 'Arm1', component: 5, transform: occ }], assembly: { joints: [] },
    }, 'x');
    const r = await make(id4);
    expect(r.rows.find((x) => /Nudge/.test(x.name))).toMatchObject({ status: 'converted' });
    const f = r.part!.features as Array<Record<string, any>>;
    expect(f.find((x) => x.name === 'Nudge')).toMatchObject({ type: 'moveBody', bodies: [{ body: 'A' }], translate: [5, 0, 0] });
    const arm = f.find((x) => x.type === 'insertPart')!.part.features as Array<Record<string, any>>;
    expect(arm.some((x) => x.type === 'moveBody')).toBe(false);
    // a component placed away from the origin keeps the old behaviour: the move cannot be done in the part that has no such body
    const placed = await make([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [10, 0, 0, 1]]);
    expect(placed.rows.find((x) => /Nudge/.test(x.name))).toMatchObject({ status: 'unsupported' });
  });
  it('several bodies: new bodies are named newBody lumps; a targeted cut, move, combine and remove refer to them by name', async () => {
    const r = await importSolidcraftDocument(doc([
      sketch(1), extrude(2, 1, { body_names: ['Block'] }),
      sketch(3), extrude(4, 3, { body_names: ['Peg'] }),
      sketch(5), extrude(6, 5, { operation: 'cut', targets: ['Block'] }),
      { id: 7, name: 'Move1', type: 'move', suppressed: false, bodies: ['Peg'], translate: ['30', '0', '0'], copy: true, body_names: ['Peg2'] },
      { id: 8, name: 'Turn', type: 'move', suppressed: false, bodies: ['Peg2'], translate: ['0', '40', '0'], rotate_axis: [0, 0, 1], angle: '90 deg' },
      { id: 9, name: 'Combine1', type: 'combine', suppressed: false, target: 'Block', tools: ['Peg'], operation: 'join', keep_tools: false },
      { id: 10, name: 'Remove1', type: 'remove', suppressed: false, bodies: ['Peg2'] },
    ]), 'x');
    expect(r.rows.filter((x) => x.status !== 'converted'), JSON.stringify(r.rows)).toEqual([]);
    const f = r.part!.features as Array<Record<string, any>>;
    const solids = f.filter((x) => x.type === 'extrude');
    expect(solids.map((x) => [x.op, x.body])).toEqual([['newBody', 'Block'], ['newBody', 'Peg'], ['newBody', '__tool6']]);
    expect(f.find((x) => x.type === 'combine' && x.tools?.[0]?.body === '__tool6')).toMatchObject({ op: 'cut', target: { body: 'Block' }, tools: [{ body: '__tool6' }], keepTools: false });
    expect(f.find((x) => x.name === 'Move1')).toMatchObject({ type: 'moveBody', bodies: [{ body: 'Peg' }], copy: true, body: 'Peg2', translate: [30, 0, 0] });
    // their z is our y; a turn about their z is a turn about our y, then the translation (0, 40, 0) is (0, 0, -40)
    expect(f.find((x) => x.name === 'Turn')).toMatchObject({ rotate: { axis: [0, 1, 0], angle: 90 }, translate: [0, 0, -40] });
    expect(f.find((x) => x.name === 'Combine1')).toMatchObject({ type: 'combine', op: 'union', target: { body: 'Block' }, tools: [{ body: 'Peg' }], keepTools: false });
    expect(f.find((x) => x.name === 'Remove1')).toMatchObject({ type: 'deleteBody', mode: 'delete', bodies: [{ body: 'Peg2' }] });
  });
  it('a circular pattern of a body about an axis that is not through the origin makes rotated copies', async () => {
    const r = await importSolidcraftDocument(doc([
      sketch(1), extrude(2, 1, { body_names: ['Block'] }), sketch(3), extrude(4, 3, { body_names: ['Peg'] }),
      { id: 5, name: 'Ring', type: 'pattern', suppressed: false, bodies: ['Peg'], features: [], pattern: { type: 'circular', axis: [0, 0, 1], origin: [10, 0, 0], count: '4', angle: '360 deg' } },
    ]), 'x');
    expect(r.rows.map((x) => x.status), JSON.stringify(r.rows)).toEqual(['converted', 'converted', 'converted', 'converted', 'converted']);
    const moves = (r.part!.features as Array<Record<string, any>>).filter((x) => x.type === 'moveBody');
    expect(moves.map((m) => [m.body, m.rotate.angle])).toEqual([['Peg 2', 90], ['Peg 3', 180], ['Peg 4', 270]]);
    expect(moves[0]).toMatchObject({ copy: true, bodies: [{ body: 'Peg' }], rotate: { axis: [0, 1, 0], origin: [10, 0, 0] } });
    const part = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1, { body_names: ['Block'] }), sketch(3), extrude(4, 3, { body_names: ['Peg'] }), { id: 5, name: 'Arc', type: 'pattern', suppressed: false, bodies: ['Peg'], features: [], pattern: { type: 'circular', axis: [0, 0, 1], origin: [0, 0, 0], count: '3', angle: '90 deg' } }]), 'x');
    expect((part.part!.features as Array<Record<string, any>>).filter((x) => x.type === 'moveBody').map((m) => m.rotate.angle)).toEqual([45, 90]);   // a part circle spreads the copies over its angle, ends included
  });
  it('progress is reported as the features are read, and an aborted import is refused as cancelled', async () => {
    const d = doc([sketch(1), extrude(2, 1), sketch(3), extrude(4, 3)]);
    const seen: Array<[number, number]> = [];
    expect((await importSolidcraftDocument(d, 'x', { onProgress: (a, b) => seen.push([a, b]) })).part).toBeTruthy();
    expect(seen).toEqual([[0, 4]]);
    const stop = new AbortController(); stop.abort();
    expect((await importSolidcraftDocument(d, 'x', { signal: stop.signal })).refused).toBe('cancelled');
  });
  it('a body that does not exist at that point is reported, not guessed; a one-body file keeps the plain add', async () => {
    const r = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1, { body_names: ['A'] }), { id: 3, name: 'Gone', type: 'remove', suppressed: false, bodies: ['B'] }, { id: 4, name: 'Tool', type: 'combine', suppressed: false, target: 'A', tools: ['Nope'], operation: 'cut' }]), 'x');
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted', 'unsupported', 'unsupported']);
    expect(r.rows[2].reason).toMatch(/body "B", which does not exist/);
    const one = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1, { body_names: ['A'] })]), 'x');
    expect((one.part!.features as Array<Record<string, any>>).find((x) => x.type === 'extrude')).toMatchObject({ op: 'add' });
  });
  it('malformed feature data is reported per feature, never thrown', async () => {
    const circle = { id: 1, name: 'Bad', type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XY' }, sketch: { points: [], curves: [{ id: 'c1', type: 'circle', c: 0, r: 2 }], constraints: [] } };
    const r = await importSolidcraftDocument(doc([circle, sketch(2), extrude(3, 2), { id: 4, name: 'NoSketch', type: 'extrude' }]), 'x');
    expect(r.rows.map((x) => x.status)).toEqual(['unsupported', 'converted', 'converted', 'unsupported']);
    expect(r.rows[0].reason).toMatch(/could not read this feature/);
    expect(r.part!.features.filter((x) => (x as { type: string }).type === 'importedUnsupported')).toHaveLength(2);
  });
  it('legacy_per_side (older designs, 538 extrudes of one real file) reads as the plain distance one way, and is refused with a second distance', async () => {
    const r = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1, { extent: { convention: 'legacy_per_side', direction: 'positive', distance: '7' } }), sketch(3), extrude(4, 3, { operation: 'join', extent: { convention: 'legacy_per_side', direction: 'positive', distance: '7', distance2: '3' } })]), 'x');
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted', 'converted', 'unsupported']);
    expect(r.rows[3].reason).toMatch(/second distance/);
    expect((r.part!.features as Array<Record<string, any>>).find((x) => x.type === 'extrude')).toMatchObject({ type: 'extrude', op: 'add' });
  });
  it('an extent without a convention (older files) is the total distance; profiles chosen by curves become regions', async () => {
    const r = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1, { extent: { direction: 'positive', distance: '7' }, profiles: { type: 'curves', loops: [['l1', 'l2', 'l3', 'l4']] } })]), 'old');
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted']);
    expect((r.part!.features as Array<Record<string, any>>)[1]).toMatchObject({ depth: 7, regions: ['e1', 'e2', 'e3', 'e4'] });
    // loops as objects with `curves`, and a curve that is not there
    const r2 = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1, { profiles: { type: 'curves', loops: [{ curves: ['l1', 'l9'] }] } })]), 'old');
    expect(r2.rows[1].reason).toMatch(/not in the sketch/);
  });
  it('a refused extent, direction and chosen profiles', async () => {
    const r = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1, { extent: { convention: 'symmetric', direction: 'positive', distance: '5' } }), extrude(3, 1, { extent: { convention: 'total_distance', direction: 'both', distance: '5' } }), extrude(4, 1, { profiles: { type: 'some' } })]), 'x');
    expect(r.rows.slice(1).map((x) => x.status)).toEqual(['unsupported', 'unsupported', 'unsupported']);
  });
  it('cylinder on each axis lands on the plane across it (Y-up); a negative axis runs the other way', async () => {
    const cyl = (axis: number[], base: number[]) => ({ id: 1, name: 'C', type: 'cylinder', suppressed: false, axis, base, radius: '4', height: '10', operation: 'new_body' });
    const feats = async (axis: number[], base = [0, 0, 0]) => (await importSolidcraftDocument(doc([cyl(axis, base)]), 'c')).part!.features as Array<Record<string, any>>;
    // their X, Y, Z axes: our right, front and top planes (their Z, the up axis, is our Y, the top plane's normal)
    for (const [axis, plane] of [[[1, 0, 0], 'right'], [[0, 1, 0], 'front'], [[0, 0, 1], 'top']] as Array<[number[], string]>) {
      expect((await feats(axis)).find((x) => x.type === 'sketch')!.plane).toEqual({ kind: 'std', id: plane });
    }
    // along +Z (up) the boss grows along our +Y with no flip; along -Z it runs down, so the extrude is flipped
    expect((await feats([0, 0, 1])).find((x) => x.type === 'extrude')!.flip).toBeUndefined();
    expect((await feats([0, 0, -1])).find((x) => x.type === 'extrude')!.flip).toBe(true);
    // a base off the origin: their (bx, by, bz) = (7, 5, 3) with the axis up is our top plane at y = 3, centre at their (7, 5)
    const f = await feats([0, 0, 1], [7, 5, 3]);
    expect(f.find((x) => x.type === 'plane')!.offset).toBe(3);
    expect(f.find((x) => x.type === 'sketch')!.points[1]).toMatchObject({ x: 7, y: 5 });
    // an axis that is not one of the three stands the circle on a plane of ours given as a frame, with the axis as its normal
    const slanted = await importSolidcraftDocument(doc([cyl([1, 1, 0], [0, 0, 0])]), 'c');
    expect(slanted.rows[0].status).toBe('converted');
    expect(slanted.part!.features.find((x: any) => x.type === 'plane')).toMatchObject({ mode: 'frame' });
    expect((await importSolidcraftDocument(doc([cyl([0, 0, 0], [0, 0, 0])]), 'c')).rows[0].status).toBe('unsupported');
  });
});

describe('planes, extents and features beyond the basics', () => {
  const sq = (id: number, name: string, plane: unknown, pts = [[0, 0], [10, 0], [10, 10], [0, 10]], extra: Record<string, unknown> = {}) => ({
    id, name, type: 'sketch', suppressed: false, plane,
    sketch: { points: [{ id: 'origin', pos: [0, 0] }, ...pts.map((p, i) => ({ id: `p${i + 1}`, pos: p }))], curves: pts.map((_, i) => ({ id: `l${i + 1}`, type: 'line', a: i + 1, b: ((i + 1) % pts.length) + 1 })), constraints: [], ...extra },
  });
  const ext = (id: number, sk: number, over: Record<string, unknown> = {}) => ({ id, name: `E${id}`, type: 'extrude', suppressed: false, sketch: sk, profiles: { type: 'all' }, operation: 'new_body', extent: { direction: 'positive', distance: '5' }, ...over });
  const doc = (features: unknown[]) => ({ format: 'solidcraft/30', units: 'mm', params: [], features });
  const F = (r: { part: { features: unknown[] } | null }) => r.part!.features as Array<Record<string, any>>;

  it('a sphere is one sphere row at the centre (their Z up becomes our Y up)', async () => {
    const ball = { id: 1, name: 'Ball', type: 'sphere', suppressed: false, center: [10, 20, 30], radius: '4', operation: 'new_body' };
    const r = await importSolidcraftDocument(doc([ball]), 's');
    expect(r.rows[0].status).toBe('converted');
    expect(F(r)).toEqual([expect.objectContaining({ type: 'sphere', op: 'add', center: [10, 30, -20], radius: 4 })]);
  });

  it('a body transfer that moves nothing is skipped (the bodies stay), one that moves them is reported', async () => {
    const I = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const tr = (id: number, transform: number[][]) => ({ id, name: `T${id}`, type: 'body_transfer', suppressed: false, bodies: ['Body1'], from: 0, to: 7, component: 7, transform });
    const r = await importSolidcraftDocument(doc([sq(1, 'S', { type: 'origin', name: 'XY' }), ext(2, 1), tr(3, I), tr(4, [[1, 0, 0, 5], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])]), 'bt');
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted', 'skipped', 'unsupported']);
    expect(r.rows[3].reason).toMatch(/also moves/);
    expect(r.geometryComplete).toBe(false);
    expect((await importSolidcraftDocument(doc([sq(1, 'S', { type: 'origin', name: 'XY' }), ext(2, 1), tr(3, I)]), 'bt')).geometryComplete).toBe(true);
  });

  it('a sketch on a face or custom plane carries its own frame: an axis-aligned one lands on a standard plane with an offset and an in-plane shift', async () => {
    // their frame: origin (10, 0, 0), x along their Y, y along their Z (a face of the part at x = 10, normal +X): our right plane, 10 along its normal (+X)
    const face = { type: 'face', name: 'F2:side:l1', at: [10, 0, 0], anchor: {}, plane: { origin: [10, 0, 0], x_dir: [0, 1, 0], y_dir: [0, 0, 1] } };
    const r = await importSolidcraftDocument(doc([sq(1, 'S', { type: 'origin', name: 'XY' }), ext(2, 1), sq(3, 'On face', face), ext(4, 3, { operation: 'join' })]), 'f');
    const f = F(r);
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted', 'converted', 'converted']);
    const pl = f.find((x) => x.type === 'plane')!;
    expect(pl).toMatchObject({ mode: 'offset', base: { kind: 'std', id: 'right' }, offset: 10 });
    const sk = f.filter((x) => x.type === 'sketch')[1];
    expect(sk.plane).toEqual({ kind: 'feature', id: pl.id });
    // their (x, y) of this frame is our right plane's (y, x)?: their frame x -> their Y -> our -Z = our right x; their frame y -> their Z -> our Y = our right y
    expect(sk.points[2]).toMatchObject({ x: 10, y: 0 });
    // a tilted frame becomes a plane of ours given as origin and two directions; the sketch keeps its own coordinates
    const tilted = { type: 'custom', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 0.7071, 0.7071] } };
    const tp = (await importSolidcraftDocument(doc([sq(1, 'T', tilted)]), 't')).part!.features as any[];
    expect(tp[0]).toMatchObject({ type: 'plane', mode: 'frame', origin: [0, 0, 0], xDir: [1, 0, 0] });
    expect(tp[1]).toMatchObject({ type: 'sketch', plane: { kind: 'feature', id: tp[0].id } });
    expect(tp[1].points[2]).toMatchObject({ x: 10, y: 0 });
    // an origin of the frame that is not at zero shifts the sketch in-plane
    const shifted = { type: 'custom', plane: { origin: [3, 4, 0], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } };
    const rs = await importSolidcraftDocument(doc([sq(1, 'Sh', shifted)]), 's');
    expect(F(rs)[0].points[2]).toMatchObject({ x: 13, y: 4 });   // their (10, 0) on top of the frame origin (3, 4)
  });
  it('a profile corner on the sketch origin of a moved plane stays on that origin, not on the origin of our plane', async () => {
    // their sketch origin is the plane's origin (3, 4); a corner coincident with it must land there (it used to land on our own origin (0, 0))
    const shifted = { type: 'custom', plane: { origin: [3, 4, 0], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } };
    const rs = await importSolidcraftDocument(doc([sq(1, 'Sh', shifted, undefined, { constraints: [{ type: 'coincident', p: 0, q: 1 }] })]), 's');
    const sk = F(rs)[0];
    const corner = sk.points.find((q: any) => q.id !== 'O' && Math.abs(q.x - 3) < 1e-9 && Math.abs(q.y - 4) < 1e-9);
    expect(corner).toBeTruthy();
    expect(sk.entities.filter((e: any) => e.p1 === 'O' || e.p2 === 'O')).toHaveLength(0);
    // with the plane origin at zero the corner still is our fixed origin
    const flat = await importSolidcraftDocument(doc([sq(1, 'Fl', { type: 'origin', name: 'XY' }, undefined, { constraints: [{ type: 'coincident', p: 0, q: 1 }] })]), 'f');
    expect(F(flat)[0].entities.some((e: any) => e.p1 === 'O' || e.p2 === 'O')).toBe(true);
  });
  it('construction planes: a sketch offset from one, and a mirror about one', async () => {
    const cp = { id: 2, name: 'Mid', type: 'construction_plane', suppressed: false, plane: { type: 'offset', base: { type: 'origin', name: 'YZ' }, distance: '-5' } };
    const sk = sq(3, 'S', { type: 'offset', base: { type: 'construction', name: 'Mid' }, distance: '2' });
    const r = await importSolidcraftDocument(doc([sq(1, 'B', { type: 'origin', name: 'XY' }), ext(4, 1), cp, sk, ext(5, 3, { operation: 'join' }), { id: 6, name: 'Mir', type: 'mirror', suppressed: false, features: ['E5'], plane: { type: 'construction', name: 'Mid' } }]), 'c');
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted', 'converted', 'converted', 'converted', 'converted']);
    const f = F(r);
    // YZ at -5, then +2 more along its normal (+X): their x = -3, our right plane offset -3
    expect(f.find((x) => x.type === 'plane' && x.offset === -3)).toBeTruthy();
    const mir = f.find((x) => x.type === 'mirror')!;
    expect(mir.seeds).toEqual([f.find((x) => x.type === 'extrude' && x.name === 'E5')!.id]);
    expect(f.find((x) => x.id === mir.plane.id)).toMatchObject({ type: 'plane', offset: -5 });
  });
  it('through-all cuts, negative distances, and extents that cannot be mapped', async () => {
    const base = [sq(1, 'B', { type: 'origin', name: 'XY' }), ext(2, 1, { extent: { direction: 'positive', distance: '20' } }), sq(3, 'C', { type: 'origin', name: 'XY' })];
    const cut = async (extent: Record<string, unknown>) => F(await importSolidcraftDocument(doc([...base, ext(4, 3, { operation: 'cut', extent })]), 'x'));
    expect((await cut({ direction: 'positive', distance: '0', through_all: true })).at(-1)).toMatchObject({ op: 'cut', end: 'through' });
    // "-100" going positive is 100 going negative: the same cut as 100 negative
    const neg = (await cut({ direction: 'positive', distance: '-100' })).at(-1)!;
    const same = (await cut({ direction: 'negative', distance: '100' })).at(-1)!;
    expect(neg).toMatchObject({ depth: 100 }); expect(neg.flip).toBe(same.flip); expect(neg.depth).toBe(same.depth);
    const bad = await importSolidcraftDocument(doc([...base, ext(4, 3, { operation: 'cut', extent: { direction: 'positive', distance: '4', to: [1, 2, 3] } }), ext(6, 3, { operation: 'cut', extent: { direction: 'positive', distance: '0' } })]), 'x');
    expect(bad.rows.slice(3).map((x) => x.status)).toEqual(['converted', 'unsupported']);
    expect((bad.rows[3].notes ?? []).join(' ')).toMatch(/stops at a face/);
    // a start offset moves the sketch along the extrude direction: a copy of it on an offset plane, depth unchanged
    const off = await importSolidcraftDocument(doc([...base, ext(4, 3, { operation: 'cut', extent: { direction: 'positive', distance: '4', start_offset: '2' } })]), 'x');
    expect(off.rows[3].status).toBe('converted');
    const moved = off.part!.features.filter((q) => q.type === 'plane');
    expect(moved.at(-1)).toMatchObject({ mode: 'offset', offset: 2 });
    expect(off.part!.features.at(-1)).toMatchObject({ type: 'extrude', depth: 4 });
  });
  it('a profile that uses only part of a longer line gets its own outline; a whole loop keeps selecting by curve', async () => {
    // an outer 70 x 84 rectangle with two horizontal lines across at y = -31 and y = 31; the strip between them is chosen by l1, l5, l4, l7
    const pts = [[-35, -42], [-35, 42], [35, -42], [35, 42], [-35, -31], [35, -31], [35, 31], [-35, 31]];
    const lines: Array<[number, number]> = [[1, 2], [3, 4], [1, 3], [2, 4], [5, 6], [7, 8]];
    const s2 = { id: 3, name: 'Strip', type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XY' }, sketch: { points: [{ id: 'origin', pos: [0, 0] }, ...pts.map((p, i) => ({ id: `p${i + 1}`, pos: p }))], curves: lines.map(([a, b], i) => ({ id: `l${i + 1}`, type: 'line', a, b })), constraints: [] } };
    // loop order: left side l1, bottom of strip l5, right side l2, top of strip l6
    const r = await importSolidcraftDocument(doc([sq(1, 'B', { type: 'origin', name: 'XY' }), ext(2, 1), s2, ext(4, 3, { operation: 'join', profiles: { type: 'curves', loops: [['l1', 'l5', 'l2', 'l6']] }, extent: { direction: 'positive', distance: '18' } })]), 'strip');
    const f = F(r);
    const prof = f.filter((x) => x.type === 'sketch').at(-1)!;
    expect(prof.name).toBe('E4 profile');
    expect(prof.visible).toBe(false);
    // four corners: x = +-35, y = -31 and 31
    const xy = prof.points.slice(1).map((p: any) => [p.x, p.y]).sort();
    expect(xy).toEqual([[-35, -31], [-35, 31], [35, -31], [35, 31]]);
    expect(f.at(-1)!.sketch).toBe(prof.id);
    expect(f.at(-1)!.regions).toBeUndefined();
    // a loop made of whole curves still selects by curve id
    const whole = await importSolidcraftDocument(doc([sq(1, 'B', { type: 'origin', name: 'XY' }), ext(2, 1, { profiles: { type: 'curves', loops: [['l1', 'l2', 'l3', 'l4']] } })]), 'w');
    expect(F(whole).at(-1)!.regions).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(F(whole).filter((x) => x.type === 'sketch')).toHaveLength(1);
  });
  it('an edge the file names by its two faces gets those names as a hint for when its stored position is stale', async () => {
    const seen: unknown[] = [];
    const resolver: EdgeResolver = async (_p, pts, hints) => { seen.push(hints?.[0]?.faces); return pts.map((p) => ({ faces: ['a', 'b'], at: p })); };
    const d = doc([
      sq(1, 'B', { type: 'origin', name: 'XY' }), ext(2, 1, { extent: { direction: 'positive', distance: '10' } }),
      { id: 3, name: 'Round', type: 'fillet', suppressed: false, edges: [[10, 5, 10]], edge_names: ['F2:side:l1|F2:start'], radius: '1' },
      { id: 4, name: 'Odd', type: 'fillet', suppressed: false, edges: [[10, 5, 10]], edge_names: ['F6:inner:F2:side:l1|F2:start'], radius: '1' },
      { id: 5, name: 'Piece', type: 'fillet', suppressed: false, edges: [[10, 5, 10]], edge_names: ['F2:side:l1#2|F2:start#1'], radius: '1' },
    ]);
    const r = await importSolidcraftDocument(d, 'm', { resolver });
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted', 'converted', 'converted', 'converted']);
    const ext2 = F(r).find((x) => x.type === 'extrude')!.id;
    expect(seen[0]).toEqual([{ prefix: `${ext2}.S.e1` }, { prefix: `${ext2}.C0` }]);
    expect(seen[1]).toBeUndefined();   // a name of another form gives no hint
    expect(seen[2]).toEqual(seen[0]);   // pieces of a split face (#1, #2, format 31 and later) name the same faces
  });
  it('revolve about the sketch axis, loft, rectangular pattern, chamfer, shell and offset face', async () => {
    const calls: unknown[][] = [];
    const resolver: EdgeResolver = async (_p, pts) => { calls.push(pts); return pts.map((p) => ({ faces: ['a', 'b'], at: p })); };
    const faceResolver: FaceResolver = async (_p, pts) => { calls.push(pts); return pts.map((_, i) => `F2.S.e${i + 1}`); };
    const d = doc([
      sq(1, 'B', { type: 'origin', name: 'XY' }), ext(2, 1, { extent: { direction: 'positive', distance: '10' } }),
      { id: 3, name: 'Ch', type: 'chamfer', suppressed: false, edges: [[10, 5, 10]], distance: '1.5 mm' },
      { id: 4, name: 'Sh', type: 'shell', suppressed: false, faces: [[5, 5, 10]], thickness: '1', direction: 'inside' },
      { id: 5, name: 'Raise', type: 'offset_face', suppressed: false, faces: [[5, 5, 0]], distance: '2' },
      sq(6, 'H', { type: 'origin', name: 'XY' }), ext(7, 6, { name: 'Hole1', operation: 'cut', extent: { direction: 'positive', distance: '4' } }),
      { id: 8, name: 'Grid', type: 'pattern', suppressed: false, features: ['Hole1'], pattern: { type: 'rectangular', dir1: [1, 0, 0], count1: '3', spacing1: '12 mm', dir2: [0, 1, 0], count2: '2', spacing2: '9' } },
    ]);
    const r = await importSolidcraftDocument(d, 'm', { resolver, faceResolver });
    expect(r.rows.map((x) => `${x.name}:${x.status}`)).toEqual(['B:converted', 'E2:converted', 'Ch:converted', 'Sh:converted', 'Raise:converted', 'H:converted', 'Hole1:converted', 'Grid:converted']);
    const f = F(r);
    expect(f.find((x) => x.type === 'chamfer')).toMatchObject({ chamferType: 'equal', distance: 1.5 });
    expect(f.find((x) => x.type === 'shell')).toMatchObject({ thickness: 1, faces: ['F2.S.e1'] });
    expect(f.find((x) => x.type === 'moveFace')).toMatchObject({ mode: 'offset', distance: 2 });
    // the positions the resolvers got are in OUR world: their (10, 5, 10) is (10, 10, -5)
    expect(calls[0]).toEqual([[10, 10, -5]]);
    // 3 x 2: their X stays X, their Y is our -Z (a reversed direction)
    const lp = f.filter((x) => x.type === 'lpattern');
    expect(lp).toHaveLength(2);
    expect(lp[0]).toMatchObject({ dir: { kind: 'axis', axis: 'x' }, count: 3, spacing: 12, reverse: false });
    expect(lp[1]).toMatchObject({ dir: { kind: 'axis', axis: 'z' }, count: 2, spacing: 9, reverse: true });
    expect(lp[1].seeds).toContain(lp[0].id);   // the second direction repeats the first row too
    // without the resolvers they are reported, not guessed
    const bare = await importSolidcraftDocument(d, 'm');
    expect(bare.rows.filter((x) => x.status === 'unsupported').map((x) => x.name)).toEqual(['Ch', 'Sh', 'Raise']);
  });
  it('a revolve about the sketch y axis adds a construction line along it, mapped to our plane axes', async () => {
    const rev = (axis: string) => ({ id: 2, name: 'R', type: 'revolve', suppressed: false, sketch: 1, profiles: { type: 'all' }, axis: { type: 'sketch_axis', axis }, angle: '180 deg', operation: 'new_body' });
    const r = await importSolidcraftDocument(doc([sq(1, 'P', { type: 'origin', name: 'XZ' }, [[1, 0], [3, 0], [3, 5], [1, 5]]), rev('y')]), 'r');
    const f = F(r);
    const sk = f[0], rv = f[1];
    const ax = sk.entities.find((e: any) => e.id === rv.axis);
    expect(ax).toMatchObject({ type: 'line', construction: true });
    // their XZ plane maps to our front with y reversed: their sketch y axis is our -y
    const a = sk.points.find((p: any) => p.id === ax.p1), b = sk.points.find((p: any) => p.id === ax.p2);
    expect([b.x - a.x, b.y - a.y]).toEqual([0, -10]);
    expect(rv).toMatchObject({ op: 'add', angle: 180, end: 'blind' });
    expect((await importSolidcraftDocument(doc([sq(1, 'P', { type: 'origin', name: 'XZ' }), rev('z')]), 'r')).rows[1].status).toBe('unsupported');
  });
});

describe('sketch constraints', () => {
  // a 20 x 10 rectangle on their XY plane, plus a circle and an arc-less set of dimensions; points: 0 origin, 1..4 corners, 5 circle centre
  const sketch = (constraints: unknown[], plane = { type: 'origin', name: 'XY' }) => ({
    id: 1, name: 'S', type: 'sketch', suppressed: false, plane,
    sketch: {
      points: [{ id: 'origin', pos: [0, 0], fixed: true }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [20, 0] }, { id: 'p3', pos: [20, 10] }, { id: 'p4', pos: [0, 10] }, { id: 'p5', pos: [10, 5] }, { id: 'p6', pos: [10, 0] }],
      curves: [
        { id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 },
        { id: 'c1', type: 'circle', c: 5, r: 2 },
      ],
      constraints,
    },
  });
  const run = async (constraints: unknown[], plane?: { type: string; name: string }) => {
    const r = await importSolidcraftDocument({ format: 'solidcraft/30', units: 'mm', params: [], features: [sketch(constraints, plane)] } as never, 'c');
    const sk = (r.part!.features as Array<Record<string, any>>).find((x) => x.type === 'sketch')!;
    return { r, cons: sk.constraints as Array<{ type: string; refs: string[]; value?: number }> };
  };
  it('carries midpoint, distances, radius, diameter, tangent, collinear, symmetric and point on curve', async () => {
    const { r, cons } = await run([
      { id: 'k1', type: 'midpoint', l: 0, p: 6 },
      { id: 'k2', type: 'distance_x', p: 1, q: 2, value: 20, param: 'd1' },
      { id: 'k3', type: 'distance_y', p: 2, q: 3, value: 10 },
      { id: 'k4', type: 'distance', p: 1, q: 3, value: 22.36 },
      { id: 'k5', type: 'radius', c: 4, value: 2 },
      { id: 'k6', type: 'diameter', c: 4, value: 4 },
      { id: 'k7', type: 'collinear', a: 0, b: 2 },
      { id: 'k8', type: 'symmetric', p: 1, q: 2, l: 3 },
      { id: 'k9', type: 'point_on_curve', p: 5, c: 4 },
      { id: 'k10', type: 'point_on_curve', p: 6, c: 0 },
      { id: 'k11', type: 'tangent', a: 0, b: 4 },
    ]);
    expect(cons.map((c) => c.type)).toEqual(['midpoint', 'hdist', 'vdist', 'distance', 'radius', 'diameter', 'collinear', 'symmetric', 'pointOnCircle', 'pointOnLine', 'tangent']);
    expect(cons.find((c) => c.type === 'hdist')).toMatchObject({ value: 20 });
    expect(cons.find((c) => c.type === 'radius')).toMatchObject({ value: 2 });
    expect(r.rows[0].notes ?? []).toEqual([]);
  });
  it('a plane that swaps the sketch axes turns their horizontal distance into our vertical one; unusable ones are noted, not guessed', async () => {
    // their YZ plane: their x runs along our -z and y along our y, so no swap; their XZ plane (front) keeps x and y: swap is for a plane whose u lies along our y
    const { cons } = await run([{ id: 'k1', type: 'distance_x', p: 1, q: 2, value: 20 }], { type: 'origin', name: 'XY' });
    expect(cons[0].type).toBe('hdist');
    const bad = await run([{ id: 'k1', type: 'distance_x', p: 1, q: 1, value: 20 }, { id: 'k2', type: 'radius', c: 0, value: 2 }, { id: 'k3', type: 'distance', p: 1, q: 2, value: 0 }]);
    expect(bad.cons).toEqual([]);
    expect(bad.r.rows[0].notes?.length).toBeGreaterThanOrEqual(2);
  });
});

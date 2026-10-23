import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importSolidcraft, importSolidcraftDocument, type EdgeResolver } from './import';

const fixture = (n: string) => new Uint8Array(readFileSync(`${process.cwd()}/packages/solidcraft/fixtures/${n}.solidcraft`));

describe('slot file (sketch, extrude, box cut)', () => {
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

describe('sample plate (parameters, offset planes, a cut, a fillet)', () => {
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
    expect(ex.map((e) => [e.op, e.depth, !!e.flip])).toEqual([['add', 8, false], ['cut', 8, true], ['add', 14, false], ['cut', 22, false]]);
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
  it('an assembly is refused as a whole, with the counts', async () => {
    const r = await importSolidcraft(fixture('hinge-assembly'), 'hinge');
    expect(r.part).toBeNull();
    expect(r.refused).toMatch(/assemblies are not supported \(2 occurrences in 2 components\)/);
  });
  it('not a zip, no document, bad JSON, wrong format, wrong units', async () => {
    expect((await importSolidcraft(new Uint8Array([1, 2, 3]), 'x')).refused).toMatch(/not a SolidCraft file/);
    expect((await importSolidcraftDocument({ format: 'other/1', features: [] }, 'x')).refused).toMatch(/unknown document format/);
    expect((await importSolidcraftDocument({ format: 'solidcraft/30', units: 'in', features: [] }, 'x')).refused).toMatch(/only mm/);
    expect((await importSolidcraftDocument({ format: 'solidcraft/30' } as never, 'x')).refused).toMatch(/no feature list/);
    expect((await importSolidcraftDocument({ format: 'solidcraft/30', params: [{ name: 'a', expr: 'b' }], features: [] }, 'x')).refused).toMatch(/parameter/);
  });
  const sketch = (id: number, extra: Record<string, unknown> = {}) => ({
    id, name: `S${id}`, type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XY' },
    sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [10, 0] }, { id: 'p3', pos: [10, 10] }, { id: 'p4', pos: [0, 10] }],
      curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }],
      constraints: [{ id: 'k1', type: 'coincident', p: 0, q: 1 }, { id: 'k2', type: 'horizontal', l: 0 }, { id: 'k3', type: 'vertical', l: 1 }, { id: 'k4', type: 'length', l: 0, value: 10, param: 'd1' }], ...extra },
  });
  const extrude = (id: number, sk: number, over: Record<string, unknown> = {}) => ({ id, name: `E${id}`, type: 'extrude', suppressed: false, sketch: sk, profiles: { type: 'all' }, operation: 'new_body', extent: { convention: 'total_distance', direction: 'positive', distance: '5' }, ...over });
  const doc = (features: unknown[]) => ({ format: 'solidcraft/30', units: 'mm', params: [], features });

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
  it('an unsupported sketch takes its extrude with it, and the numbering of the rest is intact', async () => {
    const bad = sketch(1); bad.sketch.curves[0] = { id: 'l1', type: 'spline', a: 1, b: 2 } as never;
    const r = await importSolidcraftDocument(doc([bad, extrude(2, 1), sketch(3), extrude(4, 3)]), 'x');
    expect(r.rows.map((x) => x.status)).toEqual(['unsupported', 'unsupported', 'converted', 'converted']);
    expect(r.rows[1].reason).toMatch(/depends on sketch 1/);
    const types = (r.part!.features as Array<Record<string, any>>).map((x) => x.type);
    expect(types).toEqual(['importedUnsupported', 'importedUnsupported', 'sketch', 'extrude']);
    const ids = (r.part!.features as Array<Record<string, any>>).map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('a second new body, a cut with nothing to cut, an unknown operation and a suppressed feature', async () => {
    const r = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1), sketch(3), extrude(4, 3), sketch(5), extrude(6, 5, { operation: 'intersect' }), { ...sketch(7), suppressed: true }]), 'x');
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted', 'converted', 'unsupported', 'converted', 'unsupported', 'skipped']);
    expect(r.rows[3].reason).toMatch(/separate body/);
    expect(r.rows[5].reason).toMatch(/operation "intersect"/);
    const first = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1, { operation: 'cut' })]), 'x');
    expect(first.rows[1].reason).toMatch(/nothing to cut/);
  });
  it('malformed feature data is reported per feature, never thrown', async () => {
    const circle = { id: 1, name: 'Bad', type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XY' }, sketch: { points: [], curves: [{ id: 'c1', type: 'circle', c: 0, r: 2 }], constraints: [] } };
    const r = await importSolidcraftDocument(doc([circle, sketch(2), extrude(3, 2), { id: 4, name: 'NoSketch', type: 'extrude' }]), 'x');
    expect(r.rows.map((x) => x.status)).toEqual(['unsupported', 'converted', 'converted', 'unsupported']);
    expect(r.rows[0].reason).toMatch(/could not read this feature/);
    expect(r.part!.features.filter((x) => (x as { type: string }).type === 'importedUnsupported')).toHaveLength(2);
  });
  it('a refused extent, direction and chosen profiles', async () => {
    const r = await importSolidcraftDocument(doc([sketch(1), extrude(2, 1, { extent: { convention: 'symmetric', direction: 'positive', distance: '5' } }), extrude(3, 1, { extent: { convention: 'total_distance', direction: 'both', distance: '5' } }), extrude(4, 1, { profiles: { type: 'some' } })]), 'x');
    expect(r.rows.slice(1).map((x) => x.status)).toEqual(['unsupported', 'unsupported', 'unsupported']);
  });
  it('cylinder on each axis and a negative axis refused', async () => {
    const cyl = (axis: number[], base: number[]) => ({ id: 1, name: 'C', type: 'cylinder', suppressed: false, axis, base, radius: '4', height: '10', operation: 'new_body' });
    for (const [axis, plane] of [[[1, 0, 0], 'right'], [[0, 1, 0], 'top'], [[0, 0, 1], 'front']] as Array<[number[], string]>) {
      const r = await importSolidcraftDocument(doc([cyl(axis, [0, 0, 0])]), 'c');
      const sk = (r.part!.features as Array<Record<string, any>>).find((x) => x.type === 'sketch')!;
      expect(sk.plane).toEqual({ kind: 'std', id: plane });
    }
    expect((await importSolidcraftDocument(doc([cyl([-1, 0, 0], [0, 0, 0])]), 'c')).rows[0].status).toBe('unsupported');
  });
});

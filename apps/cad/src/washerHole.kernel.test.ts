// "Washer on this hole" on a real kernel: a plate with a hole, the hole read from its picked wall or edge, the washer placed coaxial and seated on the face the hole
// opens on as one folder. Also the refusals (countersink) and the counterbore floor.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import './i18n';
import { DEFAULT_WASHER, washerOnHole, washerOps } from './washer';
import { holeFromPick } from './washerHole';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world(doc: PartDoc) {
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc);
  return c;
}
const fail = (r: unknown) => JSON.stringify((r as { errors?: unknown }).errors ?? r);

/** A 40 x 30 x 8 plate on the front plane (extruded along +Z: 0..8) with one hole at (20, 15) cut from the top face. */
function plate(hole: Record<string, unknown> | null): PartDoc {
  const feats: unknown[] = [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 }, { id: 'c', x: 40, y: 30 }, { id: 'd', x: 0, y: 30 }],
      entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([id, p1, p2]) => ({ id, type: 'line', p1, p2 })), constraints: [] },
    { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 8 },
  ];
  if (hole) feats.push(
    { type: 'sketch', id: 'F3', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'h', x: 20, y: 15 }], entities: [{ id: 'e1', type: 'point', p: 'h' }], constraints: [] },
    { type: 'hole', id: 'F4', sketch: 'F3', end: 'through', ...hole },
  );
  return { ...emptyPart('Plate'), features: feats, seq: 5 } as unknown as PartDoc;
}
const wallOf = (c: Controller): string => c.bodyFaces()!.faceIds.find((f) => /^F4\./.test(f) && /\.S\./.test(f))!;
const read = (c: Controller, pick: string) => holeFromPick(pick, c.bodyEdges() as never, c.bodyFaces());
const bbox = (c: Controller, re: RegExp) => {
  const m = c.bodyFaces()!;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  m.faceIds.forEach((f, id) => { if (!re.test(f)) return; for (let t = 0; t < m.triFace.length; t++) if (m.triFace[t] === id) for (let v = 0; v < 9; v++) { const k = v % 3, x = m.positions[t * 9 + v]; lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x); } });
  return { lo, hi };
};

describe('washer on a hole, real kernel', () => {
  it('a 9 mm through hole: M8 washer, coaxial, touching the top face, in one folder', async () => {
    const c = await world(plate({ kind: 'simple', diameter: 9 }));
    const wall = wallOf(c);
    expect(wall, 'the hole wall face').toBeTruthy();
    const r = read(c, wall);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hole.diameter).toBeCloseTo(9, 3);
    expect(r.hole.blind).toBe(false);
    expect(r.hole.seats).toHaveLength(2);
    const top = bbox(c, /^F2\.C\d$/);   // the plate's own extent
    const { params, size } = washerOnHole(DEFAULT_WASHER, r.hole);
    expect(size).toMatchObject({ fit: 'contains', size: { size: 'M8' } });
    expect(params).toMatchObject({ inner: 8.4, outer: 16, thickness: 1.6, axis: 'pz' });
    expect(params.origin[0]).toBeCloseTo(20, 3); expect(params.origin[1]).toBeCloseTo(15, 3); expect(params.origin[2]).toBeCloseTo(top.hi[2], 3);
    const before = (c.document()!.features as unknown[]).length;
    const res = await c.commit(washerOps(c.document() as never, params), 'washer');
    expect(res.ok, fail(res)).toBe(true);
    const feats = c.document()!.features as unknown as Array<{ id: string; group?: string }>;
    const added = feats.slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(new Set(added.map((f) => f.group))).toEqual(new Set(['Washer']));
    const ids = added.map((f) => f.id);
    const w = bbox(c, new RegExp(`^(${ids.join('|')})\\.`));
    // coaxial: the washer's outer boundary is centred on the hole axis
    expect((w.lo[0] + w.hi[0]) / 2).toBeCloseTo(20, 1); expect((w.lo[1] + w.hi[1]) / 2).toBeCloseTo(15, 1);   // the mesh is a polygon: tenth of a mm
    expect(w.hi[0] - w.lo[0]).toBeCloseTo(16, 1);
    // seated: touches the top face, does not enter the plate
    expect(w.lo[2]).toBeCloseTo(8, 3); expect(w.hi[2]).toBeCloseTo(8 + 1.6, 3);
  }, 120000);

  it('picking a circular edge seats on that end of a through hole', async () => {
    const c = await world(plate({ kind: 'simple', diameter: 11 }));
    const wall = wallOf(c);
    const edges = (c.bodyEdges() as unknown as Array<{ key?: string; faces?: string[]; pts?: number[][] }>).filter((e) => e.faces?.includes(wall) && e.pts?.every((p) => Math.abs(p[2] - e.pts![0][2]) < 1e-6));
    expect(edges).toHaveLength(2);
    const low = edges.find((e) => e.pts![0][2] < 1)!;
    const r = read(c, low.key!);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hole.diameter).toBeCloseTo(11, 3);
    expect(r.hole.seats[0].axis).toBe('nz');
    expect(r.hole.seats[0].origin[2]).toBeCloseTo(0, 3);
    expect(washerOnHole(DEFAULT_WASHER, r.hole).size?.size.size).toBe('M10');
  }, 120000);

  it('a blind hole seats on its open end only', async () => {
    const c = await world(plate({ kind: 'simple', diameter: 6.6, end: 'blind', depth: 4 }));
    const r = c.bodyFaces()!.faceIds.filter((f) => /^F4\./.test(f)).map((f) => read(c, f)).find((x) => x.ok)!;   // the wall (the flat floor is not a hole)
    expect(r, 'a hole read').toBeTruthy();
    if (!r.ok) return;
    expect(r.hole.blind).toBe(true);
    expect(r.hole.seats).toHaveLength(1);
    expect(r.hole.seats[0].axis).toBe('pz');
    expect(r.hole.seats[0].origin[2]).toBeCloseTo(8, 3);
    expect(washerOnHole(DEFAULT_WASHER, r.hole).size?.size.size).toBe('M6');
  }, 120000);

  it('a counterbore seats on its floor, from the bore or from the counterbore wall', async () => {
    const c = await world(plate({ kind: 'cbore', diameter: 9, cboreDiameter: 15, cboreDepth: 3 }));
    const walls = c.bodyFaces()!.faceIds.filter((f) => /^F4\./.test(f) && /\.S\./.test(f));
    expect(walls.length).toBeGreaterThanOrEqual(2);
    const results = walls.map((w) => read(c, w));   // the cylinder walls and the flat floor, which is not a hole
    const oks = results.filter((r): r is Extract<ReturnType<typeof read>, { ok: true }> => r.ok);
    expect(oks.length, JSON.stringify(results)).toBe(2);
    for (const r of oks) {
      expect(r.hole.counterbore).toBe(true);
      expect(r.hole.diameter).toBeCloseTo(9, 3);
      expect(r.hole.seats[0].axis).toBe('pz');
      expect(r.hole.seats[0].origin[2]).toBeCloseTo(5, 3);   // the floor: 3 below the top face at 8
    }
  }, 120000);

  it('a countersink is refused, not guessed', async () => {
    const c = await world(plate({ kind: 'csink', diameter: 6.6, cskDiameter: 12, cskAngle: 90 }));
    const walls = c.bodyFaces()!.faceIds.filter((f) => /^F4\./.test(f) && /\.S\./.test(f));
    const results = walls.map((w) => read(c, w));
    expect(results.some((r) => !r.ok && r.reason === 'countersink'), JSON.stringify(results)).toBe(true);
    expect(results.every((r) => !r.ok || r.hole.seats.length === 0)).toBe(true);
  }, 120000);

  it('the outside of the plate is not a hole', async () => {
    const c = await world(plate({ kind: 'simple', diameter: 9 }));
    const side = c.bodyFaces()!.faceIds.find((f) => /^F2\./.test(f) && !/\.C\d$/.test(f))!;
    const r = read(c, side);
    expect(r).toMatchObject({ ok: false });
  }, 120000);
});

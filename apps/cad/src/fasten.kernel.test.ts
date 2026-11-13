// "Fasten this hole" on a real kernel: a plate with an M5 clearance hole (5.5 mm) through 12 mm gets a hex bolt, washers and a nut from the hole read off the part; the
// bolt axis is the hole axis, the stack is the right length, nothing is fused into the plate and the bolt does not cut it; a 2 x 2 pattern of holes gets four sets, and a
// plate with four identical holes plus one different one gets four, not five.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import './i18n';
import { allHoles, HoleIndex, identicalHoles, readFastenHole } from './fastenHole';
import { autoLength, defaultParams, fastenOps, planHole, type FastenParams } from './fasten';
import { queryInterference } from './inspect/kernel';
import { listBodies, readBodyFields } from './bodies';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world(doc: PartDoc) {
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc);
  return c;
}
const fail = (r: unknown) => JSON.stringify((r as { errors?: unknown }).errors ?? r);
const ixOf = (c: Controller) => new HoleIndex(c.bodyEdges() as never, c.bodyFaces()!);

/** A 50 x 40 plate on the front plane, 12 mm thick (z 0..12), and the hole features given: each [id, points, diameter]. */
function plate(holes: Array<[string, Array<[number, number]>, number]>, extra: unknown[] = []): PartDoc {
  const feats: unknown[] = [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 0, y: 0 }, { id: 'b', x: 50, y: 0 }, { id: 'c', x: 50, y: 40 }, { id: 'd', x: 0, y: 40 }],
      entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([id, p1, p2]) => ({ id, type: 'line', p1, p2 })), constraints: [] },
    { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 12 },
  ];
  let n = 3;
  for (const [, pts, dia] of holes) {
    const sk = `F${n++}`, hid = `F${n++}`;
    feats.push(
      { type: 'sketch', id: sk, plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts.map(([x, y], i) => ({ id: `h${i}`, x, y }))], entities: pts.map((_, i) => ({ id: `e${i}`, type: 'point', p: `h${i}` })), constraints: [] },
      { type: 'hole', id: hid, sketch: sk, end: 'through', kind: 'simple', diameter: dia },
    );
  }
  feats.push(...extra);
  return { ...emptyPart('Plate'), features: feats, seq: n + 10 } as unknown as PartDoc;
}
const bbox = (c: Controller, ids: string[]) => {
  const m = c.bodyFaces()!, re = new RegExp(`^(${ids.join('|')})\\.`);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  m.faceIds.forEach((f, id) => { if (!re.test(f)) return; for (let t = 0; t < m.triFace.length; t++) if (m.triFace[t] === id) for (let v = 0; v < 9; v++) { const k = v % 3, x = m.positions[t * 9 + v]; lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x); } });
  return { lo, hi };
};
const mass = async (c: Controller) => (await c.massProps())!;
const rowsOf = (c: Controller) => listBodies(c.selModel()!.bodies(), readBodyFields(c.document()), {});
/** The bodies: name, volume and centre of mass from the kernel's massProps, the extent of the faces from the Bodies list (both follow the kernel's lumps in order) */
async function bodiesOf(c: Controller) {
  const m = ((await mass(c)) as unknown as { bodies: Array<{ name?: string; volume: number; com: number[] }> }).bodies;
  const rows = rowsOf(c), mesh = c.bodyFaces()!;
  expect(rows).toHaveLength(m.length);
  return m.map((b, i) => {
    const set = new Set(rows[i].faces);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    mesh.faceIds.forEach((f, id) => { if (!set.has(f)) return; for (let t = 0; t < mesh.triFace.length; t++) if (mesh.triFace[t] === id) for (let v = 0; v < 9; v++) { const k = v % 3, x = mesh.positions[t * 9 + v]; lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x); } });
    return { name: b.name ?? '', volume: b.volume, mid: b.com, lo, hi };
  });
}
describe('fasten this hole, real kernel', () => {
  it('M5 clearance hole through 12 mm: hex bolt + washers + nut, on the hole axis, in one folder, nothing fused or cut', async () => {
    const c = await world(plate([['F4', [[20, 15]], 5.5]]));
    const plateVol = (await mass(c)).volume as number;
    const ix = ixOf(c);
    const wall = c.bodyFaces()!.faceIds.find((f) => /^F4\.S\.h1/.test(f))!;
    const r = readFastenHole(wall, ix);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.hole;
    expect(h).toMatchObject({ diameter: 5.5, kind: 'plain', through: true, thickness: 12 });
    expect(h.out).toEqual([0, 0, 1]);
    expect(h.mouth).toEqual([20, 15, 12]); expect(h.exit).toEqual([20, 15, 0]);
    const p: FastenParams = { ...defaultParams(h), washer: 'both', nut: true };
    expect(p).toMatchObject({ type: 'hex', size: 'M5' });
    // grip 12 + head washer 1 + nut washer 1 + nut 4.7 = 18.7 -> 20
    expect(autoLength(h, p)).toBe(20);
    expect(planHole(h, p).issues).toEqual([]);
    const doc = c.document()!;
    const before = (doc.features as unknown[]).length;
    const res = await c.commit(fastenOps(doc as never, [{ hole: h, params: p }]), 'fasten');
    expect(res.ok, fail(res)).toBe(true);
    const added = (c.document()!.features as unknown as Array<{ id: string; group?: string; body?: string; type: string }>).slice(before);
    expect(new Set(added.map((f) => f.group))).toEqual(new Set(['Fasteners']));
    const bodies = await bodiesOf(c);
    // plate + bolt + 2 washers + nut
    expect(bodies, JSON.stringify(bodies.map((x) => x.name))).toHaveLength(5);
    const named = (n: string) => bodies.find((b) => b.name === n)!;
    expect(bodies.map((b) => b.name)).toEqual(expect.arrayContaining(['Bolt', 'Washer', 'Washer (nut)', 'Nut']));
    // the plate is untouched: no fused head, no cut by the bolt: its volume is that of the plate with the hole
    const plateBody = bodies.reduce((a, b) => (b.volume > a.volume ? b : a));
    expect(plateBody.volume).toBeCloseTo(plateVol, -1);
    expect(plateBody.hi[2]).toBeCloseTo(12, 3); expect(plateBody.lo[2]).toBeCloseTo(0, 3);
    // hex bolt M5 x 20: shank + head, on the hole axis (head to the 20, 15 centre)
    const bolt = named('Bolt');
    expect(bolt.volume).toBeGreaterThan(560); expect(bolt.volume).toBeLessThan(600);
    expect(bolt.mid[0]).toBeCloseTo(20, 1); expect(bolt.mid[1]).toBeCloseTo(15, 1);
    expect(bolt.hi[2]).toBeCloseTo(13 + 3.5, 2);   // the head's top: washer (13) + head height 3.5
    expect(bolt.lo[2]).toBeCloseTo(-7, 2);          // 20 mm of shank below the head washer's top, past the nut's far face (-5.7)
    const washerHead = named('Washer'), washerNut = named('Washer (nut)'), nut = named('Nut');
    for (const w of [washerHead, washerNut]) { expect(w.volume).toBeGreaterThan(50); expect(w.volume).toBeLessThan(62); expect(w.mid[0]).toBeCloseTo(20, 1); expect(w.mid[1]).toBeCloseTo(15, 1); }
    expect([washerHead.lo[2], washerHead.hi[2]].map((v) => +v.toFixed(2))).toEqual([12, 13]);
    expect([washerNut.lo[2], washerNut.hi[2]].map((v) => +v.toFixed(2))).toEqual([-1, 0]);
    expect(nut.mid[0]).toBeCloseTo(20, 1); expect(nut.mid[1]).toBeCloseTo(15, 1);
    expect(nut.hi[2]).toBeCloseTo(-1, 2); expect(nut.lo[2]).toBeCloseTo(-1 - 4.7, 2);
    expect(nut.volume).toBeGreaterThan(150); expect(nut.volume).toBeLessThan(215);
    // interference query: the bolt and washers do not enter the plate; the only shared volume is the thread zone of the nut on the bolt
    const inter = (await queryInterference(sessions[0]))!;
    expect(inter.bodies).toBe(5);
    for (const pr of inter.pairs) expect(pr.error).toBeUndefined();
    const hasPlate = inter.pairs.filter((pr) => pr.box && pr.box.min[2] < 11.9 && pr.box.max[2] > 0.1);
    expect(hasPlate, JSON.stringify(inter.pairs)).toEqual([]);
    for (const pr of inter.pairs) expect(pr.box!.max[2]).toBeLessThanOrEqual(-1 + 1e-3);   // inside the nut's span only
  }, 180000);

  it('a 2 x 2 pattern of holes gets four sets (one folder, one undo step)', async () => {
    const c = await world(plate([['F4', [[10, 8]], 5.5]], [{ type: 'lpattern', id: 'F20', seeds: ['F4'], dir: { kind: 'axis', axis: 'x' }, spacing: 25, count: 2, dir2: { kind: 'axis', axis: 'y' }, spacing2: 20, count2: 2 }]));
    const ix = ixOf(c);
    const holes = allHoles(ix);
    expect(holes).toHaveLength(4);
    const first = holes[0];
    const same = identicalHoles(holes, first);
    expect(same).toHaveLength(4);
    const doc = c.document()!;
    const targets = same.map((hole) => ({ hole, params: { ...defaultParams(hole), washer: 'head' as const } }));
    const res = await c.commit(fastenOps(doc as never, targets), 'fasten');
    expect(res.ok, fail(res)).toBe(true);
    const bodies = await bodiesOf(c);
    expect(bodies.filter((b) => /^Bolt \d$/.test(b.name))).toHaveLength(4);
    expect(bodies.filter((b) => /^Washer \d$/.test(b.name))).toHaveLength(4);
    expect(bodies).toHaveLength(9);
    const xy = bodies.filter((b) => /^Bolt \d$/.test(b.name)).map((b) => `${Math.round(b.mid[0])},${Math.round(b.mid[1])}`).sort();
    expect(xy).toEqual(['10,8', '10,28', '35,28', '35,8'].sort());
    // one undo removes all of it
    await c.undo();
    expect(rowsOf(c)).toHaveLength(1);
  }, 180000);

  it('four identical holes plus a different one: four sets, not five', async () => {
    const c = await world(plate([['F4', [[10, 8], [40, 8], [10, 30], [40, 30]], 5.5], ['F6', [[25, 20]], 3.4]]));
    const holes = allHoles(ixOf(c));
    expect(holes).toHaveLength(5);
    const big = holes.find((h) => h.diameter === 5.5)!;
    const same = identicalHoles(holes, big);
    expect(same).toHaveLength(4);
    const doc = c.document()!;
    const res = await c.commit(fastenOps(doc as never, same.map((hole) => ({ hole, params: defaultParams(hole) }))), 'fasten');
    expect(res.ok, fail(res)).toBe(true);
    const bodies = await bodiesOf(c);
    expect(bodies.filter((b) => /^Bolt/.test(b.name))).toHaveLength(4);
    expect(bodies).toHaveLength(5);
  }, 180000);

  it.each([
    ['cbore', { kind: 'cbore', size: 'M5', fit: 'normal', end: 'through' }, 'cap', 'cbore'],
    ['csink', { kind: 'csink', size: 'M5', fit: 'normal', end: 'through', cskDiameter: 10.4, cskAngle: 90 }, 'countersunk', 'csink'],
    ['blind', { kind: 'simple', diameter: 4.2, end: 'blind', depth: 8 }, 'hex', 'plain'],
  ] as const)('a %s hole: the head type, size and length come from the hole, the bolt is made without a nut when it cannot have one', async (_n, hole, type, kind) => {
    const doc = plate([]);
    const d = { ...doc, features: [...(doc.features as unknown[]),
      { type: 'sketch', id: 'F3', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'h', x: 25, y: 20 }], entities: [{ id: 'e1', type: 'point', p: 'h' }], constraints: [] },
      { type: 'hole', id: 'F4', sketch: 'F3', ...hole }], seq: 6 } as unknown as PartDoc;
    const c = await world(d);
    const holes = allHoles(ixOf(c));
    expect(holes, JSON.stringify(holes)).toHaveLength(1);
    const h = holes[0];
    expect(h.kind).toBe(kind);
    const p = defaultParams(h);
    expect(p.type).toBe(type);
    if (_n === 'blind') { expect(h.through).toBe(false); expect(h.exit).toBeNull(); expect(p.size).toBe('M5'); expect(planHole(h, { ...p, nut: true }).issues.map((i) => i.code)).toContain('blindNut'); expect(autoLength(h, p)).toBe(8); }
    else { expect(h.through).toBe(true); expect(h.seatDepth).toBeGreaterThan(2); expect(h.recessDiameter).toBeGreaterThan(h.diameter); }
    expect(planHole(h, p).issues).toEqual([]);
    const res = await c.commit(fastenOps(c.document() as never, [{ hole: h, params: p }]), 'fasten');
    expect(res.ok, fail(res)).toBe(true);
    const bodies = await bodiesOf(c);
    expect(bodies).toHaveLength(2);
    const plateBody = bodies.reduce((a, b) => (b.volume > a.volume ? b : a));
    expect(plateBody.hi[2]).toBeCloseTo(12, 3);
    const bolt = bodies.find((b) => b.name === 'Bolt')!;
    expect(bolt.mid[0]).toBeCloseTo(25, 1); expect(bolt.mid[1]).toBeCloseTo(20, 1);
    // the head sits on the seat (counterbore floor, mouth) and the shank points into the part
    expect(bolt.hi[2]).toBeCloseTo(kind === 'csink' ? 12 : 12 - h.seatDepth + (type === 'cap' ? 3.3 : 3.5), 2);
  }, 180000);
});

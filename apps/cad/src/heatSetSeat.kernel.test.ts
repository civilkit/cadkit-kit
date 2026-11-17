// Heat-set seat on a real kernel: a plate with a 3 mm through hole gets an M3 insert seated at the hole's mouth: the hole is opened up to the insert's hole, the insert is a
// separate valid body, and the plate loses exactly the ring between the two diameters over the hole depth.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import './i18n';
import { HoleIndex, allHoles } from './fastenHole';
import { seatParams } from './heatSetSeat';
import { insertOps } from './fasteners';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world(doc: PartDoc) {
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc);
  return c;
}
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

describe('heat-set seat on a hole, through the kernel', { skip: !process.env.CK_WASM }, () => {
  it('opens a 3 mm hole to the M3 insert hole and adds the insert as its own body', async () => {
    const c = await world(plate([['H', [[25, 20]], 3]]));
    const before = (await c.massProps())!.volume as number;
    const hole = allHoles(new HoleIndex(c.bodyEdges() as never, c.bodyFaces()!))[0];
    expect(hole.diameter).toBeCloseTo(3, 3);
    const seat = seatParams(hole, 'M3');
    expect(seat.ok).toBe(true);
    if (!seat.ok) return;
    expect(seat.params.hole).toBe(true);
    expect(seat.params.axis).toBe('nz');
    const r = await c.commit(insertOps(c.document() as never, seat.params), 'seat');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const bodies = ((await c.massProps()) as unknown as { bodies: Array<{ volume: number }> }).bodies;
    expect(bodies.length).toBe(2);
    const plateVol = Math.max(...bodies.map((b) => b.volume));
    // the ring between the 3 mm hole and the insert hole, over the insert hole depth
    const d = seat.params.holeDiameter, depth = seat.params.holeDepth;
    const ring = Math.PI * ((d / 2) ** 2 - 1.5 ** 2) * depth;
    expect(before - plateVol).toBeGreaterThan(ring * 0.97);
    expect(before - plateVol).toBeLessThan(ring * 1.03);
  }, 120000);
});

// A bearing the wizard seats on a face stays on that face when the part is edited: the shaft is made longer or shorter and the bearing at the far end (and its
// seat pocket) goes with the end face. Real kernel: a shaft from a sketch and an extrude, the Bearing wizard's ops at both ends, then the extrude length changed.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { bearingOps, DEFAULT_BEARING, bearingSeat, type BearingParams } from './bearing';
import './i18n';
import { adviceOf, diagnose, summaryLine } from '@kit/viewdata';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (d: PartDoc) => { const s = await Session.open(d); sessions.push(s); return s; };
const fail = (r: unknown) => JSON.stringify((r as { errors?: unknown; schemaError?: unknown }).errors ?? (r as { schemaError?: unknown }).schemaError ?? r);

type V3 = [number, number, number];
const AX = ['x', 'y', 'z'] as const;
const NAMED = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;

/** A plate or shaft: a closed profile on a standard plane, extruded. `around` is the circle centre or rectangle corner in the sketch. */
function body(plane: 'front' | 'top' | 'right', shape: { circle: [number, number, number] } | { rect: [number, number, number, number] }, depth: number): PartDoc {
  const sketch = 'circle' in shape
    ? { type: 'sketch', id: 'F1', plane: { kind: 'std', id: plane }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: shape.circle[0], y: shape.circle[1] }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: shape.circle[2] }], constraints: [] }
    : (() => {
      const [x0, y0, x1, y1] = shape.rect;
      return { type: 'sketch', id: 'F1', plane: { kind: 'std', id: plane }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: x0, y: y0 }, { id: 'b', x: x1, y: y0 }, { id: 'c', x: x1, y: y1 }, { id: 'd', x: x0, y: y1 }],
        entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([id, p1, p2]) => ({ id, type: 'line', p1, p2 })), constraints: [] };
    })();
  return { ...emptyPart('Test'), features: [sketch, { type: 'extrude', id: 'F2', name: 'Body', op: 'add', sketch: 'F1', end: 'blind', depth }], seq: 3 } as unknown as PartDoc;
}

interface Cap { face: string; origin: V3; axis: (typeof NAMED)[number]; k: number; sign: 1 | -1 }
/** The two caps of the extrude as the wizard sees them: the face name, the centre of the face and the axis into the body. */
async function caps(s: Session): Promise<Cap[]> {
  const names = (await s.facts()).faces.filter((f) => /^F2\.C[01]$/.test(f));
  const items = await s.describe(names);
  return names.map((face, i) => {
    const it = items[i] as { normal?: string; centroid?: number[] };
    const m = /^([+-])([xyz])$/.exec(String(it.normal));
    if (!m) throw new Error(`cap ${face} is not axis aligned: ${it.normal}`);
    const k = AX.indexOf(m[2] as 'x');
    const outward = m[1] === '+' ? 1 : -1;
    // the wizard's axis runs into the body: against the outward normal
    return { face, origin: it.centroid!.map((v) => Math.round(v * 1000) / 1000 + 0) as V3, axis: NAMED[k * 2 + (outward > 0 ? 1 : 0)], k, sign: outward as 1 | -1 };
  });
}

const placed = (c: Cap, extra: Partial<BearingParams> = {}): BearingParams => ({ ...DEFAULT_BEARING, origin: c.origin, axis: c.axis, placedOn: c.face, placedAt: { origin: c.origin, axis: c.axis }, seat: true, ...extra });
async function addBearing(s: Session, p: BearingParams): Promise<void> {
  const r = await s.edit(bearingOps(s.document as never, p), 'bearing');
  expect(r.ok, fail(r)).toBe(true);
}
const setDepth = (s: Session, depth: number) => s.edit([{ op: 'set', id: 'F2', path: 'depth', value: depth } as never], 'length');

/** Volumes and centres of every body, the shaft or plate first (the biggest). */
async function bodies(s: Session) {
  const mp = await s.massProps({ bodies: true });
  return (mp.bodies ?? []).map((b) => ({ volume: b.volume, com: b.com })).sort((a, b) => b.volume - a.volume);
}
const seat = bearingSeat(DEFAULT_BEARING);
const pocket = Math.PI * (seat.diameter / 2) ** 2 * DEFAULT_BEARING.width;

describe('bearings placed on the ends of a shaft follow the end faces', { skip: !process.env.CK_WASM }, () => {
  // The owner's part: a 30 mm shaft (a sketch and an extrude, off the origin), a 608 with its housing seat at each end.
  const R = 15, shaft = (len: number) => body('right', { circle: [-11, 9, R] }, len);
  /** the shaft runs along +x from 0; world centre of the circle is y = 9, z = 11 */
  async function assertModel(s: Session, len: number): Promise<void> {
    const b = await bodies(s);
    expect(b.length, 'shaft + two rings at each end').toBe(5);
    // the shaft lost exactly the two seat pockets
    expect(b[0].volume).toBeCloseTo(Math.PI * R * R * len - 2 * pocket, 1);
    // the bearings sit on their end faces: ring centres half a width inside, on the shaft axis
    const rings = b.slice(1);
    const near = rings.filter((x) => Math.abs(x.com[0] - 3.5) < 0.05).length;
    const far = rings.filter((x) => Math.abs(x.com[0] - (len - 3.5)) < 0.05).length;
    expect({ near, far }).toEqual({ near: 2, far: 2 });
    for (const x of rings) { expect(x.com[1]).toBeCloseTo(9, 2); expect(x.com[2]).toBeCloseTo(11, 2); }
    expect((await s.validate()).ok).toBe(true);
  }
  it('30 mm shaft, a bearing with a seat at each end; 20, 40 and 30 again: it still builds and the bearings stay on the ends', async () => {
    const s = await open(shaft(30));
    const [c0, c1] = (await caps(s)).sort((a, b) => a.origin[0] - b.origin[0]);
    expect([c0.axis, c1.axis]).toEqual(['px', 'nx']);
    await addBearing(s, placed(c1));
    await addBearing(s, placed(c0));
    await assertModel(s, 30);
    const volumes30 = (await bodies(s)).map((x) => x.volume);
    for (const len of [20, 40, 30]) {
      const r = await setDepth(s, len);
      expect(r.ok, `length ${len}: ${fail(r)}`).toBe(true);
      await assertModel(s, len);
    }
    expect((await bodies(s)).map((x) => x.volume)).toEqual(volumes30);
  }, 240000);

  it('a bearing placed by numbers (no face) keeps its position: the edit that moves the end face away from it is refused', async () => {
    const s = await open(shaft(30));
    const [, c1] = (await caps(s)).sort((a, b) => a.origin[0] - b.origin[0]);
    await addBearing(s, placed(c1, { placedAt: null }));
    const r = await setDepth(s, 20);
    expect(r.ok).toBe(false);
    // the message says what went away and what to do (not just "it cuts nothing")
    const d = diagnose((r.errors ?? []).map(([id, e]) => ({ id, code: e.code, params: e.params })), s.document.features as never);
    expect(d.roots[0].seat).toBe('fixed');
    expect(summaryLine(d)).toMatch(/Bearing 608 seat: the bearing seat no longer touches the part, it was placed at a fixed position\./);
    expect(adviceOf(d.roots[0])).toMatch(/delete the bearing and add it again from the face/);
  }, 120000);

  it('an open bearing (balls) on the end face follows it too', async () => {
    const s = await open(shaft(30));
    const [, c1] = (await caps(s)).sort((a, b) => a.origin[0] - b.origin[0]);
    await addBearing(s, placed(c1, { seal: 'open' }));
    for (const len of [22, 30]) {
      const r = await setDepth(s, len);
      expect(r.ok, `length ${len}: ${fail(r)}`).toBe(true);
      const b = await bodies(s);
      expect(b.length).toBe(1 + 2 + 7);   // shaft, two rings, seven balls
      const rest = b.slice(1);
      expect(rest.every((x) => Math.abs(x.com[0] - (len - 3.5)) < 0.05)).toBe(true);
      expect(b[0].volume).toBeCloseTo(Math.PI * R * R * len - pocket, 1);
    }
  }, 240000);
});

describe('bearings follow a face in every direction and away from the origin', { skip: !process.env.CK_WASM }, () => {
  // a 40 x 30 plate off the origin, extruded from each standard plane; a bearing on each of its two faces (the frame of a face differs by direction: the
  // up axis, the x axis and the sign of the normal all change), then the plate made thicker and thinner.
  for (const plane of ['front', 'top', 'right'] as const) {
    it(`plate sketched on ${plane}: bearings on both faces follow the thickness`, async () => {
      const t = 20;
      const s = await open(body(plane, { rect: [20, 15, 60, 45] }, t));
      const cs = await caps(s);
      expect(cs.length).toBe(2);
      for (const c of cs) await addBearing(s, placed(c));
      const k = cs[0].k;
      expect(cs.every((c) => c.k === k)).toBe(true);
      const check = async (thick: number) => {
        const b = await bodies(s);
        expect(b.length).toBe(5);
        const plateVol = 40 * 30 * thick - 2 * pocket;
        expect(b[0].volume).toBeCloseTo(plateVol, 1);
        const start = 0;   // the sketch plane stays; the other face moves
        const rings = b.slice(1).map((x) => x.com[k]).sort((p, q) => p - q);
        // two rings on each face, half a width inside it
        const lowFace = start, highFace = start + thick;
        const want = [lowFace + 3.5, lowFace + 3.5, highFace - 3.5, highFace - 3.5];
        want.forEach((w, i) => expect(rings[i], `${plane} ring ${i} at thickness ${thick}`).toBeCloseTo(w, 1));
        expect((await s.validate()).ok).toBe(true);
      };
      await check(t);
      for (const thick of [26, 18, 20]) {
        const r = await setDepth(s, thick);
        expect(r.ok, `thickness ${thick}: ${fail(r)}`).toBe(true);
        await check(thick);
      }
    }, 240000);
  }
});

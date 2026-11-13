import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import { bodyShapes, faceMoments, faceVolumes, listBodies, matchLumps, readBodyFields, type BodyRow } from './bodies';
import { lipJointOps, splitOps } from './featureCreators';

// The Bodies list of a shelled box cut by a split or a lip joint: the halves carry the names the feature gives them (names: [below, above]).
const sketch = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 40, y: 0 }, { id: 'c', x: 40, y: 25 }, { id: 'd', x: 0, y: 25 }],
  entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([id, p1, p2]) => ({ type: 'line', id, p1, p2 })), constraints: [] };
const base = [sketch, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10, name: 'Case' }, { type: 'shell', id: 'F3', faces: ['F2.C1'], thickness: 2 }];
/** a notch in the left wall, `depth` mm up from the bottom: below 5 mm it meets the Base only, through all (10) both halves */
const notch = (id: string, depth: number, target?: unknown) => [
  { type: 'sketch', id: id + 's', plane: { kind: 'std', id: 'front' },
    points: [{ id: 'a', x: -1, y: 9 }, { id: 'b', x: 3, y: 9 }, { id: 'c', x: 3, y: 16 }, { id: 'd', x: -1, y: 16 }],
    entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([i, p1, p2]) => ({ type: 'line', id: i, p1, p2 })), constraints: [] },
  { type: 'extrude', id, op: 'cut', sketch: id + 's', end: 'blind', depth, flip: true, ...(target ? { target } : {}) },
];

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world(features: unknown[]) {
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load({ ...emptyPart('Case'), features } as unknown as PartDoc);
  return c;
}
/** the rows as the Bodies panel lists them (waits for the kernel's lump names) */
async function names(c: Controller, want?: string[]): Promise<string[]> {
  const n = 2;
  let rows: BodyRow[] = [];
  await vi.waitFor(() => {
    const m = c.selModel()!;
    const docNames = c.lumps.length ? matchLumps(bodyShapes(m.bodies(), faceMoments(c.bodyFaces())), c.lumps) : undefined;
    rows = listBodies(m.bodies(), readBodyFields(c.document()), { ...(docNames ? { docNames } : {}), volumes: faceVolumes(c.bodyFaces()) });
    expect(rows.length).toBe(n);
    expect(rows.every((r) => r.named)).toBe(true);
    if (want) expect(rows.map((r) => r.name).sort()).toEqual(want);
  }, { timeout: 30000, interval: 100 });
  return rows.map((r) => r.name).sort();
}
const feats = (c: Controller) => (c.document()?.features ?? []) as unknown as Array<Record<string, unknown>>;

describe('the halves of a split or lip joint in the Bodies list', { skip: !process.env.CK_WASM }, () => {
  it('a lip joint names them Base and Lid, and the editor changes the names', async () => {
    const c = await world([...base, { type: 'lipJoint', id: 'F4', plane: { kind: 'std', id: 'front' }, offset: 5, height: 1.5, widthRatio: 0.5, clearance: 0.2, names: ['Base', 'Lid'] }]);
    expect(await names(c)).toEqual(['Base', 'Lid']);
    // what the editor writes when a name is typed
    expect((await c.commit([{ op: 'set', id: 'F4', path: 'names', value: ['Bottom', 'Top'] }] as never, 'names')).ok).toBe(true);
    expect(await names(c, ['Bottom', 'Top'])).toEqual(['Bottom', 'Top']);
  });
  it('the Split body and Lip joint commands start with Base and Lid', async () => {
    for (const ops of [splitOps, lipJointOps]) {
      const c = await world(base);
      const o = ops({ box: { min: [0, 0, 0], max: [40, 25, 10] }, doc: null, mode: 'none', selection: [] } as never)!;
      expect((await c.commit(o, 'add')).ok).toBe(true);
      expect(await names(c)).toEqual(['Base', 'Lid']);
    }
  });
  it('the names stay through later cuts, also one aimed at the Lid', async () => {
    const c = await world([...base, { type: 'split', id: 'F4', plane: { kind: 'std', id: 'front' }, offset: 5, names: ['Base', 'Lid'] }, ...notch('F5', 4)]);
    expect(await names(c)).toEqual(['Base', 'Lid']);
    const r = await c.commit(notch('F7', 10, { body: 'Lid' }).map((feature) => ({ op: 'add', feature })) as never, 'cut');
    expect(JSON.stringify(r)).toContain('"ok":true');
    // the kernel's bodies: both still named, the base keeps the notch of F5 only (the Lid-aimed cut did not reach it)
    const lumps = async () => ((await sessions.at(-1)!.massProps({ bodies: true })) as { bodies: Array<{ name?: string; volume: number }> }).bodies;
    await vi.waitFor(async () => expect((await lumps()).map((b) => b.name).sort()).toEqual(['Base', 'Lid']), { timeout: 30000, interval: 200 });
    const after = await lumps();
    const plain = await world([...base, { type: 'split', id: 'F4', plane: { kind: 'std', id: 'front' }, offset: 5, names: ['Base', 'Lid'] }, ...notch('F5', 4)]);
    await names(plain);
    const before = await lumps();
    expect(before.length).toBe(2);
    expect(after.find((b) => b.name === 'Base')!.volume).toBeCloseTo(before.find((b) => b.name === 'Base')!.volume, 6);
    expect(after.find((b) => b.name === 'Lid')!.volume).toBeLessThan(before.find((b) => b.name === 'Lid')!.volume - 1e-6);
  });
  it('without names the halves are listed by the feature that made them', async () => {
    const c = await world([...base, { type: 'split', id: 'F4', plane: { kind: 'std', id: 'front' }, offset: 5 }]);
    await vi.waitFor(() => expect(c.selModel()!.bodies().length).toBe(2));
  });
});

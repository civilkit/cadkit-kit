import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import { bodyShapes, faceMoments, faceVolumes, listBodies, matchLumps, readBodyFields, type BodyRow } from './bodies';
import { nextBodyName, opPatch } from './extrudeOp';
import { combineBodyOps, copyBodyOps, freeBodyName, removeBodyOps, renameBodyOps, usedBodyNames, type BodyTarget } from './bodyOps';

const sq = (id: string, x: number, y: number, w: number) => ({ type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x, y }, { id: 'p2', x: x + w, y }, { id: 'p3', x: x + w, y: y + w }, { id: 'p4', x, y: y + w }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] });
const ext = (id: string, sketch: string, depth: number, extra: Record<string, unknown> = {}) => ({ type: 'extrude', id, op: 'newBody', sketch, end: 'blind', depth, ...extra });
// a 10 mm block named Block and a 6 mm one named Peg that overlaps it (a new body stays separate)
const doc = (): PartDoc => ({ ...emptyPart('Two'), features: [sq('F1', 0, 0, 10), ext('F2', 'F1', 10, { body: 'Block' }), sq('F3', 5, 0, 6), ext('F4', 'F3', 6, { body: 'Peg' })] }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world() {
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc());
  return c;
}
/** the rows as the Bodies list shows them */
async function rowsOf(c: Controller, n: number, names?: string[]): Promise<BodyRow[]> {
  let rows: BodyRow[] = [];
  await vi.waitFor(() => {
    const m = c.selModel()!;
    const docNames = matchLumps(bodyShapes(m.bodies(), faceMoments(c.bodyFaces())), c.lumps);
    rows = listBodies(m.bodies(), readBodyFields(c.document()), { docNames, volumes: faceVolumes(c.bodyFaces()) });
    expect(rows.length).toBe(n);
    if (names) expect(rows.map((r) => r.name).sort()).toEqual(names);
    expect(rows.every((r) => r.docName)).toBe(true);   // the names of the kernel's lumps arrive after the result
  });
  return rows;
}
const target = (r: BodyRow): BodyTarget => ({ ...(r.docName ? { docName: r.docName } : {}), face: [...r.faces].sort()[0] });
const feats = (c: Controller) => (c.document()?.features ?? []) as unknown as Array<Record<string, unknown>>;

describe('body edits on the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('the list shows the names the document gives, not the feature names', async () => {
    const c = await world();
    await rowsOf(c, 2, ['Block', 'Peg']);
  });
  it('copy makes a named copy in place; the three bodies are listed by their names', async () => {
    const c = await world();
    const peg = (await rowsOf(c, 2)).find((r) => r.name === 'Peg')!;
    const name = freeBodyName(usedBodyNames(feats(c)), 'Peg');
    expect((await c.commit(copyBodyOps(target(peg), name), 'bodies')).ok).toBe(true);
    await rowsOf(c, 3, ['Block', 'Peg', 'Peg 2']);
  });
  it('rename in the document changes the body and every feature that refers to it', async () => {
    const c = await world();
    const peg = (await rowsOf(c, 2)).find((r) => r.name === 'Peg')!;
    await c.commit(copyBodyOps(target(peg), 'Peg 2'), 'bodies');
    await rowsOf(c, 3);
    const rn = await c.commit(renameBodyOps(feats(c), 'Peg', 'Pin')!, 'bodies');
    expect(rn.ok).toBe(true);
    await rowsOf(c, 3, ['Block', 'Peg 2', 'Pin']);
    expect(JSON.stringify(feats(c).find((f) => f.type === 'moveBody'))).toContain('"body":"Pin"');
  });
  it('remove deletes the body; combine joins the first with the others and uses them up', async () => {
    const c = await world();
    let rows = await rowsOf(c, 2);
    const block = rows.find((r) => r.name === 'Block')!, peg = rows.find((r) => r.name === 'Peg')!;
    const rr = await c.commit(combineBodyOps('cut', target(block), [target(peg)]), 'bodies');
    expect(rr.ok).toBe(true);
    rows = await rowsOf(c, 1, ['Block']);
    expect(rows[0].volume).toBeLessThan(1000);   // the peg was cut out of the block
    expect((await c.commit(removeBodyOps([target(rows[0])]), 'bodies')).ok).toBe(true);
    await vi.waitFor(() => expect(c.selModel()?.bodies().length ?? 0).toBe(0));
  });
  it('the Operation control: switching an extrude to New body names it and keeps it apart, switching back joins it', async () => {
    const c = await world();   // Block and Peg overlap, both newBody
    // make Peg an Add: the two merge into one body, the name is dropped
    expect((await c.commit([{ op: 'set', id: 'F4', path: 'op', value: 'add' }, { op: 'set', id: 'F4', path: 'body', value: null }] as never, 'op')).ok).toBe(true);
    await vi.waitFor(() => expect(c.selModel()!.bodies().length).toBe(1));
    // and back to New body with the name the control proposes
    const f4 = feats(c).find((f) => f.id === 'F4')!;
    const patch = opPatch('new', f4, usedBodyNames(feats(c).filter((f) => f.id !== 'F4')));
    expect(patch.body).toBe(nextBodyName(new Set(['Block'])));
    expect((await c.commit(Object.entries(patch).map(([path, value]) => ({ op: 'set', id: 'F4', path, value })) as never, 'op')).ok).toBe(true);
    await rowsOf(c, 2, ['Block', 'Body 1']);
  });
  it('a revolve can be a new body too', async () => {
    const c = await world();
    const rev = { type: 'revolve', id: 'F6', op: 'newBody', body: 'Spin', sketch: 'F5', axis: 'e5', angle: 360, end: 'blind' };
    const sk = { type: 'sketch', id: 'F5', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 20, y: 0 }, { id: 'b', x: 25, y: 0 }, { id: 'c', x: 25, y: 5 }, { id: 'd', x: 20, y: 5 }, { id: 'up', x: 0, y: 10 }],
      entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a'], ['e5', 'O', 'up']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] };
    const r = await c.commit([{ op: 'add', feature: sk }, { op: 'add', feature: rev }] as never, 'rev');
    expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
    await rowsOf(c, 3, ['Block', 'Peg', 'Spin']);
  });
});

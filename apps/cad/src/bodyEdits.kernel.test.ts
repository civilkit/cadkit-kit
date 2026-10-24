import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import { bodyShapes, faceMoments, faceVolumes, listBodies, matchLumps, readBodyFields, type BodyRow } from './bodies';
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
});

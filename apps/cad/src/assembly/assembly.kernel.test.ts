import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../controller';
import { displayBody } from './display';
import { bomItems, insertFeature, insertIds, NO_PLACEMENT } from './model';
import { mateFeature, newDraft } from './mateKinds';
import { densityOf } from '../inspect/mass';

const sample = (): PartDoc => JSON.parse(readFileSync('apps/cad/public/samples/assembly-block-bolt.ckpart', 'utf8')) as PartDoc;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function load(doc: PartDoc) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const bodies: unknown[] = [];
  const c = new Controller({ store: createStore(), view: { setBody(b) { bodies.push(b); }, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc);
  return { c, bodies };
}

describe('assembly against the kernel', () => {
  it('the block-with-bolt sample rebuilds and reports the degrees of freedom the two mates leave', async () => {
    const { c } = await load(sample());
    expect(c.components().map((x) => [x.id, x.dof])).toEqual([['F1', 0], ['F2', 1]]);
  });
  it('insert part, then a distance mate, changes the bolt DOF; a deleted mate gives it back', async () => {
    const { c } = await load(sample());
    const d = c.document()!;
    const bolt = (d.features[1] as unknown as { part: Record<string, unknown> }).part;
    expect((await c.edit([{ op: 'add', feature: insertFeature(bolt, { ...NO_PLACEMENT, dx: 100 }, { name: 'Bolt 2' }) }])).ok).toBe(true);
    const id = c.document()!.features.at(-1)!.id;
    expect(c.components().find((x) => x.id === id)?.dof).toBe(6);
    const m = newDraft('coincident');
    m.refs = { a: `F2.C0@${id}.1`, b: 'F2.C1@F1.1' };
    expect((await c.edit([{ op: 'add', feature: mateFeature(m) }])).ok).toBe(true);
    expect(c.components().find((x) => x.id === id)?.dof).toBe(3);
    const mateId = c.document()!.features.at(-1)!.id;
    expect((await c.edit([{ op: 'remove', id: mateId }])).ok).toBe(true);
    expect(c.components().find((x) => x.id === id)?.dof).toBe(6);
  });
  it('the kernel rejects a kind it does not solve (angle, hinge) with mateGeometry and leaves the document', async () => {
    const { c } = await load(sample());
    const before = c.document()!.features.length;
    const m = newDraft('coincident');
    m.refs = { a: 'F2.C0@F2.1', b: 'F2.C1@F1.1' };
    const f = { ...mateFeature(m), kind: 'hinge' };
    const r = await c.edit([{ op: 'add', feature: f }]);
    expect(r.ok).toBe(false);
    expect(c.document()!.features.length).toBe(before);
  });
  it('interference finds none for the clearance hole, and the bolt pushed into the block interferes', async () => {
    const { c } = await load(sample());
    expect((await c.interference())!.pairs).toEqual([]);
    const m = newDraft('coincident');
    // bring the bolt head down into the block: distance mate, head underside 5 mm inside the top face
    const f = { ...mateFeature({ ...m, kind: 'distance', refs: { a: 'F2.C0@F2.1', b: 'F2.C1@F1.1' }, params: { distance: -5 } }), id: 'F3' };
    expect((await c.edit([{ op: 'replace', id: 'F3', feature: f }])).ok).toBe(true);
    const r = (await c.interference())!;
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0].error).toBeUndefined();
    expect(r.pairs[0].volume!).toBeGreaterThan(100);
  });
  it('BOM masses come from each part measured alone', async () => {
    const { c } = await load(sample());
    const d = c.document()!;
    const vols = new Map<string, number | null>();
    for (const f of d.features) if (f.type === 'insertPart') vols.set(JSON.stringify((f as unknown as { part: unknown }).part), (await c.partMass((f as unknown as { part: unknown }).part)).volume);
    const items = bomItems(d as never, (p) => vols.get(JSON.stringify(p)) ?? null);
    expect(items.map((i) => i.part)).toEqual(['Block 40x40x20', 'Bolt M8x30']);
    expect(items[0].massEach!).toBeCloseTo((40 * 40 * 20 - Math.PI * 4.2 * 4.2 * 20) * densityOf('aluminium')! / 1000, 0);
  });
  it('the exploded view is kept in the document and read back; hiding a component drops only its triangles from the shown body', async () => {
    const { c, bodies } = await load(sample());
    c.setDocExtra('explode', { spread: 1, dir: 'auto', manual: { F2: [0, 0, 30] } });
    expect((c.document() as unknown as { explode: { spread: number } }).explode.spread).toBe(1);
    const again = await load(c.document()!);
    expect((again.c.document() as unknown as { explode: unknown }).explode).toEqual({ spread: 1, dir: 'auto', manual: { F2: [0, 0, 30] } });
    c.setDocExtra('explode', null);
    expect('explode' in (c.document() as object)).toBe(false);
    const body = bodies.at(-1) as never;
    const ins = insertIds(c.document() as never);
    const all = (body as { mesh: { triFace: Int32Array } }).mesh.triFace.length;
    const shown = displayBody(body, { inserts: ins, hidden: new Set(['F2']), explode: { spread: 0, dir: 'auto', manual: {} } }) as { mesh: { triFace: Int32Array } };
    expect(shown.mesh.triFace.length).toBeLessThan(all);
    expect(shown.mesh.triFace.length).toBeGreaterThan(0);
  });
});

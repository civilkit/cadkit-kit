import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { readVars } from '../variables';
import { GH_BASE, fakeNet, makeRegistry } from './testkit';
import { insertPart, openText } from './actions';
import { liveSources } from './insert';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  // a document that already has a variable called `w`, the same name the library parts use
  const doc = { ...emptyPart('Host'), variables: [{ name: 'w', expr: '7' }] } as unknown as PartDoc;
  await controller.load(doc);
  const net = fakeNet([GH_BASE]);
  const { registry } = makeRegistry(net);
  const lib = await registry.add(await registry.preview('github:example/parts'));
  const size = () => { const b = controller.bodyBox()!; return b.max.map((m, i) => +(m - b.min[i]).toFixed(3)).sort((a, c) => a - c); };
  return { controller, registry, lib, size };
}

describe('library Insert against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('inserting the same part twice: variables do not clash, one undo step each, provenance recorded', async () => {
    const w = await world();
    const hist = () => (w.controller as unknown as { session: Session }).session.history().length;
    const part = await w.registry.part(w.lib.id, 'block-small');
    const h0 = hist();

    const a = await insertPart(w.controller, w.lib, part);
    expect(a.ok).toBe(true);
    expect(hist()).toBe(h0 + 1);
    expect(w.size()).toEqual([5, 10, 10]);
    const b = await insertPart(w.controller, w.lib, part);
    expect(b.ok).toBe(true);
    expect(hist()).toBe(h0 + 2);

    const names = readVars(w.controller.document()).map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['w', 'blocksmall_1_w', 'blocksmall_2_w', 'blocksmall_2_t']));
    expect(readVars(w.controller.document()).find((v) => v.name === 'w')!.expr).toBe('7');   // the host's own variable is untouched
    const doc = w.controller.document()!;
    expect(doc.features.map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4']);

    const src = liveSources(doc);
    expect(src).toHaveLength(2);
    expect(src[0]).toMatchObject({ library: 'Fixture parts', partId: 'block-small', licence: 'CC0-1.0', ref: 'HEAD', features: ['F1', 'F2'] });
    expect(src[1].features).toEqual(['F3', 'F4']);
    expect(src[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(JSON.stringify(doc)).sources).toHaveLength(2);   // saved with the document

    // each insert is one undo step
    await w.controller.undo();
    expect(w.controller.document()!.features.map((f) => f.id)).toEqual(['F1', 'F2']);
    expect(liveSources(w.controller.document())).toHaveLength(1);
    await w.controller.undo();
    expect(w.controller.document()!.features).toHaveLength(0);
    expect(liveSources(w.controller.document())).toHaveLength(0);
    expect(readVars(w.controller.document()).map((v) => v.name)).toEqual(['w']);
  });

  it('a variable edit of one inserted copy leaves the other alone', async () => {
    const w = await world();
    const part = await w.registry.part(w.lib.id, 'block-small');
    await insertPart(w.controller, w.lib, part);
    await insertPart(w.controller, w.lib, part);
    const vars = readVars(w.controller.document()).map((v) => (v.name === 'blocksmall_2_t' ? { ...v, expr: '20' } : v));
    expect((await w.controller.applyDocPatch({ variables: vars }, 'variables.set')).ok).toBe(true);
    // both blocks are 10 x 10; depths are 5 and 20 and they overlap, so the union is 20 deep
    expect(w.size()).toEqual([10, 10, 20]);
  });

  it('Open as new document loads the part with its provenance and keeps it through a save', async () => {
    const w = await world();
    const part = await w.registry.part(w.lib.id, 'block-wide');
    await w.controller.load(JSON.parse(openText(w.lib, part)) as PartDoc);
    expect(w.size()).toEqual([4, 10, 30]);
    const src = liveSources(w.controller.document());
    expect(src).toHaveLength(1);
    expect(src[0]).toMatchObject({ partId: 'block-wide', features: ['F1', 'F2'] });
  });
});

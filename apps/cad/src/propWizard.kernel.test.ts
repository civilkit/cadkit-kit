// The wizard's commit path against the real kernel through the Controller: a new propeller is ONE document patch (variables + features), the preview
// uses plain numbers, an edit with the same structure is one step, a changed section count is two, a variable edit rebuilds the hub, undo removes it.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { DEFAULT_PROP, freePrefix, propOps, propOwner, propPlan, type PropParams } from './propData';
import { readVars } from './variables';
import { folderIds } from './treeFolders';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(emptyPart('Prop') as unknown as PartDoc);
  const box = () => controller.bodyBox()!;
  return { controller, box };
}
const P = (o: Partial<PropParams> = {}): PropParams => ({ ...DEFAULT_PROP, sections: 5, blades: 2, ...o });

describe('propeller wizard commit path against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('create: a preview of plain numbers builds in the empty document, Create is one patch with the variables, undo removes it all', async () => {
    const w = await world();
    const p = P();
    const prev = await w.controller.preview(propOps(w.controller.document() as never, p), 0);
    expect(prev.ok, JSON.stringify(prev.errors)).toBe(true);
    await w.controller.cancelPreview();
    expect(w.controller.document()!.features.length).toBe(0);
    const plan = propPlan(w.controller.document() as never, p);
    expect(plan.before).toEqual([]);
    const r = await w.controller.applyDocPatch(plan.patch as never, 'propeller');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const d = w.controller.document()!;
    expect(readVars(d).map((v) => v.name)).toEqual(['prop_hub_d', 'prop_hub_len', 'prop_bore_d', 'prop_blades']);
    expect(d.features.length).toBe(2 + 2 * 5 + 2 + 2);
    expect(w.box().max[0]).toBeCloseTo(60, 3);
    expect(w.controller.history().length).toBe(1);
    // reading the record back finds the owner from any of its features
    expect(propOwner(d.features as unknown[], 'F5')?.params).toEqual(p);
    await w.controller.undo();
    expect(w.controller.document()!.features.length).toBe(0);
    expect(readVars(w.controller.document()).length).toBe(0);
  }, 300000);

  it('edit with the same structure is one step and keeps the ids; a variable edit rebuilds only the hub', async () => {
    const w = await world();
    await w.controller.applyDocPatch(propPlan(w.controller.document() as never, P()).patch as never, 'propeller');
    const d0 = w.controller.document()!;
    const owner = propOwner(d0.features as unknown[], 'F1')!;
    const next = { ...owner.params, diameter: 100, pitch: 70 };
    const plan = propPlan(d0 as never, next, owner.roles);
    expect(plan.before).toEqual([]);
    expect(plan.patch.append).toBeUndefined();
    expect((await w.controller.applyDocPatch(plan.patch as never, 'propeller')).ok).toBe(true);
    expect(w.controller.history().length).toBe(2);
    expect(w.controller.document()!.features.map((f) => f.id)).toEqual(d0.features.map((f) => f.id));
    expect(w.box().max[0]).toBeCloseTo(50, 3);
    // the user edits the hub length variable in the Variables panel
    const vars = readVars(w.controller.document()).map((v) => (v.name === 'prop_hub_len' ? { ...v, expr: '30' } : v));
    expect((await w.controller.applyDocPatch({ variables: vars }, 'variables.set')).ok).toBe(true);
    expect(w.box().max[2] - w.box().min[2]).toBeGreaterThanOrEqual(30 - 1e-6);
    expect(w.box().max[0]).toBeCloseTo(50, 3);
  }, 300000);

  it('edit that changes the section count (or drops the bore) removes the old features first: two steps, the next prefix is free', async () => {
    const w = await world();
    await w.controller.applyDocPatch(propPlan(w.controller.document() as never, P()).patch as never, 'propeller');
    const d0 = w.controller.document()!;
    const owner = propOwner(d0.features as unknown[], 'F1')!;
    const plan = propPlan(d0 as never, { ...owner.params, sections: 7, boreDia: 0 }, owner.roles);
    expect(plan.before.length).toBe(d0.features.length);
    expect((await w.controller.commit(plan.before, 'propeller')).ok).toBe(true);
    expect(w.controller.document()!.features.length).toBe(0);
    expect((await w.controller.applyDocPatch(plan.patch as never, 'propeller')).ok).toBe(true);
    const d1 = w.controller.document()!;
    expect(d1.features.length).toBe(2 + 2 * 7 + 2);
    expect(readVars(d1).map((v) => v.name)).not.toContain('prop_bore_d');   // ours are replaced by the new record's variables
    expect(w.controller.history().length).toBe(3);
    // a second propeller in the same document would use the next prefix, so the first one's variables stay
    expect(freePrefix(readVars(d1))).toBe('prop2');
  }, 400000);

  it('the propeller sits in one folder; editing it keeps the folder (renamed too); deleting the folder removes exactly its features, one undo step', async () => {
    const w = await world();
    await w.controller.applyDocPatch(propPlan(w.controller.document() as never, P()).patch as never, 'propeller');
    const feats = () => w.controller.document()!.features as unknown as Array<{ id: string; type: string; group?: string }>;
    const n = feats().length;
    expect(new Set(feats().map((f) => f.group))).toEqual(new Set(['Propeller']));
    // the user renames the folder, then re-opens the wizard and changes a size: still the renamed folder
    await w.controller.edit(feats().map((f) => ({ op: 'set' as const, id: f.id, path: 'group', value: 'Drive prop' })));
    const owner = propOwner(feats() as never, 'F1')!;
    const plan = propPlan(w.controller.document() as never, { ...owner.params, diameter: 100 }, owner.roles);
    expect((await w.controller.applyDocPatch(plan.patch as never, 'propeller')).ok).toBe(true);
    expect(new Set(feats().map((f) => f.group))).toEqual(new Set(['Drive prop']));
    // delete the folder: everything it holds goes in one step
    const rows = feats().map((f) => ({ id: f.id, type: f.type, group: f.group }));
    const ids = folderIds(rows, feats(), 'Drive prop');
    expect(ids.length).toBe(n);
    const before = w.controller.history().length;
    expect((await w.controller.deleteFeatures(ids))?.ok).toBe(true);
    expect(feats().length).toBe(0);
    expect(w.controller.history().length).toBe(before + 1);
    await w.controller.undo();
    expect(feats().length).toBe(n);
  }, 300000);
});

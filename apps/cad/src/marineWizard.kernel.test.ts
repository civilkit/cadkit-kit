// The marine wizard's commit path against the real kernel through the Controller: the preview builds in an empty document, Create is ONE document patch, the record is
// found from any feature (and the airfoil reader does not claim it), an edit that keeps the section count is one step and keeps the ids, a changed section count is two
// steps, undo removes it, and the presets build.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { DEFAULT_MARINE, MARINE_PRESETS, helicoidStations, marineOps, marineOwner, marinePlan, marineRoles, type MarineParams } from './marineData';
import { propOwner } from './propData';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(emptyPart('Marine') as unknown as PartDoc);
  const box = () => controller.bodyBox()!;
  return { controller, box };
}
const P = (o: Partial<MarineParams> = {}): MarineParams => ({ ...DEFAULT_MARINE, ...o });

describe('marine wizard commit path against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('create: the preview builds in the empty document, Create is one patch, the owner is found from any feature, undo removes it all', async () => {
    const w = await world();
    const p = P();
    const prev = await w.controller.preview(marineOps(w.controller.document() as never, p), 0);
    expect(prev.ok, JSON.stringify(prev.errors)).toBe(true);
    await w.controller.cancelPreview();
    expect(w.controller.document()!.features.length).toBe(0);
    const plan = marinePlan(w.controller.document() as never, p);
    expect(plan.before).toEqual([]);
    const r = await w.controller.applyDocPatch(plan.patch as never, 'propeller');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const d = w.controller.document()!;
    expect(d.features.length).toBe(marineRoles(p).length);
    // the tip is at the radius (the skew moves it off +x, so look at the bounding sphere in the xy plane)
    const b = w.box();
    expect(Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]), Math.abs(b.min[1]), Math.abs(b.max[1]))).toBeGreaterThan(p.diameter / 2 - 6);
    expect(w.controller.history().length).toBe(1);
    const owner = marineOwner(d.features as unknown[], 'F5');
    expect(owner?.params).toEqual(p);
    expect(owner?.hubId).toBe('F1');
    expect(propOwner(d.features as unknown[], 'F5')).toBeNull();   // the airfoil reader leaves a marine propeller alone
    await w.controller.undo();
    expect(w.controller.document()!.features.length).toBe(0);
  }, 300000);

  it('an edit that keeps the section count is one step and keeps the ids; a different section count removes the old features first (two steps)', async () => {
    const w = await world();
    await w.controller.applyDocPatch(marinePlan(w.controller.document() as never, P()).patch as never, 'propeller');
    const d0 = w.controller.document()!;
    const owner = marineOwner(d0.features as unknown[], 'F1')!;
    // same ray count: a thickness and a blade count change keep the section structure
    const same = { ...owner.params, thickTip: 0.006 };
    expect(helicoidStations(same).psi.length).toBe(helicoidStations(owner.params).psi.length);
    const plan = marinePlan(d0 as never, same, owner.roles);
    expect(plan.before).toEqual([]);
    expect(plan.patch.append).toBeUndefined();
    expect((await w.controller.applyDocPatch(plan.patch as never, 'propeller')).ok).toBe(true);
    expect(w.controller.history().length).toBe(2);
    expect(w.controller.document()!.features.map((f) => f.id)).toEqual(d0.features.map((f) => f.id));
    expect(marineOwner(w.controller.document()!.features as unknown[], 'F1')?.params.thickTip).toBe(0.006);
    // a different pitch changes the ray count: the old features go first
    const d1 = w.controller.document()!;
    const o1 = marineOwner(d1.features as unknown[], 'F1')!;
    const moved = { ...o1.params, pitchRatio: 1.6, hubLength: 130 };
    expect(helicoidStations(moved).psi.length).not.toBe(helicoidStations(o1.params).psi.length);
    const p2 = marinePlan(d1 as never, moved, o1.roles);
    expect(p2.before.length).toBe(d1.features.length);
    expect((await w.controller.commit(p2.before, 'propeller')).ok).toBe(true);
    expect(w.controller.document()!.features.length).toBe(0);
    expect((await w.controller.applyDocPatch(p2.patch as never, 'propeller')).ok).toBe(true);
    expect(w.controller.document()!.features.length).toBe(marineRoles(moved).length);
    expect(w.controller.history().length).toBe(4);
  }, 600000);

  it('the live preview of an edit (replace and add / remove ops against the existing roles) builds and is cancelled without touching the document', async () => {
    const w = await world();
    await w.controller.applyDocPatch(marinePlan(w.controller.document() as never, P()).patch as never, 'propeller');
    const d0 = w.controller.document()!;
    const owner = marineOwner(d0.features as unknown[], 'F1')!;
    const prev = await w.controller.preview(marineOps(d0 as never, { ...owner.params, ear: 0.6, hubLength: 130 }, owner.roles), 0);
    expect(prev.ok, JSON.stringify(prev.errors)).toBe(true);
    await w.controller.cancelPreview();
    expect(w.controller.document()!.features).toEqual(d0.features);
    // a same-structure edit previews as replacements
    const ops2 = marineOps(d0 as never, { ...owner.params, thickTip: 0.007 }, owner.roles);
    expect(ops2.every((o) => (o as { op: string }).op === 'replace')).toBe(true);
    const prev2 = await w.controller.preview(ops2, 0);
    expect(prev2.ok, JSON.stringify(prev2.errors)).toBe(true);
    await w.controller.cancelPreview();
    expect(w.controller.document()!.features).toEqual(d0.features);
  }, 300000);

  it('every preset builds as one valid solid', async () => {
    for (const [k, o] of Object.entries(MARINE_PRESETS)) {
      const w = await world();
      const p = P(o);
      const r = await w.controller.applyDocPatch(marinePlan(w.controller.document() as never, p).patch as never, 'propeller');
      expect(r.ok, `${k}: ${JSON.stringify(r)}`).toBe(true);
      console.log(`MARINE preset ${k}: ${helicoidStations(p).psi.length} sections, bbox`, JSON.stringify(w.box()).slice(0, 120));
    }
  }, 600000);
});

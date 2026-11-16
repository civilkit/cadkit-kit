// pluginRun.ts on the real kernel through the app's Controller: the ops of a plugin generator preview and commit like a wizard's, in one folder and one undo step.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { builtinRegistry, PluginRegistry } from '@kit/plugin';
import { Controller, type KernelFactory } from './controller';
import { pluginOps, runOfFolder } from './pluginRun';
import { listPlugins, runPluginOnApp } from './agentLink/appPlugin';
import './i18n';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const registry = builtinRegistry();

async function world() {
  const base = await Session.open(emptyPart('base'));
  sessions.push(base);
  const raw = (base as unknown as { kernel: { request(m: Record<string, unknown>): Promise<unknown> } }).kernel;
  let live: Session | null = null;
  const kernel: KernelFactory = { async open(d) { live = new Session(d, raw as never, 'user'); return live; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('Plugins') as PartDoc);
  const host = {
    load: async () => {}, edit: async (ops: never, why?: string) => (await controller.edit(ops, why)) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d: unknown, v?: unknown) => controller.scratchBuild(d as never, v as never) as never,
    release: () => controller.scratchRelease(),
    facts: (need: never) => controller.scratchFacts(need),
  };
  return { controller, host, mass: async () => ((await live!.massProps({ bodies: true })) as unknown as { volume: number; bodies?: Array<{ name?: string }> }) };
}
type Feat = { id: string; group?: string };
const feats = (c: Controller) => (c.document()?.features ?? []) as unknown as Feat[];

describe('plugin generator ops through the Controller', () => {
  it('Case: preview does not touch the document, commit adds one folder in one undo step, undo takes it all back', async () => {
    const w = await world();
    const sel = { pluginId: 'civilkit.enclosures', generatorId: 'case', values: { width: 80, depth: 50, height: 30, wall: 2, radius: 0, topRadius: 0, lidHeight: 15, tongueHeight: 1.5, tongueOn: 'lid', clearance: 0.2, baseName: 'Base', lidName: 'Lid', axis: 'y', x: 0, y: 0, z: 0 } };
    const r = await pluginOps(registry, w.controller.document() as never, sel, w.host as never);
    expect(r.ok, r.ok ? '' : r.message).toBe(true);
    if (!r.ok) return;
    expect(r.group).toBe('Case');
    expect(r.record).toMatchObject({ plugin: 'civilkit.enclosures@0.1.0', generator: 'case' });
    const pv = await w.controller.preview(r.ops, 0);
    expect(pv.ok).toBe(true);
    expect(feats(w.controller)).toHaveLength(0);          // a preview is not a commit
    await w.controller.cancelPreview();
    const c = await w.controller.commit(r.ops, 'plugin');
    expect(c.ok).toBe(true);
    expect([...new Set(feats(w.controller).map((f) => f.group))]).toEqual(['Case']);
    const m = await w.mass();
    expect(Math.abs(m.volume - 28882.24)).toBeLessThan(0.5);   // the Case wizard's guide number
    await w.controller.undo();
    expect(feats(w.controller)).toHaveLength(0);
  }, 300000);

  it('a second run gets its own folder; bad parameters are reported before the kernel is asked', async () => {
    const w = await world();
    const run = (values: Record<string, unknown>) => pluginOps(registry, w.controller.document() as never, { pluginId: 'civilkit.enclosures', generatorId: 'case', values: values as never }, w.host as never);
    const one = await run({ baseName: 'B1', lidName: 'L1', x: -60 });
    expect(one.ok).toBe(true);
    if (one.ok) expect((await w.controller.commit(one.ops, 'plugin')).ok).toBe(true);
    const two = await run({ baseName: 'B2', lidName: 'L2', x: 60 });
    expect(two.ok).toBe(true);
    if (two.ok) { expect(two.group).toBe('Case 2'); expect((await w.controller.commit(two.ops, 'plugin')).ok).toBe(true); }
    expect([...new Set(feats(w.controller).map((f) => f.group))]).toEqual(['Case', 'Case 2']);
    const bad = await run({ wall: 0.1 });
    expect(bad).toMatchObject({ ok: false, message: 'wall must be at least 0.4 mm' });
    const kernelBad = await run({ width: 10, depth: 10, height: 30, wall: 6 });   // passes the schema, refused by caseBox()
    expect(kernelBad.ok).toBe(false);
  }, 300000);

  it('Edit parameters: the folder is replaced in place (same name, same spot), a later feature stays after it, one undo restores the old one', async () => {
    const w = await world();
    const run = (values: Record<string, unknown>, edit?: { group: string; ids: string[] }) => pluginOps(registry, w.controller.document() as never, { pluginId: 'civilkit.enclosures', generatorId: 'case', values: values as never, ...(edit ? { edit } : {}) }, w.host as never);
    const first = await run({ baseName: 'B1', lidName: 'L1', x: -60 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((await w.controller.commit(first.ops, 'plugin')).ok).toBe(true);
    w.controller.setUndoableExtras(first.extras, { withLastEdit: true });
    const before = feats(w.controller).length;
    const ids = feats(w.controller).filter((f) => f.group === 'Case').map((f) => f.id);
    // a renamed folder still finds its record (the record is found by the folder's first feature, not its name)
    const renamedDoc = { ...(w.controller.document() as never as { features: Array<Record<string, unknown>> }), features: (w.controller.document()!.features as unknown as Array<Record<string, unknown>>).map((f) => (f.group === 'Case' ? { ...f, group: 'My kitchen case' } : f)) };
    expect(runOfFolder(renamedDoc as never, 'My kitchen case')).toMatchObject({ generator: 'case' });
    expect(runOfFolder(renamedDoc as never, 'Nothing')).toBeUndefined();
    const edited = await run({ baseName: 'B1', lidName: 'L1', x: -60, width: 100 }, { group: 'Case', ids });
    expect(edited.ok, edited.ok ? '' : edited.message).toBe(true);
    if (!edited.ok) return;
    expect(edited.group).toBe('Case');                                   // the same folder name, not "Case 2"
    expect(edited.extras.pluginRuns).toMatchObject({ Case: { generator: 'case', params: { width: 100 } } });
    const cr = await w.controller.commit(edited.ops, 'plugin');
    expect(cr.ok, JSON.stringify(cr).slice(0, 600) + ' OPS ' + JSON.stringify(edited.ops.slice(0, 4)).slice(0, 500)).toBe(true);
    w.controller.setUndoableExtras(edited.extras, { withLastEdit: true });
    expect([...new Set(feats(w.controller).map((f) => f.group))]).toEqual(['Case']);
    expect(feats(w.controller).some((f) => ids.includes(f.id))).toBe(false);   // new ids, none reused
    expect(Math.abs(((await w.mass()).volume) - 28882.24)).toBeGreaterThan(100);   // a wider case is a different volume
    expect((w.controller.document() as unknown as { pluginRuns: Record<string, { params: { width: number } }> }).pluginRuns.Case.params.width).toBe(100);
    // saved and opened again, the document still knows how the folder was made
    const saved = JSON.parse(JSON.stringify(w.controller.document()));
    const w2 = await world();
    await w2.controller.load(saved);
    expect(runOfFolder(w2.controller.document() as never, 'Case')).toMatchObject({ generator: 'case', params: { width: 100 } });
    // ONE undo takes back the edit, its record included
    await w.controller.undo();
    expect(feats(w.controller).length).toBe(before);
    expect(feats(w.controller).filter((f) => f.group === 'Case').map((f) => f.id)).toEqual(ids);   // the old folder is back, ids and all
    expect((w.controller.document() as unknown as { pluginRuns: Record<string, { params: { width?: number } }> }).pluginRuns.Case.params.width).not.toBe(100);
    await w.controller.redo();
    expect((w.controller.document() as unknown as { pluginRuns: Record<string, { params: { width: number } }> }).pluginRuns.Case.params.width).toBe(100);
  }, 300000);

  it('Edit parameters refuses when something outside the folder is built on it', async () => {
    const w = await world();
    const run = (edit?: { group: string; ids: string[] }) => pluginOps(registry, w.controller.document() as never, { pluginId: 'civilkit.enclosures', generatorId: 'case', values: {} as never, ...(edit ? { edit } : {}) }, w.host as never);
    const first = await run();
    if (!first.ok) throw new Error(first.message);
    await w.controller.commit(first.ops, 'plugin');
    const ids = feats(w.controller).filter((f) => f.group === 'Case').map((f) => f.id);
    const fix = (w.controller.document()!.features as unknown as Array<Record<string, unknown>>).find((f) => f.type === 'extrude')!;
    const add = await w.controller.commit([{ op: 'add', feature: { type: 'extrude', id: 'F900', name: 'Mine', op: 'newBody', body: 'Mine', sketch: fix.sketch, end: 'blind', depth: 1 } }] as never, 'edit');
    expect(add.ok).toBe(true);
    const r = await run({ group: 'Case', ids });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toContain('Mine');
  }, 300000);

  it('Edit parameters can grow the folder: more features than before still land in place, in order, ahead of a later feature', async () => {
    const reg = new PluginRegistry();
    reg.add({ id: 'acme.row', name: 'Row', version: '1.0.0', contributes: { generators: [{ id: 'row', title: 'Row', params: [{ name: 'n', type: 'integer', default: 2, min: 1, max: 9 }] }] } },
      { row: (v) => `const p = part('Row'); for (let i = 0; i < ${Number(v.n)}; i++) p.sketch('front', (s) => s.rect(10, 10, [i * 20, 0])).extrude(5, { newBody: 'B' + i });` });
    const w = await world();
    const run = (n: number, edit?: { group: string; ids: string[] }) => pluginOps(reg, w.controller.document() as never, { pluginId: 'acme.row', generatorId: 'row', values: { n }, ...(edit ? { edit } : {}) }, w.host as never);
    const a = await run(2);
    if (!a.ok) throw new Error(a.message);
    await w.controller.commit(a.ops, 'plugin');
    const ids = feats(w.controller).map((f) => f.id);
    // a later feature that refers to a body by NAME (a Move folder does the same), not by feature id
    const tail = await w.controller.commit([{ op: 'add', feature: { type: 'moveBody', id: 'F900', bodies: [{ body: 'B0' }], translate: [0, 0, 50] } }] as never, 'edit');
    expect(tail.ok).toBe(true);
    const b = await run(5, { group: 'Row', ids });
    expect(b.ok, b.ok ? '' : b.message).toBe(true);
    if (!b.ok) return;
    const c = await w.controller.commit(b.ops, 'plugin');
    expect(c.ok, JSON.stringify(c).slice(0, 400)).toBe(true);
    const f = feats(w.controller);
    expect(f.length).toBe(5 * 2 + 1);                                  // five sketch+extrude pairs, then the user's Tail
    expect(f[f.length - 1].id).toBe('F900');                           // the later feature still comes last
    expect(f.slice(0, -1).every((x) => x.group === 'Row')).toBe(true);
    expect(f.slice(0, -1).map((x) => (x as unknown as { type: string }).type)).toEqual(['sketch', 'extrude', 'sketch', 'extrude', 'sketch', 'extrude', 'sketch', 'extrude', 'sketch', 'extrude']);
  }, 300000);

  it('an agent run through the app (what app_plugin_run does): one folder, one undo, the record kept, bad parameters named', async () => {
    const w = await world();
    const list = listPlugins(registry);
    expect(list.map((p) => p.id)).toEqual(['civilkit.enclosures', 'civilkit.springs']);
    expect((list[0].generators[0].parameters as { properties: Record<string, unknown> }).properties.width).toBeDefined();
    const r = await runPluginOnApp(w.controller as never, registry, 'civilkit.enclosures', 'case', { width: 90 });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, group: 'Case' });
    expect([...new Set(feats(w.controller).map((f) => f.group))]).toEqual(['Case']);
    expect(runOfFolder(w.controller.document() as never, 'Case')).toMatchObject({ generator: 'case', params: { width: 90 } });
    const bad = await runPluginOnApp(w.controller as never, registry, 'civilkit.enclosures', 'case', { wall: 0.1 });
    expect(bad).toMatchObject({ ok: false, message: 'wall must be at least 0.4 mm' });
    await w.controller.undo();
    expect(feats(w.controller)).toHaveLength(0);   // ONE undo took back the whole run
  }, 300000);
});

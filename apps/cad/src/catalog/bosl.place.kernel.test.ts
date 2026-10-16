// Placement of parts-library entries on the real kernel: on the ground (first body) and on the top face of a slab, as the app does
// it (attach-mode script, variables + features as ONE undo step), and editing a variable afterwards rebuilds the part.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import type { ScriptHost } from '@kit/script';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { buildShape, catalogItem, registerDynamicItem, type PlaceTarget } from './shapes';
import { Placer, type PlacerDeps } from './placer';
import { BOSL_ENTRIES, defaultParams } from './bosl/entries';
import { buildBosl } from './bosl/build';
import reference from './bosl_reference.json';
const REF = reference as unknown as { entries: Record<string, Array<{ name: string; volume: number }>> };
// entries whose default shape stands entirely on the face (anchor bottom): the volume they add is the BOSL2 volume
const STANDS = new Set(['cuboid', 'prismoid', 'wedge', 'rect_tube', 'cyl', 'tube', 'pie_slice', 'regular_prism', 'spheroid', 'torus']);

const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b })), constraints: [],
});
const slab = (): PartDoc => ({ ...emptyPart('Slab'), features: [rect('F1', -50, -50, 50, 50), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }], seq: 3 }) as unknown as PartDoc;
const SLAB = 100 * 100 * 20;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world(doc: PartDoc) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} } as ViewSink, kernel });
  await controller.load(doc);
  const host: ScriptHost = {
    load: async () => {}, edit: async () => ({ ok: true }), geometry: () => ({ mesh: null, edges: [], box: null }),
    build: (d, view) => controller.scratchBuild(d as never, view) as never, release: () => controller.scratchRelease(), facts: (need) => controller.scratchFacts(need),
  };
  const volume = async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume;
  const valid = async () => ((await sessions.at(-1)!.validate()) as { ok: boolean }).ok;
  return { controller, host, volume, valid, session: () => sessions.at(-1)! };
}
async function topFrame(w: Awaited<ReturnType<typeof world>>) {
  const probe = buildShape(catalogItem('add-block')!, { kind: 'face', face: 'F2.C1', planar: true, frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, point: [0, 0, 0] }, w.controller.document()!.seq);
  if ('error' in probe) throw new Error(probe.error);
  const r = await w.controller.preview(probe.ops, 0);
  return (r.body?.sketches ?? r.sketches ?? []).find((s: { id: string }) => s.id === probe.sketchId)!.frame as { o: number[]; x: number[]; y: number[]; z: number[] };
}

describe('parts library placement', { skip: !process.env.CK_WASM, timeout: 240000 }, () => {
  it('on the ground: every entry is placed as one undo step with its variables, and a variable edit rebuilds it', async () => {
    for (const e of BOSL_ENTRIES) {
      const w = await world(emptyPart('Empty') as unknown as PartDoc);
      const target: PlaceTarget = { kind: 'ground', point: [0, 0, 0] };
      if (e.mask) { expect(await buildBosl(w.host, w.controller.document(), { entryId: e.id, params: defaultParams(e) }, target, true), `${e.id} needs a body`).toEqual({ error: 'needsBody' }); continue; }
      const b = await buildBosl(w.host, w.controller.document(), { entryId: e.id, params: defaultParams(e) }, target, true);
      if ('error' in b) throw new Error(`${e.id}: ${b.error} ${b.hint}`);
      const before = w.session().history().length;
      const r = await w.controller.applyDocPatch(b.patch!, 'test');
      expect(r.ok, e.id).toBe(true);
      expect(w.session().history().length - before, `${e.id} one undo step`).toBe(1);
      expect(await w.valid(), `${e.id} valid`).toBe(true);
      const v0 = await w.volume();
      const vars = (w.controller.document() as unknown as { variables?: Array<{ name: string; expr: string }> }).variables ?? [];
      if (!e.params.some((q) => q.linked)) continue;
      // double the first linked variable (a feature depth or a fillet radius): the part changes
      const name = vars[0].name;
      const patch = { variables: vars.map((v) => (v.name === name ? { ...v, expr: String(Number(v.expr) * 0.5) } : v)) };
      const r2 = await w.controller.applyDocPatch(patch, 'edit var');
      expect(r2.ok, `${e.id} variable edit`).toBe(true);
      expect(Math.abs((await w.volume()) - v0), `${e.id} volume follows ${name}`).toBeGreaterThan(1e-6);
      await w.controller.undo(); await w.controller.undo();
      expect(w.controller.document()!.features.length, `${e.id} undone`).toBe(0);
    }
  });

  it('on the top face of a slab: every entry fuses to the slab, stays valid and its footprint edges stay sharp', async () => {
    for (const e of BOSL_ENTRIES.filter((x) => x.onFace)) {
      const w = await world(slab());
      const frame = await topFrame(w);
      const target: PlaceTarget = { kind: 'face', face: 'F2.C1', planar: true, frame, point: [10, -5, 20], extent: [100, 100], thickness: 20 };
      const b = await buildBosl(w.host, w.controller.document(), { entryId: e.id, params: { ...defaultParams(e), anchor: 'bottom' } }, target, true);
      if ('error' in b) throw new Error(`${e.id}: ${b.error} ${b.hint}`);
      const r = await w.controller.applyDocPatch(b.patch!, 'test');
      expect(r.ok, e.id).toBe(true);
      expect(await w.valid(), `${e.id} valid`).toBe(true);
      const v = await w.volume();
      if (e.mask) { expect(v, `${e.id} removes material`).toBeLessThan(SLAB - 0.5); continue; }
      expect(v, `${e.id} adds material`).toBeGreaterThan(SLAB + 0.5);
      if (STANDS.has(e.id)) {
        const ref = REF.entries[e.id].find((c) => c.name === 'default')!.volume;
        expect(Math.abs(v - SLAB - ref) / ref, `${e.id} adds the BOSL2 volume`).toBeLessThan(0.003);
      }
      const bf = w.controller.bodyFaces()!;
      const own = new Set(Array.from(bf.triFace).map((f) => bf.faceIds[f]).filter((n) => n.startsWith(b.mainId + '.')));
      expect(own.size, `${e.id} has faces in the mesh`).toBeGreaterThan(0);
    }
  });

  it('a preview (parameters as numbers) uses no variables', async () => {
    const w = await world(emptyPart('Empty') as unknown as PartDoc);
    const e = BOSL_ENTRIES[0];
    const b = await buildBosl(w.host, w.controller.document(), { entryId: e.id, params: defaultParams(e) }, { kind: 'ground', point: [0, 0, 0] }, false);
    if ('error' in b) throw new Error(b.error);
    expect(b.patch).toBeUndefined();
    expect(JSON.stringify(b.ops)).not.toContain('"=');
    const p = await w.controller.preview(b.ops, 0);
    expect(p.ok).toBe(true);
  });

  it('through the Placer (hover preview, then drop): the same code path as the app, one undo step, variables and a selectable main feature', async () => {
    const w = await world(slab());
    const c = w.controller;
    const deps: PlacerDeps = {
      document: () => c.document(), hasSolid: () => c.hasSolid(), bodyFaces: () => c.bodyFaces() as never, bodyEdges: () => c.bodyEdges(), bodyBox: () => c.bodyBox(),
      preview: (ops) => c.preview(ops, 0) as never, cancelPreview: () => c.cancelPreview(), commit: (ops, why) => c.commit(ops, why), commitPatch: (patch, why) => c.applyDocPatch(patch, why),
      buildBosl: async (item, target, doc, linked) => (await buildBosl(w.host, doc, { entryId: item.bosl!.entryId, params: item.bosl!.params }, target, linked)) as never,
      rayAt: (x, y) => ({ o: [x, y, 100], d: [0, 0, -1] }), worldPerPixel: () => 0.05, setFade() {}, holdView() {},
    };
    const placer = new Placer(deps);
    const e = BOSL_ENTRIES.find((x) => x.id === 'cyl')!;
    const item = registerDynamicItem({ id: 'bosl:cyl', kind: 'cylinder', op: 'add', bosl: { entryId: 'cyl', params: { ...defaultParams(e), rounding: 2 } } });
    placer.hover(item, 20, 10);
    await new Promise((r) => setTimeout(r, 1500));
    expect(placer.status.state).toBe('ready');
    const before = w.session().history().length;
    const id = await placer.drop(item, 20, 10);
    expect(id).toBeTruthy();
    expect(w.session().history().length - before).toBe(1);
    const doc = c.document() as unknown as { variables: Array<{ name: string }>; features: Array<{ id: string; type: string }> };
    expect(doc.variables.map((v) => v.name)).toEqual(['cyl1_h', 'cyl1_rounding', 'cyl1_chamfer']);
    expect(doc.features.find((f) => f.id === id)!.type).toBe('extrude');
    expect(await w.valid()).toBe(true);
    // a rounded cylinder on a face: only the free (top) ring is rounded, the base ring is the footprint on the host face
    const added = (await w.volume()) - SLAB;
    expect(added).toBeGreaterThan(9360);
    expect(added).toBeLessThan(9390);
    // a second drop gets its own variable names
    const id2 = await placer.drop(item, -20, -10);
    expect(id2, JSON.stringify(placer.status)).toBeTruthy();
    expect((c.document() as unknown as { variables: Array<{ name: string }> }).variables.map((v) => v.name)).toContain('cyl2_h');
  });
});

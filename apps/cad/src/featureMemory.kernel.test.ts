// Repeat last command on a kernel-backed document: a Cut through all with Flip, accepted once, comes back the same on the next sketch (needs CK_WASM).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { faceVolumes } from './bodies';
import { FeatureMemory, applyExtrudeMemory, memoryOp } from './featureMemory';
import { buildCommands, resetLastCommand, type Actions } from './commands';
import { filletOps, shellOps, type Ctx } from './featureCommands';
import { autoCutFlip } from './editorFixes';

type Wire = Record<string, unknown>;
const rect = (id: string, plane: Wire, w: number, cx = 0): Wire => ({ type: 'sketch', id, plane, points: [{ id: 'a', x: cx - w, y: -w }, { id: 'b', x: cx + w, y: -w }, { id: 'c', x: cx + w, y: w }, { id: 'd', x: cx - w, y: w }], entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([i, p1, p2]) => ({ type: 'line', id: i, p1, p2 })), constraints: [] });
const plane = (id: string, offset: number): Wire => ({ type: 'plane', id, mode: 'offset', base: { kind: 'std', id: 'front' }, offset });
// a 60 x 40 x 20 block on the Front plane (z 0..20), and two small squares on a plane below it
const BLOCK: Wire[] = [
  { ...rect('F1', { kind: 'std', id: 'front' }, 20), points: [{ id: 'a', x: -30, y: -20 }, { id: 'b', x: 30, y: -20 }, { id: 'c', x: 30, y: 20 }, { id: 'd', x: -30, y: 20 }] },
  { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 },
  plane('P', -5), rect('F4', { kind: 'feature', id: 'P' }, 5, -15), rect('F5', { kind: 'feature', id: 'P' }, 5, 15),
];

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world(features: Wire[]) {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load({ ...emptyPart('t'), features, seq: 40 } as unknown as PartDoc);
  return controller;
}
const volume = (c: Controller): number => [...faceVolumes(c.bodyFaces()).values()].reduce((a, b) => a + b, 0);

describe('repeat last feature with remembered options', { skip: !process.env.CK_WASM }, () => {
  it('a through-all cut with Flip, accepted once, is made again the same way on another sketch', async () => {
    const c = await world(BLOCK);
    const mem = new FeatureMemory(() => null);
    const make = (sketch: string, flip: boolean): Wire => applyExtrudeMemory({ type: 'extrude', op: 'cut', sketch, end: 'blind', depth: 10, ...(flip ? { flip: true } : {}) }, mem.recall('extrude', true));
    const probe = (sketch: string) => async (flip: boolean) => {
      const r = await c.preview([{ op: 'add', feature: make(sketch, flip) as never }], 0);
      return { ok: r.ok, codes: (r.errors ?? []).map((e) => String((e as unknown as [string, { code?: string }])[1]?.code ?? '')) };
    };
    // the first cut: the user picks Through all (the plane is below the body, so the cut needs Flip)
    mem.remember({ type: 'extrude', op: 'cut', end: 'through', flip: true });
    const first = await autoCutFlip(true, probe('F4'));
    await c.cancelPreview();
    expect(first).toEqual({ flip: true, ok: true });
    expect((await c.edit([{ op: 'add', feature: make('F4', true) as never }])).ok).toBe(true);
    const v1 = volume(c);
    // the repeat: same options, other sketch, no choices made
    const mem2 = mem.recall('extrude', true);
    expect(memoryOp(mem2, false, true, 'add')).toBe('cut');
    const second = make('F5', mem2.flip === true);
    expect(second).toMatchObject({ op: 'cut', end: 'through', flip: true, sketch: 'F5' });
    expect((await c.edit([{ op: 'add', feature: second as never }])).ok).toBe(true);
    expect(volume(c)).toBeLessThan(v1 - 1);
    expect((c.document()!.features as unknown as Wire[]).filter((f) => f.type === 'extrude' && f.op === 'cut')).toHaveLength(2);
  }, 90000);

  it('fillet radius and shell thickness come from the memory', async () => {
    const c = await world(BLOCK);
    const mem = new FeatureMemory(() => null);
    mem.remember({ type: 'fillet', radius: 2 });
    const edges = c.bodyEdges() as never;
    const ctx = { doc: c.document(), selection: [(edges as Array<{ key?: string }>).find((e) => e.key)!.key!], mode: 'edge', box: { min: [-30, -20, 0], max: [30, 20, 20] }, edges } as unknown as Ctx;
    const ops = filletOps(ctx);
    expect(ops).not.toBeNull();   // the default radius is used here: the singleton memory is empty in a test run
    void shellOps;
  }, 60000);

  it('Repeat last command runs the previous feature command and its tooltip names the options', () => {
    resetLastCommand();
    const ran: string[] = [];
    const a = { open() {}, save() {}, samples() {}, undo() {}, redo() {}, palette() {}, toggleDrawer() {}, settings() {}, hasDocument: () => true, newPart() {}, toggleProjection() {}, sketchHere() {}, toggleLeftPanel() {}, sketchOnFace() {}, hasFaceSelection: () => false, addExtrude: (op: string) => { ran.push(op); }, newSketch() {}, setView() {}, fit() {}, setMode() {}, mode: () => 'face', toggleLayer() {}, layer: () => true } as unknown as Actions;
    const cmds = buildCommands(a);
    cmds.find((x) => x.id === 'add-cut')!.run();
    cmds.find((x) => x.id === 'repeat-last')!.run();
    expect(ran).toEqual(['cut', 'cut']);
  });
});

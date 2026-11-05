// The Equation curve tool against the real kernel, minus the clicks: the tool places a curve that carries only its formulas, the
// kernel's solved sketch brings its points into the draft, an edit through the panel's path moves them, the committed sketch
// extrudes, and deleting the curve takes its points. Skipped without a kernel (CK_WASM).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { deleteEntity, equationFields, equationSpec, equationTool, patchEquation, type SketchDraft } from '@kit/sketch';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import './locales/en';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSelection() {}, setSketchEdit() {} } as ViewSink;
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load({ ...emptyPart('Eq'), variables: [{ name: 'R', expr: '15' }] } as unknown as PartDoc);
  return { controller, volume: async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume };
}
const gen = (d: SketchDraft, id: string) => d.points.filter((p) => p.id.startsWith(id + '_'));

describe('equation curve tool on the kernel', () => {
  it('places a curve, takes its points from the kernel, edits, extrudes and deletes', async () => {
    const w = await world();
    await w.controller.beginNewSketch('front');
    const d0 = w.controller.sketchDraft()!;
    const out = equationTool.step(equationTool.start(), { type: 'click', at: { x: 0, y: 0 }, mods: {} } as never, d0, { autoConstraints: true, arcSwitch: 'hover', onViewValues: 'dimensions' } as never);
    const id = (out.state as { placed: string }).placed;
    const r = await w.controller.applySketchDraft(out.draft);
    expect(r.ok).toBe(true);
    let d = w.controller.sketchDraft()!;
    const wave = gen(d, id);
    expect(wave.length).toBeGreaterThan(5);
    expect(wave.every((p) => p.fixed)).toBe(true);
    expect(d.points.find((p) => p.id === `${id}_end`)).toMatchObject({ x: 40 });
    // the panel's path: ask the kernel first, apply only what fits
    const circle = { x: 'R*cos(t)', y: 'R*sin(t)', t0: '0', t1: '360', tol: 0.001 };
    const pre = await w.controller.fetchEquationCurve(equationSpec(circle));
    expect('error' in pre).toBe(false);
    await w.controller.applySketchDraft(patchEquation(d, id, circle));
    d = w.controller.sketchDraft()!;
    expect(equationFields(d, id)).toEqual(circle);
    expect(d.entities.find((e) => e.id === id)!.closed).toBe(true);
    expect(gen(d, id).every((p) => Math.abs(Math.hypot(p.x, p.y) - 15) < 1e-9)).toBe(true);
    expect(gen(d, id).some((p) => p.id === `${id}_end`)).toBe(false);   // a closed curve has no end point
    const bad = await w.controller.fetchEquationCurve(equationSpec({ ...circle, y: 'R*sin(t' }));
    expect('error' in bad && bad.error).toMatch(/^equationFormula: y\(t\)/);
    // delete takes the generated points
    expect(gen(deleteEntity(d, id), id)).toEqual([]);
    // commit and extrude: a disc of radius 15
    const c = await w.controller.commitSketch();
    expect(c?.ok).not.toBe(false);
    const sk = d.id;
    await w.controller.edit([{ op: 'add', feature: { type: 'extrude', id: 'X1', op: 'add', sketch: sk, end: 'blind', depth: 4 } }], 'extrude');
    const v = await w.volume();
    expect(Math.abs(v - Math.PI * 225 * 4) / (Math.PI * 225 * 4)).toBeLessThan(3e-4);
  }, 120000);
});

// The procedural curve and surface wrappers (features/procedural.ts) as whole scripts against the real kernel: each builds, the
// closed-form numbers come out, and checkIntersection returns the kernel's report.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function run(code: string) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  const r = await runScript(code, h);
  const regen = async () => (await sessions.at(-1)!.verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`);
  const types = () => ((r.document?.features ?? []) as Array<{ type: string }>).map((f) => f.type);
  return { r, regen, types, controller };
}
const PLATE = `const p = part('Plate').sketch('front', (s) => s.rect(40, 25, [20, 12.5])).extrude(10);\n`;

describe('procedural curve and surface script wrappers against the kernel', { skip: !process.env.CK_WASM, timeout: 240000 }, () => {
  it('a tube swept along a line with caps knits into a solid of volume pi r^2 L', async () => {
    const { r, regen, types } = await run(`const p = part('Tube').sweepSurface({ on: 'front', draw: (s) => s.circle(2) }, { on: 'right', draw: (s) => s.line([0, 0], [-25, 0]) }, { caps: true })
  .knit({ solid: true }).expectVolume(${Math.PI * 4 * 25}, { tol: 1e-4 });`);
    expect(r.errors).toEqual([]);
    expect(types()).toEqual(['sketch', 'sketch', 'sweepSurface', 'knit']);
    expect(await regen()).toEqual([]);
  });
  it('an offset of a quarter arc is a sweep path: the profile travels along the exact radius-5 arc', async () => {
    const { r, regen, types } = await run(`const p = part('Bend').sketch('front', (s) => s.arc([0, 0], [6, 0], [0, 6])).offsetCurve(-1);
const rail = p.handle();
p.sweepSurface({ on: 'top', draw: (s) => s.circle(1.5, [5, 0]) }, rail, { caps: true }).knit({ solid: true })
  .expectVolume(${Math.PI * 1.5 * 1.5 * 5 * (Math.PI / 2)}, { tol: 1e-3 });`);
    expect(r.errors).toEqual([]);
    expect(types()).toEqual(['sketch', 'offsetCurve', 'sketch', 'sweepSurface', 'knit']);
    expect(await regen()).toEqual([]);
  });
  it('a composite of a line and an arc, offset again from its handle', async () => {
    const { r, regen, types } = await run(`const p = part('Chain').sketch('front', (s) => { s.line([0, -5], [20, -5]); s.arc([20, 5], [20, -5], [30, 5]); }).compositeCurve();
const c = p.handle();
p.offsetCurve(1, { curve: c });`);
    expect(r.errors).toEqual([]);
    expect(types()).toEqual(['sketch', 'compositeCurve', 'offsetCurve']);
    expect(await regen()).toEqual([]);
  });
  it('projectCurve keeps exact: two lines of a lifted sketch, listed in chain order, onto the top face', async () => {
    const { r, regen, types } = await run(PLATE + `p.projectCurve(face('>Z'), { keepExact: true, curve: [{ on: at('front', 20), draw: (s) => s.polyline([[5, 5], [20, 20], [35, 5]]) }] });
p.sketch(at('front', 20), (s) => s.circle(6, [20, 10])).projectCurve(face('>Z'));`);
    expect(r.errors).toEqual([]);
    expect(types().filter((t) => t === 'projectCurve')).toHaveLength(2);
    const [exact, fitted] = (r.document!.features as Array<Record<string, unknown>>).filter((f) => f.type === 'projectCurve');
    expect(exact).toMatchObject({ procedural: true, faces: ['F2.C1'] });
    expect((exact.curves as unknown[]).length).toBe(2);
    expect(fitted).toMatchObject({ degree: 3, faces: ['F2.C1'] });
    expect(await regen()).toEqual([]);
  });
  it('a blend surface rounds the top front edge of the plate', async () => {
    const { r, regen, types } = await run(PLATE + `p.blendSurface([face('>Z'), face('<Y')], 3);`);
    expect(r.errors).toEqual([]);
    expect(types().at(-1)).toBe('blendSurface');
    expect((r.document!.features as Array<Record<string, unknown>>).at(-1)).toMatchObject({ faces: ['F2.C1', 'F2.S.e1'], radius: 3 });
    expect(await regen()).toEqual([]);
  });
  it('a radius too big for the faces is refused with the kernel code', async () => {
    const { r } = await run(PLATE + `p.blendSurface([face('>Z'), face('<Y')], 12);`);
    expect(JSON.stringify(r.errors)).toMatch(/blendSurfaceRadius|largest/);
  });
  it('fillNSided closes the open rim of a box sheet with N faces, G1', async () => {
    const { r, regen, types } = await run(`part('Bin').sketch('front', (s) => s.rect(20, 10, [10, 5])).surfaceExtrude(5)
  .sketch('front', (s) => s.rect(20, 10, [10, 5])).surfacePlanar().knit()
  .fillNSided('>Z', { continuity: 'G1' });`);
    expect(r.errors).toEqual([]);
    expect(types().at(-1)).toBe('fill');
    expect((r.document!.features as Array<Record<string, unknown>>).at(-1)).toMatchObject({ patch: 'nSided', continuity: 'G1' });
    expect(((r.document!.features as Array<Record<string, unknown>>).at(-1)!.edges as unknown[]).length).toBe(4);
    expect(await regen()).toEqual([]);
  });
  it('checkIntersection: crossing cylinders give marched spans, each proved, repaired or unresolved', async () => {
    const { r } = await run(`const p = part('Cross').sketch('top', (s) => s.circle(10)).extrude(20, { mid: true })
  .sketch('front', (s) => s.circle(6)).extrude(30, { mid: true });
const c = await p.checkIntersection();
if (!(c.marched > 0 && c.spans > 0 && c.proved + c.repaired + c.unresolved === c.spans)) throw new Error('report ' + JSON.stringify(c));
const one = await p.checkIntersection(faces({ kind: 'cylinder', radius: 6 }));
if (!(one.pairs > 0 && one.pairs < c.pairs)) throw new Error('one face ' + one.pairs + ' of ' + c.pairs);`);
    expect(r.errors).toEqual([]);
  });
});

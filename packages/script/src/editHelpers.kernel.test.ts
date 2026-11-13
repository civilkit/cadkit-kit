import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

// One kernel run per typed helper (draft, moveFace, lip, groove, scale, split, deleteBody, deleteFace, helix, axis, sphere, moveBody, sweep guides):
// the script builds a solid through the kernel, the volume is compared with a hand-derived value.
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

interface Out { vol: number; ok: boolean; bbox: { min: number[]; max: number[]; size: number[] }; errors: string[] }
async function build(body: string, readBack = true): Promise<Out> {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  const code = body + (readBack ? `
const vol = await p.volume(); const ok = await p.isValid(); const bb = await p.bbox();
throw new Error('KN' + JSON.stringify({ vol, ok, bbox: bb }));
` : `
throw new Error('KN' + JSON.stringify({ vol: 0, ok: true, bbox: { min: [], max: [], size: [] } }));
`);
  const r = await runScript(code, h);
  const e = r.errors.find((x) => x.message.startsWith('KN'));
  if (!e) throw new Error('script failed: ' + r.errors.map((x) => x.message).join(' | '));
  return { ...(JSON.parse(e.message.slice(2)) as Out), errors: r.errors.filter((x) => !x.message.startsWith('KN')).map((x) => x.message) };
}
const near = (v: number, want: number, tol = 0.001) => { expect(v).toBeGreaterThan(want * (1 - tol)); expect(v).toBeLessThan(want * (1 + tol)); };
const BOX = `const p = part('Box').sketch('front', (s) => s.rect(40, 20)).extrude(10);\n`;   // x -20..20, y -10..10, z 0..10: 8000 mm3
const RIM = `edges({ onFace: face('>Z'), not: edges({ inside: [[-19, -9, 9], [19, 9, 11]] }) })`;   // the four outer edges of the shelled rim

describe('typed helpers for kernel features, through the kernel', () => {
  it('moveFace pushes the top up: 40 x 20 x 12.5', async () => {
    const o = await build(BOX + `p.moveFace(face('>Z'), { distance: 2.5 });`);
    expect(o.errors).toEqual([]); expect(o.ok).toBe(true);
    near(o.vol, 10000); near(o.bbox.size[2], 12.5);
  });
  it('moveFace translate moves a side out by 3', async () => {
    const o = await build(BOX + `p.moveFace(face('>X'), { translate: [3, 0, 0] });`);
    expect(o.errors).toEqual([]); near(o.vol, 8600); near(o.bbox.size[0], 43);
  });
  it('draft tilts the +X wall 5 degrees about the front plane: the wedge 1/2 x 10 x (10 tan 5) x 20 is removed', async () => {
    const o = await build(BOX + `p.draft(face('>X'), 5, { neutral: 'front' });`);
    expect(o.errors).toEqual([]); expect(o.ok).toBe(true);
    near(o.vol, 8000 - 0.5 * 10 * 10 * Math.tan(5 * Math.PI / 180) * 20);
  });
  it('lip adds a 1 x 1.5 band round a 2 mm shelled rim (+174), groove cuts the same (-174)', async () => {
    const shell = BOX + `p.shell(face('>Z'), 2);\n`;
    const base = 40 * 20 * 10 - 36 * 16 * 8;   // 3392: the shell, 2 mm walls and floor
    near((await build(shell)).vol, base);
    const l = await build(shell + `p.lip(face('>Z'), ${RIM}, { width: 1, height: 1.5 });`);
    expect(l.errors).toEqual([]); expect(l.ok).toBe(true);
    near(l.vol, base + (40 * 20 - 38 * 18) * 1.5);
    const g = await build(shell + `p.groove(face('>Z'), ${RIM}, { width: 1, height: 1.5 });`);
    expect(g.errors).toEqual([]); expect(g.ok).toBe(true);
    near(g.vol, base - (40 * 20 - 38 * 18) * 1.5);
  }, 120000);
  it('scale stretches per axis about the origin: volume x 1.1 x 1 x 2', async () => {
    const o = await build(BOX + `p.scale([1.1, 1, 2], { about: 'origin' });`);
    expect(o.errors).toEqual([]); near(o.vol, 8000 * 2.2); near(o.bbox.size[0], 44); near(o.bbox.size[2], 20);
  });
  it('split cuts a block at the slab, deleteBody removes one half', async () => {
    const two = `const p = part('Halves').sketch('front', (s) => s.rect(40, 20)).extrude(20, { newBody: 'Block' })
      .sketch(at('front', 10), (s) => s.rect(80, 40)).extrude(20, { newBody: 'Slab' })
      .split('Block', 'Slab');\n`;
    const s = await build(two);
    expect(s.errors).toEqual([]); expect(s.ok).toBe(true);
    near(s.vol, 16000);   // two bodies, 8000 each, nothing lost
    // the two halves keep their volume: deleting the body that holds the lower face leaves the upper half
    const d = await build(two + `p.deleteBody(face('<Z'));`);
    expect(d.errors).toEqual([]); near(d.vol, 8000); near(d.bbox.min[2], 10, 0.01);
    const k = await build(two + `p.deleteBody(face('<Z'), { keep: true });`);
    expect(k.errors).toEqual([]); near(k.vol, 8000); near(k.bbox.max[2], 10, 0.01);
  }, 120000);
  it('deleteBody by name', async () => {
    const o = await build(`const p = part('Two').sketch('front', (s) => s.rect(40, 20)).extrude(10, { newBody: 'A' })
      .sketch('front', (s) => s.rect(20, 20, [60, 0])).extrude(5, { newBody: 'B' }).deleteBody('B');`);
    expect(o.errors).toEqual([]); near(o.vol, 8000); near(o.bbox.size[0], 40);
  });
  it('deleteFace opens the box into a sheet of five faces', async () => {
    const o = await build(BOX + `p.deleteFace(face('>Z'));`, false);
    expect(o.errors).toEqual([]);   // the kernel accepts it; no solid is left (the faces are a sheet body), so there is no volume to read
  });
  it('helix swept with a round wire: pi r^2 x 2 pi R x turns', async () => {
    const o = await build(`const p = part('Coil').helix({ radius: 10, pitch: 4, revolutions: 5 }); const hx = p.handle();
      p.sweep({ on: 'front', draw: (s) => s.circle(1.5, [10, 0]) }, { curve: hx });`);
    expect(o.errors).toEqual([]); expect(o.ok).toBe(true);
    near(o.vol, Math.PI * 1.5 * 1.5 * 2 * Math.PI * 10 * 5, 0.002);
    near(o.bbox.size[1], 20 + 3, 0.05);   // 5 turns of pitch 4 plus the wire
  });
  it('axis: a plane turned 45 degrees about the world y axis, an extrusion on it', async () => {
    const o = await build(`const p = part('Tilt').axis('y');
      p.feature({ type: 'plane', mode: 'angle', base: { kind: 'std', id: 'front' }, axis: { kind: 'feature', id: '$last' }, angle: 45 }); const pl = p.handle();
      p.sketch(at(pl), (s) => s.circle(5)).extrude(10);`);
    expect(o.errors).toEqual([]); expect(o.ok).toBe(true);
    near(o.vol, Math.PI * 25 * 10); near(o.bbox.size[1], 10);
    near(o.bbox.size[0], 10 * Math.cos(Math.PI / 4) + 10 * Math.sin(Math.PI / 4), 0.002);   // disc projected on x plus the leaning height
  });
  it('sphere: 4/3 pi r^3, and a cut sphere takes a hemisphere out of a block', async () => {
    const s = await build(`const p = part('Ball').sphere(10);`);
    expect(s.errors).toEqual([]); near(s.vol, 4 / 3 * Math.PI * 1000);
    const c = await build(`const p = part('Dimple').sketch('front', (s) => s.rect(40, 40)).extrude(40).sphere(10, { centre: [0, 0, 40], op: 'cut' });`);
    expect(c.errors).toEqual([]); near(c.vol, 64000 - 2 / 3 * Math.PI * 1000);
  });
  it('moveBody: a moved copy, a mirror copy and a rotation', async () => {
    const A = `const p = part('Move').sketch('front', (s) => s.rect(20, 10, [20, 0])).extrude(5, { newBody: 'A' });\n`;   // x 10..30
    const c = await build(A + `p.moveBody('A', { translate: [0, 0, 30], copy: true, body: 'B' });`);
    expect(c.errors).toEqual([]); near(c.vol, 2000); near(c.bbox.size[2], 35);
    const m = await build(A + `p.moveBody('A', { copy: true, body: 'M', mirror: 'right' });`);
    expect(m.errors).toEqual([]); near(m.vol, 2000); expect(m.bbox.min[0]).toBeCloseTo(-30, 1); expect(m.bbox.max[0]).toBeCloseTo(30, 1);
    const r = await build(A + `p.moveBody('A', { rotate: { axis: 'z', angle: 90 }, translate: [0, 100, 0] });`);
    expect(r.errors).toEqual([]); near(r.vol, 1000);
    near(r.bbox.size[0], 10); near(r.bbox.size[1], 20); near(r.bbox.min[1], 110);   // x 10..30 -> y 10..30, then +100: 110..130
  }, 120000);
  it('sweep with a guide curve is a cone frustum (scale) or keeps its section (turn)', async () => {
    const sw = (mode: string) => `const p = part('Guided').sweep({ on: 'top', draw: (s) => s.circle(3) }, { on: 'front', draw: (s) => s.line([0, 0], [0, 20]) },
      { guides: [{ on: 'front', draw: (s) => s.line([3, 0], [6, 20]) }], guideMode: '${mode}' });`;
    const a = await build(sw('scale'));
    expect(a.errors).toEqual([]); expect(a.ok).toBe(true);
    near(a.vol, Math.PI * 20 / 3 * (9 + 18 + 36), 0.002);
    const b = await build(sw('turn'));
    expect(b.errors).toEqual([]); near(b.vol, Math.PI * 9 * 20, 0.002);
  }, 120000);
});

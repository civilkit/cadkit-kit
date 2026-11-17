import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

// pressPull({ distance, taper }) through the kernel (needs a wasm with pressPull): volumes are the prism, frustum and prismatoid formulas, refusals read as sentences.
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
const BOX = `const p = part('Box').sketch('front', (s) => s.rect(40, 20)).extrude(10);\n`;   // x -20..20, y -10..10, z 0..10: 8000 mm3, the top face is 800 mm2
const TAN3 = Math.tan(3 * Math.PI / 180);
/** Volume of the run of the 40 x 20 top face over h with each side moved out by t at the far end (linear taper: the prismatoid formula is exact). */
const grown = (h: number, t: number) => (h / 6) * (800 + (40 + 2 * t) * (20 + 2 * t) + 4 * (40 + t) * (20 + t));

describe('pressPull straight, through the kernel', { skip: !process.env.CK_WASM }, () => {
  it('no taper adds area x distance and joins the top end onto the same face', async () => {
    const o = await build(BOX + `p.pressPull(face('>Z'), { distance: 10 });`);
    expect(o.errors).toEqual([]); expect(o.ok).toBe(true);
    near(o.vol, 8000 + 800 * 10); near(o.bbox.size[2], 20);
  });
  it('a negative distance cuts the same prism out', async () => {
    const o = await build(BOX + `p.pressPull(face('>Z'), { distance: -4 });`);
    expect(o.errors).toEqual([]); near(o.vol, 8000 - 800 * 4); near(o.bbox.size[2], 6);
  });
  it('scale 1.5 over 10 mm: the frustum of a 40 x 20 face growing to 60 x 30', async () => {
    const o = await build(BOX + `p.pressPull(face('>Z'), { distance: 10, taper: { type: 'scale', endScale: 1.5 } });`);
    expect(o.errors).toEqual([]); expect(o.ok).toBe(true);
    near(o.vol, 8000 + (10 / 3) * (800 + 1800 + Math.sqrt(800 * 1800)));
    near(o.bbox.size[0], 60); near(o.bbox.size[2], 20);
  });
  it('draft 3 degrees grows the outline outward, draft -3 shrinks it (the opposite sign of extrude)', async () => {
    const out = await build(BOX + `p.pressPull(face('>Z'), { distance: 10, taper: { type: 'draft', angle: 3 } });`);
    expect(out.errors).toEqual([]); expect(out.ok).toBe(true);
    near(out.vol, 8000 + grown(10, 10 * TAN3), 0.002);
    const inward = await build(BOX + `p.pressPull(face('>Z'), { distance: 10, taper: { type: 'draft', angle: -3 } });`);
    expect(inward.errors).toEqual([]); expect(inward.ok).toBe(true);
    near(inward.vol, 8000 + grown(10, -10 * TAN3), 0.002);
    expect(out.vol).toBeGreaterThan(inward.vol);
  });
  it('a taper that closes the face before the distance is refused with a sentence, the body unchanged', async () => {
    const o = await build(BOX + `p.pressPull(face('>Z'), { distance: 30, taper: { type: 'draft', angle: -40 } });`).catch((e: Error) => ({ errors: [e.message] }) as Out);
    expect(o.errors.join(' ')).toMatch(/draftTooLarge|too large|taper/i);
  });
  it('a distance of 0 is refused before the kernel', async () => {
    const o = await build(BOX + `p.pressPull(face('>Z'), { distance: 0 });`, false).catch((e: Error) => ({ errors: [e.message] }) as Out);
    expect(o.errors.join(' ')).toMatch(/not 0/);
  });
});

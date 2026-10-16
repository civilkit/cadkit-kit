import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, evaluate, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function host() {
  const store = createStore();
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    facts: (need) => controller.scratchFacts(need),
  };
  return { h, session: () => sessions.at(-1)! };
}
const vol = async (s: Session) => ((await s.massProps()) as { volume: number }).volume;

describe('script text', () => {
  it('records a text entity with its own point and options', () => {
    const r = evaluate(`part('P').sketch('front', (s) => s.text('AB', [3, 4], { font: 'engrave', height: 6, anchor: 'center middle', angle: 10, name: 'lbl', arc: { centre: [1, 2], radius: 20 } })).extrude(1);`);
    expect(r.errors).toEqual([]);
    const sk = r.state.parts[0].steps[0].sk!;
    const e = sk.entities[0] as Record<string, unknown>;
    expect(e).toMatchObject({ id: 'lbl', type: 'text', string: 'AB', font: 'engrave', height: 6, anchor: ['center', 'middle'], angle: 10 });
    expect(sk.pointList.find((p) => p.id === e.p)).toMatchObject({ x: 3, y: 4 });
    expect((e.arc as { radius: number; side: string }).side).toBe('outside');
  });
  it('rejects bad arguments with a readable message and the script line', () => {
    const bad = (src: string, re: RegExp) => { const r = evaluate(src); expect(r.errors[0]?.message).toMatch(re); expect(r.errors[0]?.line).toBe(1); };
    bad(`part('P').sketch('front', (s) => s.text('', [0, 0]));`, /string is empty/);
    bad(`part('P').sketch('front', (s) => s.text('A', [0, 0], { font: 'comic' }));`, /unknown font/);
    bad(`part('P').sketch('front', (s) => s.text('A', [0, 0], { height: -2 }));`, /cap height/);
    bad(`part('P').sketch('front', (s) => s.text('A', [0, 0], { anchor: ['middle', 'left'] }));`, /anchor is/);
  });
  it('engraves a label: volume removed = glyph area x depth within 1%', async () => {
    const { h, session } = await host();
    const src = `const p = part('Plate').sketch('front', (s) => s.rect(80, 30)).extrude(4);
p.sketch(at('front', 4), (s) => s.text('SEA SPRITE', [0, 0], { font: 'engrave', height: 6, anchor: ['center', 'middle'] })).cut(0.3);`;
    const base = await runScript(`part('Plate').sketch('front', (s) => s.rect(80, 30)).extrude(4);`, h);
    expect(base.errors).toEqual([]);
    const v0 = await vol(session());
    const r = await runScript(src, h);
    expect(r.errors).toEqual([]);
    const v1 = await vol(session());
    const o = (await session().textOutline({ string: 'SEA SPRITE', font: 'engrave', height: 6, at: [0, 0], anchor: ['center', 'middle'] })) as { area: number };
    expect(o.area).toBeGreaterThan(10);
    expect((v0 - v1) / (o.area * 0.3)).toBeGreaterThan(0.99);
    expect((v0 - v1) / (o.area * 0.3)).toBeLessThan(1.01);
  }, 120000);
  it('textMetrics reads the width and sizes a plate', async () => {
    const { h, session } = await host();
    const r = await runScript(`const p = part('Plate');
const m = await p.textMetrics('SEA SPRITE', { font: 'engrave', height: 5 });
p.sketch('front', (s) => s.rect(m.width + 8, 12)).extrude(2);
p.expectBBox({ min: [-(m.width + 8) / 2, -6, 0], max: [(m.width + 8) / 2, 6, 2] }, { tol: 1e-3 });`, h);
    expect(r.errors).toEqual([]);
    const m = await session().textMetrics('SEA SPRITE', { font: 'engrave', height: 5 });
    expect(m.width).toBeGreaterThan(20);
  }, 120000);
  it('numerals around a dial are valid; empty text and tiny text report readable errors / warnings', async () => {
    const { h, session } = await host();
    const r = await runScript(`part('Dial').sketch('front', (s) => s.circle(40)).extrude(2)
  .sketch(at('front', 2), (s) => { for (let v = 0; v <= 80; v += 10) { const a = (225 - 270 * v / 80) * Math.PI / 180; s.text(String(v), [28 * Math.cos(a), 28 * Math.sin(a)], { height: 4, anchor: ['center', 'middle'] }); } }).extrude(0.15);`, h);
    expect(r.errors).toEqual([]);
    const val = (await session().validate()) as { ok: boolean };
    expect(val.ok).toBe(true);
    const bad = await runScript(`part('P').sketch('front', (s) => s.rect(10, 10)).extrude(1).sketch(at('front', 1), (s) => s.text('   ', [0, 0])).cut(0.1);`, h);
    expect(bad.errors[0]?.message).toMatch(/nothing to draw|string is empty/);
  }, 120000);
});

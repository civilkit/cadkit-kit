import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { importSvgIntoSketch } from './svgSketch';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const fixture = readFileSync(resolve(process.cwd(), 'apps/cad/src/fixtures/svg/shapes.svg'), 'utf8');
const svg = (body: string, attrs = 'width="100mm" height="100mm" viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

async function world() {
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view, kernel });
  await c.load(emptyPart('Imported') as unknown as PartDoc);
  return c;
}
/** Import `text` into a new front sketch, commit it, extrude 10 mm and return the volume and error list. */
async function extrudeImport(text: string) {
  const c = await world();
  expect(await c.beginNewSketch('front')).not.toBeNull();
  const r = await importSvgIntoSketch(c, text);
  expect(r.ok).toBe(true);
  expect((await c.commitSketch())!.ok).toBe(true);
  const sk = c.document()!.features.at(-1)!;
  const e = await c.edit([{ op: 'add', feature: { type: 'extrude', id: `F${c.document()!.seq}`, op: 'add', sketch: sk.id, end: 'blind', depth: 10 } as never }]);
  expect(e.ok).toBe(true);
  const s = sessions.at(-1)!;
  const report = await s.verify();
  const mass = (await s.massProps()) as { volume: number };
  return { volume: mass.volume, errors: report.regen.errors, r, c };
}

describe('SVG import into a sketch against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('the fixture (gear with a bore, rounded plate, boss) extrudes to the expected volume', async () => {
    const { volume, errors, r } = await extrudeImport(fixture);
    expect(errors).toEqual([]);
    expect(r.notices.map((n) => n.key)).toEqual(['io.svg.imported', 'io.svg.skipped']);
    expect(r.notices[1].params).toEqual({ what: 'text (1)' });
    // gear: 8 teeth, tip arcs r 24 over 15 deg, root arcs r 18 over 18 deg, straight flanks; bore r 6; plate 40 x 30 with r 4 corners; boss r 8
    const N = 8, seg = (rr: number, deg: number) => 0.5 * rr * rr * (deg * Math.PI / 180 - Math.sin(deg * Math.PI / 180));
    const poly: Array<[number, number]> = [];
    const at = (rr: number, deg: number): [number, number] => [rr * Math.cos(deg * Math.PI / 180), rr * Math.sin(deg * Math.PI / 180)];
    for (let i = 0; i < N; i++) poly.push(at(24, 45 * i - 7.5), at(24, 45 * i + 7.5), at(18, 45 * i + 13.5), at(18, 45 * i + 31.5));
    const shoelace = Math.abs(poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0)) / 2;
    const area = shoelace + N * (seg(24, 15) + seg(18, 18)) - Math.PI * 36 + (1200 - (4 - Math.PI) * 16) + Math.PI * 64;
    expect(volume / 10).toBeCloseTo(area, 0);
  });
  it('the sketch lands upright: the profile spans the drawing, y up', async () => {
    const { c } = await extrudeImport(svg('<rect x="10" y="20" width="30" height="10"/>'));
    const s = c.document()!.features[0] as unknown as { points: Array<{ id: string; x: number; y: number }>; entities: Array<{ p1?: string; p2?: string }> };
    const used = new Set(s.entities.flatMap((e) => [e.p1, e.p2]));
    const ys = s.points.filter((p) => used.has(p.id)).map((p) => p.y);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([70, 80]);
  });
  it('Bezier outlines extrude: four cubic quarter circles, and one closed cubic path with a rotated ellipse inside', async () => {
    const k = 0.5522847498 * 20;
    const circle = `M60 40 C60 ${40 + k} ${40 + k} 60 40 60 C${40 - k} 60 20 ${40 + k} 20 40 C20 ${40 - k} ${40 - k} 20 40 20 C${40 + k} 20 60 ${40 - k} 60 40 Z`;
    const { volume, errors, c } = await extrudeImport(svg(`<path d="${circle}"/><ellipse cx="40" cy="40" rx="10" ry="4" transform="rotate(30 40 40)"/>`));
    expect(errors).toEqual([]);
    const types = (c.document()!.features[0] as unknown as { entities: Array<{ type: string }> }).entities.map((e) => e.type).sort();
    expect(types).toEqual(['cvspline', 'cvspline', 'cvspline', 'cvspline', 'ellipse']);
    expect(volume / 10).toBeGreaterThan((Math.PI * 400 - Math.PI * 40) * 0.999);
    expect(volume / 10).toBeLessThan((Math.PI * 400 - Math.PI * 40) * 1.001);
  });
  it('an elliptical arc outline, relative commands and a transform: a stadium made with arcs', async () => {
    const { volume, errors } = await extrudeImport(svg('<path transform="translate(10 10) scale(1 1)" d="m10 0 h30 a10 10 0 0 1 0 20 h-30 a10 10 0 0 1 0 -20 z"/>'));
    expect(errors).toEqual([]);
    expect(volume / 10).toBeCloseTo(30 * 20 + Math.PI * 100, 0);
  });
  it('an elliptical (non-circular) arc closes a profile of splines', async () => {
    const { volume, errors } = await extrudeImport(svg('<path d="M10 50 A30 15 0 0 1 70 50 Z"/>'));
    expect(errors).toEqual([]);
    expect(volume / 10).toBeCloseTo(Math.PI * 30 * 15 / 2, 0);
  });
  it('inches: a 2 x 1 in plate is 50.8 x 25.4 mm', async () => {
    const { volume, errors, r } = await extrudeImport(svg('<rect width="2" height="1"/>', 'width="2in" height="1in" viewBox="0 0 2 1"'));
    expect(errors).toEqual([]);
    expect(r.notices.map((n) => n.key)).toEqual(['io.svg.imported']);
    expect(volume).toBeCloseTo(50.8 * 25.4 * 10, 0);
  });
  it('a file without a physical size imports at 96 dpi and says so', async () => {
    const { volume, r } = await extrudeImport('<svg xmlns="http://www.w3.org/2000/svg"><rect width="96" height="96"/></svg>');
    expect(r.notices.map((n) => n.key)).toEqual(['io.svg.imported', 'io.svg.unitless']);
    expect(volume).toBeCloseTo(25.4 * 25.4 * 10, 0);
  });
  it('without an open sketch nothing happens', async () => {
    const c = await world();
    expect(await importSvgIntoSketch(c, fixture)).toEqual({ ok: false, notices: [{ level: 'error', key: 'io.svg.noSketch' }] });
  });
  it('a refused file leaves the draft alone', async () => {
    const c = await world();
    await c.beginNewSketch('front');
    const before = JSON.stringify(c.sketchDraft());
    for (const bad of ['not an svg', '<!DOCTYPE svg [<!ENTITY a "b">]><svg><circle r="1"/></svg>', svg('<text>x</text>')]) {
      const r = await importSvgIntoSketch(c, bad);
      expect(r.ok).toBe(false);
    }
    expect(JSON.stringify(c.sketchDraft())).toBe(before);
  });
});

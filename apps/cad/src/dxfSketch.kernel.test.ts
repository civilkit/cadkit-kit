import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { sketchToDxf } from '@kit/io';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { importDxfIntoSketch } from './dxfSketch';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const dxf = (ents: Array<Array<[number, string | number]>>, insunits = 4): string =>
  `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${insunits}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${ents.map((e) => e.map(([c, v]) => `${c}\n${v}`).join('\n')).join('\n')}\n0\nENDSEC\n0\nEOF\n`;
const lw = (verts: Array<[number, number, number?]>): Array<[number, string | number]> =>
  [[0, 'LWPOLYLINE'], [8, '0'], [90, verts.length], [70, 1], ...verts.flatMap(([x, y, b]): Array<[number, number]> => (b ? [[10, x], [20, y], [42, b]] : [[10, x], [20, y]]))];
const circle = (x: number, y: number, r: number): Array<[number, string | number]> => [[0, 'CIRCLE'], [8, '0'], [10, x], [20, y], [40, r]];

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
  const r = await importDxfIntoSketch(c, text);
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

describe('DXF import into a sketch against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a rounded rectangle with a hole extrudes to the expected volume', async () => {
    const q = Math.tan(Math.PI / 8);
    const { volume, errors, r } = await extrudeImport(dxf([
      lw([[5, 0], [45, 0, q], [50, 5], [50, 25, q], [45, 30], [5, 30, q], [0, 25], [0, 5, q]]),
      circle(25, 15, 4),
    ]));
    expect(errors).toEqual([]);
    expect(r.notices.map((n) => n.key)).toEqual(['io.dxf.imported']);
    const area = 50 * 30 - (4 - Math.PI) * 25 - Math.PI * 16;
    expect(volume).toBeCloseTo(area * 10, 0);
  });
  it('inches are converted: a 2 x 1 in plate is 50.8 x 25.4 mm', async () => {
    const { volume, errors } = await extrudeImport(dxf([lw([[0, 0], [2, 0], [2, 1], [0, 1]])], 1));
    expect(errors).toEqual([]);
    expect(volume).toBeCloseTo(50.8 * 25.4 * 10, 0);
  });
  it('a sketch exported by us and imported into a new sketch gives the same solid', async () => {
    const sk = {
      points: [{ id: 'O', x: 0, y: 0 }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 30, y: 0 }, { id: 'p3', x: 30, y: 20 }, { id: 'p4', x: 0, y: 20 }, { id: 'c', x: 15, y: 10 }],
      entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, p1, p2]) => ({ id, type: 'line', p1, p2 })).concat([{ id: 'e5', type: 'circle', c: 'c', r: 5 } as never]),
    };
    const { volume, errors } = await extrudeImport(sketchToDxf(sk as never).text);
    expect(errors).toEqual([]);
    expect(volume).toBeCloseTo((600 - Math.PI * 25) * 10, 0);
  });
  it('a closed fit spline imports as a spline that extrudes', async () => {
    const fit: Array<[number, number]> = [[10, 0], [0, 10], [-10, 0], [0, -10]];
    const { volume, errors, c } = await extrudeImport(dxf([[
      [0, 'SPLINE'], [8, '0'], [70, 1065], [71, 3], [74, 4],
      ...fit.flatMap(([x, y]): Array<[number, number]> => [[11, x], [21, y], [31, 0]]),
    ]]));
    expect(errors).toEqual([]);
    expect((c.document()!.features[0] as unknown as { entities: Array<{ type: string }> }).entities.map((e) => e.type)).toEqual(['spline']);
    expect(volume).toBeGreaterThan(0.9 * Math.PI * 100 * 10);
    expect(volume).toBeLessThan(1.1 * Math.PI * 100 * 10);
  });
  it('without an open sketch nothing happens', async () => {
    const c = await world();
    const r = await importDxfIntoSketch(c, dxf([circle(0, 0, 1)]));
    expect(r).toEqual({ ok: false, notices: [{ level: 'error', key: 'io.dxf.noSketch' }] });
  });
  it('a refused file leaves the draft alone', async () => {
    const c = await world();
    await c.beginNewSketch('front');
    const before = JSON.stringify(c.sketchDraft());
    const r = await importDxfIntoSketch(c, 'not a dxf');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(c.sketchDraft())).toBe(before);
  });
});

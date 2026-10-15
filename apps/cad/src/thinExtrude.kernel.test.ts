// The thin-wall option against the real kernel (needs CK_WASM): a C-shaped spline arc, a closed circle, the hint-card actions and
// their undo. Patches are the ones the Thin wall section makes (thinRules.ts).
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { asSurfaceOp, closeWithLineOp, openProfile, patchThinOn, thinOf } from './thinRules';

type Wire = Record<string, unknown>;
const doc = (...features: Wire[]): PartDoc => ({ format: 'ck-part', version: 1, name: 't', features, seq: 9 }) as unknown as PartDoc;
const PI = Math.PI;

const C_ARC = [[20, 0], [14, 14], [0, 20], [-14, 14], [-20, 0], [-14, -14]];
const spline: Wire = {
  type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: C_ARC.map(([x, y], i) => ({ id: `p${i}`, x, y })),
  entities: [{ type: 'spline', id: 'e1', pts: C_ARC.map((_, i) => `p${i}`), closed: false }], constraints: [],
};
const circle: Wire = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x: 0, y: 0 }], entities: [{ type: 'circle', id: 'e1', c: 'o', r: 10 }], constraints: [] };
/** Three sides of a 20 x 40 rectangle: the loose ends are 4 apart. */
const almost: Wire = {
  type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'a', x: 20, y: 0 }, { id: 'b', x: 0, y: 0 }, { id: 'c', x: 0, y: 40 }, { id: 'd', x: 20, y: 40 }, { id: 'g', x: 20, y: 4 }],
  entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'g']].map(([id, p1, p2]) => ({ type: 'line', id, p1, p2 })), constraints: [],
};
const extrude = (patch: Wire = {}): Wire => ({ type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 5, ...patch });

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function measure(d: PartDoc) {
  const s = await Session.open(d);
  sessions.push(s);
  const report = await s.verify();
  const volume = report.regen.errors.length ? null : await s.massProps().then((m) => (m as { volume: number }).volume, () => null);   // a surface has no volume
  return { errors: report.regen.errors.map(([id, e]) => ({ id, code: e.code, params: (e as unknown as { params?: Wire }).params ?? {} })), volume };
}
const near = (a: number | null, b: number, rel = 1e-6) => expect(Math.abs((a ?? NaN) - b) / b).toBeLessThan(rel);

describe('thin wall against the kernel', { skip: !process.env.CK_WASM }, () => {
  it('a C-shaped spline arc: the mid wall is the mean of the inside and the outside wall', async () => {
    const wall = (side: string) => measure(doc(spline, extrude({ thin: { thickness: 3, side, ends: 'flat', cornerStyle: 'mitre' } })));
    const [i, o, m] = [await wall('inside'), await wall('outside'), await wall('mid')];
    for (const r of [i, o, m]) expect(r.errors).toEqual([]);
    expect(Math.abs(m.volume! - 0.5 * (i.volume! + o.volume!)) / m.volume!).toBeLessThan(5e-3);
    expect(i.volume!).toBeLessThan(m.volume!);
    expect(o.volume!).toBeGreaterThan(m.volume!);
  });
  it('a closed circle gives a hollow wall (outer and inner loop), inside by default', async () => {
    const r = await measure(doc(circle, extrude({ ...patchThinOn({ sketch: 'F1' }, doc(circle), true), depth: 5 })));
    expect(r.errors).toEqual([]);
    const t = (thinOf(patchThinOn({ sketch: 'F1' }, doc(circle), true))!.thickness as number);
    near(r.volume, PI * (100 - (10 - t) ** 2) * 5);
  });
  it('the thickness takes a variable', async () => {
    const d = { ...doc(circle, extrude({ thin: { thickness: '=wall', side: 'inside' } })), variables: [{ name: 'wall', expr: '2' }] } as unknown as PartDoc;
    const r = await measure(d);
    expect(r.errors).toEqual([]);
    near(r.volume, PI * (100 - 64) * 5);
  });
  it('too thick: the kernel error carries minRadius and maxThickness', async () => {
    const r = await measure(doc(spline, extrude({ thin: { thickness: 60, side: 'inside' } })));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe('thinTooThick');
    expect(r.errors[0].params.minRadius).toBeGreaterThan(0);
    expect(r.errors[0].params.maxThickness).toBeGreaterThan(0);
  });
  it('the three card actions each give a model that regenerates', async () => {
    const d = doc(almost, extrude());
    expect(openProfile(d, 'F1')?.gap?.distance).toBeCloseTo(4, 9);
    // the dead end the card replaces
    const dead = await measure(d);
    expect(dead.errors[0]?.code).toBe('noClosedProfile');
    // 1. Make thin wall
    const wide = { ...almost, points: (almost.points as Wire[]).map((p) => (p.id === 'g' ? { ...p, y: 12 } : p)) };   // the default 4.5 wall fits a 12 mm gap
    const thin = await measure(doc(wide, extrude(patchThinOn({ sketch: 'F1' }, doc(wide), true))));
    expect(thin.errors).toEqual([]);
    expect(thin.volume).toBeGreaterThan(0);
    // a wall thicker than the gap overlaps itself: the kernel says so and what would fit
    const clash = await measure(doc(almost, extrude(patchThinOn({ sketch: 'F1' }, d, true))));
    expect(clash.errors[0]).toMatchObject({ code: 'thinTooThick' });
    expect(clash.errors[0].params.maxThickness).toBeLessThan(4);
    // 2. Close with a line: the 20 x 40 rectangle, 5 deep
    const op = closeWithLineOp(d, 'F1') as unknown as { feature: Wire };
    const closed = await measure(doc(op.feature, extrude()));
    expect(closed.errors).toEqual([]);
    near(closed.volume, 20 * 40 * 5 - 0, 1e-6);
    // 3. Extrude as surface: a sheet, no solid volume, no error
    const surf = asSurfaceOp(extrude()) as unknown as { feature: Wire };
    const sheet = await measure(doc(almost, surf.feature));
    expect(sheet.errors).toEqual([]);
  });

  it('Close with a line is ONE undo step (and so is Make thin wall)', async () => {
    const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
    const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
    const c = new Controller({ store: createStore(), view, kernel });
    await c.load(doc(almost, extrude()));
    const before = JSON.stringify(c.document());
    const op = closeWithLineOp(c.document(), 'F1')!;
    const r = await c.commit([op], 'closeProfile');
    expect(r.ok).toBe(true);
    const closed = c.document() as unknown as { features: Array<{ id: string; entities?: unknown[] }> };
    expect(closed.features[0].entities).toHaveLength(5);
    await c.undo();
    expect(JSON.stringify(c.document())).toBe(before);
    // the surface switch is one step too
    const s = await c.commit([asSurfaceOp(extrude())], 'surfaceExtrude');
    expect(s.ok).toBe(true);
    expect((c.document() as unknown as { features: Array<{ type: string }> }).features[1].type).toBe('surfaceExtrude');
    await c.undo();
    expect(JSON.stringify(c.document())).toBe(before);
  });
});

describe('the thin-wall-bracket sample', { skip: !process.env.CK_WASM }, () => {
  it('regenerates without errors: an open arc extruded thin and an open profile revolved thin', async () => {
    const file = resolve(process.cwd(), 'apps/cad/public/samples/thin-wall-bracket.ckpart');
    const d = JSON.parse(readFileSync(file, 'utf8')) as PartDoc;
    const feats = (d as unknown as { features: Array<{ type: string; thin?: unknown }> }).features;
    expect(feats.filter((f) => f.thin)).toHaveLength(2);
    const r = await measure(d);
    expect(r.errors).toEqual([]);
    expect(r.volume).toBeGreaterThan(100);
  }, 120000);
});

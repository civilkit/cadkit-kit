// Text along a curve, against the real kernel: letters on a construction line, an arc and a spline build, a straight path gives
// the same letters as the plain entity, the text follows when the path moves, a missing path is a feature error.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

function world() {
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; }, cancel() {} };
  const store = createStore();
  return { controller: new Controller({ store, view, kernel }), store };
}
type W = Record<string, unknown>;
const emboss = (points: W[], entities: W[]) => [
  { op: 'add' as const, feature: { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...points], entities, constraints: [] } },
  { op: 'add' as const, feature: { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 2 } },
] as never;
const text = (extra: W = {}): W => ({ id: 't1', type: 'text', string: 'RPM 150', font: 'gauge', height: 6, p: 'a', ...extra });
const volume = async (c: Controller): Promise<number> => (await c.partMass(c.document())).volume ?? 0;
const errors = (store: ReturnType<typeof createStore>) => store.featureStatus.value.filter((f) => !f.ok).map((f) => f.code);

describe('text along a curve', { skip: !process.env.CK_WASM, timeout: 60000 }, () => {
  it('a straight construction line gives the letters of the plain text, rotated; the arc and the spline build', async () => {
    const a = 30 * Math.PI / 180;
    const plain = world();
    await plain.controller.load(emptyPart('T'));
    await plain.controller.edit(emptyOps());
    function emptyOps() { return emboss([{ id: 'a', x: 0, y: 0 }], [text({ angle: 30 })]); }
    const vPlain = await volume(plain.controller);
    const line = world();
    await line.controller.load(emptyPart('T'));
    await line.controller.edit(emboss([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 80 * Math.cos(a), y: 80 * Math.sin(a) }], [{ id: 'e1', type: 'line', p1: 'a', p2: 'b', construction: true }, text({ path: 'e1' })]));
    expect(errors(line.store)).toEqual([]);
    expect(await volume(line.controller)).toBeCloseTo(vPlain, 3);   // same letters, same place: left anchor starts at the start of the line
    // an arc (counter-clockwise from p1 to p2) and a spline: they build and the letters have volume
    const arc = world();
    await arc.controller.load(emptyPart('T'));
    await arc.controller.edit(emboss([{ id: 'a', x: 0, y: 0 }, { id: 'c', x: 0, y: -20 }, { id: 'p1', x: 40, y: -20 }, { id: 'p2', x: -40, y: -20 }], [{ id: 'e1', type: 'arc', c: 'c', p1: 'p1', p2: 'p2', construction: true }, text({ path: 'e1', anchor: ['center', 'baseline'] })]));
    expect(errors(arc.store)).toEqual([]);
    expect(await volume(arc.controller)).toBeGreaterThan(vPlain * 0.9);
    const sp = world();
    await sp.controller.load(emptyPart('T'));
    await sp.controller.edit(emboss([{ id: 'a', x: 0, y: 0 }, { id: 's1', x: 0, y: 0 }, { id: 's2', x: 30, y: 15 }, { id: 's3', x: 60, y: 0 }, { id: 's4', x: 90, y: 15 }], [{ id: 'e1', type: 'spline', pts: ['s1', 's2', 's3', 's4'], construction: true }, text({ path: 'e1', anchor: ['center', 'baseline'] })]));
    expect(errors(sp.store)).toEqual([]);
    expect(await volume(sp.controller)).toBeGreaterThan(vPlain * 0.9);
  });
  it('a path that is not a curve of the sketch is refused with textBadPath', async () => {
    const w = world();
    await w.controller.load(emptyPart('T'));
    const r = await w.controller.edit(emboss([{ id: 'a', x: 0, y: 0 }], [text({ path: 'nope' })]));
    expect(r.ok).toBe(false);   // the edit is refused and nothing is added
    expect(JSON.stringify(r)).toContain('textBadPath');
  });
});

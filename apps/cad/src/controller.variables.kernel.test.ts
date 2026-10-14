import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { readVars, renamePatch, readConfigs, readActive, applyConfig, scopeOf } from './variables';

// a plate whose width is a sketch dimension driven by the variable `w`, extruded to a depth of `=t*2`
const doc = (): PartDoc => ({
  ...emptyPart('Plate'),
  variables: [{ name: 'w', expr: '40' }, { name: 't', expr: '5' }],
  features: [
    {
      type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
      points: [{ id: 'p1', x: 0, y: 0, fixed: true }, { id: 'p2', x: 40, y: 0 }, { id: 'p3', x: 40, y: 20 }, { id: 'p4', x: 0, y: 20 }],
      entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
      constraints: [
        { id: 'c1', type: 'horizontal', refs: ['e1'] }, { id: 'c2', type: 'vertical', refs: ['e2'] },
        { id: 'c3', type: 'horizontal', refs: ['e3'] }, { id: 'c4', type: 'vertical', refs: ['e4'] },
        { id: 'c5', type: 'distance', refs: ['p1', 'p2'], value: 40, expr: 'w' }, { id: 'c6', type: 'distance', refs: ['p2', 'p3'], value: 20 },
      ],
    },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: '=t*2' },
  ],
  seq: 3,
}) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load(doc());
  const size = () => { const b = controller.bodyBox()!; return b.max.map((m, i) => +(m - b.min[i]).toFixed(3)).sort((a, c) => a - c); };
  return { store, controller, size };
}

describe('variables against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('builds from the variables of the document (depth =t*2, width w)', async () => {
    const w = await world();
    expect(w.size()).toEqual([10, 20, 40]);
  });

  it('a variable change rebuilds the part and is one undo step, redo applies it again', async () => {
    const w = await world();
    const vars = readVars(w.controller.document()).map((v) => (v.name === 'w' ? { ...v, expr: '60' } : v.name === 't' ? { ...v, expr: '3' } : v));
    expect((await w.controller.applyDocPatch({ variables: vars }, 'variables.set')).ok).toBe(true);
    expect(w.size()).toEqual([6, 20, 60]);
    expect(readVars(w.controller.document()).find((v) => v.name === 'w')?.expr).toBe('60');
    await w.controller.undo();
    expect(w.size()).toEqual([10, 20, 40]);
    expect(readVars(w.controller.document()).find((v) => v.name === 'w')?.expr).toBe('40');
    await w.controller.redo();
    expect(w.size()).toEqual([6, 20, 60]);
  });

  it('a rename updates every use, in one step', async () => {
    const w = await world();
    const patch = renamePatch(w.controller.document()!, 't', 'thick');
    expect((await w.controller.applyDocPatch(patch, 'variables.rename')).ok).toBe(true);
    const d = w.controller.document()!;
    expect(readVars(d).map((v) => v.name)).toEqual(['w', 'thick']);
    expect((d.features[1] as unknown as { depth: string }).depth).toBe('=thick*2');
    expect(w.size()).toEqual([10, 20, 40]);
    await w.controller.undo();
    expect((w.controller.document()!.features[1] as unknown as { depth: string }).depth).toBe('=t*2');
  });

  it('a change the kernel rejects leaves the document alone', async () => {
    const w = await world();
    const bad = readVars(w.controller.document()).filter((v) => v.name !== 't');   // F2 still uses t
    const r = await w.controller.applyDocPatch({ variables: bad }, 'variables.set');
    expect(r.ok).toBe(false);
    expect(readVars(w.controller.document())).toHaveLength(2);
    expect(w.size()).toEqual([10, 20, 40]);
  });

  it('configurations are kept in the document and switch the variables', async () => {
    const w = await world();
    const d0 = w.controller.document()!;
    const small = { name: 'Small', values: { w: '30', t: '2' } };
    const large = { name: 'Large', values: { w: '80', t: '6' } };
    await w.controller.applyDocPatch({ configurations: [small, large], activeConfig: 'Large', variables: applyConfig(readVars(d0), large) }, 'config.apply');
    expect(w.size()).toEqual([12, 20, 80]);
    const d = w.controller.document()!;
    expect(readConfigs(d).map((c) => c.name)).toEqual(['Small', 'Large']);
    expect(readActive(d)).toBe('Large');
    expect(scopeOf(d).values).toEqual({ w: 80, t: 6 });
    await w.controller.applyDocPatch({ activeConfig: 'Small', variables: applyConfig(readVars(d), small) }, 'config.apply');
    expect(w.size()).toEqual([4, 20, 30]);
  });
});

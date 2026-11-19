import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { mirrorTool, type MirrorState } from './mirror';
import { symmetricTool } from './constraint-tools';
import { DEFAULT_SETTINGS, type ToolEvent, type ToolOutput } from './types';
import { resolves } from './edit-fixtures';
import { closeSessions, solveDraft, solveSketchOnly } from './kernel-fixtures';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, entityId }, mods: M });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
const run = <S>(tool: { start(): S; step: (s: S, e: ToolEvent, d: SketchDraft, st: typeof DEFAULT_SETTINGS) => ToolOutput<S> }, d: SketchDraft, evs: ToolEvent[]) => {
  let out: ToolOutput<S> = { state: tool.start(), draft: d, preview: [], fields: [] };
  for (const ev of evs) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
};
const base = (extra: Partial<SketchDraft> = {}): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points: [], entities: [], constraints: [], ...extra });

/** a d18 circle centred 30 right of the origin, positioned from the origin point by an hdist (and vdist 0) */
const circleScene = (): SketchDraft => base({
  points: [{ id: 'o', x: 0, y: 0, fixed: true }, { id: 'c', x: 30, y: 0 }],
  entities: [{ id: 'e1', type: 'circle', c: 'c', r: 9 }],
  constraints: [{ id: 'k1', type: 'hdist', refs: ['o', 'c'], value: 30 }, { id: 'k2', type: 'vdist', refs: ['o', 'c'], value: 0 }, { id: 'k3', type: 'radius', refs: ['e1'], value: 9 }],
});

describe('mirror about an origin axis, in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a circle mirrored about the Y axis (key Y) lands at (-30,0), and editing the original x moves the copy', async () => {
    const out = run(mirrorTool, circleScene(), [clickOn('e1'), key('Enter'), key('y')]);
    const d = out.draft;
    expect(resolves(d)).toBe(true);
    expect(d.entities.filter((e) => e.type === 'circle')).toHaveLength(2);
    expect(d.entities.filter((e) => e.construction)).toHaveLength(1);                // the axis line
    const copy = d.entities.find((e) => e.type === 'circle' && e.id !== 'e1')!;
    const a = await solveDraft(d, 2, { solve: true });
    expect(a.status!.conflicts).toEqual([]);
    expect(a.status!.redundant).toEqual([]);
    expect(a.status!.dof).toBe(0);                                                    // original fully dimensioned, the copy adds nothing free
    expect(a.pts[String(copy.c)][0]).toBeCloseTo(-30, 4);
    expect(a.pts[String(copy.c)][1]).toBeCloseTo(0, 4);
    // the original's x dimension 30 -> 25 (stale value, new expression: the kernel re-solves)
    const edited = { ...d, constraints: d.constraints.map((c) => (c.id === 'k1' ? { ...c, value: 30, expr: '25' } : c)) };
    const b = await solveDraft(edited, 2, { solve: true });
    expect(b.pts['c'][0]).toBeCloseTo(25, 4);
    expect(b.pts[String(copy.c)][0]).toBeCloseTo(-25, 4);
  });

  it('without dimensions the original keeps its 3 degrees of freedom: the copy adds none', async () => {
    const d0 = base({ points: [{ id: 'c', x: 30, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 9 }] });
    const d = run(mirrorTool, d0, [clickOn('e1'), key('Enter'), key('y')]).draft;
    expect((await solveDraft(d, 2, { solve: true })).status!.dof).toBe(3);
  });

  it('a line chain mirrored about the X axis: the shared middle point is mirrored once, DOF stays that of the chain', async () => {
    const d0 = base({
      points: [{ id: 'p1', x: 10, y: 5 }, { id: 'p2', x: 20, y: 15 }, { id: 'p3', x: 35, y: 8 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }],
    });
    const d = run(mirrorTool, d0, [clickOn('e1'), clickOn('e2'), key('Enter'), key('x')]).draft;
    expect(d.points.filter((p) => !p.fixed)).toHaveLength(6);                         // 3 originals + 3 mirrored (not 4)
    const a = await solveSketchOnly(d);                                              // an open chain has no profile to extrude
    expect(a.status!.conflicts).toEqual([]);
    expect(a.status!.redundant).toEqual([]);
    expect(a.status!.dof).toBe(6);
    const sym = d.constraints.filter((c) => c.type === 'symmetric');
    expect(sym).toHaveLength(3);
    for (const c of sym) { const [p, q] = c.refs!; expect(a.pts[q][0]).toBeCloseTo(a.pts[p][0], 4); expect(a.pts[q][1]).toBeCloseTo(-a.pts[p][1], 4); }
  });

  it('Symmetric tool: two circle centres and key Y; the second centre is pulled to (-30,0)', async () => {
    const d0 = base({
      points: [{ id: 'o', x: 0, y: 0, fixed: true }, { id: 'c', x: 30, y: 0 }, { id: 'c2', x: -28, y: 4 }],
      entities: [{ id: 'e1', type: 'circle', c: 'c', r: 9 }, { id: 'e2', type: 'circle', c: 'c2', r: 9 }],
      constraints: [{ id: 'k1', type: 'hdist', refs: ['o', 'c'], value: 30 }, { id: 'k2', type: 'vdist', refs: ['o', 'c'], value: 0 }],
    });
    const out = run(symmetricTool, d0, [clickOn('e1'), clickOn('e2'), key('y')]);
    const sym = out.draft.constraints.find((c) => c.type === 'symmetric')!;
    expect(sym.refs!.slice(0, 2)).toEqual(['c', 'c2']);
    const a = await solveDraft(out.draft, 2, { solve: true });
    expect(a.status!.conflicts).toEqual([]);
    expect(a.pts['c2'][0]).toBeCloseTo(-30, 4);
    expect(a.pts['c2'][1]).toBeCloseTo(0, 4);
  });
});

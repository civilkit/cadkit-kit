import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Modifiers, type ToolEvent } from './types';
import { lineTool } from './line';
import { pruneOrphanPoints } from './builders';
import { closeSessions, solveSketchOnly } from './kernel-fixtures';

afterEach(closeSessions);
const M: Modifiers = { shift: false, ctrl: false, alt: false };
const click = (x: number, y: number, pointId?: string): ToolEvent => ({ type: 'click', at: { x, y }, mods: M, ...(pointId ? { snap: { kind: 'point' as const, at: { x, y }, pointId } } : {}) });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
/** A circle dimensioned in full: centre on the origin, radius 10. */
const circle = (): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }],
  entities: [{ id: 'e1', type: 'circle', c: 'p1', r: 10 }],
  constraints: [{ id: 'k1', type: 'coincident', refs: ['p1', 'O'] }, { id: 'k2', type: 'radius', refs: ['e1'], value: 10 }],
});
function run(events: ToolEvent[], draft = circle()) {
  let out = { state: lineTool.start(), draft, preview: [], fields: [] } as ReturnType<typeof lineTool.step>;
  for (const ev of events) out = lineTool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}

describe('aborting the line tool', () => {
  it('Escape after the first click removes the start point nothing uses', () => {
    const placed = run([click(30, 5)]);
    expect(placed.draft.points).toHaveLength(3);
    const out = run([click(30, 5), key('Escape')]);
    expect(out.draft.points.map((p) => p.id)).toEqual(['O', 'p1']);
  });
  it('keeps a start point other geometry uses, and the points of a drawn chain', () => {
    expect(run([click(0, 0, 'p1'), key('Escape')]).draft.points.map((p) => p.id)).toEqual(['O', 'p1']);
    const chain = run([click(30, 5), click(40, 5), key('Escape')]);
    expect(chain.draft.points).toHaveLength(4);
    expect(chain.draft.entities).toHaveLength(2);
  });
  it('pruneOrphanPoints leaves points a constraint mentions, and fixed ones', () => {
    const d = circle();
    const withPt = { ...d, points: [...d.points, { id: 'p9', x: 3, y: 3 }, { id: 'p8', x: 4, y: 4 }], constraints: [...d.constraints, { id: 'k3', type: 'fix', refs: ['p8'] }] };
    expect(pruneOrphanPoints(withPt, ['p9', 'p8', 'O']).points.map((p) => p.id)).toEqual(['O', 'p1', 'p8']);
  });
});

describe('aborting the line tool, against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('Escape after a first click leaves the degrees of freedom unchanged', async () => {
    const base = (await solveSketchOnly(circle())).status!.dof;
    expect(base).toBe(0);
    const stray = run([click(30, 5)]).draft;
    expect((await solveSketchOnly(stray)).status!.dof).toBe(base + 2);   // the free point the bug left behind
    const aborted = run([click(30, 5), key('Escape')]).draft;
    expect((await solveSketchOnly(aborted)).status!.dof).toBe(base);
  });
});

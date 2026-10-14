import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { constructionTool, markNewAsConstruction, setConstruction } from './construction';
import { circleTool } from './circle';
import { lineTool } from './line';
import { rectDraft } from './edit-fixtures';
import { DEFAULT_SETTINGS, type ToolEvent } from './types';
import { boxSize, closeSessions, solveDraft } from './kernel-fixtures';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const clickOn = (entityId: string): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, entityId }, mods: M });

describe('construction geometry in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('extruding ignores construction entities: a circle in a rectangle is a hole until it is construction', async () => {
    // a 40 x 20 rectangle with a circle r=4 drawn in construction mode
    const base = rectDraft(40, 20);
    let o = circleTool.step(circleTool.start(), click(20, 10), base, DEFAULT_SETTINGS);
    o = circleTool.step(o.state, click(24, 10), o.draft, DEFAULT_SETTINGS);
    const drawn = o.draft;
    expect(drawn.entities).toHaveLength(5);
    const normal = await solveDraft(drawn, 5);
    expect(normal.r.errors).toEqual([]);
    expect(normal.facts.volume!).toBeCloseTo(5 * (40 * 20 - Math.PI * 16), 3);   // the circle cuts a hole

    const marked = markNewAsConstruction(base, drawn);
    expect(marked.entities[4]).toMatchObject({ type: 'circle', construction: true });
    const cons = await solveDraft(marked, 5, { solve: true });
    expect(cons.r.errors).toEqual([]);
    expect(cons.facts.volume!).toBeCloseTo(5 * 40 * 20, 4);                       // solid: the circle was ignored
    expect(boxSize(cons.r.body!.box).slice(0, 2)).toEqual([expect.closeTo(40, 6), expect.closeTo(20, 6)]);
    expect(cons.status!.conflicts).toEqual([]);

    // the tool flips it back: a hole again
    const back = constructionTool.step({}, clickOn('e5'), marked, DEFAULT_SETTINGS).draft;
    expect(back.entities[4]).not.toHaveProperty('construction');
    const holed = await solveDraft(back, 5);
    expect(holed.facts.volume!).toBeCloseTo(5 * (40 * 20 - Math.PI * 16), 3);
  });

  it('a construction line with constraints on it still solves, and does not break the profile', async () => {
    // rectangle plus a diagonal construction line through two corners with a driving length
    let d: SketchDraft = rectDraft(30, 40);
    const withDiag: SketchDraft = { ...d, entities: [...d.entities, { id: 'e5', type: 'line', p1: 'p1', p2: 'p3' }],
      constraints: [...d.constraints, { id: 'k9', type: 'distance', refs: ['p1', 'p3'], value: 50 }] };
    d = setConstruction(withDiag, ['e5'], true);
    const { r, facts, status } = await solveDraft(d, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(facts.volume!).toBeCloseTo(2 * 30 * 40, 4);
    expect(status!.dof).toBe(3);                                      // 4 free dimensions of the rectangle, the diagonal's length takes one
  });

  it('a line drawn in construction mode next to a profile does not stop it extruding', async () => {
    const base = rectDraft(10, 10);
    let o = lineTool.step(lineTool.start(), click(-5, 5), base, DEFAULT_SETTINGS);
    o = lineTool.step(o.state, click(15, 5), o.draft, DEFAULT_SETTINGS);
    const d = markNewAsConstruction(base, o.draft);
    const { r, facts } = await solveDraft(d, 3);
    expect(r.errors).toEqual([]);
    expect(facts.volume!).toBeCloseTo(3 * 100, 4);
  });
});

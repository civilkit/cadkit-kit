import { describe, expect, it } from 'vitest';
import type { PartDoc } from '@ck/part-model';
import { MAX_THEN, addThen, contourCurves, foldLineOf, patchContourCurve, patchFoldCurve, patchFoldSketch, patchThen, removeThen, ruleNames, sheetManagedPaths, sketchLines, thenOf, RING, wallChoices, addEdgePick, applyCornerPick, cornerPoints, cornerSelectionKeep, cornerSize, cornerText, panelEdge, patchCornerMode } from './options';

const doc = { features: [
  { type: 'sheetRules', id: 'R1', name: 'Steel2' }, { type: 'sheetRules', id: 'R2' },
  { type: 'sketch', id: 'S2', entities: [{ id: 'f1', type: 'line' }, { id: 'c1', type: 'circle' }, { id: 'f2', type: 'line' }] },
] } as unknown as PartDoc;

describe('sheet option rules', () => {
  it('each sheet type owns its numbers and leaves the pickers to the generic editor', () => {
    expect([...sheetManagedPaths('sheetRules')]).toContain('cornerReliefShape');
    expect(sheetManagedPaths('edgeFlange').has('edges')).toBe(false);
    expect(sheetManagedPaths('baseFlange').has('sketch')).toBe(false);
    expect(sheetManagedPaths('fold').has('line')).toBe(true);
    expect(sheetManagedPaths('extrude').size).toBe(0);
    expect(sheetManagedPaths('unfold').size).toBe(0);
  });
  it('lists the rules by name, falling back to the id', () => {
    expect(ruleNames(doc)).toEqual(['Steel2', 'R2']);
  });
  it('chains bends after a flange: add repeats the last bend, remove drops one, the list stops at the kernel limit', () => {
    let eff: Record<string, unknown> = { type: 'edgeFlange', height: 20 };
    expect(thenOf(eff)).toEqual([]);
    eff = { ...eff, ...addThen(eff) };
    expect(thenOf(eff)).toEqual([{ angle: 90, height: 10 }]);
    eff = { ...eff, ...patchThen(eff, 0, { angle: 45, height: 12 }) };
    eff = { ...eff, ...addThen(eff) };
    expect(thenOf(eff)).toEqual([{ angle: 45, height: 12 }, { angle: 45, height: 12 }]);
    eff = { ...eff, ...patchThen(eff, 1, { flip: true }) };
    expect(thenOf(eff)[1]).toEqual({ angle: 45, height: 12, flip: true });
    expect(removeThen(eff, 0).then).toEqual([{ angle: 45, height: 12, flip: true }]);
    expect(removeThen({ then: [{ angle: 90, height: 5 }] }, 0)).toEqual({ then: null });   // the last one takes the field away
    const full = { then: Array.from({ length: MAX_THEN }, () => ({ angle: 90, height: 5 })) };
    expect(addThen(full)).toEqual({});
  });
  it('a fold follows a line of a sketch; choosing the sketch picks its first line and drops the two-point form', () => {
    expect(sketchLines(doc, 'S2')).toEqual(['f1', 'f2']);
    expect(sketchLines(doc, 'nope')).toEqual([]);
    expect(patchFoldSketch(doc, 'S2')).toEqual({ line: { sketch: 'S2', curve: 'f1' }, points: null });
    expect(patchFoldCurve({ line: { sketch: 'S2', curve: 'f1' } }, 'f2')).toEqual({ line: { sketch: 'S2', curve: 'f2' }, points: null });
    expect(foldLineOf({ line: { sketch: 'S2', curve: 'f1' } })).toEqual({ sketch: 'S2', curve: 'f1' });
    expect(foldLineOf({ points: [[0, 0, 0], [1, 0, 0]] })).toBeNull();
  });
  it('a contour flange follows every line unless some are unticked, and keeps at least one', () => {
    const all = ['f1', 'f2', 'f3'];
    expect(contourCurves({}, all)).toEqual(all);
    expect(patchContourCurve({}, all, 'f2', false)).toEqual({ curves: ['f1', 'f3'] });
    expect(patchContourCurve({ curves: ['f1', 'f3'] }, all, 'f2', true)).toEqual({ curves: null });
    expect(patchContourCurve({ curves: ['f1'] }, all, 'f1', false)).toEqual({});
  });
  it('the new types own their fields: convert (thickness, rule), cut (regions), corner (corners, mode, size)', () => {
    expect([...sheetManagedPaths('sheetConvert')].sort()).toEqual(['rule', 'thickness']);
    expect([...sheetManagedPaths('sheetCut')]).toEqual(['regions']);
    expect(sheetManagedPaths('sheetCut').has('sketch')).toBe(false);          // the sketch picker stays generic
    expect([...sheetManagedPaths('sheetCorner')].sort()).toEqual(['corners', 'distance', 'mode', 'radius', 'size']);
    expect(sheetManagedPaths('fold').has('panel')).toBe(true);
  });
  it('a panel edge is a role string or a ring edge of the panel; it is added once', () => {
    expect(panelEdge(2, 'tip')).toBe('P2.tip');
    expect(panelEdge(1, 'side.start')).toBe('P1.side.start');
    expect(panelEdge(1, 'side.w6')).toBe('P1.side.w6');
    expect(panelEdge(3, RING, 2)).toEqual({ edge: 2, panel: 3 });
    expect(panelEdge(3, RING, -1)).toEqual({ edge: 0, panel: 3 });
    expect(wallChoices([['side.e2'], ['tip', 'side.w6']], 1)).toEqual(['tip', 'side.w6']);
    expect(wallChoices([[], []], 1)).toEqual(['tip', 'side.start', 'side.end']);       // not named yet: the walls every leg has
    expect(addEdgePick({}, 'P2.tip')).toEqual({ edges: ['P2.tip'] });
    const e = { edges: [{ faces: ['a', 'b'], at: [0, 0, 0] }, 'P2.tip'] };
    expect(addEdgePick(e, 'P2.tip')).toEqual({});
    expect(addEdgePick(e, 'P1.tip')).toEqual({ edges: [...e.edges, 'P1.tip'] });
  });
  it('corner picks come from the selected vertices and say what they are', () => {
    expect(cornerPoints(['v:10,0,3', 'A|B#0', 'v:bad', 'v:1.2345678,2,3'])).toEqual([[10, 0, 3], [1.234568, 2, 3]]);
    expect(cornerText([10, 0.123456, 3])).toBe('10, 0.12, 3');
    expect(cornerText({ panel: 1, vertex: 2 })).toBe('P1 vertex 2');
  });
  it('switching a corner between round and chamfer keeps its size', () => {
    expect(patchCornerMode({ mode: 'round', radius: 5 }, 'chamfer')).toEqual({ mode: 'chamfer', distance: 5, radius: null, size: null });
    expect(patchCornerMode({ mode: 'chamfer', distance: 4 }, 'round')).toEqual({ mode: 'round', radius: 4, distance: null, size: null });
    expect(patchCornerMode({}, 'chamfer').distance).toBe(3);
    expect(cornerSize({ mode: 'chamfer', distance: 4, radius: 9 })).toBe(4);
    expect(cornerSize({ size: 6 })).toBe(6);
  });
  it('picking corners adds the vertex selected, takes out the one deselected and leaves the rest', () => {
    const typed = { panel: 1, vertex: 2 };
    expect(applyCornerPick([typed], [], ['v:1,2,3'])).toEqual([typed, [1, 2, 3]]);
    expect(applyCornerPick([typed, [1, 2, 3]], ['v:1,2,3'], [])).toEqual([typed]);
    expect(applyCornerPick([[1, 2, 3]], ['v:1,2,3'], ['v:1,2,3'])).toBeNull();                 // nothing changed
    expect(applyCornerPick([[1, 2, 3]], [], ['v:1,2,3'])).toBeNull();                          // already in
    expect(cornerSelectionKeep(['v:1,2,3', 'v:4,5,6', 'A|B#0'], [[1, 2, 3]])).toEqual(['v:1,2,3', 'A|B#0']);
  });
});

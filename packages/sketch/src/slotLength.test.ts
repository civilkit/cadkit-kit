import { describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { capsOverall, shownValue, storedValue } from './slotLength';
import { annotate, setConstraintValue } from './annotations';
import { makeDriven, makeDriving, measureRef, refAnnotations, refDimsOf } from './refdims';
import { slotTool } from './tools/slot';
import { dimensionTool } from './tools/dimension';
import { DEFAULT_SETTINGS, type SnapHit, type Tool, type ToolEvent, type ToolOutput } from './tools/types';

const M = { shift: false, ctrl: false, alt: false };
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });
const run = <S,>(tool: Tool<S>, events: ToolEvent[], draft = empty()): ToolOutput<S> => {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
};
const pick = (snap: SnapHit): ToolEvent => ({ type: 'click', at: snap.at, snap, mods: M });
const entity = (id: string) => pick({ kind: 'grid', at: { x: 0, y: 0 }, entityId: id });
const typed = (value: number): ToolEvent => ({ type: 'field', id: 'value', value, commit: true });

/** A slot of centre distance 20 and width 8 (cap radius 4): overall length 28. */
const slot = (): SketchDraft => run(slotTool, [click(0, 0), click(20, 0), click(20, 4)]).draft;
const caps = (d: SketchDraft) => d.entities.filter((e) => e.type === 'arc').map((e) => e.id);

describe('slot caps', () => {
  it('the two caps of a slot measure its overall length, in any direction', () => {
    const d = slot();
    const [a, b] = caps(d);
    expect(capsOverall(d, a, b)).toBeCloseTo(28, 9);
    const tilted = run(slotTool, [click(0, 0), click(12, 16), click(-3, 4)]).draft;   // centre distance 20, width 9.6
    const [c, e] = caps(tilted);
    expect(capsOverall(tilted, c, e)).toBeCloseTo(20 + 9.6, 6);
  });
  it('arcs that are not a slot\'s caps measure nothing', () => {
    const d = slot();
    const [a] = caps(d);
    expect(capsOverall(d, a, a)).toBeUndefined();
    const lone: SketchDraft = { ...empty(), points: [{ id: 'c1', x: 0, y: 0 }, { id: 'a1', x: 4, y: 0 }, { id: 'a2', x: 0, y: 4 }, { id: 'c2', x: 20, y: 0 }, { id: 'b1', x: 20, y: -4 }, { id: 'b2', x: 20, y: 4 }],
      entities: [{ id: 'e1', type: 'arc', c: 'c1', p1: 'a1', p2: 'a2' }, { id: 'e2', type: 'arc', c: 'c2', p1: 'b1', p2: 'b2' }] };
    expect(capsOverall(lone, 'e1', 'e2')).toBeUndefined();   // e1 is a quarter turn, not a cap
  });
  it('two caps that bulge toward each other are not a slot', () => {
    const d = slot();
    const [a, b] = caps(d);
    const pts = d.points.map((p) => ({ ...p, x: -p.x }));
    expect(capsOverall({ ...d, points: pts }, a, b)).toBeUndefined();
  });
});

describe('dimensioning the caps', () => {
  it('picking both caps and typing the overall length writes the centre distance that gives it', () => {
    const d = slot();
    const [a, b] = caps(d);
    const o = run(dimensionTool, [entity(a), entity(b)], d);
    expect(o.fields[0]).toMatchObject({ id: 'value', value: 28, label: 'app.sketch.field.overall' });
    const done = run(dimensionTool, [entity(a), entity(b), typed(40)], d);
    const k = done.draft.constraints.find((c) => c.type === 'distance' && c.overall === true)!;
    expect(k).toMatchObject({ refs: [a, b], value: 32 });                 // 40 - 2 x 4
    expect(shownValue(done.draft, k)).toBe(40);
    expect(annotate(done.draft).find((x) => x.id === k.id)).toMatchObject({ text: '40 mm', value: 40 });
  });
  it('a length no longer than the caps is refused', () => {
    const d = slot();
    const [a, b] = caps(d);
    const o = run(dimensionTool, [entity(a), entity(b), typed(8)], d);
    expect(o.draft.constraints.some((c) => c.overall)).toBe(false);
  });
  it('arcs that are not caps still start over with the second arc\'s radius', () => {
    const d: SketchDraft = { ...empty(), points: [{ id: 'c1', x: 0, y: 0 }, { id: 'a1', x: 4, y: 0 }, { id: 'a2', x: 0, y: 4 }, { id: 'c2', x: 20, y: 0 }, { id: 'b1', x: 24, y: 0 }, { id: 'b2', x: 20, y: 4 }],
      entities: [{ id: 'e1', type: 'arc', c: 'c1', p1: 'a1', p2: 'a2' }, { id: 'e2', type: 'arc', c: 'c2', p1: 'b1', p2: 'b2' }] };
    const o = run(dimensionTool, [entity('e1'), entity('e2')], d);
    expect(o.fields[0].label).toBe('app.sketch.field.radius');
  });
  it('editing the label sets the overall length; an expression is dropped; a value that is too small is refused', () => {
    const d = slot();
    const [a, b] = caps(d);
    const made = run(dimensionTool, [entity(a), entity(b), typed(40)], d).draft;
    const id = made.constraints.find((c) => c.overall)!.id;
    const edited = setConstraintValue({ ...made, constraints: made.constraints.map((c) => (c.id === id ? { ...c, expr: 'w' } : c)) }, id, 50, 'w+1')!;
    expect(edited.constraints.find((c) => c.id === id)).toMatchObject({ value: 42, overall: true });
    expect(edited.constraints.find((c) => c.id === id)!.expr).toBeUndefined();
    expect(setConstraintValue(made, id, 7)).toBeNull();
  });
  it('as a reference dimension it measures the overall length, and goes back to a driving one', () => {
    const d = slot();
    const [a, b] = caps(d);
    const made = run(dimensionTool, [entity(a), entity(b), typed(40)], d).draft;
    const id = made.constraints.find((c) => c.overall)!.id;
    const ref = makeDriven(made, id)!;
    expect(refDimsOf(ref)[0]).toMatchObject({ overall: true });
    expect(measureRef(ref, refDimsOf(ref)[0])).toBeCloseTo(28, 9);
    expect(refAnnotations(ref)[0].text).toBe('(28 mm)');
    const back = makeDriving(ref, 'r1')!;
    expect(back.constraints.find((c) => c.overall)).toMatchObject({ value: 20, refs: [a, b] });
  });
  it('shown and stored values convert both ways, and plain dimensions pass through', () => {
    const d = slot();
    const [a, b] = caps(d);
    expect(storedValue(d, { refs: [a, b], overall: true }, 28)).toBeCloseTo(20, 9);
    expect(storedValue(d, { refs: [a, b] }, 28)).toBe(28);
    expect(shownValue(d, { id: 'k', type: 'distance', refs: [a, b], value: 20 })).toBe(20);
  });
});

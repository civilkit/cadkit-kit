/**
 * Sketch corner / extend polish studied from solidcraft (#8426, #8998, #9493, #8813, #8802, #8238, #9469, #9012, #9773):
 * lines that share no end are joined first, several corners in one step, refusals for corners that are no corner, a
 * radius of half a side, a refused size's hint clearing, and crossings at a curve's own end.
 */
import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Tool, type ToolEvent, type ToolOutput } from './types';
import { filletTool } from './fillet';
import { chamferTool } from './chamfer';
import { applyCorners, cornerAtPoint, pairCorners } from './corner';
import { extendAt } from './extend';
import { trimAt } from './trim';
import { rectDraft, resolves } from './edit-fixtures';

const M = { shift: false, ctrl: false, alt: false };
const S = { shift: true, ctrl: false, alt: false };
const clickOn = (entityId: string, mods = M): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, entityId }, mods });
const clickPt = (pointId: string, mods = M): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, pointId }, mods });
const field = (id: string, value: number, commit = true): ToolEvent => ({ type: 'field', id, value, commit });
const enter: ToolEvent = { type: 'key', key: 'Enter' };
function run<S>(tool: Tool<S>, draft: SketchDraft, events: ToolEvent[]): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}
const pt = (d: SketchDraft, id: string) => d.points.find((p) => p.id === id)!;
const lines = (d: SketchDraft) => d.entities.filter((e) => e.type === 'line');
const arcs = (d: SketchDraft) => d.entities.filter((e) => e.type === 'arc');
const blank = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });
/** Two lines that stop short of each other's line: e1 (0,0)-(8,0) and e2 (10,-5)-(10,8), which cross at (10,0) once e1 is carried on. */
function apartDraft(extra: Partial<SketchDraft> = {}): SketchDraft {
  return { ...blank(), points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 8, y: 0 }, { id: 'p3', x: 10, y: -5 }, { id: 'p4', x: 10, y: 8 }],
    entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p3', p2: 'p4' }], ...extra };
}

describe('#8426 fillet / chamfer on two lines that share no end', () => {
  it('fillet: the short line is carried on, the overshoot goes, then the corner is rounded', () => {
    const o = run(filletTool, apartDraft(), [field('r', 1), clickOn('e1'), clickOn('e2')]);
    expect(o.hint).toBeUndefined();
    expect(arcs(o.draft)).toHaveLength(1);
    const e1 = o.draft.entities.find((e) => e.id === 'e1')!, e2 = o.draft.entities.find((e) => e.id === 'e2')!;
    expect(pt(o.draft, String(e1.p2))).toMatchObject({ x: expect.closeTo(9, 9), y: expect.closeTo(0, 9) });
    expect(pt(o.draft, String(e2.p1))).toMatchObject({ x: expect.closeTo(10, 9), y: expect.closeTo(1, 9) });
    expect(pt(o.draft, String(e2.p2)).y).toBeCloseTo(8, 9);          // the far end stays
    expect(resolves(o.draft)).toBe(true);
  });
  it('chamfer does the same, and the preview shows the corner piece before the click', () => {
    let o = run(chamferTool, apartDraft(), [clickOn('e1'), clickOn('e2')]);
    expect(o.hint).toBeUndefined();
    expect(o.preview.length).toBeGreaterThan(0);
    o = chamferTool.step(o.state, field('d', 2), o.draft, DEFAULT_SETTINGS);
    expect(lines(o.draft)).toHaveLength(3);
  });
  it('refuses parallel lines, and leaves the sketch as it was', () => {
    const d = rectDraft(10, 10);
    const o = run(filletTool, d, [field('r', 1), clickOn('e1'), clickOn('e3')]);
    expect(o.hint).toBe('app.sketch.hint.parallel.more');
    expect(o.draft).toEqual(d);
  });
  it('refuses lines that meet absurdly far away', () => {
    const d = apartDraft({ points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 8, y: 0 }, { id: 'p3', x: 10, y: 1e4 }, { id: 'p4', x: 20, y: 1e4 + 2e-4 }] });
    const o = run(filletTool, d, [field('r', 1), clickOn('e1'), clickOn('e2')]);
    expect(o.hint).toBe('app.sketch.hint.meetFar');
  });
  it('refuses when the end that would move is held by another curve, a constraint, or a fixed point', () => {
    const shared = apartDraft({ entities: [...apartDraft().entities, { id: 'e3', type: 'line', p1: 'p2', p2: 'p4' }] });
    expect(run(filletTool, shared, [field('r', 1), clickOn('e1'), clickOn('e2')]).hint).toBe('app.sketch.hint.endHeld');
    const dim = apartDraft({ constraints: [{ id: 'k1', type: 'distance', refs: ['p2', 'p1'], value: 8 }] });
    const o = run(filletTool, dim, [field('r', 1), clickOn('e1'), clickOn('e2')]);
    expect(o.hint).toBe('app.sketch.hint.endHeld');
    expect(o.draft).toEqual(dim);
    const fixed = apartDraft({ points: apartDraft().points.map((p) => (p.id === 'p2' ? { ...p, fixed: true } : p)) });
    expect(run(filletTool, fixed, [field('r', 1), clickOn('e1'), clickOn('e2')]).hint).toBe('app.sketch.hint.endHeld');
  });
  it('refuses a line with a size of its own (equal / midpoint)', () => {
    const eq = apartDraft({ constraints: [{ id: 'k1', type: 'equal', refs: ['e1', 'e2'] }] });
    const o = run(filletTool, eq, [field('r', 1), clickOn('e1'), clickOn('e2')]);
    expect(o.hint).toBe('app.sketch.hint.lineSized');
    expect(o.draft).toEqual(eq);
  });
  it('a radius too large for the joined corner is refused and the lines are not moved', () => {
    const d = apartDraft();
    const o = run(filletTool, d, [field('r', 50), clickOn('e1'), clickOn('e2')]);
    expect(o.hint).toBe('app.sketch.hint.radiusTooLarge');
    expect(o.draft).toEqual(d);
  });
});

describe('#8998 / #9493 several corners at once', () => {
  it('applyCorners cuts all four corners of a rectangle in one edit', () => {
    const d = rectDraft(30, 20);
    const specs = ['p1', 'p2', 'p3', 'p4'].map((p) => cornerAtPoint(d, p)!);
    const r = applyCorners(d, specs, 'chamfer', 3);
    if (!r.ok) throw new Error(r.hint);
    expect(lines(r.draft)).toHaveLength(8);
    expect(resolves(r.draft)).toBe(true);
  });
  it('a corner named twice is refused, and a corner that cannot be cut refuses them all', () => {
    const d = rectDraft(30, 20);
    const c = cornerAtPoint(d, 'p1')!;
    const twice = applyCorners(d, [c, { ...c, a: c.b, b: c.a }], 'chamfer', 3);
    expect(twice).toMatchObject({ ok: false, hint: 'app.sketch.hint.cornerTwice' });
    const all = ['p1', 'p2', 'p3', 'p4'].map((p) => cornerAtPoint(d, p)!);
    expect(applyCorners(d, all, 'chamfer', 12)).toMatchObject({ ok: false, hint: 'app.sketch.hint.distanceTooLarge' });
  });
  it('pairCorners matches picked lines into corners and reports the lines left over', () => {
    const d = rectDraft(30, 20);
    const all = pairCorners(d, ['e1', 'e2', 'e3', 'e4']);
    expect(all.corners).toHaveLength(4);
    expect(all.unpaired).toEqual([]);
    expect(new Set(all.corners.map((c) => c.s))).toEqual(new Set(['p1', 'p2', 'p3', 'p4']));
    const two = pairCorners(d, ['e1', 'e3']);
    expect(two.corners).toEqual([]);
    expect(two.unpaired).toEqual(['e1', 'e3']);
    const three = pairCorners(d, ['e1', 'e2', 'e3']);
    expect(three.corners.map((c) => c.s).sort()).toEqual(['p2', 'p3']);
  });
  it('the chamfer tool: shift-click the four sides, Enter cuts every corner in one step', () => {
    const o = run(chamferTool, rectDraft(30, 20), [field('d', 3, false), clickOn('e1', S), clickOn('e2', S), clickOn('e3', S), clickOn('e4', S), enter]);
    expect(o.hint).toBeUndefined();
    expect(lines(o.draft)).toHaveLength(8);
  });
  it('shift-clicking corner points picks corners too; an unpaired line is named in the refusal', () => {
    const ok = run(filletTool, rectDraft(30, 20), [field('r', 4, false), clickPt('p1', S), clickPt('p3', S), enter]);
    expect(arcs(ok.draft)).toHaveLength(2);
    const bad = run(chamferTool, rectDraft(30, 20), [field('d', 3, false), clickOn('e1', S), clickOn('e3', S), enter]);
    expect(bad.hint).toBe('app.sketch.hint.unpairedLine');
    expect(lines(bad.draft)).toHaveLength(4);
  });
});

describe('#8813 / #8802 a corner that is no corner is refused', () => {
  const inLine = (angle: number): SketchDraft => ({ ...blank(), points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 20, y: 10 * Math.tan(angle) }],
    entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }] });
  it('chamfer and fillet refuse two lines lying exactly in line', () => {
    for (const tool of [chamferTool, filletTool]) {
      const o = run(tool, inLine(0), [field(tool === chamferTool ? 'd' : 'r', 2), clickOn('e1'), clickOn('e2')]);
      expect(o.hint).toBe('app.sketch.hint.parallel');
      expect(lines(o.draft)).toHaveLength(2);
    }
  });
  it('and lines a hair off line, where the cut would be shorter than a micron', () => {
    for (const tool of [chamferTool, filletTool]) {
      const o = run(tool, inLine(1e-7), [field(tool === chamferTool ? 'd' : 'r', 2), clickOn('e1'), clickOn('e2')]);
      expect(o.hint).toBe('app.sketch.hint.parallel');
    }
  });
  it('a real corner still works', () => {
    expect(run(chamferTool, inLine(0.5), [field('d', 2), clickOn('e1'), clickOn('e2')]).hint).toBeUndefined();
  });
});

describe('#8238 a radius of half a side rounds both its corners', () => {
  it('a 20 x 10 rectangle with r = 5 at all four corners: 4 arcs, the two 10 sides kept, the 20 sides shortened', () => {
    const d = rectDraft(20, 10);
    const specs = ['p1', 'p2', 'p3', 'p4'].map((p) => cornerAtPoint(d, p)!);
    const r = applyCorners(d, specs, 'fillet', 5);
    if (!r.ok) throw new Error(r.hint);
    expect(arcs(r.draft)).toHaveLength(4);
    expect(lines(r.draft)).toHaveLength(2);           // the 10 high sides are used up
    expect(resolves(r.draft)).toBe(true);
    // the arcs meet end to end where the sides were
    const ends = arcs(r.draft).flatMap((a) => [String(a.p1), String(a.p2)]);
    expect(ends.filter((p) => ends.indexOf(p) !== ends.lastIndexOf(p)).length).toBe(4);
  });
  it('a 10 x 10 square with r = 5 is four arcs and no lines, and the arcs are tangent where the lines went', () => {
    const d = rectDraft(10, 10);
    const r = applyCorners(d, ['p1', 'p2', 'p3', 'p4'].map((p) => cornerAtPoint(d, p)!), 'fillet', 5);
    if (!r.ok) throw new Error(r.hint);
    expect(lines(r.draft)).toHaveLength(0);
    expect(arcs(r.draft)).toHaveLength(4);
    expect(r.draft.constraints.filter((c) => c.type === 'tangent' && c.refs!.every((x) => x.startsWith('e') && arcs(r.draft).some((a) => a.id === x)))).toHaveLength(4);
    expect(resolves(r.draft)).toBe(true);
  });
  it('a radius longer than half the side is still refused', () => {
    const d = rectDraft(20, 10);
    expect(applyCorners(d, ['p2', 'p3'].map((p) => cornerAtPoint(d, p)!), 'fillet', 5.01)).toMatchObject({ ok: false, hint: 'app.sketch.hint.radiusTooLarge' });
  });
});

describe('#9469 a refused size gives way to one that fits', () => {
  it('typing 4 passes through 40: the hint is there for 40 and gone for 4', () => {
    let o = run(filletTool, rectDraft(30, 20), [clickOn('e1'), clickOn('e2'), field('r', 40, false)]);
    expect(o.hint).toBe('app.sketch.hint.radiusTooLarge');
    o = filletTool.step(o.state, field('r', 4, false), o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBeUndefined();
    o = filletTool.step(o.state, field('r', 40), o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBe('app.sketch.hint.radiusTooLarge');
    o = filletTool.step(o.state, field('r', 4), o.draft, DEFAULT_SETTINGS);
    expect(o.hint).toBeUndefined();
    expect(arcs(o.draft)).toHaveLength(1);
  });
});

describe('#9773 / #9012 extend and trim at a curve\'s own end', () => {
  /** A 40 x 20 rectangle whose lower right corner is rounded by an arc of radius 5 (a real fillet), as a draft. */
  function rounded(): SketchDraft {
    const d = rectDraft(40, 20);
    const r = applyCorners(d, [cornerAtPoint(d, 'p2')!], 'fillet', 5);
    if (!r.ok) throw new Error(r.hint);
    return r.draft;
  }
  it('extending the rounded corner\'s arc where another side only grazes its circle a hair past the end adds no sliver', () => {
    const d = rounded();
    const arc = arcs(d)[0];
    const e = pt(d, String(arc.p2));
    // a free line 3e-7 outside the arc's circle, tangent 1e-7 rad past the end (5e-7 along it): it touches within tolerance
    const c = pt(d, String(arc.c)), th = 1e-7, rr = 5 + 3e-7;
    const foot = { x: c.x + rr * Math.cos(th), y: c.y + rr * Math.sin(th) }, dir = { x: -Math.sin(th), y: Math.cos(th) };
    const grazed: SketchDraft = { ...d, points: [...d.points, { id: 'p80', x: foot.x - 3 * dir.x, y: foot.y - 3 * dir.y }, { id: 'p81', x: foot.x + 3 * dir.x, y: foot.y + 3 * dir.y }], entities: [...d.entities, { id: 'e80', type: 'line', p1: 'p80', p2: 'p81' }] };
    const r = extendAt(grazed, arc.id, { x: e.x, y: e.y });
    if (r.ok) {
      const g = r.draft.entities.find((q) => q.id === arc.id)!;
      expect(Math.hypot(pt(r.draft, String(g.p2)).x - e.x, pt(r.draft, String(g.p2)).y - e.y)).toBeGreaterThan(1e-6);   // not a sliver of 5e-7
    } else expect(r.hint).toBe('app.sketch.hint.nothingToExtend');
  });
  it('a big construction circle around the drawing does not change what extend does with a free end', () => {
    const d: SketchDraft = { ...blank(), points: [{ id: 'p1', x: 0, y: 5 }, { id: 'p2', x: 10, y: 5 }, { id: 'p3', x: 20, y: 0 }, { id: 'p4', x: 20, y: 10 }, { id: 'p5', x: 5, y: 5 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'e3', type: 'circle', c: 'p5', r: 60 }] };
    const r = extendAt(d, 'e1', { x: 9, y: 5 });
    if (!r.ok) throw new Error(r.hint);
    const e1 = r.draft.entities.find((e) => e.id === 'e1')!;
    expect(pt(r.draft, String(e1.p2))).toMatchObject({ x: expect.closeTo(20, 9), y: expect.closeTo(5, 9) });
    expect(r.draft.constraints.some((c) => c.type === 'pointOnLine' && c.refs!.includes('e2'))).toBe(true);
  });
  it('trimming a line whose only crossing is a touch a hair inside its own end removes all of it', () => {
    // circle r 10 at the origin, an arc of it from (10,0) up to (0,10), and a line down the tangent x = 10 that ends 3e-7 past the touch
    const d: SketchDraft = { ...blank(), points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 0, y: 10 }, { id: 'p4', x: 10, y: 30 }, { id: 'p5', x: 10, y: -3e-7 }],
      entities: [{ id: 'e1', type: 'arc', c: 'p1', p1: 'p2', p2: 'p3' }, { id: 'e2', type: 'line', p1: 'p4', p2: 'p5' }] };
    const r = trimAt(d, 'e2', { x: 10, y: 15 });
    if (!r.ok) throw new Error(r.hint);
    expect(r.draft.entities.map((e) => e.id)).toEqual(['e1']);
  });
});

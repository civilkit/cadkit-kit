import { describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { angleShape, annotate, constraintTargets, dimText, formatDimNumber, leaderShape, linearShape, nudgeLabels, removeConstraintById } from './annotations';

const d = (): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 10, y: 6 }, { id: 'c1', x: 30, y: 0 }],
  entities: [
    { id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' },
    { id: 'e3', type: 'circle', c: 'c1', r: 4 },
  ],
  constraints: [
    { id: 'k1', type: 'horizontal', refs: ['e1'] },
    { id: 'k2', type: 'distance', refs: ['p1', 'p2'], value: 10 },
    { id: 'k3', type: 'radius', refs: ['e3'], value: 4 },
    { id: 'k4', type: 'angle', refs: ['e1', 'e2'], value: 90 },
    { id: 'k5', type: 'coincident', refs: ['p1', 'p2'] },
    { id: 'k6', type: 'vertical', refs: ['e2'] },
  ],
});

describe('annotate', () => {
  it('puts a dimension at the middle of what it measures, with its value', () => {
    const a = annotate(d());
    expect(a.find((x) => x.id === 'k2')).toMatchObject({ kind: 'dimension', text: '10 mm', at: { x: 5, y: 0 }, value: 10 });
    expect(a.find((x) => x.id === 'k3')).toMatchObject({ kind: 'dimension', text: 'R4 mm' });
    const ang = a.find((x) => x.id === 'k4')!;
    expect(ang.text).toBe('90°');
    expect(ang.at).toEqual({ x: 10, y: 0 });          // the corner the two lines share
  });
  it('puts a symbol for a geometric constraint on the shape it constrains', () => {
    const a = annotate(d());
    expect(a.find((x) => x.id === 'k1')).toMatchObject({ kind: 'mark', text: 'H', at: { x: 5, y: 0 } });
    expect(a.find((x) => x.id === 'k6')).toMatchObject({ kind: 'mark', text: 'V', at: { x: 10, y: 3 } });
  });
  it('does not draw coincident constraints, which are the shared points', () => {
    expect(annotate(d()).some((x) => x.type === 'coincident')).toBe(false);
  });
  it('skips constraints whose references are gone', () => {
    const draft = d();
    draft.constraints.push({ id: 'k9', type: 'distance', refs: ['nope', 'p1'], value: 3 });
    expect(annotate(draft).find((x) => x.id === 'k9')).toMatchObject({ at: { x: 0, y: 0 } });   // falls back to what exists
    draft.constraints.push({ id: 'k10', type: 'horizontal', refs: ['nope'] });
    expect(annotate(draft).find((x) => x.id === 'k10')).toBeUndefined();
  });
});

describe('constraint helpers', () => {
  it('names the entities and points a constraint refers to', () => {
    expect(constraintTargets(d(), 'k4')).toEqual({ entities: ['e1', 'e2'], points: [] });
    expect(constraintTargets(d(), 'k2')).toEqual({ entities: [], points: ['p1', 'p2'] });
    expect(constraintTargets(d(), 'nope')).toEqual({ entities: [], points: [] });
  });
  it('removes a constraint by id and nothing else', () => {
    const out = removeConstraintById(d(), 'k2');
    expect(out.constraints.map((c) => c.id)).toEqual(['k1', 'k3', 'k4', 'k5', 'k6']);
    expect(out.entities).toHaveLength(3);
  });
});

import { setConstraintValue } from './annotations';
import { pointDims, setPointDim } from './select';

describe('editing values', () => {
  it('changes a dimension value, refusing a missing constraint or a non-positive size', () => {
    const out = setConstraintValue(d(), 'k2', 25)!;
    expect(out.constraints.find((c) => c.id === 'k2')!.value).toBe(25);
    expect(setConstraintValue(d(), 'k1', 5)).toBeNull();          // no value on a horizontal
    expect(setConstraintValue(d(), 'nope', 5)).toBeNull();
    expect(setConstraintValue(d(), 'k2', -3)).toBeNull();
    expect(setConstraintValue(d(), 'k4', -45)).not.toBeNull();    // an angle may be negative
  });
  it('moves a point to a typed coordinate and dimensions it from the origin', () => {
    const draft = d();
    draft.points.unshift({ id: 'O', x: 0, y: 0, fixed: true });
    expect(pointDims(draft, 'p2').map((f) => [f.id, f.value])).toEqual([['x', 10], ['y', 0]]);
    expect(pointDims(draft, 'O')).toEqual([]);                       // the origin is fixed
    const out = setPointDim(draft, 'p2', 'x', -15)!;
    expect(out.points.find((p) => p.id === 'p2')!.x).toBe(-15);
    expect(out.constraints.find((c) => c.type === 'hdist')).toMatchObject({ refs: ['O', 'p2'], value: 15 });
    const again = setPointDim(out, 'p2', 'x', -20)!;
    expect(again.constraints.filter((c) => c.type === 'hdist')).toHaveLength(1);
    expect(setPointDim(draft, 'O', 'x', 3)).toBeNull();
  });
});

describe('dimension numbers and text', () => {
  it('units, thousands separators and consistent rounding', () => {
    expect(formatDimNumber(1500)).toBe('1 500');
    expect(formatDimNumber(1234567.891)).toBe('1 234 567.89');
    expect(formatDimNumber(12.5)).toBe('12.5');
    expect(formatDimNumber(110)).toBe('110');
    expect(formatDimNumber(0.004)).toBe('0');
    expect(formatDimNumber(-1500.1)).toBe('-1 500.1');
    expect(dimText('distance', 1500)).toBe('1 500 mm');
    expect(dimText('radius', 12)).toBe('R12 mm');
    expect(dimText('diameter', 8.25)).toBe('Ø8.25 mm');
    expect(dimText('angle', 110)).toBe('110°');
  });
});

describe('dimension drawing geometry', () => {
  it('a length gets extension lines, an offset dimension line, arrowheads inside and the text centred on it', () => {
    const s = linearShape({ x: 0, y: 0 }, { x: 10, y: 0 }, 5)!;
    expect(s.kind).toBe('linear');
    if (s.kind !== 'linear') return;
    expect(s.line).toEqual([{ x: 0, y: 5 }, { x: 10, y: 5 }]);          // left of a -> b
    expect(s.ext[0][0]).toEqual({ x: 0, y: 0 });
    expect(s.ext[0][1].y).toBeGreaterThan(5);                            // runs a little past the dimension line
    expect(s.text).toEqual({ x: 5, y: 5 });
    expect(s.slope).toBeCloseTo(0);
    expect(s.arrows[0].dir.x).toBe(-1); expect(s.arrows[0].dir.y).toBeCloseTo(0); expect(s.arrows[1].dir.x).toBe(1);
  });
  it('text slope stays readable (within -90..90) whichever way the line runs', () => {
    const down = linearShape({ x: 0, y: 10 }, { x: 0, y: 0 }, 2)! as { slope: number };
    expect(Math.abs(down.slope)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    const back = linearShape({ x: 10, y: 0 }, { x: 0, y: 1 }, 2)! as { slope: number };
    expect(Math.abs(back.slope)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    expect(linearShape({ x: 1, y: 1 }, { x: 1, y: 1 }, 2)).toBeNull();
  });
  it('horizontal and vertical distances keep their dimension line on the axis', () => {
    const h = linearShape({ x: 0, y: 0 }, { x: 10, y: 4 }, 3, 'h')! as { line: [{ x: number; y: number }, { x: number; y: number }] };
    expect(h.line[0].y).toBe(7); expect(h.line[1].y).toBe(7);
    const v = linearShape({ x: 0, y: 0 }, { x: 10, y: 4 }, 3, 'v')! as { line: [{ x: number; y: number }, { x: number; y: number }] };
    expect(v.line[0].x).toBe(13); expect(v.line[1].x).toBe(13);
  });
  it('an angle is an arc inside the corner, the smaller way round, with the text beyond its middle', () => {
    const s = angleShape({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, 4)!;
    if (s.kind !== 'angle') throw new Error('kind');
    expect(s.a0).toBeCloseTo(0); expect(s.a1).toBeCloseTo(Math.PI / 2);
    expect(s.text.x).toBeCloseTo(4 * 1.35 * Math.SQRT1_2); expect(s.text.y).toBeCloseTo(4 * 1.35 * Math.SQRT1_2);
    const swapped = angleShape({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 0 }, 4)!;      // order of the lines does not matter
    if (swapped.kind !== 'angle') throw new Error('kind');
    expect(swapped.a1 - swapped.a0).toBeCloseTo(Math.PI / 2);
    expect(angleShape({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, 1)).toBeNull();
  });
  it('a radius is a leader out through the circle, a diameter runs across it', () => {
    const r = leaderShape({ x: 0, y: 0 }, 10, false, 5)!;
    expect(r.kind).toBe('leader');
    if (r.kind !== 'leader') return;
    expect(r.line[0]).toEqual({ x: 0, y: 0 });
    expect(Math.hypot(r.arrows[0].at.x, r.arrows[0].at.y)).toBeCloseTo(10);
    expect(r.arrows).toHaveLength(1);
    const d = leaderShape({ x: 0, y: 0 }, 10, true, 5)!;
    if (d.kind !== 'leader') return;
    expect(d.arrows).toHaveLength(2);
    expect(Math.hypot(d.line[0].x, d.line[0].y)).toBeCloseTo(10);
  });
  it('annotate gives each dimension its drawing; the offset is in pixels when the zoom is known', () => {
    const near = annotate(d(), { upp: 0.5 }).find((x) => x.id === 'k2')!;
    expect(near.shape?.kind).toBe('linear');
    if (near.shape?.kind !== 'linear') return;
    expect(near.shape.line[0].y).toBeCloseTo(26 * 0.5);
    const far = annotate(d(), { upp: 4 }).find((x) => x.id === 'k2')!;
    if (far.shape?.kind !== 'linear') return;
    expect(far.shape.line[0].y).toBeCloseTo(26 * 4);
    expect(annotate(d()).find((x) => x.id === 'k3')?.shape?.kind).toBe('leader');
    expect(annotate(d()).find((x) => x.id === 'k4')?.shape?.kind).toBe('angle');
  });
});

describe('nudgeLabels', () => {
  const box = (id: string, x: number, y: number) => ({ id, x, y, w: 40, h: 20 });
  it('labels piled on one point are separated so that none overlap', () => {
    const out = nudgeLabels([box('a', 100, 100), box('b', 100, 100), box('c', 100, 100)]);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const ox = (out[i].w + out[j].w) / 2 - Math.abs(out[i].x - out[j].x), oy = (out[i].h + out[j].h) / 2 - Math.abs(out[i].y - out[j].y);
      expect(ox <= 0.001 || oy <= 0.001, `${out[i].id} ${out[j].id}`).toBe(true);
    }
  });
  it('labels that are apart do not move, and the input is not changed', () => {
    const input = [box('a', 0, 0), box('b', 200, 0)];
    expect(nudgeLabels(input)).toEqual(input);
    const piled = [box('a', 5, 5), box('b', 5, 5)];
    nudgeLabels(piled);
    expect(piled[0].y).toBe(5);
  });
});

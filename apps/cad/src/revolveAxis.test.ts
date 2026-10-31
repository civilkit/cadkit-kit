import { describe, expect, it } from 'vitest';
import './locales/en';
import { axisChoices, axisLabel, defaultAxis, revolveEdit } from './revolveAxis';

const sk = (pts: Array<[string, number, number]>, lines: Array<[string, string, string, boolean?]>) => ({
  id: 'F1', type: 'sketch',
  points: pts.map(([id, x, y]) => ({ id, x, y })),
  entities: lines.map(([id, p1, p2, construction]) => ({ id, type: 'line', p1, p2, ...(construction ? { construction: true } : {}) })),
});
const RECT0 = sk([['a', 0, 0], ['b', 10, 0], ['c', 10, 5], ['d', 0, 5]], [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']]);
const RECT5 = sk([['a', 5, 0], ['b', 10, 0], ['c', 10, 5], ['d', 5, 5]], [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']]);

describe('default revolve axis', () => {
  it('uses a profile edge on the sketch vertical axis without changing the sketch', () => {
    expect(defaultAxis(RECT0)).toEqual({ axis: 'e4' });
    expect(revolveEdit(RECT0)).toEqual([{ op: 'add', feature: { type: 'revolve', op: 'add', sketch: 'F1', axis: 'e4', end: 'blind', angle: 360 } }]);
  });
  it('prefers an existing construction line', () => {
    const s = sk([['a', 0, 0], ['b', 0, 9], ['c', 3, 0], ['d', 6, 0], ['e', 6, 4]], [['ax', 'a', 'b', true], ['l1', 'c', 'd'], ['l2', 'd', 'e'], ['l3', 'e', 'c']]);
    expect(defaultAxis(s)).toEqual({ axis: 'ax' });
  });
  it('adds a construction line along the vertical axis when there is none, in the same edit', () => {
    const ops = revolveEdit(RECT5)!;
    expect(ops.map((o) => o.op)).toEqual(['replace', 'add']);
    const rep = (ops[0] as unknown as { feature: { entities: Array<{ id: string; construction?: boolean; p1: string; p2: string }>; points: Array<{ id: string; x: number; y: number }> } }).feature;
    const line = rep.entities.at(-1)!;
    expect(line.construction).toBe(true);
    const ends = [line.p1, line.p2].map((id) => rep.points.find((p) => p.id === id)!);
    expect(ends.map((p) => p.x)).toEqual([0, 0]);
    expect((ops[1] as unknown as { feature: { axis: string } }).feature.axis).toBe(line.id);
    expect(RECT5.entities.length).toBe(4);   // the input is not changed
  });
  it('has nothing to revolve in an empty sketch', () => {
    expect(revolveEdit(sk([], []))).toBeNull();
  });
});

describe('axis in words', () => {
  it('names the sketch axes and other lines, never a bare id', () => {
    expect(axisLabel(RECT0, 'e4')).toBe('Sketch vertical axis (profile edge)');
    expect(axisLabel(RECT0, 'e1')).toBe('Sketch horizontal axis (profile edge)');
    expect(axisLabel(RECT5, 'e2')).toBe('Line (10, 0) to (10, 5) (profile edge)');
    const c = sk([['a', 0, 0], ['b', 0, 9]], [['ax', 'a', 'b', true]]);
    expect(axisLabel(c, 'ax')).toBe('Sketch vertical axis');
    expect(axisChoices(RECT0).map(([id]) => id)).toEqual(['e1', 'e2', 'e3', 'e4']);
  });
});

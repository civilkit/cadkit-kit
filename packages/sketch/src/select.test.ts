import { describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { boxSelect, deleteEntity, entityDims, entityShape, pickEntity, setEntityDim } from './select';

const draft = (): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 10, y: 10 },
    { id: 'c1', x: 30, y: 0 }, { id: 'a1', x: 40, y: 0 }, { id: 'a2', x: 30, y: 10 }],
  entities: [
    { id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' },
    { id: 'e3', type: 'circle', c: 'c1', r: 4 }, { id: 'e4', type: 'arc', c: 'c1', p1: 'a1', p2: 'a2' },
  ],
  constraints: [{ id: 'k1', type: 'horizontal', refs: ['e1'] }, { id: 'k2', type: 'vertical', refs: ['e2'] }],
});

describe('pickEntity', () => {
  it('picks the nearest line, circle or arc within the tolerance', () => {
    expect(pickEntity(draft(), { x: 5, y: 0.2 }, 0.5)).toBe('e1');
    expect(pickEntity(draft(), { x: 10.1, y: 6 }, 0.5)).toBe('e2');
    expect(pickEntity(draft(), { x: 30, y: 4.1 }, 0.5)).toBe('e3');
    expect(pickEntity(draft(), { x: 30 + 10 * Math.cos(Math.PI / 4), y: 10 * Math.sin(Math.PI / 4) }, 0.5)).toBe('e4');
  });
  it('picks nothing far from everything, and not the empty side of an arc', () => {
    expect(pickEntity(draft(), { x: 20, y: 20 }, 0.5)).toBeNull();
    expect(pickEntity(draft(), { x: 30 - 10, y: 0 }, 0.5)).toBeNull();   // the arc only runs from 0 to 90 degrees
  });
});

describe('entity dimensions', () => {
  it('reads a line length and a circle or arc radius, and whether it is already driven', () => {
    expect(entityDims(draft(), 'e1')).toEqual([expect.objectContaining({ id: 'len', value: 10, locked: false })]);
    expect(entityDims(draft(), 'e3')).toEqual([expect.objectContaining({ id: 'radius', value: 4 })]);
    expect(entityDims(draft(), 'e4')).toEqual([expect.objectContaining({ id: 'radius', value: 10 })]);
  });
  it('setting a line length adds a distance constraint and replaces an older one', () => {
    const once = setEntityDim(draft(), 'e1', 'len', 25)!;
    expect(once.constraints.filter((c) => c.type === 'distance')).toEqual([expect.objectContaining({ refs: ['p1', 'p2'], value: 25 })]);
    const twice = setEntityDim(once, 'e1', 'len', 30)!;
    expect(twice.constraints.filter((c) => c.type === 'distance')).toHaveLength(1);
    expect(twice.constraints.find((c) => c.type === 'distance')!.value).toBe(30);
    expect(entityDims(twice, 'e1')[0].locked).toBe(true);
  });
  it('setting a radius adds a radius constraint; bad input is refused', () => {
    expect(setEntityDim(draft(), 'e3', 'radius', 6)!.constraints.find((c) => c.type === 'radius')).toMatchObject({ refs: ['e3'], value: 6 });
    expect(setEntityDim(draft(), 'e1', 'radius', 6)).toBeNull();
    expect(setEntityDim(draft(), 'e1', 'len', -2)).toBeNull();
    expect(setEntityDim(draft(), 'nope', 'len', 2)).toBeNull();
  });
});

describe('deleteEntity and entityShape', () => {
  it('removes the entity, its constraints and the points nothing else uses, but keeps shared and fixed points', () => {
    const out = deleteEntity(draft(), 'e1');
    expect(out.entities.map((e) => e.id)).toEqual(['e2', 'e3', 'e4']);
    expect(out.constraints.map((c) => c.id)).toEqual(['k2']);
    expect(out.points.map((p) => p.id)).toContain('p2');       // still the end of e2
    expect(out.points.map((p) => p.id)).not.toContain('p1');   // nothing else uses it
    expect(out.points.map((p) => p.id)).toContain('O');        // fixed
  });
  it('gives geometry to highlight', () => {
    expect(entityShape(draft(), 'e1')).toEqual([{ kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }]);
    expect(entityShape(draft(), 'e3')).toEqual([{ kind: 'circle', c: { x: 30, y: 0 }, r: 4 }]);
    expect(entityShape(draft(), 'e4').length).toBeGreaterThan(8);
    expect(entityShape(draft(), 'nope')).toEqual([]);
  });
});

describe('boxSelect', () => {
  const d = (): SketchDraft => ({
    id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], constraints: [],
    points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 30, y: 0 }, { id: 'o', x: 20, y: 20 }],
    entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }, { id: 'e3', type: 'circle', c: 'o', r: 5 }],
  });
  it('window takes only what is entirely inside', () => {
    expect(boxSelect(d(), { x0: -1, y0: -1, x1: 11, y1: 1 }, 'window')).toEqual(['e1']);
    expect(boxSelect(d(), { x0: -1, y0: -1, x1: 40, y1: 30 }, 'window')).toEqual(['e1', 'e2', 'e3']);
  });
  it('crossing also takes what the box only touches, including a line passed through the middle', () => {
    expect(boxSelect(d(), { x0: 5, y0: -1, x1: 15, y1: 1 }, 'crossing')).toEqual(['e1', 'e2']);
    expect(boxSelect(d(), { x0: 18, y0: -5, x1: 22, y1: 40 }, 'crossing')).toEqual(['e3']);
    expect(boxSelect(d(), { x0: 14, y0: -1, x1: 16, y1: 1 }, 'crossing')).toEqual(['e2']);
    expect(boxSelect(d(), { x0: 14, y0: 5, x1: 16, y1: 9 }, 'crossing')).toEqual([]);
  });
  it('the corners can be given in any order', () => {
    expect(boxSelect(d(), { x0: 11, y0: 1, x1: -1, y1: -1 }, 'window')).toEqual(['e1']);
  });
});

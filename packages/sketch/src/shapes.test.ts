import { describe, expect, it } from 'vitest';
import { regionsFor, sketchShapes } from './shapes';

const rect = [
  { id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' },
  { id: 'e3', type: 'line', p1: 'c', p2: 'd' }, { id: 'e4', type: 'line', p1: 'd', p2: 'a' },
];

describe('sketchShapes', () => {
  it('finds circles and closed chains, in drawing order, naming each by one entity id', () => {
    const s = sketchShapes({ entities: [...rect, { id: 'e5', type: 'circle', c: 'o', r: 4 }, { id: 'e6', type: 'circle', c: 'q', r: 2 }] });
    expect(s.map((x) => [x.id, x.kind, x.entityIds.length, x.radius])).toEqual([['e1', 'loop', 4, 0], ['e5', 'circle', 1, 4], ['e6', 'circle', 1, 2]]);
  });
  it('ignores open chains and construction geometry', () => {
    const open = rect.slice(0, 3);
    expect(sketchShapes({ entities: open })).toEqual([]);
    expect(sketchShapes({ entities: [{ id: 'e9', type: 'circle', c: 'o', r: 3, construction: true }] })).toEqual([]);
  });
  it('treats a slot (two lines and two arcs) as one loop', () => {
    const slot = [
      { id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'a1', type: 'arc', c: 'x', p1: 'b', p2: 'c' },
      { id: 'l2', type: 'line', p1: 'c', p2: 'd' }, { id: 'a2', type: 'arc', c: 'y', p1: 'd', p2: 'a' },
    ];
    expect(sketchShapes({ entities: slot }).map((x) => x.entityIds.length)).toEqual([4]);
  });
  it('regionsFor is null when everything is checked and the ids otherwise', () => {
    const s = sketchShapes({ entities: [...rect, { id: 'e5', type: 'circle', c: 'o', r: 4 }] });
    expect(regionsFor(s, new Set(['e1', 'e5']))).toBeNull();
    expect(regionsFor(s, new Set(['e5']))).toEqual(['e5']);
  });
});

import { describe, expect, it } from 'vitest';
import { defaultCutRegions, regionsFor, shapeAtPoint, sketchOpenChains, sketchShapes } from './shapes';

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

import { nextExtrudeTarget } from './shapes';
describe('nextExtrudeTarget', () => {
  const sk = { id: 'F1', type: 'sketch', entities: [...rect, { id: 'e5', type: 'circle', c: 'a', r: 3 }, { id: 'e6', type: 'circle', c: 'b', r: 3 }] };
  it('uses a sketch nobody uses, whole', () => {
    expect(nextExtrudeTarget([sk])).toEqual({ sketchId: 'F1', regions: null });
  });
  it('after a feature took only some shapes, offers the shapes left over', () => {
    const used = { id: 'F2', type: 'extrude', sketch: 'F1', regions: ['e1', 'e5'] };
    expect(nextExtrudeTarget([sk, used])).toEqual({ sketchId: 'F1', regions: ['e6'] });
  });
  it('says nothing is left when a feature uses every shape, but honours an explicit selection', () => {
    const all = { id: 'F2', type: 'extrude', sketch: 'F1' };
    expect(nextExtrudeTarget([sk, all])).toBeNull();
    expect(nextExtrudeTarget([sk, all], 'F1')).toEqual({ sketchId: 'F1', regions: null });
  });
  it('prefers the newest sketch with something left, and skips sketches that are fully used', () => {
    const sk2 = { id: 'F3', type: 'sketch', entities: [{ id: 'k1', type: 'circle', c: 'q', r: 2 }] };
    const all = { id: 'F2', type: 'extrude', sketch: 'F1' };
    expect(nextExtrudeTarget([sk, all, sk2])).toEqual({ sketchId: 'F3', regions: null });
    const all2 = { id: 'F4', type: 'extrude', sketch: 'F3' };
    expect(nextExtrudeTarget([sk, all, sk2, all2])).toBeNull();
  });
});

describe('free-form closed shapes', () => {
  it('a closed spline is a shape by itself, so a ring of two splines offers both', () => {
    const f = { entities: [{ id: 'e1', type: 'spline', pts: ['a', 'b', 'c'], closed: true }, { id: 'e2', type: 'spline', pts: ['d', 'e', 'f'], closed: true }, { id: 'e3', type: 'spline', pts: ['g', 'h', 'i'] }] };
    expect(sketchShapes(f).map((s) => s.id)).toEqual(['e1', 'e2']);
  });
});

describe('nesting and the default cut regions', () => {
  const ring = (r: number, id: string, ext = false) => ({ id, type: 'circle', c: 'c', r, ...(ext ? { ext: true } : {}) });
  const sk = (outerExt: boolean) => ({ points: [{ id: 'c', x: 0, y: 0 }], entities: [ring(10, 'o', outerExt), ring(8, 'i')] });
  it('marks the loop that encloses another, and reference outlines', () => {
    const sh = sketchShapes(sk(true) as never);
    expect(sh.map((s) => [s.id, s.reference, s.inside])).toEqual([['o', true, undefined], ['i', false, 'o']]);
  });
  it('cutting a projected outline with a loop inside it picks the inner loop (the pocket)', () => {
    expect(defaultCutRegions(sk(true) as never)).toEqual(['i']);
  });
  it('two drawn nested loops, or no nesting: the kernel default', () => {
    expect(defaultCutRegions(sk(false) as never)).toBeNull();
    expect(defaultCutRegions({ points: [{ id: 'c', x: 0, y: 0 }], entities: [ring(10, 'o', true)] } as never)).toBeNull();
  });
});

describe('shapeAtPoint', () => {
  const ring = { points: [{ id: 'o', x: 0, y: 0 }], entities: [{ id: 'out', type: 'circle', c: 'o', r: 10 }, { id: 'in', type: 'circle', c: 'o', r: 5 }] };
  it('a click on the ring means the outer circle, a click in the hole the inner one, off both nothing', () => {
    const shapes = sketchShapes(ring);
    expect(shapeAtPoint(ring, shapes, 7, 0)?.id).toBe('out');
    expect(shapeAtPoint(ring, shapes, 1, 1)?.id).toBe('in');
    expect(shapeAtPoint(ring, shapes, 20, 0)).toBeNull();
    expect(shapeAtPoint(null, shapes, 0, 0)).toBeNull();
  });
});

/** Script-made lens shapes (as in the PET bottle sample): each lens is two arcs, and every arc has its own end points at the same places. */
const lensSketch = (n: number, openLast = false) => {
  const points: Array<{ id: string; x: number; y: number }> = [];
  const entities: Array<{ id: string; type: string; c: string; p1: string; p2: string }> = [];
  let k = 0;
  const pt = (x: number, y: number) => { const id = 'p' + ++k; points.push({ id, x, y }); return id; };
  for (let i = 0; i < n; i++) {
    const x0 = i * 50, x1 = x0 + 30;
    const arcs = openLast && i === n - 1 ? 1 : 2;
    for (let a = 0; a < arcs; a++) {
      const sy = a ? 1 : -1;
      const c = pt(x0 + 15, sy * 10), b = pt(x1, 1e-11 * a), e = pt(x0, 0);   // the second arc's ends sit a hair off (rounding)
      entities.push({ id: `e${entities.length + 1}`, type: 'arc', c, p1: b, p2: e });
    }
  }
  return { points, entities };
};

describe('coincident end points join without sharing ids', () => {
  it('five lens shapes (two arcs each, separate points) are five loops and no open chain', () => {
    const sk = lensSketch(5);
    expect(sketchShapes(sk).map((x) => x.entityIds.length)).toEqual([2, 2, 2, 2, 2]);
    expect(sketchOpenChains(sk)).toEqual([]);
  });
  it('a lens missing its second arc is still an open chain, the others stay loops', () => {
    const sk = lensSketch(3, true);
    expect(sketchShapes(sk)).toHaveLength(2);
    expect(sketchOpenChains(sk)).toHaveLength(1);
  });
  it('ends farther apart than the tolerance stay open', () => {
    const sk = lensSketch(1);
    sk.points.find((p) => p.id === 'p5')!.x += 0.01;
    expect(sketchShapes(sk)).toEqual([]);
    expect(sketchOpenChains(sk)).toHaveLength(1);
  });
});

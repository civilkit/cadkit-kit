import { describe, expect, it } from 'vitest';
import { ringPetals } from './tools/petals-fixture';
import { defaultCutRegions, defaultShapeIds, regionsFor, shapeAtPoint, sketchOpenChains, sketchShapes, toggleRegion } from './shapes';

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

import { petalSketch } from './tools/petals-fixture';
describe('loops that share end points (petals from one origin)', () => {
  it('five petals meeting at the origin are five shapes, the construction ring is none', () => {
    const sh = sketchShapes(petalSketch(5) as never);
    expect(sh).toHaveLength(5);
    expect(sh.map((s) => s.entityIds.slice().sort())).toEqual([0, 1, 2, 3, 4].map((i) => [`a${i}`, `l${i}a`, `l${i}b`].sort()));
    expect(sh.every((s) => s.kind === 'loop' && s.inside === undefined)).toBe(true);
    expect(new Set(sh.map((s) => s.id)).size).toBe(5);
  });
  it('the same when every line has its own point at the origin, and when petals are drawn in any order', () => {
    expect(sketchShapes(petalSketch(5, { reuseOrigin: false }) as never)).toHaveLength(5);
    const sk = petalSketch(5);
    sk.entities.reverse();
    expect(sketchShapes(sk as never)).toHaveLength(5);
  });
  it('a click inside a petal, also in the bulge of its round end, picks that petal and nothing else; off the petals picks nothing', () => {
    const sk = petalSketch(5) as never;
    const shapes = sketchShapes(sk);
    for (let i = 0; i < 5; i++) {
      const th = (i * 2 * Math.PI) / 5;
      for (const d of [12, 25, 33]) {   // 33 is past the tangent points: only the round end covers it
        const got = shapeAtPoint(sk, shapes, d * Math.cos(th), d * Math.sin(th));
        expect(got?.entityIds).toContain(`a${i}`);
      }
    }
    expect(shapeAtPoint(sk, shapes, 38, 0)).toBeNull();                       // beyond the end of the petal, inside the construction ring
    expect(shapeAtPoint(sk, shapes, 30 * Math.cos(Math.PI / 5), 30 * Math.sin(Math.PI / 5))).toBeNull();   // the gap between two petals
    expect(shapeAtPoint(sk, shapes, 0.2, 0)?.entityIds).toBeDefined();         // at the shared origin a petal is still chosen, not nothing
  });
  it('each petal toggles on its own: regionsFor names exactly its id', () => {
    const shapes = sketchShapes(petalSketch(5) as never);
    expect(regionsFor(shapes, new Set([shapes[2].id]))).toEqual([shapes[2].id]);
    expect(regionsFor(shapes, new Set(shapes.map((s) => s.id)))).toBeNull();
  });
  it('a rectangle cut by a diagonal that shares its corners is two triangles, each named by a side of its own', () => {
    const sk = { points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 10, y: 10 }, { id: 'd', x: 0, y: 10 }],
      entities: [...rect, { id: 'e5', type: 'line', p1: 'a', p2: 'c' }] };
    const sh = sketchShapes(sk as never);
    expect(sh).toHaveLength(2);
    expect(sh.every((s) => s.id !== 'e5' && s.entityIds.includes('e5'))).toBe(true);
    expect(sketchOpenChains(sk as never)).toEqual([]);
  });
  it('dangling curves on a loop are ignored, and a figure of two loops joined at one point is two shapes', () => {
    const pts = [{ id: 'o', x: 0, y: 0 }, { id: 'a', x: 10, y: 0 }, { id: 'b', x: 10, y: 10 }, { id: 'c', x: -10, y: 0 }, { id: 'd', x: -10, y: -10 }, { id: 'z', x: 0, y: -20 }];
    const ents = [
      { id: 'r1', type: 'line', p1: 'o', p2: 'a' }, { id: 'r2', type: 'line', p1: 'a', p2: 'b' }, { id: 'r3', type: 'line', p1: 'b', p2: 'o' },
      { id: 'l1', type: 'line', p1: 'o', p2: 'c' }, { id: 'l2', type: 'line', p1: 'c', p2: 'd' }, { id: 'l3', type: 'line', p1: 'd', p2: 'o' },
      { id: 'tail', type: 'line', p1: 'o', p2: 'z' }];
    expect(sketchShapes({ points: pts, entities: ents } as never)).toHaveLength(2);
  });
});

describe('petals whose ends sit on a closed ring circle (T-junctions)', () => {
  const petalIds = (s: ReturnType<typeof sketchShapes>) => s.filter((x) => /^(s\d[ab]|e\d|ax\d)/.test(x.id));
  for (const outer of ['circle', 'arcs'] as const) {
    it(`offers every petal as its own shape (outer as ${outer})`, () => {
      const f = ringPetals({ outer });
      const s = sketchShapes(f);
      const petals = petalIds(s);
      expect(petals).toHaveLength(6);
      expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
      for (const p of petals) expect(p.entityIds).toContain('ring');
      // the outer circle, the hole and the ring's disc are there too
      expect(s.map((x) => x.id)).toEqual(expect.arrayContaining(['hole', 'ring']));
      expect(s.some((x) => x.id === 'outer' || x.id === 'out1')).toBe(true);
    });
  }
  it('works when the ring is already cut at the petal bases', () => {
    const s = sketchShapes(ringPetals({ ringArcs: true }));
    expect(petalIds(s)).toHaveLength(6);
  });
  it('petals reaching the outer circle are still separate shapes', () => {
    expect(petalIds(sketchShapes(ringPetals({ reach: 36 })))).toHaveLength(6);
  });
  it('a construction centre line is not a boundary; a real one splits each petal in two', () => {
    expect(petalIds(sketchShapes(ringPetals({ axis: 'construction' })))).toHaveLength(6);
    expect(petalIds(sketchShapes(ringPetals({ axis: 'line' })))).toHaveLength(12);
  });
  it('a ring with nothing touching it stays one circle shape', () => {
    const s = sketchShapes({ points: [{ id: 'O', x: 0, y: 0 }], entities: [{ id: 'ring', type: 'circle', c: 'O', r: 20 }] });
    expect(s.map((x) => [x.id, x.kind])).toEqual([['ring', 'circle']]);
  });
});

describe('the view and the Shapes list agree on petals', () => {
  it('pointing at a petal gives the petal shape the list offers, and the ring disc is still there under the base', () => {
    const f = ringPetals();
    const shapes = sketchShapes(f);
    const hit = shapeAtPoint(f as never, shapes, 27, 0);   // inside the petal on the x axis (between ring and tip)
    expect(hit && shapes.some((x) => x.id === hit.id)).toBe(true);
    expect(hit!.entityIds).toContain('e0');
    expect(shapeAtPoint(f as never, shapes, 10, 0)?.id).toBe('ring');
    expect(shapeAtPoint(f as never, shapes, 0, 0)?.id).toBe('hole');
  });
  it('toggleRegion: all checked is null, one off is the rest, the last one cannot be switched off', () => {
    const all = ['a', 'b', 'c'];
    expect(toggleRegion(all, null, 'b')).toEqual(['a', 'c']);
    expect(toggleRegion(all, ['a', 'c'], 'b')).toBeNull();
    expect(toggleRegion(all, ['a'], 'a')).toBeUndefined();
    expect(toggleRegion(all, ['a', 'zz'], 'c')).toEqual(['a', 'c']);
  });
});

describe('the default ticks are the kernel default (even-odd nesting), and every box ticked fills the holes', () => {
  const circle = (id: string, r: number) => ({ id, type: 'circle', c: 'O', r });
  const at0 = [{ id: 'O', x: 0, y: 0 }];
  it('a plate with a hole: the plate is ticked, the hole is not', () => {
    const sk = { points: [{ id: 'a', x: -10, y: -10 }, { id: 'b', x: 10, y: -10 }, { id: 'c', x: 10, y: 10 }, { id: 'd', x: -10, y: 10 }, ...at0], entities: [...rect, circle('h', 3)] };
    expect(defaultShapeIds(sketchShapes(sk as never))).toEqual(['e1']);
  });
  it('three concentric circles: the outer ring and the island in its hole', () => {
    const sk = { points: at0, entities: [circle('c1', 30), circle('c2', 20), circle('c3', 10)] };
    expect(defaultShapeIds(sketchShapes(sk as never))).toEqual(['c1', 'c3']);
  });
  it('petals sharing one origin are all one level: all ticked', () => {
    const shapes = sketchShapes(petalSketch(5) as never);
    expect(defaultShapeIds(shapes)).toEqual(shapes.map((x) => x.id));
  });
  it('a ring with six petals on it inside an outer circle, a hole in the middle: the outer circle and the hole are ticked', () => {
    const shapes = sketchShapes(ringPetals());
    expect(defaultShapeIds(shapes).sort()).toEqual(['hole', 'outer']);
  });
  it('a ring split by a chord ending on it is one level: neither half is a hole of the other', () => {
    const sk = { points: [...at0, { id: 'u', x: -12, y: 16 }, { id: 'w', x: -12, y: -16 }], entities: [circle('outer', 40), circle('ring', 20), { id: 'ch', type: 'line', p1: 'u', p2: 'w' }, circle('hole', 4)] };
    const shapes = sketchShapes(sk as never);
    expect(shapes.length).toBe(4);   // the outer circle, the two parts of the ring's disc, the hole
    expect(defaultShapeIds(shapes).sort()).toEqual(['hole', 'outer']);
  });
  it('regionsFor: the default ticks are null, every box ticked lists every shape, all but the hole lists the rest', () => {
    const shapes = sketchShapes(ringPetals());
    const all = shapes.map((x) => x.id);
    const defaults = defaultShapeIds(shapes);
    expect(regionsFor(shapes, new Set(defaults), defaults)).toBeNull();
    expect(regionsFor(shapes, new Set(all), defaults)).toEqual(all);
    expect(regionsFor(shapes, new Set(all.filter((x) => x !== 'hole')), defaults)).toEqual(all.filter((x) => x !== 'hole'));
  });
  it('toggleRegion: from no regions the defaults are ticked; ticking the hole lists everything; unticking it again is null', () => {
    const all = ['plate', 'hole'];
    expect(toggleRegion(all, undefined, 'hole', ['plate'])).toEqual(['plate', 'hole']);
    expect(toggleRegion(all, ['plate', 'hole'], 'hole', ['plate'])).toBeNull();
    expect(toggleRegion(all, undefined, 'plate', ['plate'])).toBeUndefined();   // the last ticked box stays
    expect(toggleRegion(all, ['plate'], 'plate', ['plate'])).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_CORNER, effectiveInset, faceOutline, placeCornerHoles, readCornerHoles, withCornerHoles, type FaceEdge } from './cornerHoles';

const R = { minX: -30, minY: -20, maxX: 30, maxY: 20 };
const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;

describe('placeCornerHoles', () => {
  it('2 x 2 is the four corners', () => {
    const r = placeCornerHoles(R, { inset: 5, nx: 2, ny: 2 });
    expect(r.issues).toEqual([]);
    expect(r.points.map(key).sort()).toEqual(['-25,-15', '-25,15', '25,-15', '25,15']);
  });
  it('3 x 2 adds a hole in the middle of each long side; 3 x 3 goes round the edge without a centre hole', () => {
    expect(placeCornerHoles(R, { inset: 5, nx: 3, ny: 2 }).points.map(key).sort()).toEqual(['-25,-15', '-25,15', '0,-15', '0,15', '25,-15', '25,15']);
    const nine = placeCornerHoles(R, { inset: 5, nx: 3, ny: 3 }).points;
    expect(nine).toHaveLength(8);
    expect(nine.some((p) => p.x === 0 && p.y === 0)).toBe(false);
  });
  it('4 x 3 counts the perimeter of the grid', () => {
    expect(placeCornerHoles(R, { inset: 4, nx: 4, ny: 3 }).points).toHaveLength(10);
  });
  it('refuses a zero, negative or NaN inset', () => {
    for (const inset of [0, -3, NaN]) {
      const r = placeCornerHoles(R, { inset, nx: 2, ny: 2 });
      expect(r.points).toEqual([]);
      expect(r.issues[0]).toMatchObject({ code: 'inset', level: 'error' });
      expect(r.issues[0].message).toMatch(/inset/);
    }
  });
  it('refuses an inset of half the plate or more, and says the limit', () => {
    const r = placeCornerHoles(R, { inset: 20, nx: 2, ny: 2 });
    expect(r.points).toEqual([]);
    expect(r.issues[0]).toMatchObject({ code: 'insetTooLarge', level: 'error', params: { max: 20 } });
    expect(placeCornerHoles(R, { inset: 19.9, nx: 2, ny: 2 }).points).toHaveLength(4);
  });
  it('refuses counts below 2 and fractions', () => {
    for (const [nx, ny] of [[1, 2], [2, 1], [0, 0], [2.5, 2]]) expect(placeCornerHoles(R, { inset: 5, nx, ny }).issues[0]).toMatchObject({ code: 'count', level: 'error' });
  });
  it('refuses a plate without size', () => {
    expect(placeCornerHoles({ minX: 0, minY: 0, maxX: 0, maxY: 5 }, { inset: 1, nx: 2, ny: 2 }).issues[0].code).toBe('size');
  });
  it('warns, but still places, when the hole breaks the edge (radius > inset - 1)', () => {
    const r = placeCornerHoles(R, { inset: 5, nx: 2, ny: 2, holeDiameter: 9 });
    expect(r.points).toHaveLength(4);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: 'wall', level: 'warn' });
    expect(placeCornerHoles(R, { inset: 5, nx: 2, ny: 2, holeDiameter: 6.6 }).issues).toEqual([]);   // 5 - 3.3 = 1.7 mm wall
    expect(placeCornerHoles(R, { inset: 5, nx: 2, ny: 2, holeDiameter: 9 }).issues[0].params.min).toBe(5.5);
  });
  it('measures the wall to the fillet when the hole sits inside the rounded corner', () => {
    // inset 4 in a corner rounded 10: the hole is 10 - sqrt2*6 = 1.51 mm from the arc, so a 3.4 mm hole (r 1.7) breaks it although the straight edge is 4 mm away
    expect(placeCornerHoles(R, { inset: 4, nx: 2, ny: 2, radius: 10, holeDiameter: 3.4 }).issues[0]).toMatchObject({ code: 'wall' });
    expect(placeCornerHoles(R, { inset: 4, nx: 2, ny: 2, radius: 0, holeDiameter: 3.4 }).issues).toEqual([]);
    // inset equal to the radius: concentric, the wall is the radius minus the hole radius
    expect(placeCornerHoles(R, { inset: 10, nx: 2, ny: 2, radius: 10, holeDiameter: 6.6 }).issues).toEqual([]);
  });
});

describe('effectiveInset', () => {
  it('follows the fillet radius when matching, else the typed inset', () => {
    expect(effectiveInset({ ...DEFAULT_CORNER, inset: 7, matchFillet: true }, 10)).toBe(10);
    expect(effectiveInset({ ...DEFAULT_CORNER, inset: 7, matchFillet: true }, null)).toBe(7);
    expect(effectiveInset({ ...DEFAULT_CORNER, inset: 7 }, 10)).toBe(7);
  });
});

// ---- the outline ----
const frame = { o: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const seg = (a: number[], b: number[], faces = ['top', 'side']): FaceEdge => ({ faces, pts: [[a[0], a[1], 10], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 10], [b[0], b[1], 10]] });
const arc = (cx: number, cy: number, r: number, a0: number, faces = ['top', 'side']): FaceEdge => ({
  faces, pts: Array.from({ length: 9 }, (_, i) => { const a = a0 + (Math.PI / 2) * (i / 8); return [cx + r * Math.cos(a), cy + r * Math.sin(a), 10]; }),
});
function rounded(w: number, h: number, r: number): FaceEdge[] {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  return [
    seg([x0 + r, y0], [x1 - r, y0]), seg([x1, y0 + r], [x1, y1 - r]), seg([x1 - r, y1], [x0 + r, y1]), seg([x0, y1 - r], [x0, y0 + r]),
    arc(x1 - r, y0 + r, r, -Math.PI / 2), arc(x1 - r, y1 - r, r, 0), arc(x0 + r, y1 - r, r, Math.PI / 2), arc(x0 + r, y0 + r, r, Math.PI),
  ];
}
const sharp = (w: number, h: number): FaceEdge[] => [seg([-w / 2, -h / 2], [w / 2, -h / 2]), seg([w / 2, -h / 2], [w / 2, h / 2]), seg([w / 2, h / 2], [-w / 2, h / 2]), seg([-w / 2, h / 2], [-w / 2, -h / 2])];

describe('faceOutline', () => {
  it('a sharp rectangle', () => {
    const o = faceOutline(frame, sharp(60, 40), 'top')!;
    expect(o).toMatchObject({ radius: null, rectangle: true, issues: [] });
    expect(o.rect).toEqual({ minX: -30, minY: -20, maxX: 30, maxY: 20 });
  });
  it('a rectangle with equal corner fillets gives the radius', () => {
    const o = faceOutline(frame, rounded(60, 40, 8), 'top')!;
    expect(o.rectangle).toBe(true);
    expect(o.radius).toBeCloseTo(8, 6);
    expect(o.rect.minX).toBeCloseTo(-30, 6);
    expect(o.rect.maxY).toBeCloseTo(20, 6);
  });
  it('ignores holes already in the face (full circles) and edges of other faces', () => {
    const circle: FaceEdge = { faces: ['top', 'bore'], pts: Array.from({ length: 33 }, (_, i) => [3 * Math.cos((i / 32) * 2 * Math.PI), 3 * Math.sin((i / 32) * 2 * Math.PI), 10]) };
    const far = seg([-100, -100], [100, -100], ['bottom', 'side']);
    const o = faceOutline(frame, [...rounded(60, 40, 8), circle, far], 'top')!;
    expect(o.rectangle).toBe(true);
    expect(o.rect.minX).toBeCloseTo(-30, 6);
  });
  it('works in a tilted sketch frame (x and y swapped)', () => {
    const f = { o: [0, 0, 10], x: [0, 1, 0], y: [1, 0, 0], z: [0, 0, -1] };
    const o = faceOutline(f, sharp(60, 40), 'top')!;
    expect(o.rect).toEqual({ minX: -20, minY: -30, maxX: 20, maxY: 30 });
  });
  it('unequal corner radii fall back to the bounding box with a warning', () => {
    const edges = rounded(60, 40, 8);
    edges[4] = arc(30 - 4, -20 + 4, 4, -Math.PI / 2);
    const o = faceOutline(frame, edges, 'top')!;
    expect(o).toMatchObject({ rectangle: false, radius: null });
    expect(o.issues[0]).toMatchObject({ code: 'outline', level: 'warn' });
    expect(o.rect.maxX).toBeCloseTo(30, 6);
  });
  it('a slanted edge (triangle) falls back to the bounding box', () => {
    const tri = [seg([0, 0], [40, 0]), seg([40, 0], [0, 30]), seg([0, 30], [0, 0])];
    const o = faceOutline(frame, tri, 'top')!;
    expect(o.rectangle).toBe(false);
    expect(o.rect).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 30 });
  });
  it('a slot (two arcs, two lines) is not a rectangle', () => {
    const slot = [seg([-10, -5], [10, -5]), seg([10, 5], [-10, 5]), arc(10, 0, 5, -Math.PI / 2), arc(-10, 0, 5, Math.PI / 2)];
    expect(faceOutline(frame, slot, 'top')!.rectangle).toBe(false);
  });
  it('null when no edge borders the face', () => {
    expect(faceOutline(frame, sharp(60, 40), 'nowhere')).toBeNull();
  });
});

describe('record on the sketch', () => {
  const sk = { points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p9', x: 1, y: 1 }], entities: [{ id: 'e9', type: 'point', p: 'p9' }] };
  it('replaces earlier corner points and keeps the user\'s own', () => {
    const a = withCornerHoles(sk, [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }]);
    expect(a.points.map((p) => p.id)).toEqual(['O', 'p9', 'ch1', 'ch2', 'ch3']);
    expect(a.entities.map((e) => e.id)).toEqual(['e9', 'che1', 'che2', 'che3']);
    const b = withCornerHoles(a, [{ x: 7, y: 8 }]);
    expect(b.points.map((p) => p.id)).toEqual(['O', 'p9', 'ch1']);
    expect(b.points.at(-1)).toMatchObject({ x: 7, y: 8 });
    expect(b.entities.map((e) => e.id)).toEqual(['e9', 'che1']);
    expect(sk.points).toHaveLength(2);   // input untouched
  });
  it('reads the record with defaults, and null without', () => {
    expect(readCornerHoles({ type: 'sketch' })).toBeNull();
    expect(readCornerHoles({ cornerHoles: { inset: 5 } })).toEqual({ inset: 5, matchFillet: false, nx: 2, ny: 2 });
    expect(readCornerHoles({ cornerHoles: { inset: 'x', matchFillet: true, nx: 3, ny: 4, rect: R, radius: 8 } })).toEqual({ inset: 10, matchFillet: true, nx: 3, ny: 4, rect: R, radius: 8 });
    expect(readCornerHoles({ cornerHoles: { rect: { minX: 'a' } } })).toEqual(DEFAULT_CORNER);
  });
});

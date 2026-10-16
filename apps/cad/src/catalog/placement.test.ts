import { describe, expect, it } from 'vitest';
import { applyPlacement, groundPlane, placementFrame, rayStdPlane, STD_FRAMES, toPlaneUV, type Placement, type StdPlane } from './placement';
import { buildShape, catalogItem } from './shapes';

const TOP = { kind: 'std', id: 'top' } as const;
const P = (flip = false, rot: 0 | 1 | 2 | 3 = 0, mirror = false): Placement => ({ flip, rot, mirror });
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('ground plane', () => {
  it('is the plane whose normal is the up axis', () => {
    expect(groundPlane('y')).toBe('top');
    expect(groundPlane('z')).toBe('front');
    expect(STD_FRAMES[groundPlane('y')].n).toEqual([0, 1, 0]);
    expect(STD_FRAMES[groundPlane('z')].n).toEqual([0, 0, 1]);
  });
});

describe('placement frame: every plane x flip x rotate x mirror', () => {
  const planes: StdPlane[] = ['front', 'top', 'right'];
  it('the extrusion direction is the plane normal, reversed by flip, whatever the rotation or mirror', () => {
    for (const pl of planes) for (const flip of [false, true]) for (const rot of [0, 1, 2, 3] as const) for (const mirror of [false, true]) {
      const f = placementFrame(pl, P(flip, rot, mirror));
      const n = STD_FRAMES[pl].n;
      expect(f.dir, `${pl} flip=${flip}`).toEqual(flip ? n.map((v) => -v || 0) : n);
      // the profile axes stay in the plane and perpendicular to each other
      expect(dot(f.x, n)).toBe(0); expect(dot(f.y, n)).toBe(0); expect(dot(f.x, f.y)).toBe(0);
    }
  });
  it('rotating 90 turns x into y (counter-clockwise about the normal); four turns are the identity; mirror negates x first', () => {
    for (const pl of planes) {
      const f0 = STD_FRAMES[pl], f1 = placementFrame(pl, P(false, 1));
      expect(f1.x).toEqual(f0.y);
      expect(f1.y).toEqual(f0.x.map((v) => -v || 0));
      expect(placementFrame(pl, P(false, 2)).x).toEqual(f0.x.map((v) => -v || 0));
      expect(placementFrame(pl, P(false, 0))).toEqual({ x: f0.x, y: f0.y, dir: f0.n });
      expect(placementFrame(pl, P(false, 0, true)).x).toEqual(f0.x.map((v) => -v || 0));
      expect(placementFrame(pl, P(false, 0, true)).y).toEqual(f0.y);
    }
  });
  it('Top plane with Y up: the shape grows +Y (up); Front plane: +Z (toward the viewer); flip: down / away', () => {
    expect(placementFrame('top', P()).dir).toEqual([0, 1, 0]);
    expect(placementFrame('top', P(true)).dir).toEqual([0, -1, 0]);
    expect(placementFrame('front', P()).dir).toEqual([0, 0, 1]);
    expect(placementFrame('front', P(true)).dir).toEqual([0, 0, -1]);
  });
});

describe('plane picking maths', () => {
  it('a ray meets the plane and the point has plane coordinates', () => {
    const hit = rayStdPlane('top', [3, 10, -4], [0, -1, 0])!;
    expect(hit).toEqual([3, 0, -4]);
    expect(toPlaneUV('top', hit)).toEqual([3, 4]);          // Top: sketch y is -Z
    expect(rayStdPlane('front', [0, 0, 5], [0, 0, 1])).toBeNull();     // pointing away
    expect(rayStdPlane('right', [0, 5, 5], [0, 1, 0])).toBeNull();     // parallel
  });
});

describe('applyPlacement on the built features', () => {
  const block = (pl: Placement) => {
    const r = buildShape(catalogItem('add-block')!, { kind: 'ground', point: [0, 0, 0], plane: { kind: 'std', id: 'top' }, uv: [10, 20], place: pl }, 1);
    if ('error' in r) throw new Error(r.error);
    return r.ops.map((o) => (o as { feature: Record<string, unknown> }).feature);
  };
  it('the sketch goes on the chosen plane, centred on the drop point', () => {
    const f = block(P());
    const sk = f.find((x) => x.type === 'sketch') as { plane: unknown; points: Array<{ x: number; y: number }> };
    expect(sk.plane).toEqual({ kind: 'std', id: 'top' });
    const xs = sk.points.map((p) => p.x);
    expect(Math.min(...xs.filter((v) => v !== 0))).toBe(10 - 15);
  });
  it('flip toggles the extrude flip; rotate turns the profile about the centre; mirror swaps arc ends', () => {
    expect((block(P(true)).find((x) => x.type === 'extrude') as { flip?: boolean }).flip).toBe(true);
    const feats = [{ type: 'sketch', plane: { kind: 'std', id: 'top' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 14, y: 0 }, { id: 'b', x: 10, y: 4 }], entities: [{ type: 'arc', c: 'O', p1: 'a', p2: 'b' }] }];
    applyPlacement(feats as never, P(false, 1), [10, 0], TOP);
    expect(feats[0].points.slice(1).map((p) => [p.x, p.y])).toEqual([[10, 4], [6, 0]]);
    applyPlacement(feats as never, P(false, 0, true), [10, 0], TOP);
    expect(feats[0].entities[0]).toMatchObject({ p1: 'b', p2: 'a' });
    // the fixed origin never moves
    expect(feats[0].points[0]).toMatchObject({ x: 0, y: 0 });
  });
  it('rotating a 40 x 30 profile by 90 swaps its width and depth', () => {
    const feats = [{ type: 'sketch', plane: { kind: 'std', id: 'top' }, points: [{ id: 'p1', x: -20, y: -15 }, { id: 'p2', x: 20, y: -15 }, { id: 'p3', x: 20, y: 15 }, { id: 'p4', x: -20, y: 15 }], entities: [] }];
    applyPlacement(feats as never, P(false, 1), [0, 0], TOP);
    const xs = feats[0].points.map((p) => p.x), ys = feats[0].points.map((p) => p.y);
    expect([Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]).toEqual([30, 40]);
  });
});

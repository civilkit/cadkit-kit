import { describe, expect, it } from 'vitest';
import { applyMods, beginDrag, hitHandle, NumericEntry, pixelScale, rayLineParam, rayPlanePoint, readDrag, restPosition, formatQuantity, type HandleSpec, type Vec3 } from './handles';

const ray = (o: Vec3, d: Vec3) => ({ o, d });

describe('drag to value', () => {
  it('rayLineParam: nearest point on the line to the ray', () => {
    // ray along -z from (3, 0, 10); line is the x axis: nearest point is x = 3
    expect(rayLineParam([3, 0, 10], [0, 0, -1], [0, 0, 0], [1, 0, 0])).toBeCloseTo(3);
    // the ray passes beside the line: still the foot of the common perpendicular
    expect(rayLineParam([-2, 5, 10], [0, 0, -1], [10, 0, 0], [1, 0, 0])).toBeCloseTo(-12);
    expect(rayLineParam([0, 0, 10], [1, 0, 0], [0, 0, 0], [1, 0, 0])).toBeNull();   // parallel
  });

  it('an arrow reads the signed distance along its axis, from where the pointer started', () => {
    const spec: HandleSpec = { id: 'a', kind: 'arrow', origin: [0, 0, 0], axis: [0, 0, 1] };
    const st = beginDrag(spec, ray([0, 100, 5], [0, -1, 0]), 0.1)!;
    expect(readDrag(st, ray([0, 100, 12], [0, -1, 0]))!.delta).toBeCloseTo(7);
    expect(readDrag(st, ray([0, 100, -3], [0, -1, 0]))!.delta).toBeCloseTo(-8);
    expect(readDrag(st, ray([0, 100, 12], [0, -1, 0]))!.vec[2]).toBeCloseTo(7);
  });

  it('a dot is drawn beside its origin but measures from where it was grabbed', () => {
    const spec: HandleSpec = { id: 'd', kind: 'dot', origin: [0, 0, 0], axis: [1, 0, 0], offsetPx: -20 };
    expect(restPosition(spec, 0.5)).toEqual([-10, 0, 0]);
    const st = beginDrag(spec, ray([-10, 50, 0], [0, -1, 0]), 0.5)!;
    expect(readDrag(st, ray([4, 50, 0], [0, -1, 0]))!.delta).toBeCloseTo(14);
  });

  it('a plane square reads the in-plane move', () => {
    const spec: HandleSpec = { id: 'p', kind: 'plane', origin: [0, 0, 0], axis: [0, 0, 1], u: [1, 0, 0] };
    const st = beginDrag(spec, ray([1, 1, 10], [0, 0, -1]), 1)!;
    const r = readDrag(st, ray([4, 5, 10], [0, 0, -1]))!;
    expect(r.vec).toEqual([3, 4, 0]);
    expect(r.delta).toBeCloseTo(5);
    expect(rayPlanePoint([0, 0, 10], [1, 0, 0], [0, 0, 0], [0, 0, 1])).toBeNull();
  });

  it('a ring reads the signed angle about its axis', () => {
    const spec: HandleSpec = { id: 'r', kind: 'ring', origin: [0, 0, 0], axis: [0, 0, 1] };
    const st = beginDrag(spec, ray([10, 0, 10], [0, 0, -1]), 1)!;
    expect(readDrag(st, ray([0, 10, 10], [0, 0, -1]))!.delta).toBeCloseTo(90);
    expect(readDrag(st, ray([0, -10, 10], [0, 0, -1]))!.delta).toBeCloseTo(-90);
    expect(readDrag(st, ray([-10, 0, 10], [0, 0, -1]))!.delta).toBeCloseTo(180, 0);
  });
});

describe('modifiers and typed values', () => {
  it('shift drags a tenth as far, ctrl snaps the quantity to the step', () => {
    expect(applyMods(10, 0, 1, { shift: false, ctrl: false }, 1)).toEqual({ delta: 10, q: 10 });
    expect(applyMods(10, 0, 1, { shift: true, ctrl: false }, 1)).toEqual({ delta: 1, q: 1 });
    expect(applyMods(3.4, 10, 2, { shift: false, ctrl: true }, 5)).toEqual({ delta: 2.5, q: 15 });
    expect(applyMods(7.2, 0, 1, { shift: false, ctrl: true }, 1).q).toBe(7);
  });

  it('numeric entry collects digits, a point and a minus', () => {
    const n = new NumericEntry();
    expect(n.active).toBe(false);
    for (const k of ['-', '1', '2', '.', '5']) expect(n.key(k)).toBe(true);
    expect(n.value).toBe(-12.5);
    n.key('Backspace');
    expect(n.value).toBe(-12);
    expect(n.key('x')).toBe(false);
    n.key('-');
    expect(n.value).toBe(12);
    const m = new NumericEntry();
    m.key('.'); m.key('5');
    expect(m.value).toBe(0.5);
    const e = new NumericEntry();
    e.key('-');
    expect(e.value).toBeNull();
  });

  it('formats with the unit', () => {
    expect(formatQuantity(12.345, 'mm')).toBe('12.35 mm');
    expect(formatQuantity(90, 'deg')).toBe('90°');
  });
});

describe('screen size', () => {
  it('pixelScale keeps a widget the same size, also in the parallel (narrow field of view) camera', () => {
    const persp = pixelScale(100, 45, 800);
    // the parallel camera is moved back by the ratio of the tangents, so the framing is unchanged
    const back = 100 * (Math.tan((45 * Math.PI) / 360) / Math.tan((1 * Math.PI) / 360));
    expect(pixelScale(back, 1, 800)).toBeCloseTo(persp, 6);
  });
});

describe('hit testing', () => {
  // orthographic-looking projection: x, y to pixels, 1 world unit = 1 px
  const project = (p: Vec3): [number, number] => [p[0], p[1]];
  const w = () => 1;
  it('finds an arrow near its shaft, a dot near its centre, and prefers the dot', () => {
    const arrow: HandleSpec = { id: 'arrow', kind: 'arrow', origin: [0, 0, 0], axis: [1, 0, 0], sizePx: 50 };
    const dot: HandleSpec = { id: 'dot', kind: 'dot', origin: [25, 0, 0], axis: [1, 0, 0], sizePx: 6 };
    expect(hitHandle([arrow], project, 30, 4, w)).toBe('arrow');
    expect(hitHandle([arrow], project, 30, 20, w)).toBeNull();
    expect(hitHandle([arrow, dot], project, 26, 2, w)).toBe('dot');
    expect(hitHandle([arrow, dot], project, 60, 2, w)).toBeNull();
  });
  it('finds a ring by its circumference only and a square inside', () => {
    const ring: HandleSpec = { id: 'ring', kind: 'ring', origin: [0, 0, 0], axis: [0, 0, 1], sizePx: 40 };
    expect(hitHandle([ring], project, 40, 0, w)).toBe('ring');
    expect(hitHandle([ring], project, 0, 0, w)).toBeNull();
    const sq: HandleSpec = { id: 'sq', kind: 'plane', origin: [0, 0, 0], axis: [0, 0, 1], u: [1, 0, 0], sizePx: 20 };
    expect(hitHandle([sq], project, 20, 20, w)).toBe('sq');
    expect(hitHandle([sq], project, 2, 2, w)).toBeNull();
  });
});

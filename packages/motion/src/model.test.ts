import { describe, expect, it } from 'vitest';
import { lerpPose, lerpRigid, deltaBetween, describeStop, isIdentity, latestOnly, moveDir, movePoint, poseDeltas, rangeOf, readMotion, type Frame } from './model';

const frame = (o: number[], deg = 0): Frame => {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  // rotation about +y
  return { o, x: [c, 0, -s], y: [0, 1, 0], z: [s, 0, c] };
};
const near = (a: number[], b: number[], tol = 1e-9) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol));

describe('pose deltas', () => {
  it('is the identity when the pose is the assembled one', () => {
    expect(isIdentity(deltaBetween(frame([1, 2, 3], 30), frame([1, 2, 3], 30)))).toBe(true);
  });
  it('takes a point of the assembled component to the same point of the posed one', () => {
    const from = frame([10, 0, 5], 20), to = frame([12, 3, 5], 110);
    const d = deltaBetween(from, to);
    const local = [1, 2, 3];
    const world = (f: Frame) => [f.o[0] + f.x[0] * local[0] + f.y[0] * local[1] + f.z[0] * local[2], f.o[1] + f.x[1] * local[0] + f.y[1] * local[1] + f.z[1] * local[2], f.o[2] + f.x[2] * local[0] + f.y[2] * local[1] + f.z[2] * local[2]];
    near(movePoint(d, world(from)), world(to));
    // a direction turns by the rotation part only
    near(moveDir(d, from.x), to.x);
  });
  it('leaves out components that did not move and ones with no placement', () => {
    const asm = [{ id: 'F1', place: frame([0, 0, 0]) }, { id: 'F2', place: frame([5, 0, 0]) }, { id: 'F3' }];
    const m = poseDeltas(asm, { ok: true, places: [{ id: 'F1', place: frame([0, 0, 0]) }, { id: 'F2', place: frame([5, 0, 0], 90) }, { id: 'F3', place: frame([1, 1, 1]) }] });
    expect([...m.keys()]).toEqual(['F2']);
  });
});

describe('doc.motion', () => {
  it('reads defensively and keeps other fields', () => {
    expect(readMotion(null).drivers).toEqual([]);
    const m = readMotion({ version: 1, drivers: [{ mate: 'F3', min: 0, max: 110, value: 5 }, { mate: 'bad', min: 5, max: 1 }, 7], studies: [{ id: 's1' }] });
    expect(m.drivers).toEqual([{ mate: 'F3', min: 0, max: 110, value: 5 }]);
    expect(m.studies).toEqual([{ id: 's1' }]);
  });
  it('defaults a range by kind, and a saved one wins', () => {
    const a = { mate: 'F3', kind: 'angle' as const, unit: 'deg' as const, value: 0 };
    expect(rangeOf(a, [])).toEqual({ min: -360, max: 360 });
    expect(rangeOf({ ...a, kind: 'distance', unit: 'mm' }, [])).toEqual({ min: -100, max: 100 });
    expect(rangeOf(a, [{ mate: 'F3', min: 0, max: 110, value: 0 }])).toEqual({ min: 0, max: 110 });
  });
});

describe('latestOnly', () => {
  it('drops all but the newest request made while one runs', async () => {
    const seen: number[] = [];
    let release: () => void = () => {};
    const f = latestOnly(async (n: number) => { seen.push(n); await new Promise<void>((r) => { release = r; }); });
    f(1); f(2); f(3); f(4);
    expect(seen).toEqual([1]);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([1, 4]);
    release();
  });
});

describe('describeStop', () => {
  const name = (id: string) => ({ F1: 'Rail', F2: 'Slider', F4: 'Swing limit' } as Record<string, string>)[id] ?? id;
  it('says each reason with the names the user gave', () => {
    expect(describeStop({ reason: 'range', value: 12 }, name, 'mm')).toEqual({ key: 'motion.stop.range', params: { value: 12, unit: 'mm' } });
    const lim = describeStop({ reason: 'limit', value: 109.995, mate: 'F4', bound: 'max', bound_value: 110 }, name, '°');
    expect(lim.key).toBe('motion.stop.limit.max');
    expect(lim.params).toMatchObject({ mate: 'Swing limit', bound: 110 });
    const hit = describeStop({ reason: 'contact', value: 8, a: 'F1', b: 'F2', distance: 0 }, name, 'mm');
    expect(hit).toEqual({ key: 'motion.stop.contact', params: { value: 8, unit: 'mm', a: 'Rail', b: 'Slider', gap: 0 } });
    expect(describeStop({ reason: 'contact', value: 7.5, a: 'F1', b: 'F2', near: true, distance: 0.49 }, name, 'mm').key).toBe('motion.stop.near');
    expect(describeStop({ reason: 'solver', value: 3 }, name, 'mm').key).toBe('motion.stop.solver');
    expect(describeStop({ reason: 'branchJump', value: 3, component: 'F2' }, name, 'mm').params).toMatchObject({ part: 'Slider' });
  });
});

describe('between two frames', () => {
  it('turns by the share of the angle and moves by the share of the translation', () => {
    const a = deltaBetween(frame([0, 0, 0]), frame([0, 0, 0], 20));
    const b = deltaBetween(frame([0, 0, 0]), frame([0, 0, 0], 40));
    const mid = lerpRigid(a, b, 0.5);
    const want = deltaBetween(frame([0, 0, 0]), frame([0, 0, 0], 30));
    near(mid.r, want.r, 1e-12);
    expect(lerpRigid(a, b, 0)).toBe(a);
    expect(lerpRigid(a, b, 1)).toBe(b);
    // a pivot turn: the interpolated motion keeps a point on the axis within a micron
    const pivot = (deg: number) => { const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180); return { r: [c, 0, s, 0, 1, 0, -s, 0, c], t: [10 - (c * 10), 0, 0 + (s * 10)] }; };
    const m = lerpRigid(pivot(1), pivot(2), 0.5);
    near(movePoint(m, [10, 0, 0]), [10, 0, 0], 1e-3); // (0.4 um at a radius of 10 mm)
  });
  it('blends the components of two poses, a component missing on one side stays put there', () => {
    const a = new Map([['F2', deltaBetween(frame([0, 0, 0]), frame([4, 0, 0]))]]);
    const b = new Map([['F2', deltaBetween(frame([0, 0, 0]), frame([8, 0, 0]))], ['F3', deltaBetween(frame([0, 0, 0]), frame([2, 0, 0]))]]);
    const m = lerpPose(a, b, 0.5);
    expect(m.get('F2')!.t[0]).toBeCloseTo(6, 12);
    expect(m.get('F3')!.t[0]).toBeCloseTo(1, 12);
  });
});


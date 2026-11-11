import { describe, expect, it } from 'vitest';
import { meshToStl, readStl } from '@kit/io';
import { headLike } from '../../../../packages/io/src/testmesh';
import { meshRecFromStl, toWorld, worldBox } from './meshDoc';
import { centred, onGround, planeThrough, turned } from './meshEdit';

const rec = meshRecFromStl(readStl(meshToStl({ positions: headLike(40, 40) }).data as Uint8Array), 'mesh1', 'Head', 'mm');

describe('mesh placement edits', () => {
  it('onGround centres on the origin and rests on the ground (z up)', () => {
    const b = worldBox(onGround({ ...rec, pos: [300, -50, 9] }, 'z'));
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0, 4);
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(0, 4);
    expect(b.min[2]).toBeCloseTo(0, 4);
  });
  it('onGround with y up rests on y = 0', () => {
    const b = worldBox(onGround(rec, 'y'));
    expect(b.min[1]).toBeCloseTo(0, 4);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(0, 4);
  });
  it('centred puts the box centre on the origin', () => {
    const b = worldBox(centred({ ...rec, pos: [5, 6, 7] }));
    for (let i = 0; i < 3; i++) expect((b.min[i] + b.max[i]) / 2).toBeCloseTo(0, 4);
  });
  it('turned 90 about X sends the head top (+Z) to -Y, around the same centre', () => {
    const before = worldBox(rec), t = turned(rec, 0, 90), after = worldBox(t);
    for (let i = 0; i < 3; i++) expect((after.min[i] + after.max[i]) / 2).toBeCloseTo((before.min[i] + before.max[i]) / 2, 3);
    const top = toWorld(t, [0, 0, 100]), mid = toWorld(t, [0, 0, 0]);
    expect(top[1] - mid[1]).toBeCloseTo(-100, 3);
    expect(top[2] - mid[2]).toBeCloseTo(0, 3);
    // four quarter turns come home
    let q = rec; for (let k = 0; k < 4; k++) q = turned(q, 2, 90);
    const p = toWorld(q, [10, 20, 30]), p0 = toWorld(rec, [10, 20, 30]);
    for (let i = 0; i < 3; i++) expect(p[i]).toBeCloseTo(p0[i], 3);
  });
});

describe('plane through a surface point', () => {
  it('normal: the plane frame has z along the surface normal and passes through the point', () => {
    const f = planeThrough([1, 2, 3], [0, 0, 5], 'normal', 'P');
    expect(f).toMatchObject({ type: 'plane', mode: 'frame', origin: [1, 2, 3], name: 'P' });
    const x = f.xDir as number[], y = f.yDir as number[];
    const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    expect(z[2]).toBeCloseTo(1, 6);
    expect(x[0] * y[0] + x[1] * y[1] + x[2] * y[2]).toBeCloseTo(0, 9);
  });
  it('a slanted normal is kept', () => {
    const n = [0.6, 0, 0.8];
    const f = planeThrough([0, 0, 0], n as never, 'normal', 'P');
    const x = f.xDir as number[], y = f.yDir as number[];
    const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    z.forEach((v, i) => expect(v).toBeCloseTo(n[i], 6));
  });
  it('the base orientations are the three std planes', () => {
    expect(planeThrough([4, 5, 6], [1, 1, 1], 'front', 'P')).toMatchObject({ origin: [4, 5, 6], xDir: [1, 0, 0], yDir: [0, 1, 0] });
    expect(planeThrough([0, 0, 0], [1, 1, 1], 'top', 'P')).toMatchObject({ xDir: [1, 0, 0], yDir: [0, 0, 1] });
    expect(planeThrough([0, 0, 0], [1, 1, 1], 'right', 'P')).toMatchObject({ xDir: [0, 1, 0], yDir: [0, 0, 1] });
  });
});

import { describe, expect, it } from 'vitest';
import { capFrame, clipPlane, kept, STD_SECTION_NORMAL } from './section';

describe('section maths', () => {
  const s = { normal: STD_SECTION_NORMAL.front, offset: 5 };
  it('the standard planes are the view axes', () => { expect(STD_SECTION_NORMAL).toEqual({ front: [0, 0, 1], top: [0, 1, 0], right: [1, 0, 0] }); });
  it('default keeps the side behind the plane; flip keeps the other', () => {
    expect(kept(s, [0, 0, 4])).toBe(true); expect(kept(s, [0, 0, 6])).toBe(false);
    expect(kept({ ...s, flip: true }, [0, 0, 6])).toBe(true); expect(kept({ ...s, flip: true }, [0, 0, 4])).toBe(false);
  });
  it('clipPlane is the three.js form of the same half-space', () => {
    for (const spec of [s, { ...s, flip: true }, { normal: [0, 1, 0] as [number, number, number], offset: -3 }]) {
      const c = clipPlane(spec);
      for (const p of [[0, 0, 4], [0, 0, 6], [1, 2, -3], [0, -5, 0]]) {
        const threeKeeps = c.normal[0] * p[0] + c.normal[1] * p[1] + c.normal[2] * p[2] + c.constant >= 0;
        expect(threeKeeps).toBe(kept(spec, p));
      }
    }
  });
  it('the cap sits on the plane, under the box centre, and covers the box', () => {
    const f = capFrame(s, { min: [0, 0, 0], max: [30, 20, 10] });
    expect(f.center).toEqual([15, 10, 5]);
    expect(f.size).toBeGreaterThan(Math.hypot(30, 20));
    expect(capFrame({ normal: [1, 0, 0], offset: 7 }, { min: [0, 0, 0], max: [30, 20, 10] }).center).toEqual([7, 10, 5]);
  });
});

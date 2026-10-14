import { describe, expect, it } from 'vitest';
import { defaultFlip } from './extrude';

const frame = { o: [0, 0, 0], z: [0, 0, 1] };
describe('defaultFlip', () => {
  it('a cut goes against the normal by default, so it is flipped when the body is on the normal side', () => {
    expect(defaultFlip('cut', frame, { min: [0, 0, 0], max: [5, 5, 10] })).toBe(true);     // body in front: flip to go into it
    expect(defaultFlip('cut', frame, { min: [0, 0, -10], max: [5, 5, 0] })).toBe(false);   // body behind: the default already goes into it
  });
  it('a boss is never flipped, and a cut with no body or through the middle keeps the normal', () => {
    expect(defaultFlip('add', frame, { min: [0, 0, -10], max: [5, 5, 0] })).toBe(false);
    expect(defaultFlip('cut', frame, null)).toBe(false);
    expect(defaultFlip('cut', null, { min: [0, 0, -10], max: [5, 5, 0] })).toBe(false);
    expect(defaultFlip('cut', frame, { min: [0, 0, -5], max: [5, 5, 5] })).toBe(false);
  });
});

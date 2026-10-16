import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper without types
import { decodePng, diffPng, encodePng } from './png.mjs';

const img = (w: number, h: number, f: (i: number) => number[]) => { const data = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) data.set(f(i), i * 4); return { w, h, data }; };

describe('ux png helpers', () => {
  it('round-trips an image through encode and decode', () => {
    const a = img(5, 4, (i) => [i * 10, 255 - i, 7, 255]);
    const b = decodePng(encodePng(a));
    expect([b.w, b.h]).toEqual([5, 4]);
    expect(Buffer.compare(b.data, a.data)).toBe(0);
  });
  it('reports the percentage of changed pixels, 0 for equal images, 100 for a size mismatch', () => {
    const a = encodePng(img(10, 10, () => [10, 20, 30, 255]));
    const b = encodePng(img(10, 10, (i) => (i < 25 ? [200, 20, 30, 255] : [10, 20, 30, 255])));
    expect(diffPng(a, a).pct).toBe(0);
    expect(diffPng(a, b).pct).toBe(25);
    expect(diffPng(a, encodePng(img(5, 5, () => [0, 0, 0, 255]))).pct).toBe(100);
  });
});

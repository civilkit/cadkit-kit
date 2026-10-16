import { decodePng, encodePng, type RgbaImage } from './png.js';
import { Raster } from './raster.js';

export type ImageLike = Uint8Array | RgbaImage;
export interface DiffResult {
  /** percentage (0..100) of pixels whose largest channel difference exceeds the threshold */
  changedPct: number;
  changedPixels: number;
  /** changed pixels red over a faded copy of B */
  diffPng: Uint8Array;
  /** tight box of the changed pixels (inclusive), null when identical */
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
  sizeMismatch?: boolean;
}

async function toImage(i: ImageLike): Promise<RgbaImage> {
  return i instanceof Uint8Array ? decodePng(i) : i;
}

/** Pixel diff of two renders (PNG bytes or raw RGBA). Different sizes count as 100% changed. */
export async function diffImages(a: ImageLike, b: ImageLike, opts: { threshold?: number } = {}): Promise<DiffResult> {
  const tol = opts.threshold ?? 8;
  const A = await toImage(a), B = await toImage(b);
  if (A.width !== B.width || A.height !== B.height) {
    return { changedPct: 100, changedPixels: Math.max(A.width * A.height, B.width * B.height), diffPng: await encodePng(B), bbox: { x0: 0, y0: 0, x1: B.width - 1, y1: B.height - 1 }, sizeMismatch: true };
  }
  const { width: w, height: h } = A;
  const out = new Raster(w, h);
  let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = Math.max(Math.abs(A.rgba[i] - B.rgba[i]), Math.abs(A.rgba[i + 1] - B.rgba[i + 1]), Math.abs(A.rgba[i + 2] - B.rgba[i + 2]));
    if (d > tol) {
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0;
    } else {
      out.data[i] = 128 + (B.rgba[i] >> 1); out.data[i + 1] = 128 + (B.rgba[i + 1] >> 1); out.data[i + 2] = 128 + (B.rgba[i + 2] >> 1);
    }
    out.data[i + 3] = 255;
  }
  return { changedPct: +((100 * n) / (w * h)).toFixed(4), changedPixels: n, diffPng: await encodePng({ width: w, height: h, rgba: out.data }), bbox: n ? { x0, y0, x1, y1 } : null };
}

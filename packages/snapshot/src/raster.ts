// 2D raster primitives on an RGBA8 buffer: alpha blending, anti-aliased lines, text, rectangles, circles, even-odd
// polygon fill with 45 degree hatching, box downsampling and blitting. No state, no randomness.
import { ADVANCE, GLYPH_H, GLYPH_W, glyph, textWidth } from './font.js';

export type RGB = [number, number, number];

export class Raster {
  readonly data: Uint8Array;
  constructor(readonly width: number, readonly height: number, fill: RGB | readonly [number, number, number, number] = [255, 255, 255]) {
    this.data = new Uint8Array(width * height * 4);
    const a = fill.length === 4 ? fill[3] : 255;
    for (let i = 0; i < this.data.length; i += 4) { this.data[i] = fill[0]; this.data[i + 1] = fill[1]; this.data[i + 2] = fill[2]; this.data[i + 3] = a; }
  }

  /** Blend colour `c` over pixel (x, y) with coverage `a` in 0..1. */
  blend(x: number, y: number, c: RGB, a: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || a <= 0) return;
    const i = (y * this.width + x) * 4, d = this.data;
    if (a >= 1) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; return; }
    d[i] = d[i] + (c[0] - d[i]) * a + 0.5;
    d[i + 1] = d[i + 1] + (c[1] - d[i + 1]) * a + 0.5;
    d[i + 2] = d[i + 2] + (c[2] - d[i + 2]) * a + 0.5;
    d[i + 3] = 255;
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.height, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.width, Math.ceil(x1)); x++) this.blend(x, y, c, a);
  }

  strokeRect(x0: number, y0: number, x1: number, y1: number, c: RGB, w = 1): void {
    this.fillRect(x0, y0, x1, y0 + w, c); this.fillRect(x0, y1 - w, x1, y1, c);
    this.fillRect(x0, y0, x0 + w, y1, c); this.fillRect(x1 - w, y0, x1, y1, c);
  }

  /** Anti-aliased line of width `w` px. `dash` = [on, off] in px (0 / undefined = solid). `phase` offsets the pattern. */
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, w = 1, a = 1, dash?: [number, number], phase = 0): void {
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
    const hw = w / 2 + 0.5;
    const xa = Math.max(0, Math.floor(Math.min(x0, x1) - hw)), xb = Math.min(this.width - 1, Math.ceil(Math.max(x0, x1) + hw));
    const ya = Math.max(0, Math.floor(Math.min(y0, y1) - hw)), yb = Math.min(this.height - 1, Math.ceil(Math.max(y0, y1) + hw));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const px = x + 0.5, py = y + 0.5;
      let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x0 + t * dx - px, ey = y0 + t * dy - py;
      const cov = w / 2 + 0.5 - Math.sqrt(ex * ex + ey * ey);
      if (cov <= 0) continue;
      if (dash && dash[0] > 0) { const s = (phase + t * len) % (dash[0] + dash[1]); if (s >= dash[0]) continue; }
      this.blend(x, y, c, (cov > 1 ? 1 : cov) * a);
    }
  }

  polyline(pts: ReadonlyArray<readonly [number, number]>, c: RGB, w = 1, closed = false, a = 1): void {
    const n = pts.length;
    for (let i = 0; i + 1 < n; i++) this.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, w, a);
    if (closed && n > 2) this.line(pts[n - 1][0], pts[n - 1][1], pts[0][0], pts[0][1], c, w, a);
  }

  circle(cx: number, cy: number, r: number, c: RGB, w = 1, a = 1, dashed = false): void {
    const n = Math.max(16, Math.ceil(r * 3));
    let px = cx + r, py = cy;
    for (let i = 1; i <= n; i++) {
      const t = (i / n) * Math.PI * 2, x = cx + r * Math.cos(t), y = cy + r * Math.sin(t);
      if (!dashed || i % 2 === 0) this.line(px, py, x, y, c, w, a);
      px = x; py = y;
    }
  }

  text(x: number, y: number, s: string, c: RGB, scale = 1, bg?: RGB, bgAlpha = 0.85): void {
    const w = textWidth(s, scale);
    if (bg) this.fillRect(x - 2, y - 2, x + w + 2, y + GLYPH_H * scale + 2, bg, bgAlpha);
    let ox = x;
    for (const ch of s) {
      const g = glyph(ch);
      for (let r = 0; r < GLYPH_H; r++) for (let col = 0; col < GLYPH_W; col++) {
        if (g[r] & (1 << (GLYPH_W - 1 - col))) this.fillRect(ox + col * scale, y + r * scale, ox + (col + 1) * scale, y + (r + 1) * scale, c);
      }
      ox += ADVANCE * scale;
    }
  }

  /** Text rotated 90 degrees counter-clockwise (reads bottom to top), anchored at its start (bottom-left). */
  textUp(x: number, y: number, s: string, c: RGB, scale = 1, bg?: RGB): void {
    const w = textWidth(s, scale);
    if (bg) this.fillRect(x - 2, y - w - 2, x + GLYPH_H * scale + 2, y + 2, bg, 0.85);
    let oy = y;
    for (const ch of s) {
      const g = glyph(ch);
      for (let r = 0; r < GLYPH_H; r++) for (let col = 0; col < GLYPH_W; col++) {
        if (g[r] & (1 << (GLYPH_W - 1 - col))) this.fillRect(x + r * scale, oy - (col + 1) * scale, x + (r + 1) * scale, oy - col * scale, c);
      }
      oy -= ADVANCE * scale;
    }
  }

  /** Copy `src` onto this raster at (x, y). */
  blit(src: Raster, x: number, y: number): void {
    for (let yy = 0; yy < src.height; yy++) {
      const dy = y + yy;
      if (dy < 0 || dy >= this.height) continue;
      const x0 = Math.max(0, x), x1 = Math.min(this.width, x + src.width);
      if (x1 <= x0) continue;
      this.data.set(src.data.subarray((yy * src.width + (x0 - x)) * 4, (yy * src.width + (x1 - x)) * 4), (dy * this.width + x0) * 4);
    }
  }

  /** Box-filter downsample by an integer factor. */
  downsample(f: number): Raster {
    if (f === 1) return this;
    const w = Math.floor(this.width / f), h = Math.floor(this.height / f);
    const out = new Raster(w, h);
    const n = f * f, d = this.data, od = out.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
        const k = ((y * f + j) * this.width + x * f + i) * 4;
        r += d[k]; g += d[k + 1]; b += d[k + 2]; a += d[k + 3];
      }
      const o = (y * w + x) * 4;
      od[o] = (r + n / 2) / n; od[o + 1] = (g + n / 2) / n; od[o + 2] = (b + n / 2) / n; od[o + 3] = (a + n / 2) / n;
    }
    return out;
  }
}

/** Even-odd inside mask (1 = inside) of closed polygons in pixel coordinates, by scanline at pixel centres. */
export function evenOddMask(w: number, h: number, polys: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): Uint8Array {
  const mask = new Uint8Array(w * h);
  const xs: number[] = [];
  for (let y = 0; y < h; y++) {
    const py = y + 0.5;
    xs.length = 0;
    for (const poly of polys) {
      const n = poly.length;
      for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        if ((a[1] <= py) === (b[1] <= py)) continue;
        xs.push(a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(w - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let x = x0; x <= x1; x++) mask[y * w + x] = 1;
    }
  }
  return mask;
}

/** True for pixels on the 45 degree hatch lines (spacing and line width in px). */
export const hatchAt = (x: number, y: number, spacing: number, width: number): boolean => ((x + y) % spacing + spacing) % spacing < width;

/** Hatch-fill (45 degrees, even-odd) the polygons onto `r`. Returns the number of pixels inside (hatched or not). */
export function hatchPolygons(r: Raster, polys: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, c: RGB, spacing = 7, width = 1.2, alpha = 1, tint?: RGB, tintAlpha = 0.12): number {
  const mask = evenOddMask(r.width, r.height, polys);
  let inside = 0;
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
    if (!mask[y * r.width + x]) continue;
    inside++;
    if (tint) r.blend(x, y, tint, tintAlpha);
    if (hatchAt(x, y, spacing, width)) r.blend(x, y, c, alpha);
  }
  return inside;
}

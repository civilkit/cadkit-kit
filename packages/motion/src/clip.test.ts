import { describe, expect, it } from 'vitest';
import { crc32, encodeGif, medianCutPalette, zipStore, type RgbaFrame } from './clip';

/** A small GIF decoder for the tests: the palette indices of every frame. */
function decodeGif(b: Uint8Array): { w: number; h: number; palette: number[][]; delays: number[]; frames: Uint8Array[]; loops: boolean } {
  expect(String.fromCharCode(...b.slice(0, 6))).toBe('GIF89a');
  const w = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8);
  const flags = b[10];
  const n = 1 << ((flags & 7) + 1);
  const palette: number[][] = [];
  let p = 13;
  for (let i = 0; i < n; i++, p += 3) palette.push([b[p], b[p + 1], b[p + 2]]);
  const frames: Uint8Array[] = [];
  const delays: number[] = [];
  let loops = false;
  while (b[p] !== 0x3b) {
    if (b[p] === 0x21) {
      if (b[p + 1] === 0xff) loops = true;
      if (b[p + 1] === 0xf9) delays.push(b[p + 4] | (b[p + 5] << 8));
      p += 2;
      while (b[p]) p += b[p] + 1;
      p++;
    } else if (b[p] === 0x2c) {
      p += 10;
      const min = b[p++];
      const data: number[] = [];
      while (b[p]) { for (let i = 1; i <= b[p]; i++) data.push(b[p + i]); p += b[p] + 1; }
      p++;
      // LZW decode
      const clear = 1 << min, end = clear + 1;
      let size = min + 1, next = end + 1, bitPos = 0;
      let dict: number[][] = [];
      const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict.push([i]); dict.push([], []); size = min + 1; next = end + 1; };
      reset();
      const out: number[] = [];
      let prev: number[] | null = null;
      for (;;) {
        let code = 0;
        for (let i = 0; i < size; i++, bitPos++) code |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
        if (code === clear) { reset(); prev = null; continue; }
        if (code === end) break;
        let entry: number[];
        if (code < next || (code < dict.length && dict[code].length)) entry = dict[code];
        else entry = [...prev!, prev![0]];
        out.push(...entry);
        if (prev) { dict[next++] = [...prev, entry[0]]; if (next === (1 << size) && size < 12) size++; }
        prev = entry;
      }
      frames.push(Uint8Array.from(out));
    } else throw new Error('bad block ' + b[p]);
  }
  return { w, h, palette, delays, frames, loops };
}

const solid = (w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): RgbaFrame => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};

describe('GIF', () => {
  it('round-trips frames with few colours exactly, with the delay and the loop block', () => {
    const f1 = solid(8, 6, (x, y) => (x < 4 ? [255, 0, 0, 255] : y < 3 ? [0, 255, 0, 255] : [0, 0, 255, 255]));
    const f2 = solid(8, 6, (x) => (x % 2 ? [255, 255, 255, 255] : [10, 20, 30, 255]));
    const gif = encodeGif([f1, f2], { fps: 25 });
    const d = decodeGif(gif);
    expect([d.w, d.h, d.frames.length]).toEqual([8, 6, 2]);
    expect(d.delays).toEqual([4, 4]);
    expect(d.loops).toBe(true);
    const px = (fi: number, i: number) => d.palette[d.frames[fi][i]];
    for (const [fi, f] of [[0, f1], [1, f2]] as const) for (let i = 0; i < 48; i++) expect(px(fi, i)).toEqual([f.data[i * 4], f.data[i * 4 + 1], f.data[i * 4 + 2]]);
  });
  it('quantises a gradient to at most 256 colours, close to the original, and composites transparency over the background', () => {
    const g = solid(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2, 255]);
    const d = decodeGif(encodeGif([g], { fps: 10 }));
    expect(d.palette.length).toBeLessThanOrEqual(256);
    let worst = 0;
    for (let i = 0; i < 64 * 64; i++) { const c = d.palette[d.frames[0][i]]; for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(c[k] - g.data[i * 4 + k])); }
    expect(worst).toBeLessThan(32);
    const t = solid(2, 2, () => [200, 0, 0, 0]);
    const dt = decodeGif(encodeGif([t], { fps: 10, bg: [7, 8, 9] }));
    expect(dt.palette[dt.frames[0][0]]).toEqual([7, 8, 9]);
    expect(medianCutPalette([g], [0, 0, 0]).length).toBe(256);
  });
  it('refuses no frames and frames of different sizes', () => {
    expect(() => encodeGif([], { fps: 10 })).toThrow();
    expect(() => encodeGif([solid(2, 2, () => [0, 0, 0, 255]), solid(3, 2, () => [0, 0, 0, 255])], { fps: 10 })).toThrow();
  });
});

describe('ZIP', () => {
  it('stores files with the right sizes, names and CRC', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const files = [{ name: 'frame_0001.png', data: Uint8Array.from([1, 2, 3, 4]) }, { name: 'frame_0002.png', data: Uint8Array.from([9, 8]) }];
    const z = zipStore(files);
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    // end of central directory
    const eocd = z.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocd + 10, true)).toBe(2);
    let cd = dv.getUint32(eocd + 16, true);
    const names: string[] = [];
    for (let i = 0; i < 2; i++) {
      expect(dv.getUint32(cd, true)).toBe(0x02014b50);
      const size = dv.getUint32(cd + 24, true), nl = dv.getUint16(cd + 28, true), off = dv.getUint32(cd + 42, true);
      names.push(new TextDecoder().decode(z.slice(cd + 46, cd + 46 + nl)));
      expect(size).toBe(files[i].data.length);
      expect(dv.getUint32(cd + 16, true)).toBe(crc32(files[i].data));
      const hl = dv.getUint16(off + 26, true);
      expect([...z.slice(off + 30 + hl, off + 30 + hl + size)]).toEqual([...files[i].data]);
      cd += 46 + nl;
    }
    expect(names).toEqual(['frame_0001.png', 'frame_0002.png']);
  });
});

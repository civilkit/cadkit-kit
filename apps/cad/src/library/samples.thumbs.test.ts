import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { imageType } from './registry';

const DIR = join(__dirname, '../../public/samples');

describe('bundled samples', () => {
  const list = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as Array<{ id: string; file: string }>;
  it('every listed sample has a thumbnail, and it is a real webp image', () => {
    expect(list.length).toBeGreaterThan(100);
    const missing = list.filter((s) => !existsSync(join(DIR, 'thumbs', s.id + '.webp'))).map((s) => s.id);
    expect(missing).toEqual([]);
    for (const s of list) expect(imageType(new Uint8Array(readFileSync(join(DIR, 'thumbs', s.id + '.webp')).subarray(0, 16))), s.id).toBe('image/webp');
  });
  it('the nine bldc motors are samples with thumbnails', () => {
    expect(list.filter((s) => s.id.startsWith('bldc-')).length).toBe(9);
  });
  it('every sample file listed exists', () => {
    for (const s of list) expect(existsSync(join(DIR, s.file)), s.file).toBe(true);
  });
});

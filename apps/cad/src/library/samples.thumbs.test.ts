import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { imageType } from './registry';
import { libraryParts, readHashes, thumbProblems } from '../../../../tools/library_thumbs_check';
import { docHash } from '../files/docThumb';

const DIR = join(__dirname, '../../public/samples');

describe('bundled samples', () => {
  const list = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as Array<{ id: string; file: string }>;
  it('every listed sample has a thumbnail, and it is a real webp image', () => {
    expect(list.length).toBeGreaterThan(90);
    const missing = list.filter((s) => !existsSync(join(DIR, 'thumbs', s.id + '.webp'))).map((s) => s.id);
    expect(missing).toEqual([]);
    for (const s of list) expect(imageType(new Uint8Array(readFileSync(join(DIR, 'thumbs', s.id + '.webp')).subarray(0, 16))), s.id).toBe('image/webp');
  });
  // Fails when a sample has no picture, or its part changed after the picture was drawn (the hash of the part is kept in
  // thumbs/hashes.json). Fix: node tools/library_thumbs.mjs apps/cad/public/samples   (draws the missing and outdated ones)
  it('every sample thumbnail is current: it was drawn from the sample as it is now', () => {
    expect(thumbProblems(DIR)).toEqual([]);
  });
  it('the check notices a missing, an unhashed and an outdated thumbnail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thumbcheck-'));
    try {
      mkdirSync(join(dir, 'thumbs'));
      const doc = JSON.parse(readFileSync(join(DIR, 'mounting-plate.ckpart'), 'utf8'));
      const parts = ['a', 'b', 'c', 'd'].map((id) => { writeFileSync(join(dir, id + '.ckpart'), JSON.stringify(doc)); return { id, file: id + '.ckpart', path: join(dir, id + '.ckpart') }; });
      for (const id of ['b', 'c', 'd']) writeFileSync(join(dir, 'thumbs', id + '.png'), 'x');
      writeFileSync(join(dir, 'thumbs/hashes.json'), JSON.stringify({ c: 'old', d: docHash(doc) }));
      expect(thumbProblems(dir, parts).map((p) => `${p.id}:${p.problem}`)).toEqual(['a:missing', 'b:unhashed', 'c:stale']);
      writeFileSync(join(dir, 'd.ckpart'), JSON.stringify({ ...doc, seq: doc.seq + 1 }));   // the part changes after its picture was drawn
      expect(thumbProblems(dir, parts).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
      writeFileSync(join(dir, 'd.ckpart'), JSON.stringify({ ...doc, name: 'Renamed' }));     // a rename does not outdate it
      expect(thumbProblems(dir, parts).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    } finally { rmSync(dir, { recursive: true }); }
  });
  it('the tinnie hull demo is bundled and listed', () => {
    expect(list.some((s) => s.id === 'tinnie-hull')).toBe(true);
    expect(thumbProblems(DIR, libraryParts(DIR).filter((p) => p.id === 'tinnie-hull'))).toEqual([]);
  });
  it('the BLDC motors are not bundled (they live in the external fwlib-bldc library)', () => {
    expect(list.filter((s) => s.id.startsWith('bldc-')).length).toBe(0);
  });
  it('every sample file listed exists', () => {
    for (const s of list) expect(existsSync(join(DIR, s.file)), s.file).toBe(true);
  });
});

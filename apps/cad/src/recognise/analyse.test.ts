import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyseStep, verdictOf } from './analyse';
import { meshVolume } from './slices';

const plateJson = readFileSync(resolve(process.cwd(), 'apps/cad/src/recognise/plate.features.json'), 'utf8');

/** The 12 triangles of a box: positions, 9 floats a triangle. */
function boxMesh(min: number[], max: number[]): number[] {
  const [a, b] = [min, max];
  const v = (x: number, y: number, z: number) => [x ? b[0] : a[0], y ? b[1] : a[1], z ? b[2] : a[2]];
  const quads = [[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]], [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]], [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]]];
  return quads.flatMap((q) => [...v(...(q[0] as [number, number, number])), ...v(...(q[1] as [number, number, number])), ...v(...(q[2] as [number, number, number])), ...v(...(q[0] as [number, number, number])), ...v(...(q[2] as [number, number, number])), ...v(...(q[3] as [number, number, number]))]);
}

describe('analyseStep', () => {
  const min = [-30, 0, -20], max = [30, 10, 20];
  it('runs the recogniser on the STEP bytes and turns what it finds into a script', async () => {
    let got = '';
    const a = await analyseStep({ stepText: 'ISO-10303-21;', positions: boxMesh(min, max), box: { min, max } }, async (bytes) => { got = new TextDecoder().decode(bytes); return { json: plateJson, version: '0.5.3' }; });
    expect(got).toBe('ISO-10303-21;');
    expect(a.version).toBe('0.5.3');
    expect(a.script).toContain("part('From STEP')");
    expect(a.stock).toBe('box');
    expect(a.found.holes).toBeGreaterThan(0);
    expect(a.handled.length + a.skipped.length).toBe(Object.values(a.found).reduce((x, y) => x + y, 0));
  });
  it('reports the volume of the imported mesh', async () => {
    const a = await analyseStep({ stepText: '', positions: boxMesh(min, max), box: { min, max } }, async () => ({ json: plateJson, version: 'x' }));
    expect(a.fileVolume).toBeCloseTo(60 * 10 * 40, 6);
    expect(meshVolume(boxMesh(min, max))).toBeCloseTo(24000, 6);
  });
  it('passes a recogniser failure on', async () => {
    await expect(analyseStep({ stepText: '', positions: boxMesh(min, max), box: { min, max } }, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

describe('verdictOf: the trust gate', () => {
  it('is a match within 0.5 %, close within 2 %, and differs beyond', () => {
    expect(verdictOf(1000, 1000, true).verdict).toBe('match');
    expect(verdictOf(1004.9, 1000, true).verdict).toBe('match');
    expect(verdictOf(1010, 1000, true).verdict).toBe('close');
    expect(verdictOf(1200, 1000, true).verdict).toBe('differs');
  });
  it('is invalid when the rebuild is not a valid solid, whatever the volume', () => {
    expect(verdictOf(1000, 1000, false).verdict).toBe('invalid');
  });
  it('says which way: the ratio is the rebuilt volume over the imported one', () => {
    expect(verdictOf(2000, 1000, true).ratio).toBe(2);
    expect(verdictOf(250, 1000, true).ratio).toBe(0.25);
  });
  it('differs when the imported volume is unknown', () => {
    expect(verdictOf(1000, 0, true).verdict).toBe('differs');
  });
});

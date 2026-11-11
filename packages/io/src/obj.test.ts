import { describe, expect, it } from 'vitest';
import { bodiesToObj, meshToObj } from './obj';
import { cube } from './testmesh';

describe('bodiesToObj', () => {
  it('one object per body, vertex colours when any body has one, indices continue across bodies', () => {
    const r = bodiesToObj([{ name: 'Red part', positions: cube(), color: '#ff0000' }, { name: 'Plain', positions: cube(2) }]);
    const lines = r.data.split('\n');
    expect(lines.filter((l) => l.startsWith('o '))).toEqual(['o Red_part', 'o Plain']);
    expect(lines.find((l) => l.startsWith('v '))!.split(' ')).toHaveLength(7);
    expect(lines.find((l) => l.startsWith('v '))).toMatch(/ 1 0 0$/);
    const f = lines.filter((l) => l.startsWith('f ')).map((l) => l.split(' ').slice(1).map(Number));
    expect(r).toMatchObject({ bodies: 2, triangles: 24, vertices: 16, coloured: true });
    expect(Math.max(...f.flat())).toBe(16);
    expect(Math.min(...f.slice(12).flat())).toBe(9);
  });
  it('no colours: plain vertex lines', () => {
    const r = bodiesToObj([{ name: 'a', positions: cube() }]);
    expect(r.coloured).toBe(false);
    expect(r.data.split('\n').find((l) => l.startsWith('v '))!.split(' ')).toHaveLength(4);
  });
  it('matches the single-mesh writer for one uncoloured body', () => {
    expect(bodiesToObj([{ name: 'part', positions: cube() }]).triangles).toBe(meshToObj({ positions: cube() }).triangles);
  });
});

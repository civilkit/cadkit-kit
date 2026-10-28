import '../i18n';
import { describe, expect, it } from 'vitest';
import { measure, resolvePick, type EdgeInfo, type MeasureCtx } from './measure';
import { quickLines } from './quick';

const edges: EdgeInfo[] = [
  { key: 'a|b#0', pts: [[0, 0, 0], [10, 0, 0]], line: true, faces: ['A', 'B'], mid: [5, 0, 0] },
  { key: 'a|b#1', pts: [[0, 3, 0], [0, 3, 10]], line: true, faces: ['A', 'B'], mid: [0, 3, 5] },
  { key: 'c|d#2', faces: ['C', 'D'], mid: [-5, 0, 0], pts: Array.from({ length: 9 }, (_, i) => [5 * Math.cos(i * Math.PI / 4), 5 * Math.sin(i * Math.PI / 4), 0]), circle: { c: [0, 0, 0], n: [0, 0, 1], r: 5 } },
  { key: 'c|d#3', faces: ['C', 'D'], mid: [-5, 0, 7], pts: [[-5, 0, 7], [0, 5, 7]], circle: { c: [0, 0, 7], n: [0, 0, 1], r: 5 } },
];
const kernel = (reply: unknown): MeasureCtx['kernel'] => async () => reply as never;
const run = async (names: string[], k: MeasureCtx['kernel'] = kernel(null), summary = '') => {
  const picks = names.map((n) => resolvePick(n, edges)!);
  return quickLines(picks, picks.length > 2 ? null : await measure(picks, { edges, mesh: null, kernel: k }), summary);
};

describe('quickLines', () => {
  it('nothing selected: no lines', () => { expect(quickLines([], null)).toEqual([]); });
  it('a straight edge: its length', async () => { expect(await run(['a|b#0'])).toEqual(['Length: 10 mm']); });
  it('a full circle: diameter, radius, circumference', async () => {
    const l = await run(['c|d#2']);
    expect(l).toHaveLength(3);
    expect(l[0]).toBe('Diameter: 10 mm'); expect(l[1]).toBe('Radius: 5 mm'); expect(l[2]).toBe('Circumference: 31.4159 mm');
  });
  it('an arc has a length, not a circumference', async () => {
    const l = await run(['c|d#3']);
    expect(l.some((x) => x.startsWith('Circumference'))).toBe(false);
    expect(l.some((x) => x.startsWith('Length'))).toBe(true);
  });
  it('a face: the kernel area, and a round face its radius too', async () => {
    expect(await run(['F.C0'], kernel({ items: [{ area: 120.5, surface: 'plane' }] }))).toEqual(['Area: 120.5 mm²']);
    expect(await run(['F.C1'], kernel({ items: [{ area: 314.16, radius: 5, surface: 'cylinder' }] }))).toEqual(['Area: 314.16 mm²', 'Diameter: 10 mm', 'Radius: 5 mm']);
  });
  it('two edges: distance and angle', async () => {
    const l = await run(['a|b#0', 'a|b#1']);
    expect(l[0]).toBe('Minimum distance: 3 mm');
    expect(l[1]).toBe('Angle: 90°');
  });
  it('two corners: the distance only', async () => { expect(await run(['v:0,0,0', 'v:3,4,0'])).toEqual(['Minimum distance: 5 mm']); });
  it('two faces: distance and angle from the kernel (radians)', async () => {
    const l = await run(['F.C0', 'F.C1'], kernel({ items: [{ area: 1 }, { area: 1 }], distance: 2, angle: Math.PI / 2 }));
    expect(l).toEqual(['Minimum distance: 2 mm', 'Angle: 90°']);
  });
  it('more than two: the count and total summary', async () => {
    expect(await run(['a|b#0', 'a|b#1', 'c|d#2'], kernel(null), '3 edges, 33.14 mm')).toEqual(['3 edges, 33.14 mm']);
    expect(await run(['a|b#0', 'a|b#1', 'c|d#2'])).toEqual(['3 items']);
  });
  it('a whole body (no size of its own) falls back to the summary; a lone corner shows nothing', async () => {
    expect(await run(['Body 1'], kernel(null), '1 body, 12.5 cm²')).toEqual(['1 body, 12.5 cm²']);
    expect(await run(['v:1,2,3'], kernel(null), '1 corner')).toEqual([]);
  });
  it('while the measurement is pending nothing is shown for one pick', () => {
    expect(quickLines([resolvePick('a|b#0', edges)!], null, '1 edge, 10 mm')).toEqual(['1 edge, 10 mm']);
  });
});

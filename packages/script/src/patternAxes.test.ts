// linearPattern direction and circularPattern axis forms: what each emits for the kernel (no kernel needed).
import { describe, expect, it } from 'vitest';
import { runScript, type ScriptHost } from './index';

const mock = (): ScriptHost => ({
  load: async () => {},
  edit: async () => ({ ok: true }),
  geometry: () => ({ mesh: null, edges: [], box: null }),
  build: async () => ({ errors: [] }),
  release: async () => {},
});
const BASE = `part('P').sketch('front', (s) => s.rect(100, 100)).extrude(10).sketch('front', (s) => s.circle(2, [10, 10])).cut(through())`;
async function features(code: string) {
  const r = await runScript(code, mock(), {}, { yieldToUi: async () => {} });
  const f = (r.document as { features?: Array<Record<string, unknown>> } | undefined)?.features ?? [];
  return { r, pat: f.find((x) => x.type === 'lpattern' || x.type === 'cpattern') };
}

describe('linearPattern directions', () => {
  it('a world axis, a unit vector on an axis and a negative one keep the old output', async () => {
    expect((await features(`${BASE}.linearPattern({ count: 3, spacing: 5, direction: 'y' })`)).pat).toMatchObject({ dir: { kind: 'axis', axis: 'y' }, reverse: false });
    expect((await features(`${BASE}.linearPattern({ count: 3, spacing: 5, direction: [0, -2, 0] })`)).pat).toMatchObject({ dir: { kind: 'axis', axis: 'y' }, reverse: true });
  });
  it('an oblique vector goes to the kernel as a vector, as given (the kernel normalises)', async () => {
    const { r, pat } = await features(`${BASE}.linearPattern({ count: 4, spacing: 20, direction: [1.7320508, 1, 0] })`);
    expect(r.errors).toEqual([]);
    expect(pat).toMatchObject({ type: 'lpattern', dir: { kind: 'vector', dir: [1.7320508, 1, 0] }, count: 4, spacing: 20, reverse: false });
  });
  it('a second direction can be oblique too, and reverse still flips', async () => {
    const { pat } = await features(`${BASE}.linearPattern({ count: 2, spacing: 5, direction: 'x', reverse: true, second: { direction: [0, 1, 1], count: 3, spacing: 4 } })`);
    expect(pat).toMatchObject({ dir: { kind: 'axis', axis: 'x' }, reverse: true, dir2: { kind: 'vector', dir: [0, 1, 1] }, count2: 3 });
  });
  it('a zero or malformed vector is refused with the line', async () => {
    const { r } = await features(`${BASE}.linearPattern({ count: 3, spacing: 5, direction: [0, 0, 0] })`);
    expect(r.errors[0].message).toMatch(/zero vector/);
    const b = await features(`${BASE}.linearPattern({ count: 3, spacing: 5, direction: [1, 2] })`);
    expect(b.r.errors[0].message).toMatch(/\[x, y, z\]/);
  });
});

describe('circularPattern axes', () => {
  it('a world axis through the origin keeps the old output', async () => {
    expect((await features(`${BASE}.circularPattern({ count: 6, axis: 'z' })`)).pat).toMatchObject({ axis: { kind: 'axis', axis: 'z' } });
    expect((await features(`${BASE}.circularPattern({ count: 6, axis: [0, 0, 0, 0, 0, -1] })`)).pat).toMatchObject({ axis: { kind: 'axis', axis: 'z' }, reverse: true });
  });
  it('an axis away from the origin goes as a point and a direction (array and object forms)', async () => {
    const want = { axis: { kind: 'axis', point: [40, 0, 0], dir: [0, 0, 1] }, count: 6, angle: 360, equal: true };
    expect((await features(`${BASE}.circularPattern({ count: 6, axis: [40, 0, 0, 0, 0, 1] })`)).pat).toMatchObject(want);
    expect((await features(`${BASE}.circularPattern({ count: 6, axis: { point: [40, 0, 0], dir: [0, 0, 1] } })`)).pat).toMatchObject(want);
    expect((await features(`${BASE}.circularPattern({ count: 6, axis: { point: [40, 0, 0], direction: [0, 0, 1] } })`)).pat).toMatchObject(want);
  });
  it('an oblique axis through the origin keeps its direction; an object without a point means the origin', async () => {
    expect((await features(`${BASE}.circularPattern({ count: 3, axis: { dir: [1, 1, 0] } })`)).pat).toMatchObject({ axis: { kind: 'axis', point: [0, 0, 0], dir: [1, 1, 0] } });
    expect((await features(`${BASE}.circularPattern({ count: 3, axis: { dir: [1, 0, 0] } })`)).pat).toMatchObject({ axis: { kind: 'axis', axis: 'x' } });
  });
  it('bad axes are refused', async () => {
    expect((await features(`${BASE}.circularPattern({ count: 3, axis: [1, 2, 3, 4] })`)).r.errors[0].message).toMatch(/point on the axis/);
    expect((await features(`${BASE}.circularPattern({ count: 3, axis: { point: [0, 0], dir: [0, 0, 1] } })`)).r.errors[0].message).toMatch(/axis\.point/);
    expect((await features(`${BASE}.circularPattern({ count: 3, axis: { point: [0, 0, 0], dir: [0, 0, 0] } })`)).r.errors[0].message).toMatch(/zero vector/);
  });
});

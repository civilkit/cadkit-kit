import { describe, expect, it } from 'vitest';
import { MID_PLANE_CUT_WARNING, planeSplitsBody, runScript, stdPlaneAt, type ScriptHost } from './index';

// a host with no kernel: build() accepts everything and reports `box` as the body's box (or none)
const BOX = { min: [-30, -20, -10], max: [30, 20, 10] };
const mock = (box: { min: number[]; max: number[] } | null, perStep = false): ScriptHost => ({
  load: async () => {},
  edit: async () => ({ ok: true }),
  geometry: () => ({ mesh: null, edges: [], box }),
  ...(perStep ? {} : { build: async (_d: Record<string, unknown>, view: boolean) => ({ errors: [], ...(view ? { geometry: { mesh: null, edges: [], box } } : {}) }), release: async () => {} }),
});
const run = (code: string, box: { min: number[]; max: number[] } | null = BOX, perStep = false) => runScript(code, mock(box, perStep), {}, { yieldToUi: async () => {} });
const feats = (r: { document: Record<string, unknown> | null }) => (r.document?.features ?? []) as Array<Record<string, unknown>>;
const BODY = `part('P').sketch('front', (s) => s.rect(60, 40)).extrude(20, { mid: true })`;

describe('rib options', () => {
  it('writes fillet, draft, side and target into the feature; the defaults write nothing', async () => {
    const r = await run(`${BODY}.sketch('front', (s) => s.line([0, 0], [10, 10])).rib(3).sketch('front', (s) => s.line([0, 0], [10, 10])).rib(3, { fillet: 0.5, draft: 2, side: 'right', target: 'Base', flip: true });`);
    expect(r.errors).toEqual([]);
    const ribs = feats(r).filter((f) => f.type === 'rib');
    expect(ribs[0]).toEqual({ type: 'rib', id: 'F4', sketch: 'F3', thickness: 3 });
    expect(ribs[1]).toMatchObject({ thickness: 3, flip: true, fillet: 0.5, draft: 2, side: 'right', target: [{ body: 'Base' }] });
  });
  it('a list of targets is a list; side both is the default and is not written', async () => {
    const r = await run(`${BODY}.sketch('front', (s) => s.line([0, 0], [10, 10])).rib(3, { side: 'both', target: ['A', 'B'] });`);
    const rib = feats(r).find((f) => f.type === 'rib')!;
    expect(rib.target).toEqual([{ body: 'A' }, { body: 'B' }]);
    expect('side' in rib).toBe(false);
  });
  it('refuses a side that is not both, left or right, and an empty target', async () => {
    const bad = await run(`${BODY}.sketch('front', (s) => s.line([0, 0], [10, 10])).rib(3, { side: 'up' });`);
    expect(bad.errors[0]?.message).toMatch(/side is 'both', 'left' or 'right'/);
    const empty = await run(`${BODY}.sketch('front', (s) => s.line([0, 0], [10, 10])).rib(3, { target: [] });`);
    expect(empty.errors[0]?.message).toMatch(/target is a body name/);
  });
});

describe('a through cut from the middle of the part', () => {
  const cut = (plane: string, extra = '') => `${BODY}.sketch(${plane}, (s) => s.circle(5)).cut(through()${extra});`;
  const warned = async (code: string, box = BOX, perStep = false) => ((await run(code, box, perStep)).warnings ?? []).map((w) => w.message).includes(MID_PLANE_CUT_WARNING);
  it('warns when no direction is given, in the batched and the per-step run', async () => {
    for (const perStep of [false, true]) {
      expect(await warned(cut("'front'"), BOX, perStep), `perStep=${perStep}`).toBe(true);
      expect(await warned(cut("at('front', 3)"), BOX, perStep)).toBe(true);
    }
  });
  it('is quiet with a direction, flip, mid, from a face, near an end of the part or with no body', async () => {
    expect(await warned(cut("'front'", ", { direction: 'both' }"))).toBe(false);
    expect(await warned(cut("'front'", ", { direction: 'away' }"))).toBe(false);
    expect(await warned(cut("'front'", ', { flip: true }'))).toBe(false);
    expect(await warned(cut("'front'", ', { mid: true }'))).toBe(false);
    expect(await warned(cut("at('front', 8)"))).toBe(false);          // 2 mm from the +z face: a pocket from near the top
    expect(await warned(cut("'front'"), null as never)).toBe(false);
    expect(await warned(`${BODY}.sketch('front', (s) => s.circle(5)).cut(4);`)).toBe(false);   // blind: not a through cut
  });
  it('takes the axis of the plane: top is y, right is x', async () => {
    expect(await warned(cut("'top'"))).toBe(true);
    expect(await warned(cut("'right'"))).toBe(true);
    expect(await warned(cut("at('top', 19)"))).toBe(false);
  });
  it('the cut itself is unchanged', async () => {
    const r = await run(cut("'front'"));
    const f = feats(r).find((x) => x.type === 'extrude' && x.op === 'cut')!;
    expect(f).toMatchObject({ end: 'through', sketch: 'F3' });
    expect('flip' in f).toBe(false);
  });
});

describe('plane position helpers', () => {
  it('stdPlaneAt reads a standard plane and a numeric offset, nothing else', () => {
    expect(stdPlaneAt('front')).toEqual({ axis: 2, offset: 0 });
    expect(stdPlaneAt('top')).toEqual({ axis: 1, offset: 0 });
    expect(stdPlaneAt('right')).toEqual({ axis: 0, offset: 0 });
    expect(stdPlaneAt({ kind: 'offset', plane: 'front', offset: 7, opts: {}, line: 1 })).toEqual({ axis: 2, offset: 7 });
    expect(stdPlaneAt({ kind: 'offset', plane: 'front', offset: 7, opts: { rotate: { axis: 'x', angle: 10 } }, line: 1 })).toBeNull();
    expect(stdPlaneAt({ kind: 'planeRef', ref: { id: null }, line: 1 })).toBeNull();
  });
  it('planeSplitsBody needs a quarter of the extent on each side', () => {
    const box = { min: [0, 0, 0], max: [0, 0, 100] };
    const at = (offset: number) => planeSplitsBody({ axis: 2, offset }, box);
    expect([0, 24, 25, 50, 75, 76, 100].map(at)).toEqual([false, false, true, true, true, false, false]);
    expect(planeSplitsBody({ axis: 2, offset: 0 }, { min: [0, 0, 0], max: [1, 1, 0] })).toBe(false);   // a flat body has no middle
  });
});

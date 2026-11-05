import { describe, expect, it } from 'vitest';
import { GLYPHS } from '@kit/sketch';
import { GLYPH_PATHS, MARK, MARK_MODES, MIN_HIT, MIN_TAP, chipBox, chipSize, hitBox, hitChip, hitSize, separateMarks, visibleChips, type ChipItem } from './annotChips';
import { labelBox } from './dimGraphics';

const dim = (id: string, text: string, x: number, y: number, fx = false): ChipItem => ({ id, kind: 'dimension', text, x, y, fx });
const mark = (id: string, x: number, y: number): ChipItem => ({ id, kind: 'mark', text: 'H', x, y });
const meets = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('chip sizes', () => {
  it('a value chip grows with its text and with the fx badge; a glyph chip is a fixed square', () => {
    expect(chipSize('dimension', 'Ø80.00 mm').w).toBeGreaterThan(chipSize('dimension', '40 mm').w);
    expect(chipSize('dimension', '40 mm', true).w).toBeGreaterThan(chipSize('dimension', '40 mm').w);
    expect(chipSize('mark', 'H')).toEqual(chipSize('mark', 'V'));
    expect(labelBox('90.0°')).toEqual(chipSize('dimension', '90.0°'));   // the layout measures with the same box the chip is drawn with
  });
  it('a glyph chip is 14 px', () => {
    expect(chipSize('mark', 'H')).toEqual({ w: 14, h: 14 });
    expect(MARK).toBe(14);
  });
  it('the hit target is at least 44 px in the touch layout and at least 24 px on a desktop pointer', () => {
    const c = chipSize('mark', 'H');
    expect(hitSize(c.w, c.h, false)).toEqual({ w: MIN_HIT, h: MIN_HIT });
    expect(MIN_HIT).toBe(24);
    const dw = chipSize('dimension', '40 mm');
    expect(hitSize(dw.w, dw.h, false)).toEqual({ w: dw.w, h: MIN_HIT });
    expect(hitSize(c.w, c.h, true)).toEqual({ w: MIN_TAP, h: MIN_TAP });
    const wide = chipSize('dimension', 'Ø1 500.00 mm');
    expect(hitSize(wide.w, wide.h, true)).toEqual({ w: wide.w, h: MIN_TAP });
  });
});

describe('placing glyph chips', () => {
  it('moves a glyph off a dimension value and leaves the dimension where it is', () => {
    const items = [dim('d1', '40.00 mm', 100, 100), mark('m1', 100, 100)];
    const out = separateMarks(items);
    expect(out[0]).toMatchObject({ x: 100, y: 100 });
    expect(meets(chipBox(out[0]), chipBox(out[1]))).toBe(false);
    expect(items[1]).toMatchObject({ x: 100, y: 100 });   // the input is not changed
  });
  it('keeps a free glyph where it is and spreads glyphs that pile up', () => {
    const out = separateMarks([mark('a', 10, 10), mark('b', 300, 300), mark('c', 10, 10), mark('d', 10, 10)]);
    expect(out[0]).toMatchObject({ x: 10, y: 10 });
    expect(out[1]).toMatchObject({ x: 300, y: 300 });
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(meets(chipBox(out[i]), chipBox(out[j]))).toBe(false);
  });
});

describe('hit-testing', () => {
  const items = [dim('d1', '40.00 mm', 100, 100), mark('m1', 200, 100)];
  it('finds the chip under the pointer and nothing in the gap', () => {
    expect(hitChip(items, 100, 100, false)).toBe('d1');
    expect(hitChip(items, 205, 104, false)).toBe('m1');
    expect(hitChip(items, 150, 100, false)).toBeNull();
    expect(hitChip(items, 200, 125, false)).toBeNull();
  });
  it('a finger miss by 9 px still lands in the touch layout', () => {
    expect(hitChip(items, 200, 100 + 20, false)).toBeNull();
    expect(hitChip(items, 200, 100 + 20, true)).toBe('m1');
    const b = hitBox(items[1], true);
    expect(b.w).toBe(MIN_TAP); expect(b.h).toBe(MIN_TAP);
  });
  it('the nearer centre wins where hit areas overlap', () => {
    const two = [mark('a', 100, 100), mark('b', 120, 100)];
    expect(hitChip(two, 104, 100, true)).toBe('a');
    expect(hitChip(two, 116, 100, true)).toBe('b');
  });
});

describe('hit-testing small glyph chips', () => {
  it('a desktop pointer 11 px off a 14 px chip still hits it, 13 px off does not', () => {
    const items = [mark('m', 100, 100)];
    expect(hitChip(items, 111, 100, false)).toBe('m');
    expect(hitChip(items, 113, 100, false)).toBeNull();
    expect(hitChip(items, 100, 113, true)).toBe('m');   // a finger: 22 px each way
    expect(hitChip(items, 100, 123, true)).toBeNull();
  });
  it('chips stay apart and off value chips when many pile up', () => {
    const items = [dim('d', '40 mm', 100, 100), ...Array.from({ length: 6 }, (_, i) => mark('m' + i, 100, 100))];
    const out = separateMarks(items);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(meets(chipBox(out[i]), chipBox(out[j])), `${out[i].id} ${out[j].id}`).toBe(false);
  });
});

describe('which constraint chips show', () => {
  type M = ChipItem & { refs?: string[]; blame?: string; axisLock?: boolean };
  const m = (id: string, refs: string[], extra: Partial<M> = {}): M => ({ ...mark(id, 0, 0), refs, ...extra });
  const items: M[] = [dim('d', '40 mm', 5, 5), m('h1', ['e1']), m('v1', ['e2']), m('eq', ['e3']), m('bad', ['e9'], { blame: 'conflict' }), m('lock1', ['e1'], { axisLock: true }), m('lock2', ['e2'], { axisLock: true })];
  const ids = (f: Parameters<typeof visibleChips>[1]) => visibleChips(items, f).map((i) => i.id);
  const none = new Set<string>();
  it('the modes are always, hovered or selected, off', () => { expect([...MARK_MODES]).toEqual(['always', 'hover', 'off']); });
  it('hovered or selected: nothing hovered shows only value chips and the conflicting one', () => {
    expect(ids({ mode: 'hover', focus: none })).toEqual(['d', 'bad']);
  });
  it('hovered or selected: the chips of the hovered entity show, and a rectangle side shows its lock on hover only', () => {
    expect(ids({ mode: 'hover', focus: new Set(['e1']) })).toEqual(['d', 'h1', 'bad', 'lock1']);
    expect(ids({ mode: 'hover', focus: new Set(['e3']) })).toEqual(['d', 'eq', 'bad']);
  });
  it('the hovered or selected chip itself stays', () => {
    expect(ids({ mode: 'hover', focus: none, hot: 'eq' })).toEqual(['d', 'eq', 'bad']);
    expect(ids({ mode: 'hover', focus: none, selected: 'v1' })).toEqual(['d', 'v1', 'bad']);
  });
  it('always shows every chip except the repeated rectangle locks, which wait for a hover', () => {
    expect(ids({ mode: 'always', focus: none })).toEqual(['d', 'h1', 'v1', 'eq', 'bad']);
    expect(ids({ mode: 'always', focus: new Set(['e2']) })).toEqual(['d', 'h1', 'v1', 'eq', 'bad', 'lock2']);
  });
  it('off hides every glyph chip but a conflicting one, and never a value chip', () => {
    expect(ids({ mode: 'off', focus: new Set(['e1', 'e2', 'e3']), hot: 'eq' })).toEqual(['d', 'bad']);
  });
  it('a redundant constraint shows like a conflicting one', () => {
    const r = visibleChips([m('r', ['e9'], { blame: 'redundant' })], { mode: 'hover', focus: none });
    expect(r.map((i) => i.id)).toEqual(['r']);
  });
});

describe('glyph outlines', () => {
  it('every constraint the sketch marks has an outline (the spec list included)', () => {
    for (const t of Object.keys(GLYPHS)) expect(GLYPH_PATHS[t], t).toBeTruthy();
    for (const t of ['coincident', 'horizontal', 'vertical', 'tangent', 'equal', 'parallel', 'perpendicular', 'concentric', 'fix', 'midpoint', 'symmetric']) expect(GLYPH_PATHS[t], t).toBeTruthy();
  });
});

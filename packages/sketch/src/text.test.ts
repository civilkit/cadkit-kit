import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { addText, ensureTextOutlines, patchText, pickEntity, textCacheClear, textFields, textKey, textNotes, textOutlineOf, textSpec, deleteEntity, entityShape, sketchShapes, textTool, DEFAULT_SETTINGS, sketchTools, type TextOutlineData } from './index';

const M = { shift: false, ctrl: false, alt: false };
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [], temp: [] });
afterEach(() => textCacheClear());

const outline = (x0: number, y0: number, x1: number, y1: number): TextOutlineData => ({ regions: [{ outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] }], bbox: [x0, y0, x1, y1], area: (x1 - x0) * (y1 - y0), warnings: [] });

describe('text tool', () => {
  it('a click places a text entity on a new anchor point; clicking an existing point reuses it', () => {
    let o = textTool.step(textTool.start(), { type: 'click', at: { x: 5, y: 7 }, mods: M }, empty(), DEFAULT_SETTINGS);
    expect(o.draft.entities).toHaveLength(1);
    const e = o.draft.entities[0];
    expect(e).toMatchObject({ type: 'text', string: 'TEXT', font: 'gauge', height: 5 });
    expect(o.draft.points.find((p) => p.id === e.p)).toMatchObject({ x: 5, y: 7 });
    expect((o.state as { placed?: string }).placed).toBe(e.id);
    o = textTool.step(o.state, { type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, pointId: 'O' }, mods: M }, o.draft, DEFAULT_SETTINGS);
    expect(o.draft.entities[1].p).toBe('O');
    expect(o.draft.points).toHaveLength(2);
  });
  it('is registered as a draw tool with a shortcut', () => {
    const t = sketchTools().find((x) => x.id === 'text');
    expect(t?.group).toBe('draw');
    expect(t?.key).toBeTruthy();
    expect(sketchTools().filter((x) => x.key === t?.key)).toHaveLength(1);
  });
});

describe('editing a text entity', () => {
  const base = () => addText(empty(), { x: 10, y: 20 }, { string: 'RPM' });
  it('patches fields and drops defaults; the anchor point stays', () => {
    const { draft, id } = base();
    let d = patchText(draft, id, { string: 'KNOTS', height: 8, font: 'engrave', angle: 15, spacing: 1.2, mirror: true, anchor: ['center', 'middle'] });
    expect(textFields(d, id)).toMatchObject({ string: 'KNOTS', height: 8, font: 'engrave', angle: 15, spacing: 1.2, mirror: true, anchor: ['center', 'middle'], x: 10, y: 20 });
    d = patchText(d, id, { angle: 0, spacing: 1, mirror: false });
    const e = d.entities[0];
    expect(e.angle).toBeUndefined(); expect(e.spacing).toBeUndefined(); expect(e.mirror).toBeUndefined();
    expect(d.points).toEqual(draft.points);
  });
  it('on arc: defaults, a centre point or coordinates, off again', () => {
    const { draft, id } = base();
    let d = patchText(draft, id, { arc: {} });
    expect(textFields(d, id)?.arc).toMatchObject({ radius: 30, angleCentre: 90, side: 'outside', centre: { x: 10, y: 20 } });
    d = patchText(d, id, { arc: { radius: 28, side: 'inside', centre: { x: 1, y: 2 } } });
    expect(textFields(d, id)?.arc).toMatchObject({ radius: 28, side: 'inside', centre: { x: 1, y: 2 } });
    d = patchText(d, id, { arc: { centreId: 'O' } });
    expect((d.entities[0].arc as { c: string }).c).toBe('O');
    expect(textFields(d, id)?.arc?.centre).toEqual({ x: 0, y: 0 });
    expect(patchText(d, id, { arc: false }).entities[0].arc).toBeUndefined();
  });
  it('the kernel request resolves the anchor and arc centre points', () => {
    const { draft, id } = base();
    const d = patchText(draft, id, { arc: { centreId: 'O', radius: 12 } });
    const spec = textSpec(d, d.entities[0])!;
    expect(spec.at).toEqual([10, 20]);
    expect(spec.arc).toMatchObject({ centre: [0, 0], radius: 12 });
    expect((spec.arc as Record<string, unknown>).c).toBeUndefined();
    expect(textKey(spec)).toBe(textKey(textSpec(d, d.entities[0])!));
  });
  it('deleting the entity removes its anchor point and the constraints on it', () => {
    const { draft, id } = base();
    const d = deleteEntity(draft, id);
    expect(d.entities).toHaveLength(0);
    expect(d.points.map((p) => p.id)).toEqual(['O']);
  });
});

describe('outlines: cache, picking, highlight, notes', () => {
  it('ensureTextOutlines asks once per distinct spec and calls back; errors are cached as notes', async () => {
    const { draft, id } = addText(empty(), { x: 0, y: 0 });
    const calls: unknown[] = [];
    let changed = 0;
    await ensureTextOutlines(draft, async (spec) => { calls.push(spec); return outline(0, 0, 10, 5); }, () => { changed++; });
    await ensureTextOutlines(draft, async (spec) => { calls.push(spec); return outline(0, 0, 10, 5); }, () => { changed++; });
    expect(calls).toHaveLength(1);
    expect(changed).toBe(1);
    expect(textOutlineOf(draft, draft.entities[0])).toMatchObject({ area: 50 });
    const d2 = patchText(draft, id, { string: 'x', height: 0.5 });
    await ensureTextOutlines(d2, async () => { throw new Error('textBadHeight: nope'); }, () => {});
    expect(textNotes(textOutlineOf(d2, d2.entities[0]))).toEqual([{ key: 'app.sketch.text.err.BadHeight', params: { detail: 'textBadHeight: nope' } }]);
  });
  it('picks a text by its ink box (a curve over it wins) and highlights its letters', async () => {
    const { draft, id } = addText(empty(), { x: 0, y: 0 });
    await ensureTextOutlines(draft, async () => outline(0, 0, 10, 5), () => {});
    expect(pickEntity(draft, { x: 5, y: 2 }, 1)).toBe(id);
    expect(pickEntity(draft, { x: 30, y: 30 }, 1)).toBeNull();
    expect(entityShape(draft, id)).toHaveLength(4);
  });
  it('warnings map to i18n keys', () => {
    const notes = textNotes({ ...outline(0, 0, 1, 1), warnings: [{ code: 'textTooSmall', detail: 'x' }, { code: 'textMissingGlyph', detail: '€' }, { code: 'other' }] });
    expect(notes.map((n) => n.key)).toEqual(['app.sketch.text.warn.TooSmall', 'app.sketch.text.warn.MissingGlyph']);
  });
  it('a text is a shape of its own for the extrude / cut region choice', () => {
    const { draft, id } = addText(empty(), { x: 0, y: 0 });
    expect(sketchShapes(draft as never).map((s) => [s.id, s.kind])).toEqual([[id, 'text']]);
  });
});

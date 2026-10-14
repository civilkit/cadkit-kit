import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type ToolEvent } from './types';
import { constructionTool, markNewAsConstruction, setConstruction } from './construction';
import { lineTool } from './line';
import { rectDraft } from './edit-fixtures';

const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string, shift = false): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, entityId }, mods: { ...M, shift } });
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });

describe('setConstruction', () => {
  it('sets, clears (removing the key) and toggles', () => {
    const d = rectDraft(10, 10);
    const on = setConstruction(d, ['e1'], true);
    expect(on.entities[0]).toMatchObject({ id: 'e1', construction: true });
    expect(on.entities[1]).not.toHaveProperty('construction');
    const off = setConstruction(on, ['e1'], false);
    expect(off.entities[0]).not.toHaveProperty('construction');
    expect(setConstruction(off, ['e1', 'e2'], 'toggle').entities.filter((e) => e.construction)).toHaveLength(2);
  });
  it('leaves points and unknown ids alone and does not mutate', () => {
    const d: SketchDraft = { ...rectDraft(10, 10), entities: [...rectDraft(10, 10).entities, { id: 'e9', type: 'point', p: 'p1' }] };
    const copy = JSON.stringify(d);
    const r = setConstruction(d, ['e9', 'nope'], true);
    expect(r.entities.find((e) => e.id === 'e9')).not.toHaveProperty('construction');
    expect(JSON.stringify(d)).toBe(copy);
  });
});

describe('construction mode', () => {
  it('marks only the entities a tool step added', () => {
    const d0 = rectDraft(10, 10);
    let out = lineTool.step(lineTool.start(), click(20, 20), d0, DEFAULT_SETTINGS);
    out = lineTool.step(out.state, click(30, 20), out.draft, DEFAULT_SETTINGS);
    const next = markNewAsConstruction(d0, out.draft);
    expect(next.entities.slice(0, 4).some((e) => e.construction)).toBe(false);
    expect(next.entities.slice(4)).toHaveLength(1);
    expect(next.entities[4]).toMatchObject({ type: 'line', construction: true });
  });
  it('returns the same draft when nothing was added', () => {
    const d = rectDraft(10, 10);
    expect(markNewAsConstruction(d, d)).toBe(d);
  });
});

describe('construction tool', () => {
  it('a click flips an entity both ways and the tool stays ready', () => {
    const d0 = rectDraft(10, 10);
    let o = constructionTool.step({}, clickOn('e2'), d0, DEFAULT_SETTINGS);
    expect(o.draft.entities[1].construction).toBe(true);
    o = constructionTool.step(o.state, clickOn('e2'), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.entities[1]).not.toHaveProperty('construction');
  });
  it('Shift-click flips the whole connected chain', () => {
    const o = constructionTool.step({}, clickOn('e1', true), rectDraft(10, 10), DEFAULT_SETTINGS);
    expect(o.draft.entities.filter((e) => e.construction)).toHaveLength(4);
  });
  it('a click on nothing hints; hovering previews the entity', () => {
    const d = rectDraft(10, 10);
    expect(constructionTool.step({}, click(1, 1), d, DEFAULT_SETTINGS).hint).toBe('app.sketch.hint.pickCurve');
    const mv = constructionTool.step({}, { type: 'move', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, entityId: 'e1' }, mods: M }, d, DEFAULT_SETTINGS);
    expect(mv.preview.length).toBeGreaterThan(0);
    expect(mv.draft).toBe(d);
  });
});

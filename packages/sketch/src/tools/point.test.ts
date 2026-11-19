import { describe, expect, it } from 'vitest';
import { fromFeature, type SketchDraft } from '../index';
import { pointTool, type PointState } from './point';
import { DEFAULT_SETTINGS, type ToolEvent, type ToolOutput } from './types';

const NO = { shift: false, ctrl: false, alt: false };
const base = (): SketchDraft => fromFeature({ type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [] });
function run(events: ToolEvent[], draft = base()): ToolOutput<PointState> {
  let o: ToolOutput<PointState> = { state: pointTool.start(), draft, preview: [], fields: [] };
  for (const ev of events) o = pointTool.step(o.state, ev, o.draft, DEFAULT_SETTINGS);
  return o;
}
const field = (id: string, value: number, commit = true): ToolEvent => ({ type: 'field', id, value, commit });
const tab: ToolEvent = { type: 'key', key: 'Tab' };

describe('point tool: typed hole centres', () => {
  it('a click places a free point, as before (no fields until Tab)', () => {
    const o = run([{ type: 'click', at: { x: 3, y: 4 }, mods: NO }]);
    expect(o.fields).toEqual([]);
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'point', p: 'p1' }]);
    expect(o.draft.constraints).toEqual([]);
  });

  it('Tab, x, y places the point there dimensioned from the origin, and the fields stay up for the next one', () => {
    const o = run([tab, field('x', 30), field('y', -5), field('x', -30), field('y', 0)]);
    expect(o.fields.map((f) => f.id)).toEqual(['x', 'y']);
    expect(o.draft.points.filter((p) => !p.fixed).map((p) => [p.x, p.y])).toEqual([[30, -5], [-30, 0]]);
    expect(o.draft.entities.map((e) => e.type)).toEqual(['point', 'point']);
    expect(o.draft.constraints.map((k) => [k.type, k.refs, k.value])).toEqual([
      ['hdist', ['O', 'p1'], 30], ['vdist', ['O', 'p1'], 5], ['hdist', ['O', 'p2'], 30], ['vdist', ['O', 'p2'], 0],
    ]);
  });

  it('(0, 0) is a coincident with the origin; Escape leaves typing', () => {
    const o = run([tab, field('x', 0), field('y', 0), { type: 'key', key: 'Escape' }]);
    expect(o.draft.constraints.map((k) => [k.type, k.refs])).toEqual([['coincident', ['O', 'p1']]]);
    expect(o.fields).toEqual([]);
  });

  it('a click with only X typed takes Y from the pointer and dimensions X only; a snapped existing point is reused undimensioned', () => {
    const o = run([tab, field('x', 12), { type: 'click', at: { x: 99, y: 7 }, mods: NO }]);
    expect(o.draft.points.find((p) => p.id === 'p1')).toMatchObject({ x: 12, y: 7 });
    expect(o.draft.constraints.map((k) => k.type)).toEqual(['hdist']);
    const d = { ...base(), points: [...base().points, { id: 'p9', x: 5, y: 5 }] };
    const s = run([tab, field('x', 1), { type: 'click', at: { x: 5, y: 5 }, snap: { kind: 'point', at: { x: 5, y: 5 }, pointId: 'p9' }, mods: NO } as ToolEvent], d);
    expect(s.draft.entities).toEqual([{ id: 'e1', type: 'point', p: 'p9' }]);
    expect(s.draft.constraints).toEqual([]);
  });
});

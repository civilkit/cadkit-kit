import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { breakAt, breakTool, crossings } from './break';
import { rectDraft, resolves } from './edit-fixtures';
import { sketchTools } from '../registry';

/** A 40 x 20 rectangle (e1 bottom, from (0,0) to (40,0)) plus two vertical lines crossing the bottom edge. */
function crossed(): SketchDraft {
  const d = rectDraft(40, 20);
  const pts = [...d.points, { id: 'q1', x: 10, y: -5 }, { id: 'q2', x: 10, y: 5 }, { id: 'q3', x: 30, y: -5 }, { id: 'q4', x: 30, y: 5 }];
  const ents = [...d.entities, { id: 'e90', type: 'line', p1: 'q1', p2: 'q2' }, { id: 'e91', type: 'line', p1: 'q3', p2: 'q4' }];
  return { ...d, points: pts, entities: ents };
}

describe('break', () => {
  it('is registered as an edit tool', () => {
    expect(sketchTools().find((t) => t.id === 'break')).toMatchObject({ group: 'edit' });
  });
  it('finds each crossing once', () => {
    expect(crossings(crossed(), 'e1').map((p) => p.x).sort((a, b) => a - b)).toEqual([10, 30]);
  });
  it('splits a line at every crossing: three pieces that meet end to end', () => {
    const r = breakAt(crossed(), 'e1');
    if (!r.ok) throw new Error(r.hint);
    expect(r.cuts).toBe(2);
    const bottom = r.draft.entities.filter((e) => e.type === 'line' && [e.p1, e.p2].every((id) => Math.abs(r.draft.points.find((p) => p.id === id)!.y) < 1e-9) && (r.draft.points.find((p) => p.id === e.p1)!.x <= 40));
    expect(bottom).toHaveLength(3);
    expect(resolves(r.draft)).toBe(true);
  });
  it('a curve nothing crosses is refused; a rectangle edge is only touched at its ends', () => {
    const r = breakAt(rectDraft(40, 20), 'e1');
    expect(r).toEqual({ ok: false, hint: 'app.sketch.hint.breakNone' });
  });
  it('the tool: click breaks, hover previews the crossings', () => {
    const d = crossed();
    const at = { x: 20, y: 0 };
    const env = { tol: 0.6 } as never;
    const mv = breakTool.step({}, { type: 'move', at, snap: { kind: 'entity', at, entityId: 'e1' } } as never, d, undefined as never, env);
    expect(mv.preview).toHaveLength(2);
    const ck = breakTool.step({}, { type: 'click', at, snap: { kind: 'entity', at, entityId: 'e1' } } as never, d, undefined as never, env);
    expect(ck.draft.entities.length).toBe(d.entities.length + 2);
  });
});

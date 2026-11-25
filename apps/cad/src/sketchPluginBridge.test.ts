import { describe, it, expect } from 'vitest';
import { addCurvesToDraft, draftCurves, draftPicked, previewShapes } from './sketchPluginBridge';
import type { SketchDraft } from '@kit/sketch';

const empty: SketchDraft = { id: 'F1', plane: 'front', points: [], entities: [], constraints: [], temp: [] };

describe('sketch <-> plugin curves', () => {
  it('adds lines that share corners with shared points, and reads them back', () => {
    const d = addCurvesToDraft(empty, [{ type: 'line', a: [0, 0], b: [10, 0] }, { type: 'line', a: [10, 0], b: [10, 5] }, { type: 'circle', c: [3, 3], r: 1, construction: true }]);
    expect(d.points).toHaveLength(4);
    expect(d.entities.map((e) => e.type)).toEqual(['line', 'line', 'circle']);
    const back = draftCurves(d);
    expect(back).toHaveLength(3);
    expect(back[0]).toEqual({ type: 'line', a: [0, 0], b: [10, 0] });
    expect(back[2]).toMatchObject({ type: 'circle', r: 1, construction: true });
  });
  it('keeps an arc through its middle point in either direction', () => {
    const up = draftCurves(addCurvesToDraft(empty, [{ type: 'arc', a: [1, 0], b: [-1, 0], through: [0, 1] }]))[0];
    const down = draftCurves(addCurvesToDraft(empty, [{ type: 'arc', a: [1, 0], b: [-1, 0], through: [0, -1] }]))[0];
    for (const [c, y] of [[up, 1], [down, -1]] as const) {
      expect(c.type).toBe('arc');
      if (c.type === 'arc') expect(c.through[1]).toBeCloseTo(y, 9);
    }
  });
  it('ids of the added curves come after the ones the draft has', () => {
    const d1 = addCurvesToDraft(empty, [{ type: 'line', a: [0, 0], b: [1, 0] }]);
    const d2 = addCurvesToDraft(d1, [{ type: 'line', a: [5, 5], b: [6, 5] }]);
    expect(new Set(d2.entities.map((e) => e.id)).size).toBe(2);
    expect(new Set(d2.points.map((p) => p.id)).size).toBe(4);
  });
  it('reads an arc of the draft, also one longer than a half circle, with its middle point on the arc', () => {
    // counter-clockwise from (0,-1)... centre 0, radius 1: p1 at 270 deg, p2 at 180 deg = a 270 degree sweep through 45 deg
    const d: SketchDraft = { ...empty, points: [{ id: 'c', x: 0, y: 0 }, { id: 'a', x: 0, y: -1 }, { id: 'b', x: -1, y: 0 }], entities: [{ id: 'e', type: 'arc', c: 'c', p1: 'a', p2: 'b' } as never] };
    const a = draftCurves(d)[0];
    expect(a.type).toBe('arc');
    if (a.type === 'arc') { expect(Math.hypot(a.through[0], a.through[1])).toBeCloseTo(1, 9); expect(a.through[0]).toBeGreaterThan(0); expect(a.through[1]).toBeGreaterThan(0); }
    const again = draftCurves(addCurvesToDraft(empty, [a]))[0];
    expect(again).toMatchObject({ type: 'arc', a: [0, -1], b: [-1, 0] });
  });
  it('leaves out what a plugin cannot read (a spline) and a line with a missing point', () => {
    const d: SketchDraft = { ...empty, points: [{ id: 'a', x: 0, y: 0 }], entities: [{ id: 'l', type: 'line', p1: 'a', p2: 'gone' } as never, { id: 's', type: 'spline' } as never] };
    expect(draftCurves(d)).toEqual([]);
  });
  it('previews lines and circles as they are and an arc as chords that start and end on it', () => {
    const s = previewShapes([{ type: 'line', a: [0, 0], b: [1, 0] }, { type: 'circle', c: [5, 5], r: 2 }, { type: 'arc', a: [1, 0], b: [-1, 0], through: [0, -1] }]);
    expect(s[0]).toEqual({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } });
    expect(s[1]).toEqual({ kind: 'circle', c: { x: 5, y: 5 }, r: 2 });
    const chords = s.slice(2) as Array<{ kind: 'line'; a: { x: number; y: number }; b: { x: number; y: number } }>;
    expect(chords.length).toBeGreaterThan(8);
    expect(chords[0].a).toEqual({ x: 1, y: 0 });
    expect(chords[chords.length - 1].b).toEqual({ x: -1, y: 0 });
    for (const c of chords) { expect(c.a.y).toBeLessThanOrEqual(1e-9); expect(Math.hypot(c.a.x, c.a.y)).toBeCloseTo(1, 9); }   // the lower half, on the unit circle
    for (let i = 1; i < chords.length; i++) expect(chords[i].a).toEqual(chords[i - 1].b);
  });
  it('names what is picked: curves by their place in the curve list (a spline between them is skipped), points by position', () => {
    const d: SketchDraft = { ...empty, points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 1, y: 1 }], entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' } as never, { id: 'e2', type: 'spline' } as never, { id: 'e3', type: 'line', p1: 'b', p2: 'c' } as never] };
    expect(draftPicked(d, ['e3', 'c', 'zzz'])).toEqual({ curves: [1], points: [[1, 1]] });
    expect(draftPicked(d, [])).toEqual({ curves: [], points: [] });
  });
});

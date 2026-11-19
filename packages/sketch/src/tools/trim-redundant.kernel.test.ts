import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { toFeature, type SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type ToolEvent } from './types';
import { trimTool } from './trim';

const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string, x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, entityId }, mods: M });

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function status(draft: SketchDraft) {
  const doc = { ...emptyPart('T'), features: [toFeature(draft), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth: 5, id: 'F2' }], seq: 3 } as unknown as PartDoc;
  const s = await Session.open(doc);
  sessions.push(s);
  const r = await s.preview([], { sketchStatus: true });
  return r.body!.sketches[0].status!;
}

/** Two D40 circles 60 apart joined by two R40 arcs tangent to both (the "dog bone" outline), fully dimensioned. */
function scene(off: number): SketchDraft {
  const h = Math.sqrt(60 * 60 - 30 * 30), t = (20 / 60);
  const pts = [
    { id: 'c1', x: 0, y: 0 }, { id: 'c2', x: 60, y: 0 },
    { id: 'a1', x: 30, y: h }, { id: 'b1', x: 30, y: -h },
    { id: 't1', x: 30 * t * 2 * 0.5 * 1, y: h * t }, { id: 't2', x: 60 - 30 * t, y: h * t },
    { id: 't3', x: 30 * t, y: -h * t }, { id: 't4', x: 60 - 30 * t, y: -h * t },
  ];
  pts[4].x = 30 * t; // keep explicit
  // endpoints sit within solver noise of the tangent point, on the arc, but not exactly at it
  const ac = (p: { y: number }) => ({ x: 30, y: p.y > 0 ? h : -h });
  for (const p of pts.slice(4)) { const c = ac(p); const sg = ['t1', 't4'].includes(p.id) ? -1 : 1; const a = Math.atan2(p.y - c.y, p.x - c.x) + sg * off; p.x = c.x + 40 * Math.cos(a); p.y = c.y + 40 * Math.sin(a); }
  let k = 0;
  const K = (type: string, refs: string[], extra: Record<string, unknown> = {}) => ({ id: `k${++k}`, type, refs, ...extra });
  return {
    id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points: pts,
    entities: [
      { id: 'e1', type: 'circle', c: 'c1', r: 20 }, { id: 'e2', type: 'circle', c: 'c2', r: 20 },
      { id: 'e3', type: 'arc', c: 'a1', p1: 't1', p2: 't2' },
      { id: 'e4', type: 'arc', c: 'b1', p1: 't4', p2: 't3' },
    ],
    constraints: [
      K('tangent', ['e3', 'e1']), K('tangent', ['e3', 'e2']), K('tangent', ['e4', 'e1']), K('tangent', ['e4', 'e2']),
      K('radius', ['e3'], { value: 40 }), K('radius', ['e4'], { value: 40 }),
      K('diameter', ['e1'], { value: 40 }), K('diameter', ['e2'], { value: 40 }),
    ],
  } as unknown as SketchDraft;
}

describe('trim does not add redundant relations', { skip: !process.env.CK_WASM }, () => {
  // 3e-7: the arc ends are within solver noise of the tangent contact (the cut reuses them); 3e-5: further off (the cut
  // adds its own point, which must not also be tied to the arc, since the tangent already says they touch)
  for (const off of [3e-7, 3e-5]) {
    it(`trimming the inner part of two tangent-joined circles leaves no redundancy (arc end ${off} rad past the contact)`, async () => {
      const d0 = scene(off);
      const before = await status(d0);
      expect(before.conflicts).toEqual([]);
      expect(before.redundant).toEqual([]);
      let d = d0;
      for (const [id, x, y] of [['e1', 20, 0], ['e2', 40, 0]] as const) {
        const o = trimTool.step({}, clickOn(id, x, y), d, DEFAULT_SETTINGS);
        expect(o.hint).toBeUndefined();
        d = o.draft;
      }
      expect(d.constraints.filter((k) => k.type === 'pointOnCircle')).toEqual([]);
      const after = await status(d);
      expect(after.conflicts).toEqual([]);
      expect(after.redundant).toEqual([]);
      expect(after.state).not.toBe('over');
    }, 60000);
  }

  // the arcs stop at the contact (as drawn with the 3-point arc tool ending on the tangent point): exactly there, or a
  // hair short of it as the solver leaves them. The arc then only touches the circle, so the cut is the arc's own end.
  for (const off of [0, -3e-7, -2e-6]) {
    it(`trims both circles when the tangent arcs end at the contact (arc end ${off} rad from it)`, async () => {
      const d0 = scene(off);
      let d = d0;
      for (const [id, x, y] of [['e1', 20, 0], ['e2', 40, 0]] as const) {
        const o = trimTool.step({}, clickOn(id, x, y), d, DEFAULT_SETTINGS);
        expect(o.hint).toBeUndefined();
        d = o.draft;
      }
      // one closed outline: four arcs, every end shared by exactly two of them, no circle left
      expect(d.entities.map((e) => e.type)).toEqual(['arc', 'arc', 'arc', 'arc']);
      const uses = new Map<string, number>();
      for (const e of d.entities) for (const p of [e.p1, e.p2]) uses.set(String(p), (uses.get(String(p)) ?? 0) + 1);
      expect([...uses.values()]).toEqual([2, 2, 2, 2]);
      expect(d.points.map((p) => p.id).sort()).toEqual(['a1', 'b1', 'c1', 'c2', 't1', 't2', 't3', 't4']);
      expect(d.constraints.filter((k) => k.type === 'pointOnCircle')).toEqual([]);
      // the circles kept the outer side: e1 now runs from t3 round the left to t1, e2 from t2 round the right to t4
      expect(d.entities.find((e) => e.id === 'e1')).toMatchObject({ c: 'c1', p1: 't1', p2: 't3' });
      expect(d.entities.find((e) => e.id === 'e2')).toMatchObject({ c: 'c2', p1: 't4', p2: 't2' });
      const after = await status(d);
      expect(after.conflicts).toEqual([]);
      expect(after.redundant).toEqual([]);
      expect(after.state).not.toBe('over');
    }, 60000);
  }
});

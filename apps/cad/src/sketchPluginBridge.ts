// The sketch the user has open, as a plugin sees it, and what a plugin draws into it. A plugin reads the sketch's lines, arcs and circles in the
// sketch's own 2D frame (mm) and hands back curves of the same kind; they are added to the draft like an imported DXF (one sketch-undo step).
import { mergeIntoDraft } from '@kit/io';
import type { SketchDraft } from '@kit/sketch';
import type { SketchCurveIO } from '@kit/plugin';

type P2 = [number, number];
const TAU = Math.PI * 2;
const mod = (a: number): number => ((a % TAU) + TAU) % TAU;

/** The curves of a draft a plugin can read: lines, circles and arcs (others, such as splines, are left out). */
export function draftCurves(draft: SketchDraft): SketchCurveIO[] {
  return curvesWithIds(draft).map((c) => c.curve);
}

/** The curves of draftCurves, each with the id of the draft entity it came from (so what is picked in the sketch can be named to a plugin). */
function curvesWithIds(draft: SketchDraft): Array<{ id: string; curve: SketchCurveIO }> {
  const at = new Map(draft.points.map((p) => [p.id, [p.x, p.y] as P2]));
  const all: Array<{ id: string; curve: SketchCurveIO }> = [];
  for (const e of draft.entities) {
    const out: SketchCurveIO[] = [];
    const k = e.construction ? { construction: true } : {};
    const g = (id: unknown): P2 | undefined => (typeof id === 'string' ? at.get(id) : undefined);
    if (e.type === 'line') { const a = g(e.p1), b = g(e.p2); if (a && b) out.push({ type: 'line', a, b, ...k }); }
    else if (e.type === 'circle') { const c = g(e.c); if (c && typeof e.r === 'number') out.push({ type: 'circle', c, r: e.r, ...k }); }
    else if (e.type === 'arc') {
      const c = g(e.c), a = g(e.p1), b = g(e.p2);
      if (!c || !a || !b) continue;
      const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), sweep = mod(Math.atan2(b[1] - c[1], b[0] - c[0]) - a0), r = Math.hypot(a[0] - c[0], a[1] - c[1]);
      const m = a0 + sweep / 2;
      out.push({ type: 'arc', a, b, through: [c[0] + r * Math.cos(m), c[1] + r * Math.sin(m)], ...k });
    }
    for (const c of out) all.push({ id: String(e.id), curve: c });
  }
  return all;
}

/** What is picked in the sketch (entity and point ids), as a plugin's open sketch wants it: positions in draftCurves' list, and the picked points' positions. */
export function draftPicked(draft: SketchDraft, ids: ReadonlyArray<string>): { curves: number[]; points: Array<[number, number]> } {
  const want = new Set(ids);
  const curves: number[] = [];
  curvesWithIds(draft).forEach((c, i) => { if (want.has(c.id)) curves.push(i); });
  const points = draft.points.filter((p) => want.has(p.id)).map((p) => [p.x, p.y] as [number, number]);
  return { curves, points };
}

/** Add the curves a plugin drew to the draft. Points that coincide are shared; ids are renumbered after the draft's own. */
export function addCurvesToDraft(draft: SketchDraft, adds: ReadonlyArray<SketchCurveIO>): SketchDraft {
  const points: Array<{ id: string; x: number; y: number }> = [];
  const entities: Array<Record<string, unknown> & { id: string }> = [];
  const pt = (q: P2): string => {
    const hit = points.find((p) => Math.hypot(p.x - q[0], p.y - q[1]) <= 1e-7);
    if (hit) return hit.id;
    const id = `q${points.length + 1}`; points.push({ id, x: q[0], y: q[1] }); return id;
  };
  const ent = (e: Record<string, unknown>, construction?: boolean) => entities.push({ id: `n${entities.length + 1}`, ...e, ...(construction ? { construction: true } : {}) });
  for (const c of adds) {
    if (c.type === 'line') ent({ type: 'line', p1: pt(c.a), p2: pt(c.b) }, c.construction);
    else if (c.type === 'circle') ent({ type: 'circle', c: pt(c.c), r: c.r }, c.construction);
    else {
      const [a, b, t] = [c.a, c.b, c.through];
      const d = 2 * (a[0] * (b[1] - t[1]) + b[0] * (t[1] - a[1]) + t[0] * (a[1] - b[1]));
      if (Math.abs(d) < 1e-12) { ent({ type: 'line', p1: pt(a), p2: pt(b) }, c.construction); continue; }
      const sq = (p: P2) => p[0] ** 2 + p[1] ** 2;
      const cx = (sq(a) * (b[1] - t[1]) + sq(b) * (t[1] - a[1]) + sq(t) * (a[1] - b[1])) / d, cy = (sq(a) * (t[0] - b[0]) + sq(b) * (a[0] - t[0]) + sq(t) * (b[0] - a[0])) / d;
      const ang = (p: P2) => Math.atan2(p[1] - cy, p[0] - cx);
      const ccw = mod(ang(t) - ang(a)) < mod(ang(b) - ang(a));   // counter-clockwise arcs run p1 -> p2
      const [p1, p2] = ccw ? [a, b] : [b, a];
      ent({ type: 'arc', c: pt([cx, cy]), p1: pt(p1), p2: pt(p2) }, c.construction);
    }
  }
  return mergeIntoDraft(draft, { points, entities } as never);
}

export type PreviewShape = { kind: 'line'; a: { x: number; y: number }; b: { x: number; y: number } } | { kind: 'circle'; c: { x: number; y: number }; r: number };

/** What the sketch preview draws for curves a plugin would add: lines and circles as they are, arcs as short chords. */
export function previewShapes(adds: ReadonlyArray<SketchCurveIO>): PreviewShape[] {
  const out: PreviewShape[] = [];
  const v = (p: P2) => ({ x: p[0], y: p[1] });
  for (const c of adds) {
    if (c.type === 'line') out.push({ kind: 'line', a: v(c.a), b: v(c.b) });
    else if (c.type === 'circle') out.push({ kind: 'circle', c: v(c.c), r: c.r });
    else {
      // a circle through the three points (a straight line when they are collinear), walked from a to b through the middle point
      const [a, b, t] = [c.a, c.b, c.through];
      const d = 2 * (a[0] * (b[1] - t[1]) + b[0] * (t[1] - a[1]) + t[0] * (a[1] - b[1]));
      if (Math.abs(d) < 1e-12) { out.push({ kind: 'line', a: v(a), b: v(b) }); continue; }
      const sq = (p: P2) => p[0] ** 2 + p[1] ** 2;
      const cx = (sq(a) * (b[1] - t[1]) + sq(b) * (t[1] - a[1]) + sq(t) * (a[1] - b[1])) / d, cy = (sq(a) * (t[0] - b[0]) + sq(b) * (a[0] - t[0]) + sq(t) * (b[0] - a[0])) / d;
      const ang = (p: P2) => Math.atan2(p[1] - cy, p[0] - cx), r = Math.hypot(a[0] - cx, a[1] - cy);
      const a0 = ang(a), ccw = mod(ang(t) - a0) < mod(ang(b) - a0);
      const sweep = ccw ? mod(ang(b) - a0) : -mod(a0 - ang(b));
      const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
      let prev = a;
      for (let i = 1; i <= n; i++) {
        const q: P2 = i === n ? b : [cx + r * Math.cos(a0 + (sweep * i) / n), cy + r * Math.sin(a0 + (sweep * i) / n)];
        out.push({ kind: 'line', a: v(prev), b: v(q) }); prev = q;
      }
    }
  }
  return out;
}

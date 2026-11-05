/**
 * Move, Copy, Rotate and Scale for sketch geometry.
 *
 * The maths is `applyTransform` (pure, no tool state): it moves, rotates or scales the picked entities, or makes copies of
 * them, and keeps the sketch's constraints honest:
 *   - in place: a dimension that mentions what moved is re-measured from the new geometry (a moved line keeps meaning
 *     "this long", a rotated pair keeps its angle), a `fix` follows its point, and horizontal / vertical on a line that was
 *     turned off the axes becomes parallel / perpendicular between the turned lines (swapped by a quarter turn). Relations to geometry that did not move are kept: the solver pulls the moved shape
 *     back if they say so, and the tool reports it when the solver refuses.
 *   - copies: fresh points and entities (every point of a picked entity is copied, even one shared with an unpicked
 *     entity), and the constraints that live entirely inside the picked set are copied with them (dimensions re-measured).
 *     Only constraints that still hold on the copy are copied: a `fix` never is, and for a rotation the axis-bound ones
 *     (horizontal, vertical, hdist, vdist) are copied only when the copy is a whole quarter turn from the original
 *     (swapped for an odd number of quarter turns); otherwise they would pin the copy to the axes and fight the rotation.
 *
 * The tools (move / copy / rotate / scale) share one flow: click entities (or have them selected beforehand) and press
 * Enter, click the base point (the centre for rotate), then move the pointer and click, or type the numbers:
 *   move, copy   dx and dy from the base point; copy also has `n`, the number of copies (1 by default, 99 at most)
 *   rotate       the angle in degrees (counter-clockwise positive) and `n`: 0 turns the originals, 1 or more makes copies
 *   scale        the factor and `n` (same meaning); circles and arcs scale their radius, dimensions follow
 * Escape clears typed values, then goes back a step, then drops the selection.
 */
import type { DraftConstraint, SketchDraft } from '../index';
import { entityShape } from '../select';
import { angleSpec, lineEnds } from './constraints';
import { entityOf, entityPoints, pruneDangling, ptOf, withConstraint, withEntity, withPoint } from './edit-draft';
import type { FieldSpec, Pt, PreviewShape, Tool, ToolEnv, ToolOutput, ToolSettings } from './types';

export const MAX_COPIES = 99;
const TRANSFORMABLE = new Set(['line', 'circle', 'arc', 'ellipse', 'point', 'spline', 'cvspline', 'text']);
const DIMS = new Set(['distance', 'hdist', 'vdist', 'pldist', 'radius', 'diameter', 'angle']);
const rad = (d: number) => (d * Math.PI) / 180;

export type Xform =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'rotate'; center: Pt; angleDeg: number }
  | { kind: 'scale'; base: Pt; factor: number };

export type TransformRes = { ok: true; draft: SketchDraft; created: string[] } | { ok: false; hint: string };

/** Where a point goes under step `k` of the transform (k = 1 for one application; copies use 1..n). */
export function place(x: Xform, p: Pt, k = 1): Pt {
  if (x.kind === 'move') return { x: p.x + x.dx * k, y: p.y + x.dy * k };
  if (x.kind === 'rotate') {
    const t = rad(x.angleDeg) * k, c = Math.cos(t), s = Math.sin(t);
    return { x: x.center.x + (p.x - x.center.x) * c - (p.y - x.center.y) * s, y: x.center.y + (p.x - x.center.x) * s + (p.y - x.center.y) * c };
  }
  const f = x.factor ** k;
  return { x: x.base.x + (p.x - x.base.x) * f, y: x.base.y + (p.y - x.base.y) * f };
}

const radiusScale = (x: Xform, k = 1) => (x.kind === 'scale' ? x.factor ** k : 1);

/** The distinct points the entities use, in order of first use. */
export function pointsOfEntities(draft: SketchDraft, ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) { const e = entityOf(draft, id); if (e) for (const p of entityPoints(e)) if (!out.includes(p)) out.push(p); }
  return out;
}

/** The value a dimension constraint should have on this geometry; the old value when it cannot be measured. */
export function measure(d: SketchDraft, c: DraftConstraint, old: SketchDraft): number | undefined {
  const refs = c.refs ?? [];
  const pt = (id: string) => ptOf(d, id);
  const centre = (id: string): Pt | null => {
    const p = pt(id); if (p) return p;
    const e = entityOf(d, id);
    return e && typeof e.c === 'string' ? pt(e.c) : null;
  };
  switch (c.type) {
    case 'distance': { const a = centre(refs[0]), b = centre(refs[1]); return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : undefined; }
    case 'hdist': { const a = centre(refs[0]), b = centre(refs[1]); return a && b ? Math.abs(b.x - a.x) : undefined; }
    case 'vdist': { const a = centre(refs[0]), b = centre(refs[1]); return a && b ? Math.abs(b.y - a.y) : undefined; }
    case 'pldist': {
      const p = centre(refs[0]); const ends = lineEnds(d, refs[1]);
      const a = ends && pt(ends[0]), b = ends && pt(ends[1]);
      if (!p || !a || !b) return undefined;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      return l < 1e-12 ? undefined : Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / l;
    }
    case 'radius': case 'diameter': {
      const e = entityOf(d, refs[0]);
      let r: number | undefined;
      if (e?.type === 'circle' || e?.type === 'ellipse') r = Number(e.r);
      else if (e?.type === 'arc') { const cc = pt(String(e.c)), p1 = pt(String(e.p1)); r = cc && p1 ? Math.hypot(p1.x - cc.x, p1.y - cc.y) : undefined; }
      return r === undefined ? undefined : c.type === 'diameter' ? r * 2 : r;
    }
    case 'angle': {
      const oldSpec = angleSpec(old, refs[0], refs[1]); const newSpec = angleSpec(d, refs[0], refs[1]);
      if (!oldSpec || !newSpec || typeof c.value !== 'number') return undefined;
      // keep the sign convention the constraint was written in: move its value by the change of the turn
      const turn = (dd: SketchDraft) => {
        const a = lineEnds(dd, refs[0]), b = lineEnds(dd, refs[1]);
        if (!a || !b) return NaN;
        const pa = [ptOf(dd, a[0]), ptOf(dd, a[1])], pb = [ptOf(dd, b[0]), ptOf(dd, b[1])];
        if (pa.some((q) => !q) || pb.some((q) => !q)) return NaN;
        const s1 = typeof c.s1 === 'number' ? c.s1 : 1, s2 = typeof c.s2 === 'number' ? c.s2 : 1;
        const da = { x: (pa[1]!.x - pa[0]!.x) * s1, y: (pa[1]!.y - pa[0]!.y) * s1 }, db = { x: (pb[1]!.x - pb[0]!.x) * s2, y: (pb[1]!.y - pb[0]!.y) * s2 };
        return (Math.atan2(da.x * db.y - da.y * db.x, da.x * db.x + da.y * db.y) * 180) / Math.PI;
      };
      let delta = turn(d) - turn(old);
      if (!Number.isFinite(delta)) return undefined;
      while (delta > 180) delta -= 360;
      while (delta <= -180) delta += 360;
      return c.value + delta;
    }
  }
  return undefined;
}

const rounded = (v: number) => Math.round(v * 1e9) / 1e9;

/** What an axis-bound constraint becomes on copy `k` of a transform: itself, its swapped twin, or null (do not copy). */
function axisBound(x: Xform, k: number, type: string): string | null {
  const swap: Record<string, string> = { horizontal: 'vertical', vertical: 'horizontal', hdist: 'vdist', vdist: 'hdist' };
  if (!swap[type] || x.kind !== 'rotate') return type;
  const q = (x.angleDeg * k) / 90;
  if (Math.abs(q - Math.round(q)) > 1e-9) return null;
  return Math.round(q) % 2 === 0 ? type : swap[type];
}

/** Re-measure the dimensions whose geometry changed. `touched` is the set of point ids that moved or were rescaled. */
function resettle(old: SketchDraft, d: SketchDraft, touched: Set<string>, x: Xform): SketchDraft {
  const pointsOfRef = (r: string): string[] => { const e = entityOf(d, r); return e ? entityPoints(e) : [r]; };
  const hit = (c: DraftConstraint) => (c.refs ?? []).some((r) => pointsOfRef(r).some((p) => touched.has(p)));
  const turned = x.kind === 'rotate' && Math.abs(Math.sin(rad(x.angleDeg) * 2)) > 1e-9;
  const constraints: DraftConstraint[] = [];
  // lines that were horizontal / vertical and are turned off the axes: they keep their relations to each other instead
  const wasH: string[] = [], wasV: string[] = [];
  for (const c of d.constraints) {
    if (!hit(c)) { constraints.push(c); continue; }
    if (c.type === 'fix' && Array.isArray(c.value) && c.refs?.[0]) {
      const p = ptOf(d, c.refs[0]);
      constraints.push(p ? { ...c, value: [rounded(p.x), rounded(p.y)] } : c);
      continue;
    }
    if (x.kind === 'rotate' && (c.type === 'horizontal' || c.type === 'vertical')) {
      const refs = c.refs ?? [];
      const allTurned = refs.every((r) => pointsOfRef(r).every((p) => touched.has(p)));
      if (allTurned && turned) {
        if (refs.length === 1 && entityOf(d, refs[0])?.type === 'line') (c.type === 'horizontal' ? wasH : wasV).push(refs[0]);
        continue;   // the line is no longer on an axis
      }
      if (allTurned && Math.round(x.angleDeg / 90) % 2 !== 0) { constraints.push({ ...c, type: c.type === 'horizontal' ? 'vertical' : 'horizontal' }); continue; }   // a quarter turn swaps the axes
    }
    if (DIMS.has(c.type) && typeof c.value === 'number') {
      const v = measure(d, c, old);
      constraints.push(v !== undefined && Number.isFinite(v) && (c.type === 'angle' || v > 1e-12) ? { ...c, value: rounded(v) } : c);
      continue;
    }
    constraints.push(c);
  }
  let out: SketchDraft = { ...d, constraints };
  for (const group of [wasH, wasV]) for (let i = 1; i < group.length; i++) out = withConstraint(out, 'parallel', [group[0], group[i]]);
  if (wasH.length && wasV.length) out = withConstraint(out, 'perpendicular', [wasH[0], wasV[0]]);
  return out;
}

/** Move / rotate / scale the entities in place (`copies` = 0), or leave them and make `copies` transformed copies. */
export function applyTransform(draft: SketchDraft, ids: string[], x: Xform, copies = 0): TransformRes {
  const sel = ids.filter((id) => { const e = entityOf(draft, id); return e && TRANSFORMABLE.has(String(e.type)); });
  if (!sel.length) return { ok: false, hint: 'app.sketch.hint.nothingToTransform' };
  if (copies < 0 || copies > MAX_COPIES || !Number.isInteger(copies)) return { ok: false, hint: 'app.sketch.hint.patternCount' };
  if (x.kind === 'move' && Math.hypot(x.dx, x.dy) < 1e-9 && copies === 0) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  if (x.kind === 'move' && Math.hypot(x.dx, x.dy) < 1e-9) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  if (x.kind === 'rotate' && Math.abs(x.angleDeg) < 1e-9) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  if (x.kind === 'scale' && (!(x.factor > 1e-9) || Math.abs(x.factor - 1) < 1e-12)) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  const src = pointsOfEntities(draft, sel);

  if (copies === 0) {
    const fixed = src.filter((p) => draft.points.find((q) => q.id === p)?.fixed);
    if (fixed.length) return { ok: false, hint: 'app.sketch.hint.transformFixed' };
    const moved = new Set(src);
    const points = draft.points.map((p) => { if (!moved.has(p.id)) return p; const q = place(x, p); return { ...p, x: rounded(q.x), y: rounded(q.y) }; });
    const entities = draft.entities.map((e) => (sel.includes(e.id) && (e.type === 'circle' || e.type === 'ellipse') ? { ...e, r: rounded(Number(e.r) * radiusScale(x)) } : e));
    const next = resettle(draft, { ...draft, points, entities }, moved, x);
    return { ok: true, draft: next, created: [] };
  }

  let d = draft;
  const created: string[] = [];
  const inside = new Set<string>([...sel, ...src]);
  for (let k = 1; k <= copies; k++) {
    const pm = new Map<string, string>();
    for (const pid of src) {
      const p = ptOf(draft, pid)!;
      const q = place(x, p, k);
      const added = withPoint(d, { x: rounded(q.x), y: rounded(q.y) });
      d = added.draft; pm.set(pid, added.id); created.push(added.id);
    }
    const em = new Map<string, string>();
    for (const id of sel) {
      const e = entityOf(draft, id)!;
      const { id: _id, ...rest } = e;
      const f: Record<string, unknown> = { ...rest };
      for (const key of ['c', 'p', 'p1', 'p2']) if (typeof e[key] === 'string') f[key] = pm.get(e[key] as string);
      if (Array.isArray(e.pts)) f.pts = (e.pts as string[]).map((q) => pm.get(q));
      if ((e.type === 'circle' || e.type === 'ellipse') && typeof e.r === 'number') f.r = rounded(e.r * radiusScale(x, k));
      const added = withEntity(d, f);
      d = added.draft; em.set(id, added.id); created.push(added.id);
    }
    const map = (r: string) => pm.get(r) ?? em.get(r);
    const before = d;
    for (const c of draft.constraints) {
      const refs = c.refs ?? [];
      if (c.type === 'fix' || !refs.length || !refs.every((r) => inside.has(r) && map(r))) continue;
      const type = axisBound(x, k, c.type);
      if (!type) continue;
      const { id: _cid, ...rest } = c;
      const extra: Record<string, unknown> = { ...rest };
      delete extra.refs; delete extra.type;
      if (typeof c.at === 'string') extra.at = map(c.at) ?? c.at;
      d = withConstraint(d, type, refs.map((r) => map(r)!), extra);
    }
    // dimensions of the copy are measured on the copy
    d = { ...d, constraints: d.constraints.map((c, i) => {
      if (i < before.constraints.length || !DIMS.has(c.type) || typeof c.value !== 'number') return c;
      const v = measure(d, c, d);
      return v !== undefined && Number.isFinite(v) && (c.type === 'angle' || v > 1e-12) ? { ...c, value: rounded(v) } : c;
    }) };
  }
  return { ok: true, draft: pruneDangling(d), created };
}

// ---------------------------------------------------------------- the tools

export type TransformKind = 'move' | 'copy' | 'rotate' | 'scale';
export interface TransformState {
  phase: 'select' | 'base' | 'set';
  selected: string[];
  base?: Pt;
  ptr?: Pt;
  /** number of copies */
  n: number;
  lockedX?: number; liveX?: number;   // dx / angle / factor
  lockedY?: number; liveY?: number;   // dy
  /** scale: how far the pointer was from the base at the first move (the factor is the ratio to it) */
  start?: number;
}

const toggle = (s: string[], id: string) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
const highlight = (draft: SketchDraft, ids: string[]): PreviewShape[] => ids.flatMap((id) => entityShape(draft, id) as PreviewShape[]);
const angleDeg = (a: Pt, b: Pt) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/** The transform the state describes (typed numbers win over the pointer), or null when it is not defined yet. */
export function xformOf(kind: TransformKind, s: TransformState, settings?: ToolSettings): Xform | null {
  const base = s.base;
  if (!base) return null;
  const X = s.lockedX ?? s.liveX, Y = s.lockedY ?? s.liveY;
  if (kind === 'move' || kind === 'copy') {
    const dx = X ?? (s.ptr ? s.ptr.x - base.x : undefined), dy = Y ?? (s.ptr ? s.ptr.y - base.y : undefined);
    if (dx === undefined || dy === undefined) return null;
    // near an axis the move snaps to it (like the line tool) when auto-constraints are on and nothing was typed
    if (settings?.autoConstraints && X === undefined && Y === undefined) {
      const len = Math.hypot(dx, dy);
      if (len > 1e-9 && Math.abs(dy) / len < 0.02) return { kind: 'move', dx, dy: 0 };
      if (len > 1e-9 && Math.abs(dx) / len < 0.02) return { kind: 'move', dx: 0, dy };
    }
    return { kind: 'move', dx, dy };
  }
  if (kind === 'rotate') {
    const a = X ?? (s.ptr ? angleDeg(base, s.ptr) : undefined);
    return a === undefined ? null : { kind: 'rotate', center: base, angleDeg: a };
  }
  const f = X ?? (s.ptr && s.start ? Math.hypot(s.ptr.x - base.x, s.ptr.y - base.y) / s.start : undefined);
  return f === undefined ? null : { kind: 'scale', base, factor: f };
}

function view(kind: TransformKind, state: TransformState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<TransformState> {
  let preview: PreviewShape[] = highlight(draft, state.selected);
  const fields: FieldSpec[] = [];
  if (state.phase === 'set' && state.base) {
    const x = xformOf(kind, state, settings);
    const copies = kind === 'copy' ? Math.max(1, state.n) : kind === 'move' ? 0 : state.n;
    if (x) {
      const upto = Math.max(1, copies);
      const pts = pointsOfEntities(draft, state.selected);
      for (let k = 1; k <= upto; k++) {
        const moved: SketchDraft = { ...draft, points: draft.points.map((p) => { if (!pts.includes(p.id)) return p; const q = place(x, p, k); return { ...p, x: q.x, y: q.y }; }),
          entities: draft.entities.map((e) => ((e.type === 'circle' || e.type === 'ellipse') && state.selected.includes(e.id) ? { ...e, r: Number(e.r) * radiusScale(x, k) } : e)) };
        for (const id of state.selected) preview.push(...(entityShape(moved, id) as PreviewShape[]));
      }
      preview.push({ kind: 'line', a: state.base, b: x.kind === 'move' ? { x: state.base.x + x.dx, y: state.base.y + x.dy } : (state.ptr ?? state.base) } as PreviewShape);
    }
    if (settings.onViewValues !== 'off') {
      if (kind === 'move' || kind === 'copy') {
        fields.push(
          { id: 'dx', label: 'app.sketch.field.dx', value: x && x.kind === 'move' ? x.dx : 0, locked: state.lockedX !== undefined, unit: 'length' },
          { id: 'dy', label: 'app.sketch.field.dy', value: x && x.kind === 'move' ? x.dy : 0, locked: state.lockedY !== undefined, unit: 'length' },
        );
      } else if (kind === 'rotate') fields.push({ id: 'a', label: 'app.sketch.field.angle', value: x && x.kind === 'rotate' ? x.angleDeg : 0, locked: state.lockedX !== undefined, unit: 'angle' });
      else fields.push({ id: 'f', label: 'app.sketch.field.factor', value: x && x.kind === 'scale' ? x.factor : 1, locked: state.lockedX !== undefined, unit: 'length' });
      if (kind !== 'move') fields.push({ id: 'n', label: 'app.sketch.field.copies', value: state.n, locked: false, unit: 'count' });
    }
  }
  const hintKey = hint ?? (state.phase === 'select' ? 'app.sketch.hint.transformPick' : state.phase === 'base' ? (kind === 'rotate' ? 'app.sketch.hint.rotateCenter' : 'app.sketch.hint.pickBase') : undefined);
  return { state, draft, preview, fields, ...(hintKey ? { hint: hintKey } : {}) };
}

export function makeTransformTool(kind: TransformKind): Tool<TransformState> {
  const n0 = kind === 'copy' ? 1 : 0;
  const valueIds = kind === 'move' || kind === 'copy' ? { x: 'dx', y: 'dy' } : kind === 'rotate' ? { x: 'a', y: '' } : { x: 'f', y: '' };
  return {
    id: kind,
    start: () => ({ phase: 'select', selected: [], n: n0 }),
    step(state, ev, draft, settings, env?: ToolEnv): ToolOutput<TransformState> {
      // entities selected before the tool was chosen: go straight to the base point
      if (state.phase === 'select' && !state.selected.length && env?.entities?.length) {
        const sel = env.entities.filter((id) => { const e = entityOf(draft, id); return e && TRANSFORMABLE.has(String(e.type)); });
        if (sel.length) state = { ...state, selected: sel, phase: 'base' };
      }
      const apply = (s: TransformState): ToolOutput<TransformState> => {
        const x = xformOf(kind, s, settings);
        if (!x) return view(kind, s, draft, settings, 'app.sketch.hint.patternPlace');
        const copies = kind === 'move' ? 0 : kind === 'copy' ? Math.max(1, s.n) : s.n;
        const r = applyTransform(draft, s.selected, x, copies);
        if (!r.ok) return view(kind, s, draft, settings, r.hint);
        return view(kind, { phase: 'select', selected: [], n: n0 }, r.draft, settings);
      };
      switch (ev.type) {
        case 'move': {
          if (state.phase !== 'set') return view(kind, state, draft, settings);
          const ptr = ev.snap?.at ?? ev.at;
          const start = state.start ?? (state.base ? Math.hypot(ptr.x - state.base.x, ptr.y - state.base.y) || undefined : undefined);
          return view(kind, { ...state, ptr, ...(start ? { start } : {}) }, draft, settings);
        }
        case 'click': {
          if (state.phase === 'select') {
            const id = ev.snap?.entityId;
            const e = id ? entityOf(draft, id) : undefined;
            if (!e || !TRANSFORMABLE.has(String(e.type))) return view(kind, state, draft, settings, 'app.sketch.hint.pickEntity');
            return view(kind, { ...state, selected: toggle(state.selected, e.id) }, draft, settings);
          }
          const at = ev.snap?.at ?? ev.at;
          if (state.phase === 'base') return view(kind, { ...state, phase: 'set', base: at, ptr: at }, draft, settings);
          return apply({ ...state, ptr: at });
        }
        case 'field': {
          if (state.phase !== 'set') return view(kind, state, draft, settings);
          if (ev.id === 'n') {
            if (ev.value === null || !Number.isFinite(ev.value)) return view(kind, state, draft, settings);
            const n = Math.round(ev.value);
            return n < (kind === 'copy' ? 1 : 0) || n > MAX_COPIES ? view(kind, state, draft, settings, 'app.sketch.hint.patternCount') : view(kind, { ...state, n }, draft, settings);
          }
          const slot = ev.id === valueIds.x ? 'X' : valueIds.y && ev.id === valueIds.y ? 'Y' : null;
          if (!slot) return view(kind, state, draft, settings);
          if (ev.value === null || !Number.isFinite(ev.value)) return view(kind, { ...state, [`locked${slot}`]: undefined, [`live${slot}`]: undefined }, draft, settings);
          if (kind === 'scale' && ev.value <= 0) return view(kind, state, draft, settings, 'app.sketch.hint.degenerate');
          const next = ev.commit ? { ...state, [`locked${slot}`]: ev.value, [`live${slot}`]: undefined } : { ...state, [`live${slot}`]: ev.value };
          // a move needs both numbers; a typed dx alone means "along x"
          if (ev.commit && (kind === 'move' || kind === 'copy') && (next as TransformState).lockedY === undefined && slot === 'X') return view(kind, { ...next, lockedY: next.liveY ?? 0 } as TransformState, draft, settings);
          return view(kind, next as TransformState, draft, settings);
        }
        case 'key': {
          if (ev.key === 'Enter') {
            if (state.phase === 'select') return state.selected.length ? view(kind, { ...state, phase: 'base' }, draft, settings) : view(kind, state, draft, settings, 'app.sketch.hint.nothingToTransform');
            if (state.phase === 'base') return view(kind, state, draft, settings);
            return apply(state);
          }
          if (ev.key === 'Escape') {
            if (state.lockedX !== undefined || state.liveX !== undefined || state.lockedY !== undefined || state.liveY !== undefined) return view(kind, { ...state, lockedX: undefined, liveX: undefined, lockedY: undefined, liveY: undefined }, draft, settings);
            if (state.phase === 'set') return view(kind, { ...state, phase: 'base', base: undefined, ptr: undefined, start: undefined }, draft, settings);
            if (state.phase === 'base') return view(kind, { ...state, phase: 'select' }, draft, settings);
            return view(kind, { ...state, selected: [] }, draft, settings);
          }
          return view(kind, state, draft, settings);
        }
      }
    },
  };
}

export const moveTool = makeTransformTool('move');
export const copyTool = makeTransformTool('copy');
export const rotateTool = makeTransformTool('rotate');
export const scaleTool = makeTransformTool('scale');

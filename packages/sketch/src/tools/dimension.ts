/**
 * Smart dimension. Click what to dimension; the tool decides the constraint and asks for the value:
 *   point, point        distance [p, q]        (key H or V: hdist / vdist, the horizontal or vertical part; A: aligned.
 *                                               Without a key the pointer chooses: above or below the two points' box it is horizontal,
 *                                               beside it vertical, anywhere else aligned, see `orientFromCursor`)
 *   line                distance [p1, p2]      (its length; a second click refines it, see below)
 *   point, line         pldist [point, line]   (distance to the infinite line)
 *   circle              diameter [circle]      (key R: radius instead; the `radius` state flag)
 *   arc                 radius [arc]
 *   arc, arc            distance [A, B] with `overall: true`, when the two arcs are a slot's end caps: the value is the overall
 *                       length of the slot (see slotLength.ts); any other pair of arcs starts over with the second arc
 *   line, line          angle [A, B] in degrees (the angle at their shared vertex, see `angleSpec`)
 * The value field is `value`: Enter or Tab (key) commits the default, which is the measured value; a field event
 * with `commit` commits the typed number; without `commit` it only previews. A dimension that already exists
 * for the same refs is refused with `app.sketch.hint.dimension.exists`. Escape clears the typed value, then the picks.
 *
 * Committing writes the constraint with `value` and does not move the geometry (the kernel solves on request,
 * see CONSTRAINTS.md "Solving"). A typed value far from the measured one may converge to the wrong root of an
 * `angle` (CONSTRAINTS.md), so the caller should keep dimension changes moderate or step toward the target.
 */
import type { SketchDraft } from '../index';
import { capsOverall, storedValue } from '../slotLength';
import { angleSpec, appendSpec, centerId, lineEnds, pickOf, radiusOf, refusal, xy, type Pick, type Spec } from './constraints';
import type { FieldSpec, Pt, PreviewShape, Tool, ToolOutput, ToolSettings } from './types';

export type DimOrient = 'aligned' | 'horizontal' | 'vertical';

export interface Pending {
  spec: Spec;
  measured: number;
  unit: 'length' | 'angle';
  /** i18n key of the field. */
  label: string;
  /** Geometry to show while the value is asked. */
  preview: PreviewShape[];
}

export interface DimensionState {
  picks: Pick[];
  /** Circle dimension: false = diameter (default), true = radius. */
  radius: boolean;
  orient: DimOrient;
  /** H, V or A was pressed: the pointer no longer chooses the orientation. */
  orientFixed?: boolean;
  pending?: Pending;
  /** A typed but uncommitted value (live preview only). */
  live?: number;
}

const H = 'app.sketch.hint.dimension';

/** The orientation a dimension between two points takes from where the pointer is: above or below the box the points span
 *  (and not beside it) is horizontal, beside it (and not above or below) vertical, inside it or off a corner aligned. */
export function orientFromCursor(u: Pt, v: Pt, at: Pt): DimOrient {
  const outX = at.x < Math.min(u.x, v.x) || at.x > Math.max(u.x, v.x);
  const outY = at.y < Math.min(u.y, v.y) || at.y > Math.max(u.y, v.y);
  return outY && !outX ? 'horizontal' : outX && !outY ? 'vertical' : 'aligned';
}
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** What the picks (1 or 2) measure, or a hint key when the pair is not dimensionable. */
function resolveDim(d: SketchDraft, picks: readonly Pick[], radius: boolean, orient: DimOrient): { pending: Pending } | { more: true } | { hint: string } {
  const [a, b] = picks;
  const bad = { hint: 'app.sketch.hint.pick.invalid' };
  const length = (spec: Spec, measured: number, line?: [Pt, Pt]): { pending: Pending } => ({
    pending: { spec, measured, unit: 'length', label: `app.sketch.field.${spec.type}`, preview: line ? [{ kind: 'line', a: line[0], b: line[1] }] : [] },
  });
  const twoPoints = (p: string, q: string) => {
    const [u, v] = [xy(d, p), xy(d, q)];
    if (!u || !v) return bad;
    const type = orient === 'horizontal' ? 'hdist' : orient === 'vertical' ? 'vdist' : 'distance';
    const measured = type === 'hdist' ? Math.abs(v.x - u.x) : type === 'vdist' ? Math.abs(v.y - u.y) : dist(u, v);
    return length({ type, refs: [p, q] }, measured, [u, v]);
  };
  const curve = (p: Pick) => {
    const e = d.entities.find((x) => x.id === p.id);
    const c = xy(d, String(e?.c)), r = radiusOf(d, p.id);
    if (!c || r === undefined) return bad;
    const type = p.kind === 'arc' || radius ? 'radius' : 'diameter';
    return { pending: { spec: { type, refs: [p.id] }, measured: type === 'diameter' ? 2 * r : r, unit: 'length' as const, label: `app.sketch.field.${type}`, preview: [{ kind: 'circle' as const, c, r }] } };
  };
  if (picks.length === 1) {
    if (a.kind === 'point') return { more: true };
    if (a.kind === 'line') { const e = lineEnds(d, a.id); return e ? twoPoints(e[0], e[1]) : bad; }
    return a.kind === 'circle' || a.kind === 'arc' ? curve(a) : bad;
  }
  if (a.kind === 'point' && b.kind === 'point') return twoPoints(a.id, b.id);
  if (a.kind === 'arc' && b.kind === 'arc') {
    const overall = capsOverall(d, a.id, b.id);
    const [u, v] = [xy(d, centerId(d, a.id) ?? ''), xy(d, centerId(d, b.id) ?? '')];
    if (overall === undefined || !u || !v) return bad;
    const r = length({ type: 'distance', refs: [a.id, b.id], extra: { overall: true } }, overall, [u, v]);
    return { pending: { ...r.pending, label: 'app.sketch.field.overall' } };
  }
  const pt = a.kind === 'point' ? a : b, ln = a.kind === 'line' ? a : b;
  if (pt.kind === 'point' && ln.kind === 'line') {
    const e = lineEnds(d, ln.id), p = xy(d, pt.id), p1 = e && xy(d, e[0]), p2 = e && xy(d, e[1]);
    if (!e || e.includes(pt.id) || !p || !p1 || !p2) return bad;
    const len = dist(p1, p2);
    if (len < 1e-12) return bad;
    const measured = Math.abs((p2.x - p1.x) * (p.y - p1.y) - (p2.y - p1.y) * (p.x - p1.x)) / len;
    return length({ type: 'pldist', refs: [pt.id, ln.id] }, measured);
  }
  if (a.kind === 'line' && b.kind === 'line') {
    const ang = angleSpec(d, a.id, b.id);
    if (!ang) return bad;
    return { pending: { spec: { type: 'angle', refs: [...ang.refs], ...(Object.keys(ang.extra).length ? { extra: ang.extra } : {}) }, measured: ang.measured, unit: 'angle', label: 'app.sketch.field.angle', preview: [] } };
  }
  return bad;
}

function view(state: DimensionState, draft: SketchDraft, settings: ToolSettings, hint?: string): ToolOutput<DimensionState> {
  const p = state.pending;
  const fields: FieldSpec[] = !p || settings.onViewValues === 'off' ? [] : [{ id: 'value', label: p.label, value: state.live ?? p.measured, locked: false, unit: p.unit }];
  return { state, draft, preview: p?.preview ?? [], fields, hint: hint ?? (p ? `${H}.value` : state.picks.length ? `${H}.second` : `${H}.pick`) };
}

/** Re-resolve the pending dimension from the current picks (after a pick or a mode key). */
function refresh(state: DimensionState, draft: SketchDraft, settings: ToolSettings): ToolOutput<DimensionState> {
  if (!state.picks.length) return view({ ...state, pending: undefined, live: undefined }, draft, settings);
  const r = resolveDim(draft, state.picks, state.radius, state.orient);
  if ('hint' in r) return view(state, draft, settings, r.hint);
  if ('more' in r) return view({ ...state, pending: undefined, live: undefined }, draft, settings);
  return view({ ...state, pending: r.pending }, draft, settings);
}

function commit(state: DimensionState, draft: SketchDraft, settings: ToolSettings, value: number): ToolOutput<DimensionState> {
  const p = state.pending;
  if (!p) return view(state, draft, settings);
  const bad = !Number.isFinite(value) || (p.unit === 'length' ? value <= 0 : value < 0 || value >= 360);
  if (bad) return view(state, draft, settings, `${H}.value.invalid`);
  // across a slot's caps the typed number is the overall length; the kernel is given the centre distance that makes it
  const stored = p.spec.extra?.overall === true ? storedValue(draft, { refs: p.spec.refs, overall: true }, value) : value;
  if (stored === undefined) return view(state, draft, settings, `${H}.value.invalid`);
  const spec: Spec = { ...p.spec, value: stored };
  if (refusal(draft, spec)) return view({ ...state, picks: [], pending: undefined, live: undefined }, draft, settings, `${H}.exists`);
  return view({ ...state, picks: [], pending: undefined, live: undefined }, appendSpec(draft, spec), settings);
}

export const dimensionTool: Tool<DimensionState> = {
  id: 'dimension',
  start: () => ({ picks: [], radius: false, orient: 'aligned' }),
  step(state, ev, draft, settings) {
    switch (ev.type) {
      case 'move': {
        // two points picked and no key pressed: the pointer's side of their box picks horizontal, vertical or aligned
        const [a, b] = state.picks;
        const u = a?.kind === 'point' && b?.kind === 'point' && !state.orientFixed ? xy(draft, a.id) : undefined, v = u && xy(draft, b.id);
        const orient = u && v ? orientFromCursor(u, v, ev.snap?.at ?? ev.at) : state.orient;
        return orient === state.orient ? view(state, draft, settings) : refresh({ ...state, orient, live: undefined }, draft, settings);
      }
      case 'click': {
        const pick = pickOf(draft, ev.snap);
        if (!pick) return view(state, draft, settings, 'app.sketch.hint.pick.none');
        // a finished dimension (or two picks) starts over
        const fresh0 = state.orientFixed ? state : { ...state, orient: 'aligned' as const };
        const base = state.picks.length >= 2 ? { ...fresh0, picks: [], pending: undefined, live: undefined } : fresh0;
        if (base.picks.some((p) => p.id === pick.id)) return view(state, draft, settings, 'app.sketch.hint.pick.same');
        const attempt = (picks: Pick[]) => refresh({ ...base, picks, pending: undefined, live: undefined }, draft, settings);
        // a lone circle or arc already has its dimension; a new pick starts over. A line may be refined by a second pick.
        const refining = base.picks.length === 1 && (base.picks[0].kind === 'point' || base.picks[0].kind === 'line' || (base.picks[0].kind === 'arc' && pick.kind === 'arc'));
        const invalid = (o: ToolOutput<DimensionState>) => o.hint === 'app.sketch.hint.pick.invalid';
        const next = refining ? attempt([...base.picks, pick]) : attempt([pick]);
        if (!invalid(next)) return next;
        const fresh = attempt([pick]); // the pair does not fit: try the new pick on its own
        return invalid(fresh) ? view(state, draft, settings, fresh.hint) : fresh;
      }
      case 'field': {
        if (ev.id !== 'value' || !state.pending) return view(state, draft, settings);
        if (ev.value === null || !Number.isFinite(ev.value)) return view({ ...state, live: undefined }, draft, settings);
        if (ev.commit) return commit(state, draft, settings, ev.value);
        return view({ ...state, live: ev.value }, draft, settings);
      }
      case 'key': {
        switch (ev.key) {
          case 'Enter':
          case 'Tab': return state.pending ? commit(state, draft, settings, state.live ?? state.pending.measured) : view(state, draft, settings);
          case 'Escape':
            if (state.live !== undefined) return view({ ...state, live: undefined }, draft, settings);
            return view({ ...state, picks: [], pending: undefined }, draft, settings);
          case 'r': case 'R': return refresh({ ...state, radius: !state.radius, live: undefined }, draft, settings);
          case 'h': case 'H': return refresh({ ...state, orient: 'horizontal', orientFixed: true, live: undefined }, draft, settings);
          case 'v': case 'V': return refresh({ ...state, orient: 'vertical', orientFixed: true, live: undefined }, draft, settings);
          case 'a': case 'A': return refresh({ ...state, orient: 'aligned', orientFixed: true, live: undefined }, draft, settings);
          default: return view(state, draft, settings);
        }
      }
    }
  },
};

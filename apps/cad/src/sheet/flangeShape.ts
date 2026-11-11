// Edge flange and hem: the part of the edge a flange covers (start and length, or two points), the shape of its leg (a rectangle, a sketch or an
// imported outline), the holes in the leg and the relief beside a partial flange. Pure functions of the feature's fields: each `patch*` returns the
// patch the editor's draft takes (a null removes a field). The kernel's meaning of the fields is in its docs/sheet-metal.md, stage 5.
// Every field may sit on the feature or on one of its edge picks (the pick's own value wins); the SolidWorks importer writes them on the pick.
import type { PartDoc } from '@ck/part-model';

type Wire = Record<string, unknown>;
type P2 = [number, number];
type P3 = [number, number, number];

export const SPAN_KEYS = ['start', 'length', 'from', 'to'] as const;
/** The span fields of a flange; a hem has no `length` of its own for the span (its `length` is the hem's size). */
export const spanKeys = (hem = false): readonly string[] => (hem ? ['start', 'from', 'to'] : SPAN_KEYS);
const PICK_KEYS = [...SPAN_KEYS, 'profile', 'holes', 'relief'] as const;
export type SpanMode = 'whole' | 'length' | 'points';

const isObj = (v: unknown): v is Wire => !!v && typeof v === 'object' && !Array.isArray(v);
const isPt3 = (v: unknown): v is P3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r6 = (v: number): number => +v.toFixed(6);

/** The edge picks of the feature that are objects (`{faces, at}`, `{at, from, to}`, `{role}`); roles, points and ring numbers cannot carry fields. */
const picksOf = (eff: Wire): unknown[] => (Array.isArray(eff.edges) ? (eff.edges as unknown[]) : []);
/** The one pick that carries fields of its own, when the feature has exactly one edge and it is an object (the only case the editor edits per pick). */
function soloPick(eff: Wire): Wire | null {
  const p = picksOf(eff);
  return p.length === 1 && isObj(p[0]) ? (p[0] as Wire) : null;
}
/** Where a field lives for editing: on the single pick when that pick has it, else on the feature. */
function levelOf(eff: Wire, keys: readonly string[]): 'pick' | 'feature' {
  const sp = soloPick(eff);
  return sp && keys.some((k) => sp[k] !== undefined && sp[k] !== null) ? 'pick' : 'feature';
}
/** The value of a field as the kernel reads it for the single edge: the pick's, else the feature's. */
function read(eff: Wire, key: string): unknown {
  const sp = soloPick(eff);
  const v = sp && sp[key] !== undefined && sp[key] !== null ? sp[key] : eff[key];
  return v === null ? undefined : v;
}
/** Whether any of several picks has a field of its own (the form cannot show them as one value). */
export function picksHaveOwn(eff: Wire, keys: readonly string[] = PICK_KEYS): boolean {
  const p = picksOf(eff);
  return p.length > 1 && p.some((x) => isObj(x) && keys.some((k) => (x as Wire)[k] !== undefined && (x as Wire)[k] !== null));
}

/** The patch that sets (or, with null, removes) `values` where the fields live: on the single pick when it holds any of `keys`, else on the feature.
 *  Setting a field on the feature also clears it from the pick (the pick's value would win otherwise). */
function writeFields(eff: Wire, keys: readonly string[], values: Wire): Wire {
  const sp = soloPick(eff);
  if (sp && levelOf(eff, keys) === 'pick') {
    const next: Wire = { ...sp };
    for (const [k, v] of Object.entries(values)) { if (v === null || v === undefined) delete next[k]; else next[k] = v; }
    return { edges: [next] };
  }
  const patch: Wire = { ...values };
  for (const k of Object.keys(values)) if (patch[k] === undefined) patch[k] = null;
  if (sp && keys.some((k) => k in sp)) {
    const next: Wire = { ...sp };
    for (const k of keys) delete next[k];
    patch.edges = [next];
  }
  return patch;
}
/** The patch that removes `keys` wherever they are (the feature and every pick). */
function clearFields(eff: Wire, keys: readonly string[]): Wire {
  const patch: Wire = {};
  for (const k of keys) if (eff[k] !== undefined) patch[k] = null;
  const edges = picksOf(eff);
  if (edges.some((e) => isObj(e) && keys.some((k) => k in e))) {
    patch.edges = edges.map((e) => { if (!isObj(e)) return e; const n: Wire = { ...e }; for (const k of keys) delete n[k]; return n; });
  }
  return patch;
}

// ---- the part of the edge: start and length, or two points ----

export interface SpanState {
  mode: SpanMode;
  start: unknown;
  length: unknown;
  from: P3 | null;
  to: P3 | null;
  /** Several edges each with a span of its own: the form shows none of them and offers to clear them. */
  perEdge: boolean;
}
/** The span of the flange as the form shows it. Two points win over start and length (the kernel reads them first). */
export function spanOf(eff: Wire, hem = false): SpanState {
  const from = read(eff, 'from'), to = read(eff, 'to');
  const start = read(eff, 'start'), length = hem ? undefined : read(eff, 'length');
  const points = isPt3(from) && isPt3(to);
  const mode: SpanMode = points ? 'points' : start !== undefined || length !== undefined ? 'length' : 'whole';
  return { mode, start, length, from: isPt3(from) ? from : null, to: isPt3(to) ? to : null, perEdge: picksHaveOwn(eff, spanKeys(hem)) };
}
/** A field of the span set (null removes it). */
export function patchSpan(eff: Wire, values: Partial<Record<(typeof SPAN_KEYS)[number], unknown>>, hem = false): Wire {
  return writeFields(eff, spanKeys(hem), values as Wire);
}
/** Switch the way the span is given. `whole` removes every span field; `length` keeps start and length (a first length of `fallback`) and drops the points;
 *  `points` drops start and length and keeps the points (a flange needs both, so with none the edge is whole until two are given). */
export function patchSpanMode(eff: Wire, mode: SpanMode, fallbackLength = 20, hem = false): Wire {
  const keys = spanKeys(hem);
  if (mode === 'whole') return clearFields(eff, keys);
  const cur = spanOf(eff, hem);
  if (mode === 'length') {
    const vals: Wire = { from: null, to: null };
    if (cur.start === undefined && cur.length === undefined) { if (hem) vals.start = 0; else vals.length = fallbackLength; }
    return writeFields(eff, keys, vals);
  }
  return clearFields(eff, keys.filter((k) => k === 'start' || k === 'length'));
}
/** The two points a "pick two points" gave (from then to): set on the feature or the single pick, start and length dropped. */
export function patchSpanPoints(eff: Wire, from: number[], to: number[], hem = false): Wire {
  return writeFields(eff, spanKeys(hem), { from: from.map(r6), to: to.map(r6), start: null, ...(hem ? {} : { length: null }) });
}
/** A point typed as `x, y, z` (also with semicolons or spaces); null when it is not three numbers. */
export function parsePoint(text: string): P3 | null {
  const n = text.split(/[,;\s]+/).filter(Boolean).map(Number);
  return n.length === 3 && n.every(Number.isFinite) ? (n as P3) : null;
}
export const pointText = (p: number[] | null): string => (p ? p.map((v) => +(+v).toFixed(3)).join(', ') : '');
/** The point nearest to `p` on the polyline `pts` (the picked edge), so a click beside the edge lands on it. Null with fewer than two points. */
export function nearestOnPolyline(pts: number[][], p: number[]): P3 | null {
  let best: P3 | null = null, bd = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2));
    const q: P3 = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
    const dist = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (dist < bd) { bd = dist; best = q; }
  }
  return best;
}

// ---- the shape of the leg ----

export interface Seg { line?: [P2, P2]; arc?: { center: P2; from: P2; to: P2; ccw: boolean } }
export type ProfileState =
  | { kind: 'rect' }
  | { kind: 'sketch'; sketch: string }
  | { kind: 'inline'; segs: Seg[] };
/** The leg's shape: a rectangle (no profile), the outline of a sketch, or an inline list of lines and arcs (what an import makes). */
export function profileOf(eff: Wire): ProfileState {
  const p = read(eff, 'profile');
  if (Array.isArray(p)) return { kind: 'inline', segs: p as Seg[] };
  if (isObj(p) && typeof p.sketch === 'string') return { kind: 'sketch', sketch: p.sketch };
  return { kind: 'rect' };
}
/** Back to the rectangle: the profile and its holes go (the kernel ignores holes without a profile). */
export const patchProfileRect = (eff: Wire): Wire => clearFields(eff, ['profile', 'holes']);
/** The outline of a sketch (written where the profile was, else on the feature). */
export const patchProfileSketch = (eff: Wire, sketch: string): Wire => writeFields(eff, ['profile'], { profile: { sketch } });

/** An imported outline replaced by a sketch of it: the profile names the sketch, and the holes go (their circles are in the sketch, where the kernel reads the inner loops as holes). */
export const patchProfileConvert = (eff: Wire, sketch: string): Wire => writeFields(eff, ['profile', 'holes'], { profile: { sketch }, holes: null });

/** A short description of an inline outline: its size and how many lines and arcs it has. */
export function inlineInfo(segs: Seg[]): { lines: number; arcs: number; width: number; height: number; minV: number; minH: number } {
  const b = segBounds(segs);
  return { lines: segs.filter((s) => s.line).length, arcs: segs.filter((s) => s.arc).length, width: b.maxV - b.minV, height: b.maxH - b.minH, minV: b.minV, minH: b.minH };
}
/** The box of a list of segments, arcs included (their extreme points). */
export function segBounds(segs: Seg[]): { minV: number; maxV: number; minH: number; maxH: number } {
  let minV = Infinity, maxV = -Infinity, minH = Infinity, maxH = -Infinity;
  const add = (v: number, h: number) => { minV = Math.min(minV, v); maxV = Math.max(maxV, v); minH = Math.min(minH, h); maxH = Math.max(maxH, h); };
  for (const s of segs) {
    if (s.line) { add(...s.line[0]); add(...s.line[1]); }
    if (s.arc) {
      const { center: c, from: a, to: b, ccw } = s.arc;
      add(...a); add(...b);
      const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
      const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]), a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
      const sweep = ccw ? (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) : -((((a0 - a1) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
      for (let k = 0; k < 4; k++) {
        const ang = k * Math.PI / 2;
        const rel = ccw ? (((ang - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) : -((((a0 - ang) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
        if (Math.abs(rel) < Math.abs(sweep)) add(c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang));
      }
    }
  }
  return { minV, maxV, minH, maxH };
}

// ---- holes ----

export interface HoleCircle { center: P2; radius: number }
export type Hole = { circle: HoleCircle } | { loop: Seg[] };
/** The holes of the leg as the form lists them: circles by centre and radius, anything else (a loop of segments) as a count. */
export function holesOf(eff: Wire): Array<{ kind: 'circle'; center: P2; radius: number } | { kind: 'loop'; segs: number }> {
  const h = read(eff, 'holes');
  if (!Array.isArray(h)) return [];
  return h.map((x) => {
    const c = isObj(x) && isObj(x.circle) ? x.circle : null;
    const ctr = c && Array.isArray(c.center) ? c.center : null;
    if (c && ctr && ctr.length === 2 && num(c.radius) !== null) return { kind: 'circle' as const, center: [Number(ctr[0]), Number(ctr[1])] as P2, radius: Number(c.radius) };
    return { kind: 'loop' as const, segs: Array.isArray(x) ? x.length : 0 };
  });
}
const rawHoles = (eff: Wire): unknown[] => (Array.isArray(read(eff, 'holes')) ? (read(eff, 'holes') as unknown[]) : []);
const setHoles = (eff: Wire, list: unknown[]): Wire => writeFields(eff, ['holes'], { holes: list.length ? list : null });
/** A circular hole added (default: a 6 mm hole near the lower left of the outline, `at` when given). */
export const addHole = (eff: Wire, circle: HoleCircle = { center: [10, 10], radius: 3 }): Wire => setHoles(eff, [...rawHoles(eff), { circle: { center: circle.center.map(r6), radius: r6(circle.radius) } }]);
export const removeHole = (eff: Wire, i: number): Wire => setHoles(eff, rawHoles(eff).filter((_, j) => j !== i));
/** A circular hole changed: its centre (v, h) and/or radius. A hole that is not a circle is left alone. */
export function patchHole(eff: Wire, i: number, p: { v?: number; h?: number; radius?: number }): Wire {
  return setHoles(eff, rawHoles(eff).map((x, j) => {
    if (j !== i || !isObj(x) || !isObj(x.circle)) return x;
    const c = x.circle as { center: P2; radius: number };
    return { circle: { center: [p.v ?? c.center[0], p.h ?? c.center[1]], radius: p.radius ?? c.radius } };
  }));
}

/** The circles of a sketch of the document, by id: centre and radius in the sketch's own coordinates. */
export function circlesOfSketch(doc: PartDoc | null | undefined, sketchId: unknown): Array<{ id: string; center: P2; radius: number }> {
  const s = (doc?.features ?? []).find((f) => f.id === sketchId) as unknown as { points?: Array<{ id: string; x: number; y: number }>; entities?: Array<{ id: string; type: string; c?: string; r?: number }> } | undefined;
  const pt = new Map((s?.points ?? []).map((p) => [p.id, p]));
  const out: Array<{ id: string; center: P2; radius: number }> = [];
  for (const e of s?.entities ?? []) {
    const c = e.type === 'circle' && e.c ? pt.get(e.c) : undefined;
    if (c && typeof e.r === 'number' && e.r > 0) out.push({ id: e.id, center: [c.x, c.y], radius: e.r });
  }
  return out;
}
/** The lower left corner of the outline of a sketch (the kernel measures a sketch outline from it): the box of every non-circle entity. */
export function sketchOrigin(doc: PartDoc | null | undefined, sketchId: unknown): P2 {
  const s = (doc?.features ?? []).find((f) => f.id === sketchId) as unknown as { points?: Array<{ id: string; x: number; y: number }>; entities?: Array<{ type: string; p1?: string; p2?: string; c?: string }> } | undefined;
  const pt = new Map((s?.points ?? []).map((p) => [p.id, p]));
  const xs: number[] = [], ys: number[] = [];
  for (const e of s?.entities ?? []) {
    if (e.type === 'line' || e.type === 'arc') for (const id of [e.p1, e.p2]) { const p = id ? pt.get(id) : undefined; if (p) { xs.push(p.x); ys.push(p.y); } }
  }
  return xs.length ? [Math.min(...xs), Math.min(...ys)] : [0, 0];
}
/** The box [x0, y0, x1, y1] of the lines and arcs of a sketch (an arc counts by its end points), or null with none. */
export function sketchBox(doc: PartDoc | null | undefined, sketchId: unknown): [number, number, number, number] | null {
  const s = (doc?.features ?? []).find((f) => f.id === sketchId) as unknown as { points?: Array<{ id: string; x: number; y: number }>; entities?: Array<{ type: string; p1?: string; p2?: string }> } | undefined;
  const pt = new Map((s?.points ?? []).map((p) => [p.id, p]));
  const xs: number[] = [], ys: number[] = [];
  for (const e of s?.entities ?? []) if (e.type === 'line' || e.type === 'arc') for (const id of [e.p1, e.p2]) { const p = id ? pt.get(id) : undefined; if (p) { xs.push(p.x); ys.push(p.y); } }
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null;
}
/** Circles taken from a sketch as holes of the leg: each circle's centre measured from `origin` (the outline's lower left corner). Ones already in the list are not added twice. */
export function patchHolesFromCircles(eff: Wire, circles: Array<{ center: P2; radius: number }>, origin: P2): Wire {
  const have = holesOf(eff).filter((h) => h.kind === 'circle') as Array<{ center: P2; radius: number }>;
  const fresh = circles
    .map((c) => ({ center: [r6(c.center[0] - origin[0]), r6(c.center[1] - origin[1])] as P2, radius: r6(c.radius) }))
    .filter((c) => !have.some((h) => Math.hypot(h.center[0] - c.center[0], h.center[1] - c.center[1]) < 1e-4 && Math.abs(h.radius - c.radius) < 1e-4));
  return fresh.length ? setHoles(eff, [...rawHoles(eff), ...fresh.map((c) => ({ circle: c }))]) : {};
}

// ---- relief beside a partial flange ----

export type ReliefMode = 'none' | 'rectangular' | 'custom';
export function reliefOf(eff: Wire): { mode: ReliefMode; width: unknown; depth: unknown } {
  const r = read(eff, 'relief');
  if (isObj(r)) return { mode: 'custom', width: r.width, depth: r.depth };
  return { mode: r === 'rectangular' ? 'rectangular' : 'none', width: undefined, depth: undefined };
}
/** Choose the relief: none removes the field, the rule's size is `"rectangular"`, custom starts from the sizes in `dflt` (the rule's). */
export function patchRelief(eff: Wire, mode: ReliefMode, dflt: { width: number; depth: number } = { width: 2, depth: 1 }): Wire {
  if (mode === 'none') return writeFields(eff, ['relief'], { relief: null });
  if (mode === 'rectangular') return writeFields(eff, ['relief'], { relief: 'rectangular' });
  const cur = reliefOf(eff);
  return writeFields(eff, ['relief'], { relief: { width: cur.width ?? dflt.width, depth: cur.depth ?? dflt.depth } });
}
export function patchReliefSize(eff: Wire, p: { width?: unknown; depth?: unknown }): Wire {
  const cur = reliefOf(eff);
  const next: Wire = { width: cur.width, depth: cur.depth };
  for (const [k, v] of Object.entries(p)) next[k] = v;
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null) delete next[k];
  return writeFields(eff, ['relief'], { relief: next });
}
/** Whether the flange covers only part of its edge (a span is given), so a relief beside it means something. */
export const isPartial = (eff: Wire, hem = false): boolean => spanOf(eff, hem).mode !== 'whole';

// ---- sketches for the outline ----

export interface SketchBuild { sketch: Wire; ok: true }
export interface SketchRefused { ok: false; reason: 'offsetV' | 'offsetH' | 'empty'; by: number }
const near = (a: number, b: number, e = 1e-6): boolean => Math.abs(a - b) <= e;

/** A new sketch holding the default leg: the rectangle `[0, width] x [0, height]` in the flange's own (v, h) frame, v along the flange, h outward from the height reference line. */
export function rectSketch(id: string, name: string, plane: Wire, width: number, height: number): Wire {
  const w = r6(width), h = r6(height);
  return {
    type: 'sketch', id, name, plane,
    points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: w, y: 0 }, { id: 'p3', x: w, y: h }, { id: 'p4', x: 0, y: h }],
    entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'e4', type: 'line', p1: 'p4', p2: 'p1' }],
    constraints: [],
  };
}

/** Consecutive lines that run straight on through a corner at height `h` become one line. */
function mergeCollinear(segs: Seg[], h: number): Seg[] {
  const out: Seg[] = [];
  const n = segs.length;
  const at = (s: Seg | undefined) => s?.line;
  const joins = (a: Seg | undefined, b: Seg | undefined): boolean => {
    const [l, m] = [at(a), at(b)];
    if (!l || !m || !near(l[1][0], m[0][0]) || !near(l[1][1], m[0][1]) || !near(l[1][1], h)) return false;
    const d1 = [l[1][0] - l[0][0], l[1][1] - l[0][1]], d2 = [m[1][0] - m[0][0], m[1][1] - m[0][1]];
    return Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-9 * (Math.hypot(...d1) * Math.hypot(...d2) || 1) && d1[0] * d2[0] + d1[1] * d2[1] > 0;
  };
  const used = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    let cur = segs[i];
    const nextI = (i + 1) % n;
    if (joins(cur, segs[nextI]) && !used[nextI] && nextI !== i) { cur = { line: [cur.line![0], segs[nextI].line![1]] }; used[nextI] = true; }
    out.push(cur);
  }
  // a join across the end of the list (the loop's first segment continues the last)
  const last = out[out.length - 1];
  if (out.length > 1 && joins(last, out[0])) { out[0] = { line: [last.line![0], out[0].line![1]] }; out.pop(); }
  return out;
}

/** An inline outline (and its holes) as a sketch in the same (v, h) coordinates. The kernel measures a sketch outline from the lower left corner of its box,
 *  an inline one from the bend line, so an outline that starts above the bend line (the end of the bend, the setback) is carried down to it through its
 *  straight bottom edge (the kernel takes the part below the end of the bend as the bend, so the leg is the same). An outline that would still move
 *  (it starts beside the start of the flange, or its bottom is not a straight edge along it) is refused, with the distance. */
export function sketchFromProfile(id: string, name: string, plane: Wire, segs: Seg[], holes: unknown[] = []): SketchBuild | SketchRefused {
  if (!segs.length) return { ok: false, reason: 'empty', by: 0 };
  const eps = 1e-6;
  const b0 = segBounds(segs);
  let list: Seg[] = segs;
  if (b0.minH > eps) {
    const bottom = list.filter((s) => s.line && near(s.line[0][1], b0.minH) && near(s.line[1][1], b0.minH));
    if (!bottom.length) return { ok: false, reason: 'offsetH', by: r6(b0.minH) };
    list = list.flatMap((s): Seg[] => {
      if (!bottom.includes(s)) return [s];
      const [a, b] = s.line!;
      return [{ line: [a, [a[0], 0]] }, { line: [[a[0], 0], [b[0], 0]] }, { line: [[b[0], 0], b] }];
    });
    // a corner on the bend line would sit exactly on the line the kernel cuts the outline at: join the straight runs through it
    list = mergeCollinear(list, b0.minH);
  }
  const b = segBounds(list);
  if (Math.abs(b.minV) > eps) return { ok: false, reason: 'offsetV', by: r6(b.minV) };
  const pts: Array<{ id: string; x: number; y: number; fixed?: boolean }> = [{ id: 'O', x: 0, y: 0, fixed: true }];
  const at = (p: P2): string => {
    const hit = pts.find((q) => q.id !== 'O' && near(q.x, p[0], 1e-7) && near(q.y, p[1], 1e-7));
    if (hit) return hit.id;
    const pid = 'p' + (pts.length);
    pts.push({ id: pid, x: r6(p[0]), y: r6(p[1]) });
    return pid;
  };
  const ents: Wire[] = [];
  let n = 0;
  const eid = () => 'e' + (++n);
  for (const s of list) {
    if (s.line) {
      const [a, c] = s.line;
      if (Math.hypot(a[0] - c[0], a[1] - c[1]) < eps) continue;
      ents.push({ id: eid(), type: 'line', p1: at(a), p2: at(c) });
    } else if (s.arc) {
      const { center, from, to, ccw } = s.arc;
      const cid = at(center);
      // a sketch arc runs anticlockwise from its first point to its second
      ents.push({ id: eid(), type: 'arc', c: cid, p1: ccw ? at(from) : at(to), p2: ccw ? at(to) : at(from) });
    }
  }
  for (const h of holes) {
    const c = (h as { circle?: HoleCircle }).circle;
    if (c) ents.push({ id: eid(), type: 'circle', c: at(c.center), r: r6(c.radius) });
    else if (Array.isArray(h)) {
      // a loop hole: its segments as lines of their own (arcs sampled by their ends are not kept)
      for (const s of h as Seg[]) if (s.line) ents.push({ id: eid(), type: 'line', p1: at(s.line[0]), p2: at(s.line[1]) });
    }
  }
  return { ok: true, sketch: { type: 'sketch', id, name, plane, points: pts, entities: ents, constraints: [] } };
}

// ---- the plane of a sketch in the flange's frame ----

type V3 = [number, number, number];
const sub3 = (a: number[], b: number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a: number[]): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The flange's (v, h) frame in the world: where v = 0, h = 0 is, the unit vectors of v (along the flange) and h (outward), and the two ends of the span on the edge. */
export interface LegFrame { origin: V3; v: V3; h: V3; from: V3; to: V3; width: number }
/** The frame from a built leg: `leg` is the vertices of its flat face, `normal` that face's normal, `tipNormal` the normal of the end wall (the direction the
 *  leg points away from the bend), `height` the flange height (the end wall is at h = height). `v` follows `vHint` (from the first span point to the second) when given.
 *  A shaped leg has no end wall (`tipNormal` null): with `vHint` and `anchor` (a point of the span on the edge) h is found from the leg's plane instead, and the highest point
 *  of the leg stands for h = height. Null when the leg has no extent. */
export function legFrame(leg: number[][], normal: number[], tipNormal: number[] | null, height: number, vHint?: number[] | null, anchor?: number[] | null): LegFrame | null {
  if (leg.length < 3) return null;
  let h: V3;
  if (tipNormal) h = unit3(tipNormal);
  else if (vHint && anchor) {
    // a shaped leg has no end wall of its own: h is square to the way the span runs, in the plane of the leg, pointing from the point on the edge into the leg
    const c = leg.reduce((a, p) => [a[0] + p[0] / leg.length, a[1] + p[1] / leg.length, a[2] + p[2] / leg.length], [0, 0, 0]);
    const raw = unit3(cross3(normal, vHint));
    h = dot3(raw, sub3(c, anchor)) < 0 ? [-raw[0], -raw[1], -raw[2]] : raw;
  } else return null;
  let v = unit3(cross3(h, normal));
  if (Math.hypot(...v) < 0.5) return null;
  if (vHint && dot3(v, vHint) < 0) v = [-v[0], -v[1], -v[2]];
  const c0 = leg[0];
  const vs = leg.map((p) => dot3(sub3(p, c0), v)), hs = leg.map((p) => dot3(sub3(p, c0), h));
  const [vmin, vmax, hmax] = [Math.min(...vs), Math.max(...vs), Math.max(...hs)];
  if (!(vmax - vmin > 1e-9)) return null;
  // the point of the leg's tip line at v = vmin, then down by the height to the reference line
  const tip: V3 = [c0[0] + v[0] * vmin + h[0] * hmax, c0[1] + v[1] * vmin + h[1] * hmax, c0[2] + v[2] * vmin + h[2] * hmax];
  const origin: V3 = [tip[0] - h[0] * height, tip[1] - h[1] * height, tip[2] - h[2] * height];
  const to: V3 = [tip[0] + v[0] * (vmax - vmin), tip[1] + v[1] * (vmax - vmin), tip[2] + v[2] * (vmax - vmin)];
  return { origin, v, h, from: tip, to, width: vmax - vmin };
}
/** The frame of a leg re-anchored to a span given by its points: v runs from `from` towards `to` (the leg's own frame may run the other way). */
export function legFrameAt(f: LegFrame, from: number[], to: number[]): LegFrame {
  const d = unit3(sub3(to, from));
  const flipped = dot3(d, f.v) < 0;
  return flipped ? flipFrame(f) : f;
}
/** The frame seen from the other end of the span: v runs the other way, from where it ended. */
export function flipFrame(f: LegFrame): LegFrame {
  const o: V3 = [f.origin[0] + f.v[0] * f.width, f.origin[1] + f.v[1] * f.width, f.origin[2] + f.v[2] * f.width];
  return { origin: o, v: [-f.v[0], -f.v[1], -f.v[2]], h: f.h, from: f.to, to: f.from, width: f.width };
}
/** Segments (an outline or a loop hole) mirrored across the middle of a span of `length`: v becomes `length - v`, arcs turn the other way. */
export function mirrorSegs(segs: Seg[], length: number): Seg[] {
  const m = (p: P2): P2 => [length - p[0], p[1]];
  return segs.map((s) => (s.line ? { line: [m(s.line[0]), m(s.line[1])] as [P2, P2] } : { arc: { center: m(s.arc!.center), from: m(s.arc!.from), to: m(s.arc!.to), ccw: !s.arc!.ccw } }));
}
/** Holes (circles, or loops of segments) mirrored the same way. */
export function mirrorHoles(holes: unknown[], length: number): unknown[] {
  return holes.map((h) => {
    if (isObj(h) && isObj(h.circle)) { const c = h.circle as { center: P2; radius: number }; return { circle: { center: [length - c.center[0], c.center[1]], radius: c.radius } }; }
    return Array.isArray(h) ? mirrorSegs(h as Seg[], length) : h;
  });
}
/** The reference plane feature (`frame` mode) that puts a sketch's x on v and y on h. */
export const framePlane = (id: string, name: string, f: LegFrame): Wire => ({ type: 'plane', id, name, mode: 'frame', origin: f.origin.map(r6), xDir: f.v.map(r6), yDir: f.h.map(r6) });

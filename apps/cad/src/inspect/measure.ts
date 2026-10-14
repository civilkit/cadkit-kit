// The Measure tool: turns one or two picked vertices / edges / faces into labelled results and the leaders to draw.
// Vertices and edges are measured here from the polylines the view already has; anything that involves a face asks the
// kernel's `measure` request (exact on the analytic surface), and a vertex against a face uses the face's triangles.
import { parseVertexName } from '@kit/store';
import {
  angleDeg, dist, facePlane, faceAreaFromMesh, lineAngleDeg, pointFace, pointPolyline, polylineLength, polylinePolyline, sub,
  type FaceMesh, type V3,
} from './geometry';

export interface EdgeInfo { key?: string; faces?: string[]; mid?: number[]; pts?: number[][]; line?: boolean; circle?: { c: number[]; n: number[]; r: number } }

export type Pick =
  | { kind: 'vertex'; name: string; p: V3 }
  | { kind: 'edge'; name: string; edge: EdgeInfo }
  | { kind: 'face'; name: string };

/** What a selection name refers to in the body on screen; null for a name that is none of these. */
export function resolvePick(name: string, edges: EdgeInfo[]): Pick | null {
  const v = parseVertexName(name);
  if (v && v.length === 3 && v.every(Number.isFinite)) return { kind: 'vertex', name, p: v };
  if (name.includes('|')) {
    const e = edges.find((x) => x.key === name);
    return e ? { kind: 'edge', name, edge: e } : null;
  }
  return name ? { kind: 'face', name } : null;
}

export type Unit = 'mm' | 'mm2' | 'deg' | 'text';
/** One line of the result. `id` selects the label (`measure.<id>`); a vector value is a point or a displacement. */
export interface Row { id: string; value: number | V3 | string; unit: Unit }
/** A leader drawn in the 3D view: a line from a to b with the text at its middle. */
export interface Mark { a: V3; b: V3; text: string }
export interface Outcome { rows: Row[]; marks: Mark[]; /** the surface kind of a single face ("plane", "cylinder" ...) */ surface?: string; error?: string }

/** The kernel's `measure` reply (the part that is used). */
export interface KernelMeasure {
  items?: Array<{ kind?: string; surface?: string; area?: number; length?: number; radius?: number; center?: number[]; axis?: number[]; normal?: number[] }>;
  distance?: number; points?: number[][]; angle?: number; normalDistance?: number; centerDistance?: number;
}
export interface MeasureCtx {
  edges: EdgeInfo[];
  mesh: FaceMesh | null;
  /** Asks the kernel; null when it cannot answer (no document, error). */
  kernel(refs: Array<Record<string, unknown>>): Promise<KernelMeasure | null>;
}

/** Number text for results: up to `digits` decimals, no trailing zeros, no "-0". */
export function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return String(v);
  const s = v.toFixed(digits).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

const UNIT_TEXT: Record<Unit, string> = { mm: ' mm', mm2: ' mm²', deg: '°', text: '' };
export function rowText(r: Row): string {
  if (typeof r.value === 'string') return r.value;
  if (Array.isArray(r.value)) return `(${r.value.map((x) => fmt(x)).join(', ')})`;
  return fmt(r.value) + UNIT_TEXT[r.unit];
}

const pts = (e: EdgeInfo): V3[] => e.pts ?? [];
const row = (id: string, value: Row['value'], unit: Unit): Row => ({ id, value, unit });
const leader = (a: V3, b: V3, text?: string): Mark => ({ a, b, text: text ?? `${fmt(dist(a, b), 3)}` });

function edgeRows(e: EdgeInfo): { rows: Row[]; marks: Mark[] } {
  const p = pts(e);
  const rows: Row[] = [row('length', circleLength(e) ?? polylineLength(p), 'mm')];
  const marks: Mark[] = [];
  if (e.circle) {
    rows.push(row('radius', e.circle.r, 'mm'), row('diameter', 2 * e.circle.r, 'mm'), row('center', e.circle.c, 'text'));
    const at = e.mid ?? p[0];
    if (at) marks.push({ a: e.circle.c, b: at, text: `R${fmt(e.circle.r, 3)}` });
  } else if (p.length >= 2) marks.push(leader(p[0], p[p.length - 1], `${fmt(polylineLength(p), 3)}`));
  return { rows, marks };
}
/** A full circle's length is exact; for an arc the polyline length is used (the polyline is fine enough for a display value). */
function circleLength(e: EdgeInfo): number | null {
  const p = pts(e);
  if (!e.circle || p.length < 2) return null;
  const closed = dist(p[0], p[p.length - 1]) < 1e-6 * Math.max(1, e.circle.r);
  return closed ? 2 * Math.PI * e.circle.r : null;
}

const dirOf = (e: EdgeInfo): V3 | null => {
  const p = pts(e);
  if (e.circle || p.length < 2) return null;
  const straight = e.line === true || p.length === 2;
  return straight ? sub(p[p.length - 1], p[0]) : null;
};

function pairRows(c: { d: number; a: V3; b: V3 }): { rows: Row[]; marks: Mark[] } {
  const rows = [row('distance', c.d, 'mm')];
  const dv = sub(c.b, c.a);
  if (c.d > 1e-9) rows.push(row('delta', dv.map(Math.abs), 'text'));
  return { rows, marks: [leader(c.a, c.b)] };
}

/** Everything local (no kernel): vertex, edge, vertex+vertex, vertex+edge, edge+edge. Null when a face is involved. */
export function measureLocal(picks: Pick[]): Outcome | null {
  if (picks.some((p) => p.kind === 'face')) return null;
  if (picks.length === 0) return { rows: [], marks: [] };
  if (picks.length === 1) {
    const a = picks[0];
    if (a.kind === 'vertex') return { rows: [row('position', a.p, 'text')], marks: [] };
    if (a.kind === 'edge') return edgeRows(a.edge);
    return null;
  }
  const [a, b] = picks;
  if (a.kind === 'vertex' && b.kind === 'vertex') {
    const o = pairRows({ d: dist(a.p, b.p), a: a.p, b: b.p });
    return o;
  }
  if (a.kind === 'vertex' && b.kind === 'edge') return pairRows(pointPolyline(a.p, pts(b.edge)));
  if (a.kind === 'edge' && b.kind === 'vertex') { const c = pointPolyline(b.p, pts(a.edge)); return pairRows({ d: c.d, a: c.b, b: c.a }); }
  if (a.kind === 'edge' && b.kind === 'edge') {
    const o = pairRows(polylinePolyline(pts(a.edge), pts(b.edge)));
    const u = dirOf(a.edge), v = dirOf(b.edge);
    if (u && v) o.rows.push(row('angle', lineAngleDeg(u, v), 'deg'));
    if (a.edge.circle && b.edge.circle) {
      const cd = dist(a.edge.circle.c, b.edge.circle.c);
      o.rows.push(row('centerDistance', cd, 'mm'));
      if (angleDeg(a.edge.circle.n, b.edge.circle.n) < 90.0001) o.rows.push(row('angle', lineAngleDeg(a.edge.circle.n, b.edge.circle.n), 'deg'));
      o.marks.push(leader(a.edge.circle.c, b.edge.circle.c, `${fmt(cd, 3)}`));
    }
    return o;
  }
  return null;
}

const refOf = (p: Pick): Record<string, unknown> | null =>
  p.kind === 'face' ? { kind: 'face', id: p.name }
    : p.kind === 'edge' && p.edge.faces && p.edge.mid ? { kind: 'edge', faces: p.edge.faces, at: p.edge.mid }
      : null;

function fromKernel(r: KernelMeasure, picks: Pick[]): Outcome {
  const rows: Row[] = [];
  const marks: Mark[] = [];
  const items = r.items ?? [];
  if (items.length === 1) {
    const it = items[0];
    if (it.area !== undefined) rows.push(row('area', it.area, 'mm2'));
    if (it.length !== undefined) rows.push(row('length', it.length, 'mm'));
    if (it.radius !== undefined) rows.push(row('radius', it.radius, 'mm'), row('diameter', 2 * it.radius, 'mm'));
    if (it.center) rows.push(row('center', it.center, 'text'));
  } else {
    items.forEach((it, i) => {
      const tag = String.fromCharCode(65 + i);
      if (it.area !== undefined) rows.push(row(`area${tag}`, it.area, 'mm2'));
      if (it.length !== undefined) rows.push(row(`length${tag}`, it.length, 'mm'));
      if (it.radius !== undefined) rows.push(row(`radius${tag}`, it.radius, 'mm'));
    });
  }
  if (r.distance !== undefined) rows.push(row('distance', r.distance, 'mm'));
  if (r.normalDistance !== undefined && r.normalDistance !== null) rows.push(row('normalDistance', r.normalDistance, 'mm'));
  if (r.centerDistance !== undefined) rows.push(row('centerDistance', r.centerDistance, 'mm'));
  if (r.angle !== undefined && r.angle !== null) rows.push(row('angle', toDeg(r.angle), 'deg'));
  if (r.points && r.points.length === 2 && r.distance !== undefined && r.distance > 1e-9) marks.push(leader(r.points[0], r.points[1], fmt(r.distance, 3)));
  const surface = items.length === 1 && picks[0].kind === 'face' ? items[0].surface : undefined;
  return { rows, marks, ...(surface ? { surface } : {}) };
}
/** The kernel reports angles in radians. */
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Measure the picks (at most two are used). Never throws. */
export async function measure(picks: Pick[], ctx: MeasureCtx): Promise<Outcome> {
  const used = picks.slice(0, 2);
  const local = measureLocal(used);
  if (local) return local;
  // vertex against face: the face's triangles
  if (used.length === 2 && used.some((p) => p.kind === 'vertex')) {
    const v = used.find((p) => p.kind === 'vertex') as Extract<Pick, { kind: 'vertex' }>;
    const f = used.find((p) => p.kind === 'face') as Extract<Pick, { kind: 'face' }> | undefined;
    if (f && ctx.mesh) {
      const c = pointFace(v.p, ctx.mesh, f.name);
      if (c) {
        const o = pairRows(c);
        const pl = facePlane(ctx.mesh, f.name);
        if (pl?.flat) o.rows.push(row('normalDistance', Math.abs(sub(v.p, pl.point).reduce((s, x, i) => s + x * pl.normal[i], 0)), 'mm'));
        return o;
      }
    }
    return { rows: [], marks: [], error: 'unavailable' };
  }
  const refs = used.map(refOf);
  if (refs.some((r) => !r)) return { rows: [], marks: [], error: 'unavailable' };
  let reply: KernelMeasure | null = null;
  try { reply = await ctx.kernel(refs as Array<Record<string, unknown>>); } catch { reply = null; }
  if (reply && reply.items && reply.items.length) return fromKernel(reply, used);
  // no kernel answer: a single face still has an area from its triangles
  if (used.length === 1 && used[0].kind === 'face' && ctx.mesh) {
    return { rows: [row('area', faceAreaFromMesh(ctx.mesh, used[0].name), 'mm2')], marks: [] };
  }
  return { rows: [], marks: [], error: 'unavailable' };
}

/** The result as text to copy: one `label<TAB>value` line per row, labels given by the caller. */
export function copyText(rows: Row[], label: (id: string) => string): string {
  return rows.map((r) => `${label(r.id)}\t${rowText(r)}`).join('\n');
}


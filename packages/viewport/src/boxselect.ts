// Window / crossing box selection in the 3D view. Pure: positions are projected to screen by the caller, so this is
// testable without a camera. Window = the whole item is inside the box; crossing = the item touches the box.
import type { Grouped } from './meshgeom';

export interface ScreenRect { x0: number; y0: number; x1: number; y1: number }
/** Projects a world point to screen pixels; null when it is behind the camera. */
export type Project = (p: number[]) => [number, number] | null;

export interface BoxInput {
  rect: ScreenRect;
  crossing: boolean;
  project: Project;
  mode: 'face' | 'edge' | 'vertex' | 'body';
  grouped: Grouped | null;
  edges: Array<{ key?: string; pts: number[][] }>;
  /** body name -> its face names */
  bodies: Array<{ name: string; faces: string[] }>;
  /** the name a corner gets (the store's vertexName) */
  vertexName(p: number[]): string;
}

export const normRect = (r: ScreenRect): ScreenRect => ({ x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) });
const inside = (r: ScreenRect, x: number, y: number): boolean => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** Whether the segment a-b touches the rectangle (Liang-Barsky clip). */
export function segmentHitsRect(r: ScreenRect, ax: number, ay: number, bx: number, by: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, ax - r.x0) && clip(dx, r.x1 - ax) && clip(-dy, ay - r.y0) && clip(dy, r.y1 - ay);
}

const sign = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => (px - bx) * (ay - by) - (ax - bx) * (py - by);
function pointInTri(px: number, py: number, a: number[], b: number[], c: number[]): boolean {
  const d1 = sign(px, py, a[0], a[1], b[0], b[1]), d2 = sign(px, py, b[0], b[1], c[0], c[1]), d3 = sign(px, py, c[0], c[1], a[0], a[1]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
/** Whether the screen triangle overlaps the rectangle at all. */
export function triangleHitsRect(r: ScreenRect, a: number[], b: number[], c: number[]): boolean {
  if (inside(r, a[0], a[1]) || inside(r, b[0], b[1]) || inside(r, c[0], c[1])) return true;
  if (segmentHitsRect(r, a[0], a[1], b[0], b[1]) || segmentHitsRect(r, b[0], b[1], c[0], c[1]) || segmentHitsRect(r, c[0], c[1], a[0], a[1])) return true;
  return pointInTri(r.x0, r.y0, a, b, c);   // the box lies wholly inside the triangle
}

/** Per face: 'in' when every triangle is inside the rect, 'touch' when any touches it, absent otherwise. */
function faceHits(inp: BoxInput, rect: ScreenRect): Map<string, 'in' | 'touch'> {
  const out = new Map<string, 'in' | 'touch'>();
  const g = inp.grouped;
  if (!g) return out;
  const P = g.positions;
  for (const r of g.ranges) {
    let all = true, any = false;
    for (let v = r.start; v + 2 < r.start + r.count; v += 3) {
      const s: Array<[number, number] | null> = [0, 1, 2].map((k) => inp.project([P[(v + k) * 3], P[(v + k) * 3 + 1], P[(v + k) * 3 + 2]]));
      if (s.some((x) => x === null)) { all = false; continue; }   // a triangle behind the camera is neither wholly inside nor drawn
      const [a, b, c] = s as Array<[number, number]>;
      if (!(inside(rect, a[0], a[1]) && inside(rect, b[0], b[1]) && inside(rect, c[0], c[1]))) all = false;
      if (!any && triangleHitsRect(rect, a, b, c)) any = true;
      if (!all && any) { if (inp.crossing) break; }
    }
    const prev = out.get(r.name);
    // a face can be split over several ranges: it is 'in' only when all its ranges are
    if (all && any) out.set(r.name, prev === 'touch' ? 'touch' : 'in');
    else if (any) out.set(r.name, 'touch');
    else if (prev === 'in') out.set(r.name, 'touch');
  }
  return out;
}

/** The names a box picks in the current mode. */
export function boxPick(inp: BoxInput): string[] {
  const rect = normRect(inp.rect);
  const want = (h: 'in' | 'touch' | undefined): boolean => (inp.crossing ? h !== undefined : h === 'in');
  if (inp.mode === 'face' || inp.mode === 'body') {
    const hits = faceHits(inp, rect);
    if (inp.mode === 'face') return [...hits].filter(([, h]) => want(h)).map(([n]) => n);
    return inp.bodies.filter((b) => {
      const hs = b.faces.map((f) => hits.get(f));
      return inp.crossing ? hs.some((h) => h !== undefined) : hs.length > 0 && hs.every((h) => h === 'in');
    }).map((b) => b.name);
  }
  if (inp.mode === 'vertex') {
    const out = new Set<string>();
    for (const e of inp.edges) for (const p of [e.pts[0], e.pts[e.pts.length - 1]]) {
      if (!p) continue;
      const s = inp.project(p);
      if (s && inside(rect, s[0], s[1])) out.add(inp.vertexName(p));
    }
    return [...out];
  }
  const out: string[] = [];
  inp.edges.forEach((e, i) => {
    const s = e.pts.map((p) => inp.project(p));
    let hit: boolean;
    if (inp.crossing) {
      hit = s.some((q) => q && inside(rect, q[0], q[1]));
      for (let j = 0; !hit && j + 1 < s.length; j++) { const a = s[j], b = s[j + 1]; if (a && b && segmentHitsRect(rect, a[0], a[1], b[0], b[1])) hit = true; }
    } else hit = s.length > 0 && s.every((q) => q && inside(rect, q[0], q[1]));
    if (hit) out.push(e.key ?? `edge#${i}`);
  });
  return out;
}

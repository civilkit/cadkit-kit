/** Dimension drawings on screen: the pure part. `projectShape` turns a dimension's geometry (sketch coordinates, see
 *  `DimShape` in @kit/sketch) into pixels with the viewport's projection; `SketchAnnotations` draws the result as SVG. */
import type { DimShape } from '@kit/sketch';
import { chipSize } from './annotChips';

export type ToScreen = (u: number, v: number) => { x: number; y: number } | null;
export interface ScreenDim {
  /** Straight segments: x1, y1, x2, y2. */
  lines: Array<[number, number, number, number]>;
  /** A polyline (an angle's arc) as `x,y` pairs, or empty. */
  arc: Array<[number, number]>;
  /** Arrowheads: tip x, y and the unit direction on screen. */
  arrows: Array<[number, number, number, number]>;
  /** Where the label sits, and the reading angle of its text in degrees (-90..90). */
  text: { x: number; y: number; slopeDeg: number };
  /** The dimension line itself (for the label gap), or null. */
  main: [number, number, number, number] | null;
}

const norm = (dx: number, dy: number): [number, number] => { const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
const readable = (deg: number): number => { let a = deg; while (a > 90 + 1e-9) a -= 180; while (a <= -90 - 1e-9) a += 180; return a; };

export interface ProjectOptions {
  /** The label sits beyond the end of the dimension line (a segment too short for it): arrowheads point inward from outside, the line runs on past both ends and a short leader joins the label. */
  outside?: boolean;
  /** Where the label is (decided by the layout); otherwise the middle of the dimension line. */
  text?: { x: number; y: number; slopeDeg: number };
}

export function projectShape(shape: DimShape, to: ToScreen, opt: ProjectOptions = {}): ScreenDim | null {
  const P = (p: { x: number; y: number }) => to(p.x, p.y);
  const arrows: ScreenDim['arrows'] = [];
  for (const a of shape.arrows) {
    const t = P(a.at), h = P({ x: a.at.x + a.dir.x * 1e-3, y: a.at.y + a.dir.y * 1e-3 }), k = P(a.at);
    if (!t || !h || !k) return null;
    const [dx, dy] = norm(h.x - t.x, h.y - t.y);
    arrows.push([t.x, t.y, dx, dy]);
  }
  const text = opt.text ?? P(shape.text);
  if (!text) return null;
  if (opt.outside && shape.kind === 'linear') for (const a of arrows) { a[2] = -a[2]; a[3] = -a[3]; }
  if (shape.kind === 'angle' && shape.square) {
    // a right angle: a small square in the corner, not an arc
    const k = shape.r * 0.5, u = { x: Math.cos(shape.a0) * k, y: Math.sin(shape.a0) * k }, v = { x: Math.cos(shape.a1) * k, y: Math.sin(shape.a1) * k };
    const sq = [{ x: shape.c.x + u.x, y: shape.c.y + u.y }, { x: shape.c.x + u.x + v.x, y: shape.c.y + u.y + v.y }, { x: shape.c.x + v.x, y: shape.c.y + v.y }].map(P);
    if (sq.some((q) => !q)) return null;
    return { lines: [], arc: sq.map((q) => [q!.x, q!.y] as [number, number]), arrows: [], text: { x: text.x, y: text.y, slopeDeg: 0 }, main: null };
  }
  if (shape.kind === 'angle') {
    const arc: Array<[number, number]> = [];
    const n = Math.max(6, Math.ceil(((shape.a1 - shape.a0) * 180) / Math.PI / 6));
    for (let i = 0; i <= n; i++) {
      const a = shape.a0 + ((shape.a1 - shape.a0) * i) / n;
      const q = P({ x: shape.c.x + Math.cos(a) * shape.r, y: shape.c.y + Math.sin(a) * shape.r });
      if (!q) return null;
      arc.push([q.x, q.y]);
    }
    return { lines: [], arc, arrows, text: { x: text.x, y: text.y, slopeDeg: 0 }, main: null };
  }
  const lines: ScreenDim['lines'] = [];
  const segs: Array<[{ x: number; y: number }, { x: number; y: number }]> = shape.kind === 'linear' ? [...shape.ext, shape.line] : [shape.line];
  for (const [a, b] of segs) { const p = P(a), q = P(b); if (!p || !q) return null; lines.push([p.x, p.y, q.x, q.y]); }
  const main = lines[lines.length - 1];
  const slopeDeg = opt.text ? opt.text.slopeDeg : shape.kind === 'linear' ? readable((Math.atan2(main[3] - main[1], main[2] - main[0]) * 180) / Math.PI) : 0;
  if (opt.outside && shape.kind === 'linear') {
    // the dimension line runs on past its ends (the arrowheads sit outside), and a leader goes from its far end to the label
    const [x1, y1, x2, y2] = main, [ux, uy] = norm(x2 - x1, y2 - y1);
    main[0] = x1 - ux * 14; main[1] = y1 - uy * 14; main[2] = x2 + ux * 14; main[3] = y2 + uy * 14;
    lines.push([x2, y2, text.x - ux * 0, text.y - uy * 0]);
  }
  return { lines, arc: [], arrows, text: { x: text.x, y: text.y, slopeDeg }, main };
}

/** The size a dimension chip takes (the value in a monospace face on a rounded pill), for keeping labels apart. `fx`: it carries the fx badge. */
export const labelBox = (text: string, fx = false): { w: number; h: number } => chipSize('dimension', text, fx);

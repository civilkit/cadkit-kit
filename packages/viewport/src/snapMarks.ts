/**
 * Snap marker glyphs, AutoCAD style, drawn at the snapped point in the sketch overlay.
 * Pure: `markerStyleFor` picks the glyph for a snap hit, `markerSegments` returns its line segments around (x, y) for a
 * half-size `k` (in plane units; the viewport passes a constant number of screen pixels times units per pixel, so the
 * glyph stays the same size on screen at every zoom).
 *
 * square = endpoint, triangle = midpoint, circle = centre, diamond = quadrant, X = intersection, right-angle mark = perpendicular,
 * circle on a line = tangent, hourglass = nearest (on curve), small plus = grid point, diamond on a dashed guide = alignment.
 * Model snaps use the same glyphs in cyan; the sketch's own in orange.
 */
export type MarkerStyle = 'point' | 'midpoint' | 'align' | 'anchor' | 'center' | 'quadrant' | 'intersection' | 'perpendicular' | 'tangent' | 'oncurve' | 'grid';

/** Half-size of a snap glyph in screen pixels (the glyph is about 10 px across); the chain-end ring is larger. */
export const MARKER_HALF_PX = 5.5;
export const ANCHOR_HALF_PX = 11;

export interface MarkerHit { kind: string; role?: 'endpoint' | 'center' | 'origin'; model?: string; /** the pointer's own curve pick, not a grid snap */ entityId?: string }

/** The glyph for a snap hit, or null when nothing is drawn (no hit, or a pick that is not a snap). */
export function markerStyleFor(hit: MarkerHit | undefined | null): MarkerStyle | null {
  if (!hit) return null;
  switch (hit.kind) {
    case 'point': return hit.role === 'center' ? 'center' : 'point';
    case 'center': return 'center';
    case 'midpoint': case 'modelMidpoint': return 'midpoint';
    case 'quadrant': case 'intersection': case 'perpendicular': case 'tangent': case 'align': return hit.kind;
    case 'oncurve': return 'oncurve';
    case 'modelEndpoint': return 'point';
    case 'modelCenter': return 'center';
    case 'modelExtent': return 'align';
    case 'grid': return hit.entityId ? null : 'grid';   // a grid hit carrying an entity is a curve pick that found no snap
    default: return null;
  }
}

/** Draw colours: the sketch's snaps in orange, the model's in cyan; a shade that reads on a light and on a dark background. */
export function markerColor(model: boolean, darkBackground: boolean): number {
  if (model) return darkBackground ? 0x35d6f0 : 0x0a8fa8;
  return darkBackground ? 0xffb02e : 0xd9680a;
}

type P = { x: number; y: number };
export type Seg = [P, P];

/** The line segments of a glyph centred on (x, y), half-size k. */
export function markerSegments(style: MarkerStyle, x: number, y: number, k: number): Seg[] {
  const out: Seg[] = [];
  const seg = (p: P, q: P) => out.push([p, q]);
  const loop = (pts: P[]) => { for (let i = 0; i < pts.length; i++) seg(pts[i], pts[(i + 1) % pts.length]); };
  const ring = (r: number, cx = x, cy = y, n = 20) => loop(Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((i / n) * Math.PI * 2), y: cy + r * Math.sin((i / n) * Math.PI * 2) })));
  switch (style) {
    case 'point': loop([{ x: x - k, y: y - k }, { x: x + k, y: y - k }, { x: x + k, y: y + k }, { x: x - k, y: y + k }]); break;
    case 'midpoint': loop([{ x, y: y + k }, { x: x + k, y: y - k * 0.8 }, { x: x - k, y: y - k * 0.8 }]); break;
    case 'align': loop([{ x, y: y + k }, { x: x + k, y }, { x, y: y - k }, { x: x - k, y }]); break;
    case 'quadrant': loop([{ x, y: y + k }, { x: x + k, y }, { x, y: y - k }, { x: x - k, y }]); seg({ x: x - k, y }, { x: x + k, y }); break;
    case 'intersection': seg({ x: x - k, y: y - k }, { x: x + k, y: y + k }); seg({ x: x - k, y: y + k }, { x: x + k, y: y - k }); break;
    case 'perpendicular': seg({ x: x - k, y: y + k }, { x: x - k, y: y - k }); seg({ x: x - k, y: y - k }, { x: x + k, y: y - k }); seg({ x: x - k, y }, { x, y }); seg({ x, y }, { x, y: y - k }); break;
    case 'tangent': ring(k * 0.7, x, y + k * 0.25); seg({ x: x - k * 1.3, y: y - k * 0.45 }, { x: x + k * 1.3, y: y - k * 0.45 }); break;
    case 'center': ring(k); seg({ x: x - k * 0.3, y }, { x: x + k * 0.3, y }); seg({ x, y: y - k * 0.3 }, { x, y: y + k * 0.3 }); break;
    case 'oncurve':   // hourglass: two triangles tip to tip
      seg({ x: x - k, y: y + k }, { x: x + k, y: y + k }); seg({ x: x + k, y: y + k }, { x: x - k, y: y - k });
      seg({ x: x - k, y: y - k }, { x: x + k, y: y - k }); seg({ x: x + k, y: y - k }, { x: x - k, y: y + k }); break;
    case 'grid': seg({ x: x - k * 0.7, y }, { x: x + k * 0.7, y }); seg({ x, y: y - k * 0.7 }, { x, y: y + k * 0.7 }); break;
    case 'anchor': ring(k, x, y, 24); break;
  }
  return out;
}

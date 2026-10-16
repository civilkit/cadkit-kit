// A true section view from the kernel's exact loops: the cut face hatched at 45 degrees (even-odd, so holes stay open),
// the outline, the dimensioned bounding box of the section and its area. Curves are the loop polylines the kernel sends.
import { Raster, hatchPolygons, type RGB } from './raster.js';
import { fmtMm, rectDims } from './render3d.js';
import type { SectionLike } from './types.js';

export interface SectionPanelOpts { w: number; h: number; bg: RGB; label?: string; fill?: number }

export function renderSectionPanel(sec: SectionLike, o: SectionPanelOpts): { raster: Raster; scale: number; bbox2d: [number, number, number, number]; inside: number } {
  const r = new Raster(o.w, o.h, o.bg);
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const lp of sec.loops) for (const [u, v] of lp.pts) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  if (!isFinite(u0)) { u0 = v0 = 0; u1 = v1 = 1; }
  const eu = Math.max(u1 - u0, 1e-9), ev = Math.max(v1 - v0, 1e-9);
  const scale = (o.fill ?? 0.66) * Math.min(o.w / eu, o.h / ev);
  const cx = o.w / 2 - ((u0 + u1) / 2) * scale, cy = o.h / 2 + ((v0 + v1) / 2) * scale;
  const polys = sec.loops.map((lp) => lp.pts.map(([u, v]) => [cx + u * scale, cy - v * scale] as [number, number]));
  const inside = hatchPolygons(r, polys, [60, 72, 90], 7, 1, 1, [214, 224, 238], 0.7);
  for (const p of polys) r.polyline(p, [20, 26, 36], 2, true);
  const sx0 = cx + u0 * scale, sx1 = cx + u1 * scale, sy0 = cy - v1 * scale, sy1 = cy - v0 * scale;
  r.strokeRect(Math.round(sx0) - 1, Math.round(sy0) - 1, Math.round(sx1) + 1, Math.round(sy1) + 1, [150, 170, 210], 1);
  rectDims(r, sx0, sy0, sx1, sy1, eu, ev);
  const area = sec.area ?? sec.loops.reduce((a, l) => a + (l.kind === 'inner' ? -1 : 1) * Math.abs(l.area ?? 0), 0);
  r.text(8, o.h - 16, `AREA ${fmtMm(area)} MM2  LOOPS ${sec.loops.length}`, [20, 24, 32], 1, [255, 255, 255]);
  if (o.label) r.text(8, 8, o.label, [20, 24, 32], 2, [255, 255, 255]);
  return { raster: r, scale, bbox2d: [u0, v0, u1, v1], inside };
}

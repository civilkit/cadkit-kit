// Does an imported STEP / SolidWorks part lie on its back? Those files are mostly Z up while the view is Y up by default, so a part
// modelled standing on its Z bottom shows lying down. Judged from the flat area that faces down Z against the larger of the flat
// areas that face down or up Y: only when the Z bottom clearly dominates is the part offered a Z-up view. Pure; nothing is rotated.
import type { FaceMesh } from '../inspect/geometry';

/** A triangle counts as "facing" an axis when its normal is within this many degrees of it. */
export const FLAT_TOL_DEG = 10;
/** The Z bottom must be this many times the larger Y flat area. */
export const DOMINANCE = 1.5;

export interface FlatAreas { zDown: number; yDown: number; yUp: number }

/** Total area (mm2) of the triangles whose normal is within `FLAT_TOL_DEG` of -Z, -Y and +Y. */
export function flatAreas(mesh: Pick<FaceMesh, 'positions'>): FlatAreas {
  const P = mesh.positions;
  const cos = Math.cos((FLAT_TOL_DEG * Math.PI) / 180);
  const out: FlatAreas = { zDown: 0, yDown: 0, yUp: 0 };
  for (let o = 0; o + 8 < P.length; o += 9) {
    const ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2];
    const vx = P[o + 6] - P[o], vy = P[o + 7] - P[o + 1], vz = P[o + 8] - P[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const twice = Math.hypot(nx, ny, nz);
    if (twice < 1e-12) continue;
    const a = twice / 2;
    if (-nz / twice >= cos) out.zDown += a;
    else if (-ny / twice >= cos) out.yDown += a;
    else if (ny / twice >= cos) out.yUp += a;
  }
  return out;
}

/** True when the part seems to be Z up (it would lie on its back in a Y-up view). Round parts and ambiguous ones are false. */
export function seemsZUp(mesh: Pick<FaceMesh, 'positions'> | null | undefined): boolean {
  if (!mesh) return false;
  const { zDown, yDown, yUp } = flatAreas(mesh);
  return zDown > 0 && zDown >= DOMINANCE * Math.max(yDown, yUp);
}

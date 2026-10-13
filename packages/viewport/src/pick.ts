import { faceOfVertexIndex, type Grouped } from './meshgeom';

export interface PickResult {
  face: string | null;
  vertexIndex: number | null;
}

export function pickFace(g: Grouped, hit: { faceIndex: number } | null): string | null {
  if (hit == null) return null;
  return faceOfVertexIndex(g, hit.faceIndex * 3);
}

export function nearestEdge(edges: Array<{ pts: number[][] }>, point: number[], tol: number): number | null {
  let bestIdx: number | null = null;
  let bestDist = tol * tol;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    for (let j = 0; j + 1 < e.pts.length; j++) {
      const a = e.pts[j];
      const b = e.pts[j + 1];
      let dx = b[0] - a[0];
      let dy = b[1] - a[1];
      let dz = b[2] - a[2];
      let lenSq = dx * dx + dy * dy + dz * dz;
      if (lenSq === 0) {
        const dx0 = point[0] - a[0];
        const dy0 = point[1] - a[1];
        const dz0 = point[2] - a[2];
        const d = dx0 * dx0 + dy0 * dy0 + dz0 * dz0;
        if (d <= bestDist) {
          bestDist = d;
          bestIdx = i;
        }
        continue;
      }
      let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy + (point[2] - a[2]) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const projX = a[0] + t * dx;
      const projY = a[1] + t * dy;
      const projZ = a[2] + t * dz;
      const dxp = point[0] - projX;
      const dyp = point[1] - projY;
      const dzp = point[2] - projZ;
      const d = dxp * dxp + dyp * dyp + dzp * dzp;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}
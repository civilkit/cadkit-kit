// The bodies of the open document: one row per connected lump with its name, creating feature, volume, bounding box and colour.
// Bodies are found the way the app and the snapshot renderer find them (faces joined by a shared edge); names and looks follow the
// app's rules (docs/bodies-appearance.md): a body key '@body:<lowest face name>' wins over the creating feature's id.
import type { AgentSession } from './agent-session';

export interface BodyInfo {
  /** 1-based position in the list (ordered by creating feature) */
  index: number;
  name: string;
  /** the body key the document's appearance / bodyNames / view.hiddenBodies use */
  key: string;
  /** the feature that created the lump (the lowest-numbered feature owning one of its faces) */
  feature: string | null;
  featureType: string | null;
  featureName: string | null;
  /** mm3 from the display mesh (a sheet has none) */
  volume: number | null;
  bbox: { min: number[]; max: number[]; size: number[] } | null;
  faceCount: number;
  /** the look in effect: colour, opacity, finish; null when the part's material is used */
  appearance: { color?: string; opacity?: number; finish?: string } | null;
  hidden: boolean;
  /** sheet metal parts: the rule and flat pattern summary (sheet_info has the bends); null for any other body */
  sheetMetal: { rule: string; thickness: number; kFactor: number; flatSize: number[]; bendCount: number; unfolded: boolean } | null;
}

const r4 = (x: number): number => Number(x.toFixed(4));
const featureNum = (id: string): number => { const m = /^F(\d+)/.exec(id); return m ? +m[1] : Infinity; };

interface Mesh { positions: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }

/** Volume (signed tetrahedra) and bbox per face name of a display mesh. */
function faceStats(mesh: Mesh): Map<string, { v: number; min: number[]; max: number[] }> {
  const out = new Map<string, { v: number; min: number[]; max: number[] }>();
  const p = mesh.positions;
  const tris = Math.floor(p.length / 9);
  for (let t = 0; t < tris; t++) {
    const name = mesh.faceIds[mesh.triFace[t]];
    if (name === undefined) continue;
    let e = out.get(name);
    if (!e) out.set(name, (e = { v: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
    const o = t * 9;
    const ax = p[o], ay = p[o + 1], az = p[o + 2], bx = p[o + 3], by = p[o + 4], bz = p[o + 5], cx = p[o + 6], cy = p[o + 7], cz = p[o + 8];
    e.v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (let k = 0; k < 9; k += 3) for (let a = 0; a < 3; a++) { const x = p[o + k + a]; if (x < e.min[a]) e.min[a] = x; if (x > e.max[a]) e.max[a] = x; }
  }
  return out;
}

export async function listBodies(a: AgentSession): Promise<BodyInfo[]> {
  const view = await a.session.bodyForView();
  if (!view || !view.mesh.positions.length) return [];
  const { lumps, bodyKey, bodyOrigin } = await import('@kit/snapshot');
  const mesh = view.mesh as unknown as Mesh;
  const stats = faceStats(mesh);
  const doc = a.doc as unknown as { features: Array<Record<string, unknown>>; appearance?: Record<string, Record<string, unknown>>; bodyNames?: Record<string, string>; view?: { hiddenBodies?: string[] } };
  const feats = new Map(doc.features.map((f) => [String(f.id), f]));
  const hiddenKeys = new Set(doc.view?.hiddenBodies ?? []);
  const rows = lumps(mesh.faceIds, view.edges as never).map((faces) => ({ faces, key: bodyKey(faces), origin: bodyOrigin(faces) }));
  rows.sort((x, y) => (x.origin ? featureNum(x.origin) : Infinity) - (y.origin ? featureNum(y.origin) : Infinity) || (x.key < y.key ? -1 : 1));
  const per = new Map<string, number>();
  for (const r of rows) if (r.origin) per.set(r.origin, (per.get(r.origin) ?? 0) + 1);
  const seen = new Map<string, number>();
  // the sheet metal summary goes to the body the base flange / contour flange made
  const sheet = (await a.sheetMetal().catch(() => [])).filter((e) => e.flatPattern);
  const lastFp = sheet.length ? sheet[sheet.length - 1].flatPattern! : null;
  return rows.map((r, i) => {
    let v = 0, any = false;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const n of r.faces) {
      const s = stats.get(n);
      if (!s) continue;
      any = true; v += s.v;
      for (let k = 0; k < 3; k++) { if (s.min[k] < min[k]) min[k] = s.min[k]; if (s.max[k] > max[k]) max[k] = s.max[k]; }
    }
    const f = r.origin ? feats.get(r.origin) : undefined;
    const names = doc.bodyNames ?? {};
    const featLabel = (typeof f?.body === 'string' && f.body.trim()) || (typeof f?.name === 'string' && f.name.trim()) || '';
    let name = names[r.key]?.trim() || '';
    if (!name && r.origin) {
      const base = names[r.origin]?.trim() || featLabel;
      if (base) { const k = (seen.get(r.origin) ?? 0) + 1; seen.set(r.origin, k); name = (per.get(r.origin) ?? 1) > 1 ? `${base} ${k}` : base; }
    }
    const app = doc.appearance ?? {};
    const look = { ...(r.origin ? app[r.origin] : {}), ...app[r.key] };
    const sheet = Math.abs(v) < 1e-9;
    return {
      index: i + 1, name: name || `Body ${i + 1}`, key: r.key, feature: r.origin,
      featureType: f ? String(f.type) : null, featureName: typeof f?.name === 'string' ? f.name : null,
      volume: any && !sheet ? r4(Math.abs(v)) : null,
      bbox: any ? { min: min.map(r4), max: max.map(r4), size: max.map((x, k) => r4(x - min[k])) } : null,
      faceCount: r.faces.length,
      appearance: Object.keys(look).length ? (look as BodyInfo['appearance']) : null,
      hidden: hiddenKeys.has(r.key) || (!!r.origin && hiddenKeys.has(r.origin)),
      sheetMetal: lastFp && (f?.type === 'baseFlange' || f?.type === 'contourFlange') ? { rule: lastFp.rule, thickness: lastFp.thickness, kFactor: lastFp.kFactor, flatSize: lastFp.flatSize.map(r4), bendCount: lastFp.bends.length, unfolded: lastFp.unfolded } : null,
    };
  });
}

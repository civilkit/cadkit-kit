// A cosmetic knurl: a display-only record of a knurl, kept in the document field `cosmeticKnurls` (no feature, no geometry). The viewport draws it as
// a shading effect on the matching cylinder; mass, volume, validity and exports see the plain cylinder. Every number is resolved (no expressions), so
// the record is the same for a script, the wizard and a saved file. `cosmeticToOpts` turns a record back into the options of a real cut.
import type { KnurlOpts } from './features/knurl';

export interface CosmeticKnurl {
  axis: 'x' | 'y' | 'z';
  /** the axis position across it: [x, y] for z, [x, z] for y, [y, z] for x */
  center: [number, number];
  radius: number;
  /** axial range in world coordinates */
  from: number;
  to: number;
  pattern: 'straight' | 'diamond' | 'pyramid';
  /** grooves round the circumference (per hand for a diamond) */
  count: number;
  depth: number;
  profile: 'v' | 'round';
  /** included angle of a V groove, degrees */
  angle: number;
  /** width of a round groove at the surface */
  width: number;
  /** diamond: degrees from the axis */
  helixAngle: number;
  /** pyramid: spacing of the rings */
  ringPitch: number;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The records of a document field read back safely: anything malformed is dropped, missing numbers take their defaults. */
export function sanitizeCosmeticKnurls(v: unknown): CosmeticKnurl[] {
  if (!Array.isArray(v)) return [];
  const out: CosmeticKnurl[] = [];
  for (const r of v as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object') continue;
    const axis = r.axis, pattern = r.pattern ?? 'straight', profile = r.profile ?? 'v';
    const c = r.center;
    if (axis !== 'x' && axis !== 'y' && axis !== 'z') continue;
    if (pattern !== 'straight' && pattern !== 'diamond' && pattern !== 'pyramid') continue;
    if (profile !== 'v' && profile !== 'round') continue;
    if (!Array.isArray(c) || !fin(c[0]) || !fin(c[1])) continue;
    if (!fin(r.radius) || !(r.radius > 0) || !fin(r.from) || !fin(r.to) || !(r.to > r.from)) continue;
    if (!fin(r.count) || r.count < 3 || !fin(r.depth) || !(r.depth > 0) || r.depth >= r.radius) continue;
    const angle = fin(r.angle) && r.angle > 0 && r.angle < 180 ? r.angle : 90;
    const width = fin(r.width) && r.width > 0 ? r.width : 2 * r.depth;
    const helixAngle = fin(r.helixAngle) && r.helixAngle > 0 && r.helixAngle < 80 ? r.helixAngle : 30;
    const ringPitch = fin(r.ringPitch) && r.ringPitch > 0 ? r.ringPitch : (2 * Math.PI * r.radius) / Math.round(r.count);
    out.push({ axis, center: [c[0], c[1]], radius: r.radius, from: r.from, to: r.to, pattern, count: Math.round(r.count), depth: r.depth, profile, angle, width, helixAngle, ringPitch });
  }
  return out;
}

/** The options of a real cut with the same look as a cosmetic record. */
export function cosmeticToOpts(k: CosmeticKnurl): KnurlOpts {
  return {
    axis: k.axis, center: [...k.center], radius: k.radius, from: k.from, to: k.to, pattern: k.pattern, count: k.count, depth: k.depth, profile: k.profile,
    ...(k.profile === 'v' ? { angle: k.angle } : { width: k.width }),
    ...(k.pattern === 'diamond' ? { helixAngle: k.helixAngle } : {}),
    ...(k.pattern === 'pyramid' ? { ringPitch: k.ringPitch } : {}),
  };
}

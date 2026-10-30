// A part converted from another CAD system can carry the original solid as an imported body (named `Original (STEP)`) next to the
// body its history rebuilds. The original is the exact solid and is what shows by default. Only when the rebuilt body is really
// there (live, valid, not empty) and has the volume of the original (within 0.5%) do the two lie on one another, and then the
// original is hidden so the history body is the one on screen and the one a face pick lands on. In every other case (the history
// is suppressed, a placeholder, failed, empty, or a different size) nothing is hidden. Viewer state only (`view.hiddenBodies`, a
// feature id hides every body of that feature); a part that already says what is hidden is left alone, and Show in the Bodies
// list brings the original back.
export const ORIGINAL_BODY = 'Original (STEP)';
/** How far the rebuilt body's volume may be from the original's, as a fraction of it. */
export const SAME_SOLID = 0.005;

interface Feat { type?: unknown; id?: unknown; name?: unknown; body?: unknown; suppressed?: unknown }
const MAKES_BODY = new Set(['extrude', 'revolve', 'sweep', 'loft', 'sphere']);
export interface LumpVolume { name?: string; volume: number }

/** The imported original solids of a part (feature ids), when the part has bodies of its own that are not suppressed; else none. Cheap: no kernel. */
export function originalCandidates(doc: { features?: unknown; view?: unknown }): string[] {
  if (doc.view) return [];
  const fs = Array.isArray(doc.features) ? (doc.features as Feat[]) : [];
  const orig = fs.filter((f) => f.type === 'importStep' && typeof f.id === 'string' && (f.body === ORIGINAL_BODY || f.name === ORIGINAL_BODY));
  if (!orig.length) return [];
  const others = fs.some((f) => !f.suppressed && typeof f.type === 'string' && MAKES_BODY.has(f.type));
  return others ? orig.map((f) => f.id as string) : [];
}

/**
 * The originals to hide, given what the kernel built (`lumps`: name and volume of each body of the result): all of them when the bodies
 * that are not the original add up to the original's volume within 0.5%, none otherwise.
 */
export function originalsToHide(doc: { features?: unknown; view?: unknown }, lumps: readonly LumpVolume[]): string[] {
  const ids = originalCandidates(doc);
  if (!ids.length) return [];
  const orig = lumps.filter((l) => l.name === ORIGINAL_BODY && l.volume > 0);
  const rest = lumps.filter((l) => l.name !== ORIGINAL_BODY && l.volume > 0);
  if (!orig.length || !rest.length) return [];
  const o = orig.reduce((s, l) => s + l.volume, 0), h = rest.reduce((s, l) => s + l.volume, 0);
  return Math.abs(h - o) <= SAME_SOLID * o ? ids : [];
}

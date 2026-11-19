// The Section control of the viewport while a feature panel is open: which cutting plane "the feature's sketch plane" means.
import type { SectionState } from './InspectPanel';

export interface PlaneChoice { plane: SectionState['plane']; faceId?: string }
type Feat = { id?: string; type?: string; plane?: { kind?: string; id?: string }; sketch?: unknown; sketches?: unknown };

/** The plane the sketch of feature `f` lies on, as a section choice: a standard plane, or the face it was drawn on. Null for a feature with no sketch (a shell, a fillet) or a plane that is neither. */
export function sketchSectionPlane(features: Feat[], f: Feat | null | undefined): PlaneChoice | null {
  if (!f) return null;
  const sid = typeof f.sketch === 'string' ? f.sketch : Array.isArray(f.sketches) && typeof f.sketches[0] === 'string' ? f.sketches[0] as string : f.type === 'sketch' ? f.id : undefined;
  const sk = sid ? features.find((x) => x.id === sid && x.type === 'sketch') : undefined;
  const pl = sk?.plane;
  if (!pl || typeof pl.id !== 'string') return null;
  if (pl.kind === 'std' && (pl.id === 'front' || pl.id === 'top' || pl.id === 'right')) return { plane: pl.id };
  if (pl.kind === 'face') return { plane: 'face', faceId: pl.id };
  return null;
}

/** Is the viewport's Section chip shown: with a feature panel open (any kind: add, cut, shell ...) or while a cut is on, and a body to cut, never inside a sketch. */
export function sectionChipShown(o: { sketching: boolean; editing: boolean; sectionOn: boolean; hasBody: boolean }): boolean {
  return !o.sketching && (o.editing || o.sectionOn) && o.hasBody;
}

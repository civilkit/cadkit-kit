// Cosmetic knurls in exports: the scratch document an export is made from (the open document with its cosmetic records cut as real grooves), how heavy
// that cut is, and which records a folder's bodies hold. Pure: the kernel work is the controller's (`bakeBuild`, `folderBuild`).
import type { PartDoc } from '@ck/part-model';
import type { EditOp } from '@ck/session';
import type { CosmeticKnurl } from '@kit/script';
import { cosmeticToCutOps } from './knurl';
import { applyOpsLocal } from './threadData';

/** The document with the cosmetic records cut as real grooves (the same cuts the wizard makes with Cosmetic off) and no records. Not saved anywhere:
 *  the scratch copy an export is built from. Throws with the helper's message (overlapping grooves, too many crossings). */
export function bakedDoc(doc: PartDoc, recs: readonly CosmeticKnurl[], rolledBackTo: number | null = null): PartDoc {
  const { viewCache: _cache, thumbnail: _thumb, cosmeticKnurls: _cosmetic, ...plain } = doc as PartDoc & { viewCache?: unknown; thumbnail?: unknown; cosmeticKnurls?: unknown };
  const ops = cosmeticToCutOps(doc as never, recs);
  // a rolled-back model shows only its first features: the copy keeps those and no marker, so the cuts land on what is shown
  const shown = rolledBackTo === null ? plain.features : plain.features.slice(0, rolledBackTo);
  const features = applyOpsLocal(shown as never, ops as EditOp[]);
  if (!features) throw new Error('the knurl cuts could not be added to the copy');
  const ids = features.map((f) => Number(/^F(\d+)$/.exec(String(f.id))?.[1] ?? 0));
  return { ...plain, ...(rolledBackTo === null ? {} : { rollback: null }), features, seq: Math.max(doc.seq ?? 1, ...ids.map((n) => n + 1)) } as unknown as PartDoc;
}

/** How many cells of the pattern the cut builds: the groove count for straight grooves, the crossings of a diamond, the grooves times the rings of a pyramid. */
export function knurlCost(k: CosmeticKnurl): number {
  if (k.pattern === 'straight') return k.count;
  if (k.pattern === 'diamond') {
    const twist = ((k.to - k.from) * Math.tan((k.helixAngle * Math.PI) / 180) / (k.radius * 2 * Math.PI)) * 360;   // degrees the grooves turn over the band
    return Math.round(k.count * k.count * ((2 * Math.abs(twist)) / 360));
  }
  return k.count * Math.max(1, Math.round((k.to - k.from) / k.ringPitch));
}
/** From this many cells a diamond or pyramid takes tens of seconds even as faces (measured: a V pyramid of 90 grooves and 17 rings, 39 s). */
export const KNURL_HEAVY = 400;
/** Whether the cut of these records may take a while: any diamond or pyramid with round grooves (crossed as cuts, seconds each) or a dense V one. */
export function mayBeSlow(recs: readonly CosmeticKnurl[]): boolean {
  return recs.some((k) => k.pattern !== 'straight' && (k.profile === 'round' || knurlCost(k) >= KNURL_HEAVY));
}

/** The surface facts the scope check reads from the kernel's `describe`. */
export interface FaceFact { name: string; surface?: string; area?: number; radius?: number }
/** The records whose cylinder is among `faces`: a round face of the same radius whose area covers the band. A folder export holds a knurl only
 *  when it holds that face (the body that carries it). */
export function recordsInFaces(recs: readonly CosmeticKnurl[], faces: readonly FaceFact[]): CosmeticKnurl[] {
  return recs.filter((k) => faces.some((f) => f.surface === 'cylinder' && typeof f.radius === 'number' && Math.abs(f.radius - k.radius) <= 1e-4 * Math.max(1, k.radius)
    && typeof f.area === 'number' && f.area >= 0.98 * 2 * Math.PI * k.radius * (k.to - k.from)));
}

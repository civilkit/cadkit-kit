// The outline sketch of an edge flange, made from the editor: a new sketch holding the default leg, or an imported outline turned into a sketch. The
// kernel measures a sketch outline along the edge from the first point of the span to the second and refuses one whose span runs against the edge's own
// direction (the outline comes out mirrored and its cut at the end of the bend fails). Which way the edge runs is not known to the editor, so each plan has a
// second candidate with the sketch mirrored (the same leg in the world) and the span's points swapped; the app keeps the first that builds.
import type { PartDoc } from '@ck/part-model';
import {
  flipFrame, framePlane, legFrameAt, mirrorHoles, mirrorSegs, patchProfileConvert, patchProfileSketch, patchSpanPoints, profileOf, rectSketch, sketchFromProfile, spanOf, type LegFrame,
} from './flangeShape';

type Wire = Record<string, unknown>;
export interface OutlinePlan {
  /** The features to add before the flange, in order: the plane (when the leg's frame is known) and the sketch. */
  add: Wire[];
  /** The patch for the flange's draft: the profile names the sketch (and the span's points are pinned to the sketch's frame). */
  patch: Wire;
  /** For a flange on the whole edge: the same without the span's two points. They orient the trial (which way the edge runs), but a span makes the bend as wide as the span
   *  instead of as wide as the outline at the end of the bend, so the flange keeps them off once the direction is known. */
  unpinned?: Wire;
  sketchId: string;
}
export interface OutlineRequest {
  kind: 'new' | 'convert';
  /** The flange as it is now (feature with the draft applied). */
  eff: Wire;
  /** The frame of the built leg (null when it could not be read: the sketch goes on the Front plane). */
  frame: LegFrame | null;
  /** The next free feature number: the plane and sketch take `F<seq>` and `F<seq+1>`. */
  seq: number;
  name: string;
  planeName: string;
  /** The flange height (the top of the outline). */
  height: number;
  /** A width to draw the new rectangle with when the frame is not known. */
  width: number | null;
}
/** The candidates for the outline sketch, best first; an empty list with `refused` (the distance the outline would move) when an imported outline cannot become a sketch. */
export function outlineCandidates(q: OutlineRequest): { plans: OutlinePlan[]; refused?: number } {
  const { eff, frame } = q;
  const planeId = `F${q.seq}`, sketchId = `F${q.seq + (frame ? 1 : 0)}`;
  const planeRef = (f: LegFrame | null): Wire => (f ? { kind: 'feature', id: planeId } : { kind: 'std', id: 'front' });
  const prof = profileOf(eff);
  const sp = spanOf(eff, false);
  const plans: OutlinePlan[] = [];
  const mk = (fr: LegFrame | null, sketch: Wire, patch: Wire, unpinned?: Wire): OutlinePlan => ({ add: [...(fr ? [framePlane(planeId, q.planeName, fr)] : []), sketch], patch, ...(unpinned ? { unpinned } : {}), sketchId });
  if (q.kind === 'convert') {
    if (prof.kind !== 'inline') return { plans: [] };
    const raw = Array.isArray(eff.holes) ? (eff.holes as unknown[]) : (((eff.edges as unknown[] | undefined)?.[0] as { holes?: unknown[] } | undefined)?.holes ?? []);
    const L = sp.from && sp.to ? Math.hypot(sp.to[0] - sp.from[0], sp.to[1] - sp.from[1], sp.to[2] - sp.from[2]) : 0;
    const base = frame && sp.from && sp.to ? legFrameAt(frame, sp.from, sp.to) : frame;
    const first = sketchFromProfile(sketchId, q.name, planeRef(base), prof.segs, raw);
    if (!first.ok) return { plans: [], refused: first.by };
    const conv = patchProfileConvert(eff, sketchId);
    plans.push(mk(base, first.sketch, conv));
    if (sp.from && sp.to) {
      const second = sketchFromProfile(sketchId, q.name, planeRef(base), mirrorSegs(prof.segs, L), mirrorHoles(raw, L));
      if (second.ok) plans.push(mk(base ? flipFrame(base) : null, second.sketch, { ...conv, ...patchSpanPoints({ ...eff, ...conv }, sp.to, sp.from) }));
    }
    return { plans };
  }
  const one = (fr: LegFrame | null): OutlinePlan => {
    const sketch = rectSketch(sketchId, q.name, planeRef(fr), fr?.width ?? q.width ?? q.height, q.height);
    const base = patchProfileSketch(eff, sketchId);
    return mk(fr, sketch, fr ? { ...base, ...patchSpanPoints({ ...eff, ...base }, fr.from, fr.to) } : base, fr && sp.mode === 'whole' ? base : undefined);   // v runs the way the sketch's x does
  };
  plans.push(one(frame));
  if (frame) plans.push(one(flipFrame(frame)));
  return { plans };
}
/** The document with a plan's features added before the flange `flangeId`. */
export function withOutline(doc: PartDoc, flangeId: string, plan: OutlinePlan): PartDoc {
  const feats = [...doc.features] as unknown as Wire[];
  const at = feats.findIndex((f) => f.id === flangeId);
  feats.splice(at < 0 ? feats.length : at, 0, ...plan.add);
  return { ...doc, features: feats, seq: doc.seq + plan.add.length } as unknown as PartDoc;
}

/** The number the next two features of the document can take as `F<n>` ids: past the document's own `seq` and past every `F<number>` id in it (an imported part's `seq` may lag behind its ids). */
export function freeFeatureNumber(doc: PartDoc): number {
  let n = typeof doc.seq === 'number' ? doc.seq : 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(f.id); if (m) n = Math.max(n, +m[1] + 1); }
  return n;
}

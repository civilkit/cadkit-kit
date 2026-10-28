// The document edits of a bearing, for callers that have no script to run (the Bearing wizard in the app): the same bearing() helper, recorded on a throwaway
// part and its steps run against an empty geometry (a bearing only uses the planes it builds from its origin and axis, so it needs none). Throws a
// SelectorError whose message says why the numbers cannot work (a bore larger than the outer diameter, balls that do not fit).
import { makeApi, type EditOp, type Ctx, type ScriptState } from './recorder';
import type { BearingOpts } from './features/bearing';

export type { BearingOpts } from './features/bearing';
export { BEARING_PRESETS, BEARING_SEALS, SEAT_FITS, bearingModel, bearingPreset, bearingProblem, defaultBallCount, defaultChamfer, findBearings, housingSeat } from './bearingTable';
export type { BearingModel, BearingPreset, BearingSeal, BearingSeries, BearingSpec, HousingSeat, SeatFit } from './bearingTable';

/** The features that make a bearing, numbered F<firstSeq> onwards, as ops to append to the document. */
export function bearingEditOps(opts: BearingOpts, firstSeq: number): EditOp[] {
  const state: ScriptState = { parts: [], vars: {}, varDefs: [] };
  const part = makeApi(state).part('Bearing');
  part.bearing(opts);
  let seq = firstSeq;
  const ctx: Ctx = { geo: { mesh: null, edges: [], box: null }, nextId: () => `F${seq++}`, lastSketch: null, lastFeature: null };
  return part.steps.flatMap((s) => s.run(ctx));
}

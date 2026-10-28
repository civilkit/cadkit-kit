// The document edits of a screw, for callers that have no script to run (the Screw wizard in the app): the same screw() helper, recorded on a throwaway
// part and its steps run against an empty geometry (a screw only uses the standard planes and points in space, so it needs none). Throws a SelectorError
// whose message says why the numbers cannot work (unknown size, a hex head with a drive).
import { makeApi, type EditOp, type Ctx, type ScriptState } from './recorder';
import type { ScrewOpts } from './features/screw';

export type { ScrewOpts, ScrewHead, ScrewDrive } from './features/screw';
export { SCREW_SIZES } from './features/screw';

/** The features that make a screw, numbered F<firstSeq> onwards, as ops to append to the document. */
export function screwEditOps(opts: ScrewOpts, firstSeq: number): EditOp[] {
  const state: ScriptState = { parts: [], vars: {}, varDefs: [] };
  const part = makeApi(state).part('Screw');
  part.screw(opts);
  let seq = firstSeq;
  const ctx: Ctx = { geo: { mesh: null, edges: [], box: null }, nextId: () => `F${seq++}`, lastSketch: null, lastFeature: null };
  return part.steps.flatMap((s) => s.run(ctx));
}

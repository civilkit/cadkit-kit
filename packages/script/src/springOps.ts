// The document edits of a spring, for callers that have no script to run (the Spring wizard in the app): the spring() helper recorded on a throwaway part
// and its steps run against an empty geometry (a spring only uses points in space). Throws a SelectorError whose message says why the numbers cannot work.
import { makeApi, type EditOp, type Ctx, type ScriptState } from './recorder';
import type { SpringOpts } from './features/spring';

export type { SpringOpts, SpringHand } from './features/spring';
export { springGeometry } from './features/spring';

/** The features that make a spring, numbered F<firstSeq> onwards, as ops to append to the document. */
export function springEditOps(opts: SpringOpts, firstSeq: number): EditOp[] {
  const state: ScriptState = { parts: [], vars: {}, varDefs: [] };
  const part = makeApi(state).part('Spring');
  part.spring(opts);
  let seq = firstSeq;
  const ctx: Ctx = { geo: { mesh: null, edges: [], box: null }, nextId: () => `F${seq++}`, lastSketch: null, lastFeature: null };
  return part.steps.flatMap((s) => s.run(ctx));
}

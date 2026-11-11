// The document edits of a washer, for callers that have no script to run (the Washer wizard in the app): the washer() helper recorded on a throwaway part
// and its steps run against an empty geometry (a washer only uses points in space). Throws a SelectorError whose message says why the numbers cannot work.
import { makeApi, type EditOp, type Ctx, type ScriptState } from './recorder';
import type { WasherOpts } from './features/washer';

export type { WasherOpts, WasherKind } from './features/washer';

/** The features that make a washer, numbered F<firstSeq> onwards, as ops to append to the document. */
export function washerEditOps(opts: WasherOpts, firstSeq: number): EditOp[] {
  const state: ScriptState = { parts: [], vars: {}, varDefs: [] };
  const part = makeApi(state).part('Washer');
  part.washer(opts);
  let seq = firstSeq;
  const ctx: Ctx = { geo: { mesh: null, edges: [], box: null }, nextId: () => `F${seq++}`, lastSketch: null, lastFeature: null };
  return part.steps.flatMap((s) => s.run(ctx));
}

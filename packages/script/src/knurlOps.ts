// The document edits of a knurl, for callers that have no script to run (the Knurl wizard in the app): the same knurl() helper, recorded on a throwaway
// part and its steps run against an empty geometry (a knurl only uses the standard planes, so it needs none). Throws a SelectorError whose message says
// why the numbers cannot work (grooves overlap, a bad range).
import { makeApi, type EditOp, type Ctx, type ScriptState } from './recorder';
import type { KnurlOpts } from './features/knurl';
import type { CosmeticKnurl } from './cosmeticKnurl';

export type { KnurlOpts } from './features/knurl';

/** The features that knurl a cylinder, numbered F<firstSeq> onwards, as ops to append to the document. */
export function knurlEditOps(opts: KnurlOpts, firstSeq: number): EditOp[] {
  const state: ScriptState = { parts: [], vars: {}, varDefs: [] };
  const part = makeApi(state).part('Knurl');
  part.knurl(opts);
  let seq = firstSeq;
  const ctx: Ctx = { geo: { mesh: null, edges: [], box: null }, nextId: () => `F${seq++}`, lastSketch: null, lastFeature: null };
  return part.steps.flatMap((s) => s.run(ctx));
}

/** The cosmetic record of these options (the same knurl() helper with mode 'cosmetic'); throws like knurlEditOps for options that cannot work. */
export function knurlCosmeticRecord(opts: KnurlOpts): CosmeticKnurl {
  const state: ScriptState = { parts: [], vars: {}, varDefs: [] };
  const part = makeApi(state).part('Knurl');
  part.knurl({ ...opts, mode: 'cosmetic' });
  return part.cosmetic[0];
}

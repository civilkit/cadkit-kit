// The document edits of the fasteners (nut, standoff, heat-set insert), for callers that have no script to run (the wizards in the app): the helper recorded on a throwaway
// part and its steps run against an empty geometry (they only use points in space). Throws a SelectorError whose message says why the numbers cannot work.
import { makeApi, type EditOp, type Ctx, type ScriptState, type PartBuilder } from './recorder';
import type { CaseBoxOpts } from './features/enclosure';
import type { NutOpts, StandoffOpts, HeatSetInsertOpts } from './features/fasteners';

export type { NutOpts, StandoffOpts, HeatSetInsertOpts, FastenerThread, StandoffKind, StandoffEnds } from './features/fasteners';
export { nutGeometry, NUT_CHAMFER_ANGLE, NUT_BEARING_RATIO } from './features/fasteners';
export { NUT_SIZES, NUT_TYPES, NUT_STANDARD, STANDOFF_SIZES, INSERT_SIZES, minorInternal, type NutType, type NutSize, type StandoffSize, type InsertSize } from './features/fastenerData';

function ops(title: string, firstSeq: number, build: (p: PartBuilder) => void): EditOp[] {
  const state: ScriptState = { parts: [], vars: {}, varDefs: [] };
  const part = makeApi(state).part(title);
  build(part);
  let seq = firstSeq;
  const ctx: Ctx = { geo: { mesh: null, edges: [], box: null }, nextId: () => `F${seq++}`, lastSketch: null, lastFeature: null };
  return part.steps.flatMap((s) => s.run(ctx));
}
/** The features that make a nut, numbered F<firstSeq> onwards, as ops to append to the document. */
export const nutEditOps = (o: NutOpts, firstSeq: number): EditOp[] => ops('Nut', firstSeq, (p) => { p.nut(o); });
/** The features that make a standoff. */
export const standoffEditOps = (o: StandoffOpts, firstSeq: number): EditOp[] => ops('Standoff', firstSeq, (p) => { p.standoff(o); });
/** The features that make a heat-set insert (with its hole when asked). */
export const heatSetInsertEditOps = (o: HeatSetInsertOpts, firstSeq: number): EditOp[] => ops('Insert', firstSeq, (p) => { p.heatSetInsert(o); });

/** The features that make a two-part case (box, closed cavity, lip joint), numbered F<firstSeq> onwards. */
export const caseEditOps = (o: CaseBoxOpts, firstSeq: number): EditOp[] => ops('Case', firstSeq, (p) => { p.caseBox(o); });
export { caseGeometry, type CaseBoxOpts } from './features/enclosure';

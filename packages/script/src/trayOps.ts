// The document edits of a tray or bin, for callers that have no script to run (the Tray wizard in the app): the gridTray() helper recorded on a throwaway part and its steps run
// against an empty geometry (a tray only uses points in space). Throws a SelectorError whose message says why the numbers cannot work.
import { makeApi, type EditOp, type Ctx, type ScriptState } from './recorder';
import type { GridBaseplateOpts, GridTrayOpts } from './features/tray';

export type { GridTrayOpts, GridBaseplateOpts, TrayEnds } from './features/tray';
export { trayGeometry, baseplateGeometry, splitUnits, magnetPoints, footCells, FOOT_HEIGHT, FOOT_MIN_CORNER, MAGNET_OFFSET, MAGNET_FLOOR } from './features/tray';

/** The features that make a tray or bin, numbered F<firstSeq> onwards, as ops to append to the document. */
export function trayEditOps(o: GridTrayOpts, firstSeq: number): EditOp[] {
  const state: ScriptState = { parts: [], vars: {}, varDefs: [] };
  const part = makeApi(state).part('Tray');
  part.gridTray(o);
  let seq = firstSeq;
  const ctx: Ctx = { geo: { mesh: null, edges: [], box: null }, nextId: () => `F${seq++}`, lastSketch: null, lastFeature: null };
  return part.steps.flatMap((s) => s.run(ctx));
}

/** The features that make a Gridfinity baseplate, numbered F<firstSeq> onwards. */
export function baseplateEditOps(o: GridBaseplateOpts, firstSeq: number): EditOp[] {
  const state: ScriptState = { parts: [], vars: {}, varDefs: [] };
  const part = makeApi(state).part('Baseplate');
  part.gridBaseplate(o);
  let seq = firstSeq;
  const ctx: Ctx = { geo: { mesh: null, edges: [], box: null }, nextId: () => `F${seq++}`, lastSketch: null, lastFeature: null };
  return part.steps.flatMap((s) => s.run(ctx));
}

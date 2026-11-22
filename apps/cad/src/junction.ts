// "Fillet the junction": the edges where the faces a feature made meet faces that existed before it. After a boss is added
// these are the concave edges where the boss meets the body. Faces are named `<feature id>.<role>`, so ownership is the prefix.
import type { EditOp } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { edgeRefs, niceSize, type Box, type ViewEdge } from './edgeRefs';

const owner = (face: string): string => face.split('.')[0];

/** Keys of the two-face edges with exactly one face made by feature `id` (the other face is older). */
export function junctionEdgeKeys(id: string, edges: ViewEdge[]): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (!e.key || !e.faces || e.faces.length !== 2 || !e.mid) continue;
    const mine = e.faces.filter((f) => owner(f) === id).length;
    if (mine === 1) out.push(e.key);
  }
  return out;
}

/** The radius of the last fillet in the document, or null when there is none. */
export function lastFilletRadius(doc: PartDoc | null): number | null {
  const fs = (doc?.features ?? []) as unknown as Array<{ type: string; radius?: unknown }>;
  for (let i = fs.length - 1; i >= 0; i--) if (fs[i].type === 'fillet' && typeof fs[i].radius === 'number' && fs[i].radius as number > 0) return fs[i].radius as number;
  return null;
}

/** The edit that adds a fillet on the junction of feature `id`, at the last fillet's radius (else a size from the part). Null when it has no junction edges. */
export function junctionFilletOps(doc: PartDoc | null, id: string, edges: ViewEdge[], box: Box | null): EditOp[] | null {
  const refs = edgeRefs(junctionEdgeKeys(id, edges), edges);
  if (!refs.length) return null;
  return [{ op: 'add', feature: { type: 'fillet', radius: lastFilletRadius(doc) ?? niceSize(box), edges: refs } }];
}

/** Features that add material and so may leave a junction worth rounding. */
export function addsMaterial(f: { type?: string; op?: string } | undefined | null): boolean {
  return !!f && (f.type === 'extrude' || f.type === 'revolve') && (f.op === undefined || f.op === 'add');
}

// Edits of whole bodies as feature ops: copy, remove, combine and rename. A body is named in the document by the `body` of the feature that made
// it (an extrude with `op: newBody`, a `moveBody` copy, a `combine`); later features refer to it as `{body: name}`. A body with no document name is
// referred to by one of its faces, `{face}`, which names the lump holding that face and survives regeneration.
import type { EditOp } from '@ck/session';

type Rec = Record<string, unknown>;
export interface BodyTarget {
  /** the name the document gives the body, when it has one */
  docName?: string;
  /** a face of the body (its lowest face name) */
  face: string;
}

export const refOf = (b: BodyTarget): { body: string } | { face: string } => (b.docName ? { body: b.docName } : { face: b.face });

/** Every body name the document uses: the `body` of any feature and the `names` of a split or lip joint. */
export function usedBodyNames(features: readonly Rec[], extra: Iterable<string> = []): Set<string> {
  const out = new Set<string>(extra);
  for (const f of features) {
    if (typeof f.body === 'string' && f.body) out.add(f.body);
    if (f.type === 'split' || f.type === 'lipJoint') for (const n of Array.isArray(f.names) ? f.names : []) if (typeof n === 'string' && n.trim()) out.add(n.trim());
  }
  return out;
}

/** Does the document give a body a name the kernel knows: a `newBody` or `body` of a feature, or the `names` of a split or lip joint?
 *  Only then is the kernel asked which lump carries which name (the Bodies list shows these names, else the feature's own). */
export function namesBodies(features: readonly Rec[]): boolean {
  return features.some((f) => f.op === 'newBody' || (typeof f.body === 'string' && f.body !== '')
    || ((f.type === 'split' || f.type === 'lipJoint') && Array.isArray(f.names) && f.names.some((n) => typeof n === 'string' && n.trim() !== '')));
}

/** `base`, or `base 2`, `base 3`, ... : the first name that is free. */
export function freeBodyName(used: ReadonlySet<string>, base: string): string {
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** A copy of the body, in place (move it afterwards): `moveBody` with `copy` and the name of the copy. */
export function copyBodyOps(b: BodyTarget, copyName: string): EditOp[] {
  return [{ op: 'add', feature: { type: 'moveBody', bodies: [refOf(b)], translate: [0, 0, 0], copy: true, body: copyName } }];
}

/** Delete the bodies. */
export function removeBodyOps(bs: readonly BodyTarget[]): EditOp[] {
  return [{ op: 'add', feature: { type: 'deleteBody', mode: 'delete', bodies: bs.map(refOf) } }];
}

export type CombineOp = 'union' | 'cut' | 'intersect' | 'split';
/** The first body combined with the others, which are used up (`keepTools` keeps them). */
export function combineBodyOps(op: CombineOp, target: BodyTarget, tools: readonly BodyTarget[], keepTools = false): EditOp[] {
  return [{ op: 'add', feature: { type: 'combine', op, target: refOf(target), tools: tools.map(refOf), ...(keepTools ? { keepTools: true } : {}) } }];
}

/** `value` with the body `from` called `to`: the `{body: from}` selectors at any depth. Returns the same object when nothing changed. */
function renamed(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((x) => { const y = renamed(x, from, to); if (y !== x) changed = true; return y; });
    return changed ? out : value;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out: Rec = {};
    for (const [k, v] of Object.entries(value as Rec)) {
      const nv = k === 'body' && v === from ? to : renamed(v, from, to);
      if (nv !== v) changed = true;
      out[k] = nv;
    }
    return changed ? out : value;
  }
  return value;
}

/** Call the body `from` by the name `to` everywhere: the feature that made it (`body`) and every `{body: from}` that refers to it. Null when `to` is taken
 *  or empty, or no feature uses `from`. */
export function renameBodyOps(features: readonly Rec[], from: string, to: string): EditOp[] | null {
  const name = to.trim();
  if (!name || name === from || usedBodyNames(features).has(name)) return null;
  const ops: EditOp[] = [];
  for (const f of features) {
    const g = renamed(f, from, name) as Rec;
    if (g !== f) ops.push({ op: 'replace', id: String(f.id), feature: g });
  }
  return ops.length ? ops : null;
}

// Pure helpers for broken-reference survival (frozen pose): when an upstream feature is deleted or suppressed,
// dependent sketches and planes can hold their last known placement frame (`frozenFrame`) with a `detachedReference`
// warning so downstream features keep building until the user reattaches them.
import type { EditOp, ViewFrame } from '@ck/session';
import { dependents } from './treeActions';

type Feat = { id: string; type?: string; suppressed?: boolean; [k: string]: unknown };
type RefLike = { kind?: unknown; id?: unknown } | null | undefined;

/** True when `v` is a finite placement frame `{ o, x, y, z }` of 3-vectors. */
export function isValidFrame(v: unknown): v is ViewFrame {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  for (const k of ['o', 'x', 'y', 'z'] as const) {
    const a = f[k];
    if (!Array.isArray(a) || a.length !== 3 || !a.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  }
  return true;
}

/** True when `f` is a sketch or plane whose placement depends on a non-built-in reference and can survive via `frozenFrame`. */
export function isDetachableFeature(f: Feat): boolean {
  if (f.type === 'sketch') {
    const p = f.plane as RefLike;
    return !!p && typeof p === 'object' && p.kind !== 'std';
  }
  if (f.type === 'plane') {
    return f.mode !== 'frame';
  }
  if (f.type === 'connector') {
    const a = f.anchor as RefLike;
    return !!a && typeof a === 'object' && a.kind !== 'std' && a.kind !== 'frame';
  }
  return false;
}

/** Direct dependents of `targetIds` (not in `targetIds` themselves), in document order. */
export function directDependentsOf(features: Feat[], targetIds: readonly string[]): Feat[] {
  const d = dependents(features);
  const removing = new Set(targetIds);
  const directIds = new Set<string>();
  for (const id of targetIds) {
    for (const u of d.get(id) ?? []) {
      if (!removing.has(u)) directIds.add(u);
    }
  }
  return features.filter((f) => directIds.has(f.id));
}

/** True when every direct dependent of `removingIds` is a detachable sketch or plane with a known frame,
 *  so `removingIds` can be deleted while keeping downstream features alive at their frozen pose. */
export function canDetachOnDelete(
  features: Feat[],
  removingIds: readonly string[],
  frameOf: (id: string) => ViewFrame | null | undefined,
): boolean {
  const direct = directDependentsOf(features, removingIds);
  if (!direct.length) return false;
  return direct.every((f) => isDetachableFeature(f) && isValidFrame(frameOf(f.id)));
}

/** Atomic edit batch to delete `removingIds` while freezing the last-known frame onto every directly dependent
 *  sketch/plane so downstream geometry survives with a `detachedReference` warning. Returns empty when not detachable. */
export function detachDeleteOps(
  features: Feat[],
  removingIds: readonly string[],
  frameOf: (id: string) => ViewFrame | null | undefined,
): EditOp[] {
  const direct = directDependentsOf(features, removingIds);
  if (!direct.length || !direct.every((f) => isDetachableFeature(f) && isValidFrame(frameOf(f.id)))) return [];
  const ops: EditOp[] = [];
  for (const dep of direct) {
    const fr = frameOf(dep.id)!;
    ops.push({ op: 'set', id: dep.id, path: 'frozenFrame', value: { o: [...fr.o], x: [...fr.x], y: [...fr.y], z: [...fr.z] } });
  }
  const sel = new Set(removingIds);
  for (const f of features) {
    if (sel.has(f.id)) ops.push({ op: 'remove', id: f.id, detach: true });
  }
  return ops;
}

/** Ops to stamp `frozenFrame` onto unsuppressed dependent sketches/planes right before suppressing `suppressingIds`,
 *  so suppressing an upstream body/plane keeps downstream sketches/planes alive at their frozen pose. */
export function freezeBeforeSuppressOps(
  features: Feat[],
  suppressingIds: readonly string[],
  frameOf: (id: string) => ViewFrame | null | undefined,
): EditOp[] {
  const direct = directDependentsOf(features, suppressingIds);
  const ops: EditOp[] = [];
  for (const dep of direct) {
    if (dep.suppressed) continue;
    if (!isDetachableFeature(dep)) continue;
    const fr = frameOf(dep.id);
    if (!isValidFrame(fr)) continue;
    ops.push({ op: 'set', id: dep.id, path: 'frozenFrame', value: { o: [...fr.o], x: [...fr.x], y: [...fr.y], z: [...fr.z] } });
  }
  return ops;
}

/** Patch to reattach a detached sketch (`plane`) or plane (`base`) to a new live reference and clear `frozenFrame`. */
export function reattachPatch(field: 'plane' | 'base', ref: { kind: string; id: string }): Record<string, unknown> {
  return { [field]: ref, frozenFrame: null };
}

/** Patch to turn a detached reference plane into an independent `frame` plane at its frozen pose, clearing the warning. */
export function makeIndependentPlanePatch(fr: ViewFrame): Record<string, unknown> {
  return {
    mode: 'frame',
    origin: [...fr.o],
    xDir: [...fr.x],
    yDir: [...fr.y],
    base: null,
    frozenFrame: null,
  };
}

/** Patch to turn a detached mate connector into an independent `frame` anchor at its frozen pose, clearing the warning. */
export function makeIndependentConnectorPatch(fr: ViewFrame): Record<string, unknown> {
  return {
    anchor: { kind: 'frame', origin: [...fr.o], xDir: [...fr.x], yDir: [...fr.y] },
    offset: null,
    rotate: null,
    flip: null,
    rotateZ: null,
    frozenFrame: null,
  };
}

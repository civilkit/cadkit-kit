// app_edit: one atomic transaction of add / replace / remove / transform / setParam on the open document. This file checks every op against the
// document as it would be after the ops before it (so an unknown id or a duplicate is refused with its index before the kernel is asked), turns the
// ops into the kernel's edit ops, and names which features a finished edit changed. The kernel then rebuilds the candidate and either commits
// all of it as ONE history step or none of it. Ids are never renumbered: replace, setParam and transform keep the id; an add without an id gets the next free one.
import { BridgeError } from '@kit/agent-link';
import { featureHash } from './stateQuery';

export const MAX_EDIT_OPS = 50;
/** One transaction may carry at most this much feature JSON (characters): a big model goes in through app_open_asset, not through here. */
export const MAX_EDIT_CHARS = 200_000;

/** The kernel's edit ops (the part of @ck/session's EditOp this uses). */
export type KernelOp =
  | { op: 'add'; feature: Record<string, unknown>; index?: number }
  | { op: 'set'; id: string; path: string; value: unknown }
  | { op: 'remove'; id: string; cascade?: boolean }
  | { op: 'replace'; id: string; feature: Record<string, unknown> };

interface Doc { features: Array<Record<string, unknown>> }
const bad = (i: number, op: string, message: string, hint?: string) => new BridgeError('bad_op', `op ${i} (${op}): ${message}`, hint ?? 'nothing was changed; fix this op and send the transaction again');
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const vec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Check `ops` against `doc` and translate them. Throws BridgeError('bad_op') naming the first op that cannot apply. */
export function planEdit(rawOps: unknown, doc: Doc): KernelOp[] {
  if (!Array.isArray(rawOps) || rawOps.length < 1 || rawOps.length > MAX_EDIT_OPS) throw new BridgeError('bad_input', `ops must be a list of 1 to ${MAX_EDIT_OPS} operations`);
  if (JSON.stringify(rawOps).length > MAX_EDIT_CHARS) throw new BridgeError('edit_too_large', `the transaction is over ${MAX_EDIT_CHARS} characters`, 'a big model goes in with app_open_asset; split the rest into several transactions');
  const types = new Map(doc.features.map((f) => [String(f.id), String(f.type)] as const));
  const out: KernelOp[] = [];
  rawOps.forEach((raw, i) => {
    if (!isObj(raw)) throw bad(i, '?', 'each op must be an object');
    const op = String(raw.op);
    const needId = (): string => {
      if (typeof raw.id !== 'string' || !raw.id) throw bad(i, op, 'id is required');
      if (!types.has(raw.id)) throw bad(i, op, `no feature ${raw.id}`, `nothing was changed; ids now: ${[...types.keys()].slice(0, 40).join(', ')}`);
      return raw.id;
    };
    switch (op) {
      case 'add': {
        if (!isObj(raw.feature) || typeof raw.feature.type !== 'string') throw bad(i, op, 'feature must be an object with a type');
        if (raw.index !== undefined && (!Number.isInteger(raw.index) || (raw.index as number) < 0 || (raw.index as number) > types.size)) throw bad(i, op, `index must be 0 to ${types.size}`);
        const id = raw.feature.id;
        if (id !== undefined) {
          if (typeof id !== 'string' || !id) throw bad(i, op, 'feature.id must be a non-empty string');
          if (types.has(id)) throw bad(i, op, `a feature ${id} already exists`, 'leave the id out and one is assigned, or use replace');
          types.set(id, raw.feature.type);
        }
        out.push({ op: 'add', feature: raw.feature, ...(raw.index !== undefined ? { index: raw.index as number } : {}) });
        return;
      }
      case 'replace': {
        const id = needId();
        if (!isObj(raw.feature) || typeof raw.feature.type !== 'string') throw bad(i, op, 'feature must be an object with a type');
        if (raw.feature.id !== undefined && raw.feature.id !== id) throw bad(i, op, `feature.id ${String(raw.feature.id)} differs from ${id}: a replace keeps the id`, 'leave feature.id out');
        types.set(id, raw.feature.type);
        out.push({ op: 'replace', id, feature: { ...raw.feature, id } });
        return;
      }
      case 'remove': {
        const id = needId();
        types.delete(id);
        out.push({ op: 'remove', id, ...(raw.cascade === true ? { cascade: true } : {}) });
        return;
      }
      case 'setParam': {
        const id = needId();
        if (typeof raw.path !== 'string' || !raw.path) throw bad(i, op, 'path is required (for example depth, or entities.0.r)');
        if (raw.path === 'id' || raw.path === 'type' || raw.path.startsWith('id.') || raw.path.startsWith('type.')) throw bad(i, op, `${raw.path} cannot be set: ids and types are stable`, 'use replace to change a feature\'s type');
        if (raw.value === undefined) throw bad(i, op, 'value is required');
        out.push({ op: 'set', id, path: raw.path, value: raw.value });
        return;
      }
      case 'transform': {
        const id = needId();
        if (types.get(id) !== 'moveBody') throw bad(i, op, `${id} is a ${types.get(id)}, not a moveBody`, 'add a moveBody feature ({type: "moveBody", translate, rotate}) to move a body, then transform that');
        if (raw.translate === undefined && raw.rotate === undefined) throw bad(i, op, 'give translate [x, y, z] and/or rotate {axis, angle, origin?}');
        if (raw.translate !== undefined) { if (!vec3(raw.translate)) throw bad(i, op, 'translate must be three numbers [x, y, z] (mm)'); out.push({ op: 'set', id, path: 'translate', value: raw.translate }); }
        if (raw.rotate !== undefined) {
          const r = raw.rotate;
          const axisOk = isObj(r) && (vec3(r.axis) || r.axis === 'x' || r.axis === 'y' || r.axis === 'z');
          if (!isObj(r) || !axisOk || typeof r.angle !== 'number' || !Number.isFinite(r.angle) || (r.origin !== undefined && !vec3(r.origin))) throw bad(i, op, 'rotate must be {axis: [x, y, z] or "x"|"y"|"z", angle: degrees, origin?: [x, y, z]}');
          out.push({ op: 'set', id, path: 'rotate', value: { axis: r.axis, angle: r.angle, ...(r.origin ? { origin: r.origin } : {}) } });
        }
        return;
      }
      default: throw bad(i, op, 'unknown op', 'ops: add, replace, remove, transform, setParam');
    }
  });
  return out;
}

/** What a finished edit changed, by feature id: the features whose JSON or build status differs, the ones that are new and the ones that are gone. */
export interface FeatureDiff { changed: string[]; added: string[]; removed: string[] }
export function snapshotFeatures(features: Array<Record<string, unknown>>, bad: Map<string, { code?: string }>): Map<string, string> {
  return new Map(features.map((f) => [String(f.id), featureHash(f, bad as never)] as const));
}
export function diffFeatures(before: Map<string, string>, features: Array<Record<string, unknown>>, bad: Map<string, { code?: string }>): FeatureDiff {
  const now = snapshotFeatures(features, bad);
  const d: FeatureDiff = { changed: [], added: [], removed: [] };
  for (const [id, h] of now) { const o = before.get(id); if (o === undefined) d.added.push(id); else if (o !== h) d.changed.push(id); }
  for (const id of before.keys()) if (!now.has(id)) d.removed.push(id);
  return d;
}

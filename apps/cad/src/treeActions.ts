// Pure helpers for the feature tree: which feature a face belongs to, what depends on what, multi-select,
// the rollback marker, and the ops for rename and delete. No DOM, no kernel.
import type { EditOp } from '@ck/session';

/** Feature that owns a face or edge name: `F2.C1` -> `F2`. A bare feature id gives itself; anything else null. */
export function faceOwner(name: string): string | null {
  const m = /^(F\d+)(?:[.:]|$)/.exec(name);
  return m ? m[1] : null;
}

/** Which tree row a face / edge name belongs to when viewing. In a part it is the feature id before the first dot; in an
 *  assembly a name carrying `@F6.1` belongs to the component F6 (the insert feature), and a name of the root part to its feature. */
export function viewOwner(name: string, inserts: ReadonlySet<string>): string | null {
  if (name.includes('@')) {
    const first = name.split('|')[0].replace(/#\d+$/, '');
    const ids = [...first.matchAll(/@(F\d+)\.(\d+)/g)].map((m) => m[1]);
    for (let i = ids.length - 1; i >= 0; i--) if (inserts.has(ids[i])) return ids[i];
    return null;
  }
  return faceOwner(name);
}

/** The face / edge names (of `names`) that belong to the component `insertId`, for lighting up a selected component row. */
export function componentNames(names: readonly string[], insertId: string, inserts: ReadonlySet<string>): string[] {
  return names.filter((n) => viewOwner(n, inserts) === insertId);
}

/** The tree rows to show for a picked face / edge / corner name. The owning feature is the id before the first dot (`F62.S.e3`, `F62.C0`);
 *  a patterned or mirrored name carries the feature that repeated it after an `@` (`F4.S.h1@F9.2`): the seed `F4` is the primary row and
 *  `F9` comes with it. A corner name `v:...` or a body name has no owner. Only ids in `rows` count; null when none of them is. */
export function revealTargets(name: string, rows: ReadonlySet<string> | readonly string[]): { id: string; also: string[] } | null {
  const has = rows instanceof Set ? (x: string) => rows.has(x) : (x: string) => (rows as readonly string[]).includes(x);
  const first = name.split('|')[0];
  const base = /^(F\d+)(?=[.:@#]|$)/.exec(first)?.[1] ?? null;
  const via = [...first.matchAll(/@(F\d+)(?=[.:@#]|$)/g)].map((m) => m[1]).filter((x, i, a) => a.indexOf(x) === i);
  const all = [...(base ? [base] : []), ...via].filter(has);
  if (!all.length) return null;
  return { id: all[0], also: all.slice(1) };
}

type Feat = { id: string; [k: string]: unknown };

/** String leaves of a feature that can refer to another feature (everything but its own id and display name). */
function refStrings(f: Feat): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(f)) if (k !== 'id' && k !== 'name') walk(v);
  function walk(v: unknown): void {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  }
  return out;
}

/** For every feature, the ids of the features that refer to it directly: by id (a sketch, a path, a seed) or as the prefix
 *  of a face / edge name (`F2.C1`). Only features other than itself; the answer is in document order. */
export function dependents(features: Feat[]): Map<string, string[]> {
  const refs = features.map((f) => ({ id: f.id, strings: refStrings(f) }));
  const out = new Map<string, string[]>();
  for (const f of features) {
    const hit = refs.filter((r) => r.id !== f.id && r.strings.some((s) => s === f.id || faceOwner(s) === f.id)).map((r) => r.id);
    out.set(f.id, hit);
  }
  return out;
}

/** The ids that rely on `id`, directly or through other features (what would break if it went away). */
export function dependentsOf(features: Feat[], id: string): string[] {
  const d = dependents(features);
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) for (const n of d.get(queue.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  return features.map((f) => f.id).filter((x) => seen.has(x));
}

/** The selection after a click on a tree row. Plain click selects only it; Ctrl/Cmd toggles it; Shift selects the
 *  range from the anchor (the last plain or Ctrl click) to it, in `order` (the rows as shown). */
export function nextSelection(
  current: string[], anchor: string | null, clicked: string, order: string[], mods: { ctrl?: boolean; shift?: boolean },
): { selection: string[]; anchor: string } {
  if (mods.shift && anchor && order.includes(anchor)) {
    const a = order.indexOf(anchor), b = order.indexOf(clicked);
    if (b >= 0) {
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      return { selection: mods.ctrl ? [...new Set([...current, ...range])] : range, anchor };
    }
  }
  if (mods.ctrl) {
    return { selection: current.includes(clicked) ? current.filter((x) => x !== clicked) : [...current, clicked], anchor: clicked };
  }
  return { selection: [clicked], anchor: clicked };
}

/** Number of features the rollback marker lets through, or null for "all". The marker is stored as the id of the last
 *  feature that is still on (`''` for none), so it survives inserts, moves and removals. */
export function rollbackCount(anchor: string | null, ids: string[]): number | null {
  if (anchor === null) return null;
  if (anchor === '') return 0;
  const i = ids.indexOf(anchor);
  return i < 0 ? null : i + 1;
}

/** When the anchor feature is gone (deleted, undone), the nearest earlier feature that is still there. `before` is the
 *  id list from when the anchor was last valid. */
export function repairAnchor(anchor: string | null, before: string[], now: string[]): string | null {
  if (anchor === null || anchor === '' || now.includes(anchor)) return anchor;
  for (let i = before.indexOf(anchor) - 1; i >= 0; i--) if (now.includes(before[i])) return before[i];
  return '';
}

/** Where new features go while the model is rolled back: right after the marker. */
export function withRollbackInsert(ops: EditOp[], count: number | null): EditOp[] {
  if (count === null) return ops;
  let at = count;
  return ops.map((o) => (o.op === 'add' && o.index === undefined ? { ...o, index: at++ } : o));
}

/** A user rename also ends the live generated name (`autoName` false): the name given is kept as typed. */
export const renameOps = (id: string, name: string): EditOp[] => [{ op: 'set', id, path: 'name', value: name }, { op: 'set', id, path: 'autoName', value: false }];

/** Ops to delete these features. A feature other features still use is removed with them only when all of them are in
 *  the selection too; otherwise the plain `remove` goes through and the session refuses it with its reason. */
export function deleteOps(features: Feat[], ids: string[]): EditOp[] {
  const d = dependents(features);
  const sel = new Set(ids);
  return features.filter((f) => sel.has(f.id)).map((f) => {
    const users = d.get(f.id) ?? [];
    return { op: 'remove' as const, id: f.id, ...(users.length && users.every((u) => sel.has(u)) ? { cascade: true } : {}) };
  });
}

/** The features that block a delete, read from the session's refusal ("F3 is still referenced by F4, F7 (use cascade to remove them too)"):
 *  their ids, without the ones already being deleted. Empty when the refusal is about something else. */
export function blockingFeatures(refusal: string | undefined | null, deleting: string[]): string[] {
  const m = /still referenced by (.+?) \(use cascade/.exec(refusal ?? '');
  if (!m) return [];
  return m[1].split(',').map((x) => x.trim()).filter((x) => x && !deleting.includes(x));
}

/** Ops to toggle suppression on all of these: if every one is suppressed they come back, else they are all suppressed. */
export function suppressOps(features: Feat[], ids: string[]): EditOp[] {
  const sel = features.filter((f) => ids.includes(f.id));
  const value = !sel.every((f) => f.suppressed === true);
  return sel.filter((f) => (f.suppressed === true) !== value).map((f) => ({ op: 'set' as const, id: f.id, path: 'suppressed', value }));
}

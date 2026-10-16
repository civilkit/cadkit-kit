// Folders of the feature tree, as edits. A folder is not a record of its own: it is the `group` name on features (what the
// script helper group() writes), and the tree shows a run of two or more consecutive top-level rows with the same name under
// one folder row. So a folder is always a contiguous range, the regeneration order is the order of the features, and
// every folder action is an ordinary list of EditOps (`set` / `replace` / `move`) for one undo step. No DOM, no kernel.
import type { EditOp } from '@ck/session';
import { sketchOwners, type FeatureRow } from '@kit/ui';
import { dependents } from './treeActions';

type Feat = { id: string; group?: string; [k: string]: unknown };

/** Why a folder action was refused; the app turns each into a short message (`app.folder.refuse.<reason>`). */
export type Refusal = 'needTwo' | 'notContiguous' | 'order' | 'nameTaken' | 'nameEmpty' | 'splits' | 'noFolder';
export type Plan = { ok: true; ops: EditOp[]; /** the folder a grouping made */ name?: string } | { ok: false; reason: Refusal; detail?: string };

export type DragSource = { kind: 'row'; id: string } | { kind: 'folder'; name: string };
export type DropTarget = DragSource;

const ok = (ops: EditOp[], name?: string): Plan => ({ ok: true, ops, ...(name !== undefined ? { name } : {}) });
const no = (reason: Refusal, detail?: string): Plan => ({ ok: false, reason, ...(detail ? { detail } : {}) });

/** The first of `Folder`, `Folder 2`, `Folder 3` ... that no feature uses as its group. */
export function uniqueFolderName(base: string, features: Feat[]): string {
  const taken = new Set(features.map((f) => f.group).filter((g): g is string => typeof g === 'string'));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

interface Ctx {
  features: Feat[];
  order: string[];
  groupOf: Map<string, string | undefined>;
  owner: Map<string, string>;
  /** Top-level row for any row (itself when nothing owns it). */
  topOf(id: string): string;
  isTop(id: string): boolean;
  /** The row and every row tucked under it. */
  family(top: string): string[];
}

function ctxOf(rows: FeatureRow[], features: Feat[]): Ctx {
  const owner = sketchOwners(rows);
  const topOf = (id: string): string => { let c = id; for (let g = 0; g < 8; g++) { const o = owner.get(c); if (!o) break; c = o; } return c; };
  const order = features.map((f) => f.id);
  return {
    features, order, owner, topOf,
    groupOf: new Map(features.map((f) => [f.id, typeof f.group === 'string' && f.group ? f.group : undefined])),
    isTop: (id) => !owner.has(id),
    family: (top) => order.filter((id) => topOf(id) === top),
  };
}

interface Run { name?: string; tops: string[] }
function runsOf(tops: string[], groupOf: (id: string) => string | undefined): Run[] {
  const runs: Run[] = [];
  for (const id of tops) { const g = groupOf(id), last = runs.at(-1); if (last && g !== undefined && last.name === g) last.tops.push(id); else runs.push({ name: g, tops: [id] }); }
  return runs;
}

/** The folders as the tree shows them (a run of two or more top-level rows with one name), in order. */
export function folderRuns(rows: FeatureRow[], features: Feat[]): Array<{ name: string; ids: string[] }> {
  const c = ctxOf(rows, features);
  return runsOf(c.order.filter(c.isTop), (id) => c.groupOf.get(id)).filter((r) => r.name !== undefined && r.tops.length >= 2).map((r) => ({ name: r.name!, ids: r.tops.flatMap(c.family) }));
}

/** Every feature id a folder holds (its rows and the sketches tucked under them); empty when there is no such folder. */
export function folderIds(rows: FeatureRow[], features: Feat[], name: string): string[] {
  return folderRuns(rows, features).find((r) => r.name === name)?.ids ?? [];
}

/** The folder a feature sits in, if any. */
export function folderOf(rows: FeatureRow[], features: Feat[], id: string): string | undefined {
  const c = ctxOf(rows, features), top = c.topOf(id);
  return folderRuns(rows, features).find((r) => r.ids.includes(top))?.name;
}

/** `moves` that turn the current order into `target` (each id goes to its place, front to back). Pairs that are in the
 *  same order before and after never swap on the way, so a result that keeps every feature after what it uses is valid at each step. */
function movesTo(cur: string[], target: string[]): EditOp[] {
  const c = [...cur], ops: EditOp[] = [];
  for (let i = 0; i < target.length; i++) {
    if (c[i] === target[i]) continue;
    ops.push({ op: 'move', id: target[i], to: i });
    c.splice(c.indexOf(target[i]), 1); c.splice(i, 0, target[i]);
  }
  return ops;
}

/** The common end of every action: given the order and groups wanted, tidy folders that fell to one row, refuse a result
 *  that splits a folder or puts a feature before one it uses, and build the ops. */
function finish(c: Ctx, order: string[], groupOf: Map<string, string | undefined>, touched: Set<string>, name?: string): Plan {
  const g = new Map(groupOf);
  const tops = order.filter(c.isTop);
  const runs = runsOf(tops, (id) => g.get(id));
  for (const n of touched) if (runs.filter((r) => r.name === n).length > 1) return no('splits', n);
  for (const r of runs) if (r.name !== undefined && r.tops.length === 1 && touched.has(r.name)) for (const id of c.family(r.tops[0])) g.set(id, undefined);
  // a feature may only use earlier ones
  const pos = new Map(order.map((id, i) => [id, i]));
  const was = new Map(c.order.map((id, i) => [id, i]));
  for (const [dep, users] of dependents(c.features)) {
    for (const u of users) {
      if ((pos.get(dep) ?? 0) > (pos.get(u) ?? 0) && (was.get(dep) ?? 0) < (was.get(u) ?? 0)) return no('order', `${u} uses ${dep}`);
    }
  }
  const ops: EditOp[] = movesTo(c.order, order);
  for (const f of c.features) {
    const before = c.groupOf.get(f.id), after = g.get(f.id);
    if (before === after) continue;
    if (after !== undefined) ops.push({ op: 'set', id: f.id, path: 'group', value: after });
    else { const { group: _drop, ...rest } = f; ops.push({ op: 'replace', id: f.id, feature: rest }); }   // `set` cannot remove a key
  }
  return ok(ops, name);
}

const assign = (c: Ctx, tops: string[], name: string | undefined): Map<string, string | undefined> => {
  const g = new Map(c.groupOf);
  for (const t of tops) for (const id of c.family(t)) g.set(id, name);
  return g;
};

/** Put the selected features in a new folder. They must be consecutive in the tree (the folder is a range of the
 *  regeneration order and nothing is moved to make it one) and at least two rows. */
export function groupPlan(rows: FeatureRow[], features: Feat[], ids: string[], baseName: string): Plan {
  const c = ctxOf(rows, features);
  const sel = new Set(ids.filter((i) => c.groupOf.has(i)).map(c.topOf));
  const tops = c.order.filter(c.isTop);
  if (sel.size < 2) return no('needTwo');
  const at = tops.map((t, i) => (sel.has(t) ? i : -1)).filter((i) => i >= 0);
  if (at[at.length - 1] - at[0] + 1 !== at.length) return no('notContiguous');
  const name = uniqueFolderName(baseName, features);
  const touched = new Set<string>([name]);
  for (const t of sel) { const o = c.groupOf.get(t); if (o !== undefined) touched.add(o); }
  return finish(c, c.order, assign(c, tops.filter((t) => sel.has(t)), name), touched, name);
}

/** Take the selected features out of their folder. Only from the ends of it: a feature in the middle would split the folder. */
export function removeFromFolderPlan(rows: FeatureRow[], features: Feat[], ids: string[]): Plan {
  const c = ctxOf(rows, features);
  const tops = [...new Set(ids.filter((i) => c.groupOf.has(i)).map(c.topOf))];
  const inFolder = new Set(folderRuns(rows, features).flatMap((r) => r.ids));
  const out = tops.filter((t) => inFolder.has(t));
  if (!out.length) return no('noFolder');
  const touched = new Set(out.map((t) => c.groupOf.get(t)!));
  return finish(c, c.order, assign(c, out, undefined), touched);
}

/** Rename the folder `from`. The new name must not belong to another folder. */
export function renameFolderPlan(features: Feat[], from: string, to: string): Plan {
  const name = to.trim();
  if (!name) return no('nameEmpty');
  if (name === from) return ok([], name);
  if (features.some((f) => f.group === name)) return no('nameTaken', name);
  return ok(features.filter((f) => f.group === from).map((f) => ({ op: 'set' as const, id: f.id, path: 'group', value: name })), name);
}

/** Dissolve a folder; its features stay where they are. */
export function ungroupPlan(features: Feat[], name: string): Plan {
  const ops = features.filter((f) => f.group === name).map((f) => { const { group: _drop, ...rest } = f; return { op: 'replace' as const, id: f.id, feature: rest }; });
  return ops.length ? ok(ops) : no('noFolder');
}

/** A drag and drop in the tree.
 *  - row onto a row: the feature takes that row's place (as before); it joins the folder the row is in, or leaves its own when the row is outside any folder.
 *  - row onto a folder: the feature goes to the end of the folder and joins it.
 *  - folder onto a row or folder: the folder (its rows and their sketches) goes before that row or folder when it was below, after when above. A row inside another folder stands for that folder; folders never nest. */
export function dropPlan(rows: FeatureRow[], features: Feat[], drag: DragSource, target: DropTarget): Plan {
  const c = ctxOf(rows, features);
  const runs = folderRuns(rows, features);
  const runOfTop = (top: string) => runs.find((r) => r.ids.includes(top));
  const runNamed = (n: string) => runs.find((r) => r.name === n);

  if (drag.kind === 'row') {
    if (!c.groupOf.has(drag.id)) return ok([]);
    let dest: number, group: string | undefined;
    const mine = runOfTop(c.topOf(drag.id))?.name;
    if (target.kind === 'folder') {
      const run = runNamed(target.name);
      if (!run) return no('noFolder');
      const last = Math.max(...run.ids.map((i) => c.order.indexOf(i)));
      dest = c.order.indexOf(drag.id) < last ? last : last + 1; group = target.name;
    } else {
      if (!c.groupOf.has(target.id)) return ok([]);
      dest = c.order.indexOf(target.id);
      const theirs = runOfTop(c.topOf(target.id))?.name;
      group = theirs ?? (mine !== undefined ? undefined : c.groupOf.get(drag.id));
    }
    const order = c.order.filter((i) => i !== drag.id);
    order.splice(Math.min(dest, order.length), 0, drag.id);
    const g = c.isTop(drag.id) ? assign(c, [drag.id], group) : new Map(c.groupOf).set(drag.id, group);
    const touched = new Set([mine, group].filter((x): x is string => x !== undefined));
    if (order.every((i, k) => i === c.order[k]) && [...g].every(([i, v]) => v === c.groupOf.get(i))) return ok([]);
    return finish(c, order, g, touched);
  }

  const run = runNamed(drag.name);
  if (!run) return no('noFolder');
  // the unit the target stands for: its folder, or itself with the sketches under it
  let unit: string[];
  if (target.kind === 'folder') { const t = runNamed(target.name); if (!t) return no('noFolder'); unit = t.ids; }
  else { if (!c.groupOf.has(target.id)) return ok([]); const top = c.topOf(target.id); unit = runOfTop(top)?.ids ?? c.family(top); }
  const block = new Set(run.ids);
  if (unit.some((i) => block.has(i))) return ok([]);
  const idx = (i: string) => c.order.indexOf(i);
  const below = Math.min(...run.ids.map(idx)) > Math.max(...unit.map(idx));
  const moving = c.order.filter((i) => block.has(i)), rest = c.order.filter((i) => !block.has(i));
  const at = below ? Math.min(...unit.map((i) => rest.indexOf(i))) : Math.max(...unit.map((i) => rest.indexOf(i))) + 1;
  const order = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  return finish(c, order, c.groupOf, new Set());
}

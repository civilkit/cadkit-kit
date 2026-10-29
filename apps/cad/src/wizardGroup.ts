// One tree folder per wizard result. A folder is the cosmetic `group` name on features (see treeFolders.ts), so a wizard that
// stamps the same name on everything it adds makes its result show, hide and delete as a unit. Every wizard goes through
// these helpers: the name is chosen once (wizardGroupName), then stamped on the ops or the document patch it commits.
import type { EditOp } from '@ck/session';
import { uniqueFolderName } from './treeFolders';

type Feat = { id?: string; group?: unknown };

/** The folder name for a wizard's result.
 *  - A new result: the wizard's title, made unique ("Bearing", "Bearing 2") so two results never run together into one folder.
 *  - A result being edited (`existing`: role -> feature id): the folder it already sits in, even when the user renamed it; undefined when it
 *    was made before wizards grouped (the edit then leaves it as it is). */
export function wizardGroupName(features: readonly Feat[], title: string, existing?: Record<string, string> | null): string | undefined {
  if (!existing) return uniqueFolderName(title, features as Array<{ id: string; group?: string }>);
  const mine = new Set(Object.values(existing));
  const g = features.find((f) => typeof f.id === 'string' && mine.has(f.id) && typeof f.group === 'string' && f.group !== '')?.group;
  return typeof g === 'string' ? g : undefined;
}

/** The ops with `group` stamped on every feature they add or replace (a `replace` is a whole feature, so it would otherwise drop the group). */
export function groupOps(ops: EditOp[], name: string | undefined): EditOp[] {
  if (name === undefined) return ops;
  return ops.map((o) => (o.op === 'add' || o.op === 'replace' ? { ...o, feature: { ...(o.feature as Record<string, unknown>), group: name } } : o) as EditOp);
}

/** The same for a wizard's document patch: the features it replaces in place and the ones it appends. */
export function groupPatch<P extends { features?: Record<string, Record<string, unknown>>; append?: Array<Record<string, unknown>> }>(patch: P, name: string | undefined): P {
  if (name === undefined) return patch;
  return {
    ...patch,
    ...(patch.features ? { features: Object.fromEntries(Object.entries(patch.features).map(([id, f]) => [id, { ...f, group: name }])) } : {}),
    ...(patch.append ? { append: patch.append.map((f) => ({ ...f, group: name })) } : {}),
  };
}

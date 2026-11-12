import { dropKind, type DropKind } from './names';

export type DropPlan = { action: 'none' } | { action: 'multiple' } | { action: 'open'; kind: DropKind; name: string; /** an OBJ dropped together with its .mtl: the material file's name */ mtl?: string };

/** What to do with the files of a drop: one file at a time (an OBJ may come with its .mtl); its kind decides the path. */
export function planDrop(names: string[]): DropPlan {
  if (names.length === 0) return { action: 'none' };
  if (names.length === 2) {
    const obj = names.find((n) => /\.obj$/i.test(n)), mtl = names.find((n) => /\.mtl$/i.test(n));
    if (obj && mtl) return { action: 'open', kind: 'obj', name: obj, mtl };
  }
  if (names.length > 1) return { action: 'multiple' };
  return { action: 'open', kind: dropKind(names[0]), name: names[0] };
}

/** Whether a drag carries files (and not, say, selected text). */
export const dragHasFiles = (dt: { types?: ArrayLike<string> } | null | undefined): boolean => !!dt?.types && Array.from(dt.types).includes('Files');

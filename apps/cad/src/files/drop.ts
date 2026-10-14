import { dropKind, type DropKind } from './names';

export type DropPlan = { action: 'none' } | { action: 'multiple' } | { action: 'open'; kind: DropKind; name: string };

/** What to do with the files of a drop: one file at a time; its kind decides the path. */
export function planDrop(names: string[]): DropPlan {
  if (names.length === 0) return { action: 'none' };
  if (names.length > 1) return { action: 'multiple' };
  return { action: 'open', kind: dropKind(names[0]), name: names[0] };
}

/** Whether a drag carries files (and not, say, selected text). */
export const dragHasFiles = (dt: { types?: ArrayLike<string> } | null | undefined): boolean => !!dt?.types && Array.from(dt.types).includes('Files');

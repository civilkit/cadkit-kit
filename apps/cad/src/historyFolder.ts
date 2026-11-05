// The feature history of an imported SolidWorks part sits in one folder of the tree, and the folder can be switched off as a whole to see
// the file's own body. A folder is the `group` name on features (treeFolders.ts) and switching it off is `suppressed` on each of them,
// so nothing new is needed in the document or the kernel. What is new is the body that stands in while the history is off:
//  * a complete history makes the body itself, so with every feature suppressed there would be none. The part also holds an
//    `importBody` step after the folder (the file's solid, `replace`), which is suppressed while the history is on and takes over when it is
//    off. It carries `origin: standin:<folder>` so the toggle finds it.
//  * a partial history already ends in an `importBody` (the rest of the file); it is never suppressed, so with the folder off it alone gives
//    the file's body, and with the folder on it follows the rebuilt features and gives the same body.
// No DOM, no kernel.
import type { EditOp } from '@ck/session';

export const HISTORY_FOLDER = 'SolidWorks history';
type Feat = { id: string; [k: string]: unknown };

/** The `origin` of the stand-in body of the folder `name`. */
export const standInOrigin = (name: string): string => `standin:${name}`;
export const isStandIn = (f: Feat, name?: string): boolean => f.type === 'importBody' && typeof f.origin === 'string' && (name === undefined ? f.origin.startsWith('standin:') : f.origin === standInOrigin(name));

/** True when every feature of the folder (`ids`) is suppressed. */
export const folderOff = (features: Feat[], ids: string[]): boolean => { const sel = features.filter((f) => ids.includes(f.id)); return sel.length > 0 && sel.every((f) => f.suppressed === true); };

/**
 * Ops that switch a folder (the feature ids it holds, sketches included) off when any of it is on, and on when all of it is off.
 * The stand-in body of the folder, if the part has one, is switched the other way. One edit, one undo step.
 */
export function folderToggleOps(features: Feat[], ids: string[], name: string): EditOp[] {
  const off = !folderOff(features, ids);
  const set = (f: Feat, value: boolean): EditOp[] => ((f.suppressed === true) !== value ? [{ op: 'set', id: f.id, path: 'suppressed', value }] : []);
  return [
    ...features.filter((f) => ids.includes(f.id)).flatMap((f) => set(f, off)),
    ...features.filter((f) => isStandIn(f, name)).flatMap((f) => set(f, !off)),
  ];
}

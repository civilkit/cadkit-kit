import { t } from './i18n';
import type { UpAxis } from '@kit/viewport';

// The kernel's standard planes: front is XY (normal Z), top is XZ (normal Y, y = -Z), right is ZY. Those three keep their ids and frames,
// so every saved part and every generator means the same thing as before. Two more stand upright in a Z-up view: xz (Front, y up, normal -Y)
// and yz (Right, y up, normal +X). With Z up the ground is XY, so the app offers [xz, front, yz] as Front, Top, Right; with Y up it offers
// [front, top, right]. A part that already has a sketch on `top` or `right` keeps it: the name follows the plane, not the view.
export type PlaneId = 'front' | 'top' | 'right' | 'xz' | 'yz';
export const PLANE_IDS: readonly PlaneId[] = ['front', 'top', 'right', 'xz', 'yz'];
export const isPlaneId = (id: unknown): id is PlaneId => PLANE_IDS.includes(id as PlaneId);

let up: UpAxis = 'y';
export const setPlaneUp = (u: UpAxis): void => { up = u; };

/** The three planes the app offers as Front, Top and Right for the current up axis. */
export const viewPlaneIds = (): readonly PlaneId[] => (up === 'z' ? ['xz', 'front', 'yz'] : ['front', 'top', 'right']);
/** The plane lying flat for the current up axis. */
export const groundPlaneId = (): 'front' | 'top' => (up === 'z' ? 'front' : 'top');

const NAME: Record<PlaneId, string> = { front: 'front', top: 'top', right: 'right', xz: 'front', yz: 'right' };
const SWAPPED: Record<string, string> = { front: 'top', top: 'front' };
/** The display name of a standard plane ('Front Plane'). The old front (XY) is called Top in a Z-up view, where it is the ground. */
export function planeName(id: string): string {
  const base = NAME[id as PlaneId] ?? id;
  return t('app.ref.' + (up === 'z' && (id === 'front' || id === 'top') ? SWAPPED[id]! : base));
}
/** 'front' | 'top' | 'right': the word in the name, for icons and shortcuts. */
export const planeRole = (id: string): 'front' | 'top' | 'right' => planeName(id).split(' ')[0]!.toLowerCase() as 'front' | 'top' | 'right';
/** The name without 'Plane'. */
export const planeShort = (id: string): string => planeName(id).replace(/ Plane$/, '');
const TAG: Record<PlaneId, string> = { front: 'XY', top: 'XZ', right: 'ZY', xz: 'XZ', yz: 'YZ' };
export const planeTag = (id: string): string => TAG[id as PlaneId] ?? '';

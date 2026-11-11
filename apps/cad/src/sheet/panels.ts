// What the sheet has to pick from where the open editor's feature is applied: its panels and their walls, for the Panel lists of the edge
// flange, hem and fold editors. useSheet (the app side) measures it from the kernel's regen and publishes it here; the forms read it with usePanels.
import { useEffect, useState } from 'preact/hooks';
import type { PanelInfo } from './model';

const ONE: PanelInfo = { count: 1, walls: [[]] };
let info: PanelInfo = ONE;
const subs = new Set<(p: PanelInfo) => void>();

/** Publish the panels of the sheet (the editors re-draw when they change). */
export function setPanels(next: PanelInfo | null): void {
  const n = next && next.count > 0 ? next : ONE;
  if (n.count === info.count && JSON.stringify(n.walls) === JSON.stringify(info.walls)) return;
  info = n;
  for (const f of subs) f(n);
}
/** The panel count alone (tests). */
export const setPanelCount = (count: number): void => setPanels({ count, walls: Array.from({ length: count }, () => []) });
/** The panels of the sheet the open editor works on (one panel until the app has measured it). */
export function usePanels(): PanelInfo {
  const [p, set] = useState(info);
  useEffect(() => { subs.add(set); set(info); return () => { subs.delete(set); }; }, []);
  return p;
}

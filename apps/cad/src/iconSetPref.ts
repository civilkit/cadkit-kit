import { asIconSet, DEFAULT_ICON_SET, setIconSet, type IconSet } from '@kit/ui';

/** Which icon set the app draws (Settings, General): our own, or the SolidCraft preview. Remembered in the browser, per device. */
export const ICON_SET_KEY = 'cad.iconSet';

export function loadIconSet(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): IconSet {
  try { return asIconSet(JSON.parse(storage?.getItem(ICON_SET_KEY) ?? 'null')); } catch { return DEFAULT_ICON_SET; }
}
export function saveIconSet(s: IconSet, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(ICON_SET_KEY, JSON.stringify(s)); } catch { /* private window: keep the choice for this session only */ }
}
/** Choose a set: draws it now (every mounted icon redraws) and remembers it. */
export function chooseIconSet(s: IconSet, storage?: Pick<Storage, 'setItem'> | null): void { setIconSet(s); saveIconSet(s, storage); }

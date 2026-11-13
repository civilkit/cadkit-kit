/** Whether a newer build is applied by itself when the app comes back to the foreground with nothing modified (see decideUpdate). On by default;
 *  remembered in the browser, per device. */
const KEY = 'cad.autoUpdate';
export const DEFAULT_AUTO_UPDATE = true;

export function loadAutoUpdate(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try { const v = JSON.parse(storage?.getItem(KEY) ?? 'null'); return typeof v === 'boolean' ? v : DEFAULT_AUTO_UPDATE; } catch { return DEFAULT_AUTO_UPDATE; }
}
export function saveAutoUpdate(on: boolean, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify(on)); } catch { /* private window: kept for this session only */ }
}

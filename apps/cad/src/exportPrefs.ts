/** How exports treat a cosmetic (display only) knurl: `on` bakes it into real cuts in a scratch copy for the file, `ask` asks at each export, `off`
 *  writes the plain solid and warns (the older behaviour). Remembered in the browser, per device. */
export const KNURL_EXPORT_MODES = ['on', 'ask', 'off'] as const;
export type KnurlExportMode = (typeof KNURL_EXPORT_MODES)[number];
export interface ExportPrefs { knurl: KnurlExportMode }
export const DEFAULT_EXPORT_PREFS: ExportPrefs = { knurl: 'on' };
/** Seconds the cutting of the grooves may take before the export offers the plain solid instead. */
export const KNURL_BAKE_SECONDS = 120;

export function sanitizeExportPrefs(raw: unknown): ExportPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { knurl: (KNURL_EXPORT_MODES as readonly unknown[]).includes(r.knurl) ? (r.knurl as KnurlExportMode) : DEFAULT_EXPORT_PREFS.knurl };
}

const KEY = 'cad.exportPrefs';
export function loadExportPrefs(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): ExportPrefs {
  try { return sanitizeExportPrefs(JSON.parse(storage?.getItem(KEY) ?? 'null')); } catch { return DEFAULT_EXPORT_PREFS; }
}
export function saveExportPrefs(p: ExportPrefs, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify(p)); } catch { /* private window: keep the setting for this session only */ }
}

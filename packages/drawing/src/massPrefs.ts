// How a mass is shown: its unit and the number of significant digits. A display setting only: mass is always computed in grams, saved files and
// the kernel are untouched. Remembered in the browser. `massText` (inspect/mass.ts) reads the current setting.
export const MASS_UNITS = ['auto', 'g', 'kg', 'lb', 'oz'] as const;
export type MassUnit = (typeof MASS_UNITS)[number];
export const MASS_DIGITS = [3, 4, 5, 6] as const;
export interface MassPrefs { unit: MassUnit; digits: number }
export const DEFAULT_MASS_PREFS: MassPrefs = { unit: 'auto', digits: 5 };
/** grams per unit */
export const GRAMS_PER: Record<Exclude<MassUnit, 'auto'>, number> = { g: 1, kg: 1000, lb: 453.59237, oz: 28.349523125 };

export function sanitizeMassPrefs(raw: unknown): MassPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    unit: (MASS_UNITS as readonly unknown[]).includes(r.unit) ? (r.unit as MassUnit) : DEFAULT_MASS_PREFS.unit,
    digits: typeof r.digits === 'number' && (MASS_DIGITS as readonly number[]).includes(r.digits) ? r.digits : DEFAULT_MASS_PREFS.digits,
  };
}
const KEY = 'cad.massPrefs';
export function loadMassPrefs(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): MassPrefs {
  try { return sanitizeMassPrefs(JSON.parse(storage?.getItem(KEY) ?? 'null')); } catch { return DEFAULT_MASS_PREFS; }
}
export function saveMassPrefs(p: MassPrefs, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify(p)); } catch { /* private window: the setting lasts for this session only */ }
}

let current: MassPrefs = DEFAULT_MASS_PREFS;
export const getMassPrefs = (): MassPrefs => current;
export const setMassPrefs = (p: MassPrefs): void => { current = sanitizeMassPrefs(p); };

// Per-profile design-check settings: a mode per rule (Off / Info / Warn / Block) and the rule's limit parameters.
// Stored in localStorage in a small versioned shape ({ v, rules }) so it can later move into the document unchanged.
import type { ParamInfo, ParamValue, ProfileInfo, Severity } from './designCheck';

export type Mode = 'off' | 'info' | 'warn' | 'block';
export const MODES: Mode[] = ['off', 'info', 'warn', 'block'];
export interface RuleSetting { mode: Mode; params: Record<string, ParamValue> }
export type ProfileSettings = Record<string, RuleSetting>;
export const SETTINGS_VERSION = 1;
export interface StoredSettings { v: number; rules: ProfileSettings }

/** What a mode asks the kernel for: Info and Warn as they are, Block is an error. Off sends nothing. */
export const modeSeverity = (m: Mode): Severity | null => (m === 'off' ? null : m === 'block' ? 'error' : m);

/** A rule's starting mode. A kernel "error" starts as Warn: nothing blocks an edit until the user chooses Block. */
const startMode = (kernel: string): Mode => (kernel === 'info' ? 'info' : 'warn');

/** The profile as the kernel lists it: every rule on, the kernel's parameter values. */
export function defaultSettings(p: ProfileInfo): ProfileSettings {
  const out: ProfileSettings = {};
  for (const r of p.rules) {
    const params: Record<string, ParamValue> = {};
    for (const q of r.params) params[q.name] = (q.value ?? q.default) as ParamValue;
    out[r.id] = { mode: startMode(r.severity), params };
  }
  return out;
}

/** Saved settings laid over the defaults; rules or parameters the kernel no longer has are dropped, new ones get defaults. */
export function mergeSettings(p: ProfileInfo, saved: unknown): ProfileSettings {
  const base = defaultSettings(p);
  const rules = saved && typeof saved === 'object' && (saved as StoredSettings).v === SETTINGS_VERSION ? (saved as StoredSettings).rules : null;
  if (!rules || typeof rules !== 'object') return base;
  for (const [id, raw] of Object.entries(rules as Record<string, Partial<RuleSetting>>)) {
    const cur = base[id];
    if (!cur || !raw || typeof raw !== 'object') continue;
    if (raw.mode && MODES.includes(raw.mode)) cur.mode = raw.mode;
    for (const [k, v] of Object.entries(raw.params ?? {})) {
      if (!(k in cur.params)) continue;
      const old = cur.params[k];
      const ok = Array.isArray(old) ? Array.isArray(v) && v.length === old.length && v.every(Number.isFinite) : typeof v === 'number' && Number.isFinite(v);
      if (ok) cur.params[k] = v;
    }
  }
  return base;
}

export type InlineProfile = { id: string; name: string; rules: Array<{ id: string; severity: Severity; params: Record<string, ParamValue> }> };

/** The inline profile for checkProfile: rules that are not Off, with their severity and limits. */
export function settingsToInline(p: ProfileInfo, s: ProfileSettings): InlineProfile {
  const rules: InlineProfile['rules'] = [];
  for (const r of p.rules) {
    const sev = modeSeverity(s[r.id]?.mode ?? 'off');
    if (sev) rules.push({ id: r.id, severity: sev, params: { ...s[r.id].params } });
  }
  return { id: p.id, name: p.name, rules };
}

/** Whether the settings still equal the starting ones. */
export const isDefault = (p: ProfileInfo, s: ProfileSettings): boolean => JSON.stringify(s) === JSON.stringify(defaultSettings(p));

/** What the controller runs after edits and what it enforces. */
export interface CheckPolicy { profile: InlineProfile; name: string; blocking: string[]; afterEdit: boolean; titles: Record<string, string> }
export function buildPolicy(p: ProfileInfo, s: ProfileSettings, afterEdit: boolean): CheckPolicy {
  return {
    profile: settingsToInline(p, s), name: p.name, afterEdit,
    blocking: p.rules.filter((r) => s[r.id]?.mode === 'block').map((r) => r.id),
    titles: Object.fromEntries(p.rules.map((r) => [r.id, r.title])),
  };
}

/** A number typed into a field, clamped to the parameter's range; null when it is not a number. */
export function parseParam(text: string, q: Pick<ParamInfo, 'min' | 'max'>): number | null {
  const x = Number(text.replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(x)) return null;
  return Math.min(q.max ?? Infinity, Math.max(q.min ?? -Infinity, x));
}

type Store = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>;
const ls = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
const KEY = (profile: string) => `cad.check.${profile}`;
export const AFTER_KEY = 'cad.check.afterEdit';
export const ACTIVE_KEY = 'cad.check.profile';

export function loadSettings(p: ProfileInfo, storage: Store | null = ls()): ProfileSettings {
  try { return mergeSettings(p, JSON.parse(storage?.getItem(KEY(p.id)) ?? 'null')); } catch { return defaultSettings(p); }
}
export function saveSettings(p: ProfileInfo, s: ProfileSettings, storage: Store | null = ls()): void {
  try { storage?.setItem?.(KEY(p.id), JSON.stringify({ v: SETTINGS_VERSION, rules: s } satisfies StoredSettings)); } catch { /* private window */ }
}
export function loadFlag(key: string, storage: Store | null = ls()): boolean { try { return storage?.getItem(key) === '1'; } catch { return false; } }
export function saveFlag(key: string, on: boolean, storage: Store | null = ls()): void { try { storage?.setItem?.(key, on ? '1' : '0'); } catch { /* private window */ } }
export function loadText(key: string, storage: Store | null = ls()): string | null { try { return storage?.getItem(key) ?? null; } catch { return null; } }
export function saveText(key: string, v: string, storage: Store | null = ls()): void { try { storage?.setItem?.(key, v); } catch { /* private window */ } }

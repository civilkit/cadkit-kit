// The live keymap: the defaults read from the app's tables, the saved state, and who is listening. keymap.ts has the logic.
import { sketchTools } from '@kit/sketch';
import type { Command } from '@kit/ui';
import { SHORTCUTS_DEFAULT_EXTRA } from './keymapDefaults';
import { EMPTY_KEYMAP, effectiveBindings, sanitizeKeymap, type Bindings, type Combo, type KeymapState } from './keymap';

const KEY = 'cad.keymap';
type Store = Pick<Storage, 'getItem' | 'setItem'> | null;
const browserStore = (): Store => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function loadKeymap(storage: Pick<Storage, 'getItem'> | null = browserStore()): KeymapState {
  try { return sanitizeKeymap(JSON.parse(storage?.getItem(KEY) ?? 'null')).state; } catch { return EMPTY_KEYMAP; }
}
export function saveKeymap(s: KeymapState, storage: Pick<Storage, 'setItem'> | null = browserStore()): void {
  try { storage?.setItem(KEY, JSON.stringify(s)); } catch { /* private window: keep it for this session only */ }
}

let state: KeymapState = loadKeymap();
const listeners = new Set<() => void>();
/** Id to the key the app ships with, collected from the command tables as buildCommands runs (first sight wins: the table never changes). */
const defaults: Bindings = {};

export const getKeymapState = (): KeymapState => state;
export function setKeymapState(s: KeymapState, persist = true): void {
  state = s;
  if (persist) saveKeymap(s);
  for (const l of [...listeners]) l();
}
export function subscribeKeymap(l: () => void): () => void { listeners.add(l); return () => void listeners.delete(l); }

/** Record the shipped keys of a freshly built command table (before the keymap is applied to it). */
export function registerDefaults(cmds: Command[]): void {
  for (const c of cmds) if (c.keys && !(c.id in defaults)) defaults[c.id] = c.keys;
}

/** The shipped key of every rebindable command: the command tables, the sketch tools and the few extra keys handled in code. */
export function getDefaults(): Bindings {
  const out: Bindings = { ...SHORTCUTS_DEFAULT_EXTRA };
  for (const x of sketchTools()) if (x.key) out['sketch-tool-' + x.id] = x.key.toUpperCase();
  return { ...out, ...defaults };
}

/** The keys in force now. */
let cache: { state: KeymapState; n: number; value: Bindings } | null = null;
export function getBindings(): Bindings {
  const n = Object.keys(defaults).length;
  if (!cache || cache.state !== state || cache.n !== n) cache = { state, n, value: effectiveBindings(getDefaults(), state) };
  return cache.value;
}
export const keyOf = (id: string): Combo | undefined => getBindings()[id] ?? undefined;

/** Put the keymap on a command table: each command's `keys` becomes its current binding (unbound ones lose it). Call after registerDefaults. */
export function applyKeymap(cmds: Command[]): void {
  const b = getBindings();
  for (const c of cmds) {
    if (!(c.id in b)) continue;
    const k = b[c.id];
    if (k) c.keys = k; else delete c.keys;
  }
}

/** Tests: forget the collected defaults and go back to the given state without saving. */
export function resetKeymapForTests(s: KeymapState = EMPTY_KEYMAP): void {
  for (const k of Object.keys(defaults)) delete defaults[k];
  state = s;
}

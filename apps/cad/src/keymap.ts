// The keymap layer: command id -> key combo. Pure logic (no DOM, no storage): keymapStore.ts holds the live state and persists it.
//
// Three layers are merged, later ones winning: the DEFAULTS (read from the tables the app runs on, see keymapStore.ts), a PRESET (a
// set of bindings that follow another program's habits) and the user's OVERRIDES. `null` means "unbound". A combo is written the way
// the command table writes it: `Ctrl+Alt+Shift+Key` (Ctrl means Ctrl or Cmd), the key a single character or a name such as `F2`.

export type Combo = string;
/** Command id to combo; null = unbound on purpose. */
export type Bindings = Record<string, Combo | null>;
export type PresetId = 'default' | 'solidworks' | 'fusion' | 'freecad';
export const PRESET_IDS: PresetId[] = ['default', 'solidworks', 'fusion', 'freecad'];
export interface KeymapState { preset: PresetId; overrides: Bindings }
export const EMPTY_KEYMAP: KeymapState = { preset: 'default', overrides: {} };

export type KeyEventLike = { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; code?: string };

const NAMED: Record<string, string> = { esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete', backspace: 'Backspace', enter: 'Enter', return: 'Enter', tab: 'Tab', space: 'Space', ' ': 'Space',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'altgraph', 'os', 'capslock']);

/** A single printable character that is not a letter or digit: Shift is part of the character already, so a combo never names it. */
const isSymbol = (k: string): boolean => k.length === 1 && !/[a-z0-9]/i.test(k);

/** The key part in its canonical spelling, or null when it is not a key (empty, a modifier). */
function canonKey(k: string): string | null {
  if (!k) return null;
  const low = k.toLowerCase();
  if (MODIFIER_KEYS.has(low)) return null;
  if (NAMED[low]) return NAMED[low];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(low)) return low.toUpperCase();
  if (k.length === 1) return k.toUpperCase();
  return null;
}

export interface ParsedCombo { ctrl: boolean; alt: boolean; shift: boolean; key: string }

/** Parse `Ctrl+Shift+Z` (any case, any modifier order; `Cmd`/`Meta`/`Control` mean Ctrl, `Option` Alt). The key `+` is written `Ctrl++` or `+`. */
export function parseCombo(spec: string): ParsedCombo | null {
  if (typeof spec !== 'string' || !spec.trim()) return null;
  let s = spec.trim();
  let key: string;
  if (s === '+') key = '+';
  else if (s.endsWith('++')) { key = '+'; s = s.slice(0, -1); }
  else { const i = s.lastIndexOf('+'); key = i < 0 ? s : s.slice(i + 1); s = i < 0 ? '' : s.slice(0, i + 1); }
  const mods = s.split('+').filter(Boolean).map((m) => m.trim().toLowerCase());
  const out = { ctrl: false, alt: false, shift: false };
  for (const m of mods) {
    if (m === 'ctrl' || m === 'control' || m === 'cmd' || m === 'meta' || m === 'command') out.ctrl = true;
    else if (m === 'alt' || m === 'option') out.alt = true;
    else if (m === 'shift') out.shift = true;
    else return null;
  }
  const k = canonKey(key);
  if (!k) return null;
  if (isSymbol(k)) out.shift = false;
  return { ...out, key: k };
}

export function formatCombo(p: ParsedCombo): Combo {
  return [p.ctrl ? 'Ctrl' : '', p.alt ? 'Alt' : '', p.shift ? 'Shift' : '', p.key].filter(Boolean).join('+');
}

/** The canonical spelling of a combo (`ctrl+shift+z` to `Ctrl+Shift+Z`), or null when it is not one. */
export function normalizeCombo(spec: string): Combo | null {
  const p = parseCombo(spec);
  return p ? formatCombo(p) : null;
}

/** The combo a key press makes, or null for a bare modifier press. With Alt the key is often another character (macOS: Alt+H is a dead key), so the physical key is read. */
export function comboFromEvent(e: KeyEventLike): Combo | null {
  const code = e.code?.match(/^(?:Key|Digit)(.)$/);
  const raw = e.altKey && code ? code[1] : e.key;
  const key = canonKey(raw);
  if (!key) return null;
  return formatCombo({ ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey && !isSymbol(key), key });
}

/** Whether a key press is this combo. */
export function matchCombo(spec: string, e: KeyEventLike): boolean {
  const p = parseCombo(spec);
  const c = comboFromEvent(e);
  if (!p || !c) return false;
  return formatCombo(p) === c;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Contexts and conflicts

/** `sketch`: a sketch tool or other key that works only while sketching, where plain letters belong to the tools. `model`: everything else. */
export type KeyContext = 'sketch' | 'model';
export const contextOf = (id: string): KeyContext => (id.startsWith('sketch-tool-') || id === 'sketch-look-normal' ? 'sketch' : 'model');

/** Ids whose keys are read with the sketch tools' own dispatcher, which ignores Ctrl and Alt; a combo with either cannot work there. */
export const isSketchOnly = (id: string): boolean => contextOf(id) === 'sketch';

/** Ids that can be rebound. Anything else in the cheat sheet is fixed (handled in code with no table behind it). */
export const FIXED_ONLY_IDS = new Set(['redo-y', 'repeat', 'escape', 'tab-next', 'tab-prev', 'tab-jump', 'tab-new', 'tab-close', 'orbit', 'pan', 'zoom-in', 'zoom-out', 'zoom-page',
  'delete-selected', 'sketch-constraints', 'sketch-select-all', 'sketch-delete', 'sketch-type-point', 'sketch-edit-dim', 'sketch-leave-tool', 'help']);

/** Two ids can fire on the same key press only when they share a context. A sketch key and a model key never meet: while sketching the tools
 *  take plain letters first, and with Ctrl or Alt the sketch dispatcher is not used at all (and is refused those combos, see `bindError`). */
export const contextsOverlap = (a: string, b: string): boolean => contextOf(a) === contextOf(b);

/** Why a combo cannot be bound to a command, or null when it can. */
export function bindError(id: string, combo: Combo): 'invalid' | 'sketchModifier' | 'reserved' | null {
  const p = parseCombo(combo);
  if (!p) return 'invalid';
  if (isSketchOnly(id) && (p.ctrl || p.alt)) return 'sketchModifier';
  if (p.key === 'Escape' && !p.ctrl && !p.alt && !p.shift) return 'reserved';
  return null;
}

/** The ids bound to `combo` in `bindings`, other than `except`, that would fire on the same press as `id`. */
export function conflictsFor(bindings: Record<string, Combo | null>, id: string, combo: Combo): string[] {
  const want = normalizeCombo(combo);
  if (!want) return [];
  return Object.entries(bindings).filter(([other, c]) => other !== id && c && normalizeCombo(c) === want && contextsOverlap(id, other)).map(([other]) => other);
}

/** Every pair of ids that share a combo in one context, as `combo -> ids`. */
export function allConflicts(bindings: Record<string, Combo | null>): Map<Combo, string[]> {
  const byCombo = new Map<Combo, string[]>();
  for (const [id, c] of Object.entries(bindings)) {
    const n = c ? normalizeCombo(c) : null;
    if (n) byCombo.set(n, [...(byCombo.get(n) ?? []), id]);
  }
  const out = new Map<Combo, string[]>();
  for (const [combo, ids] of byCombo) {
    const clash = ids.filter((a) => ids.some((b) => b !== a && contextsOverlap(a, b)));
    if (clash.length) out.set(combo, clash);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Presets. Each lists only the commands whose key differs from the app's own; a default binding another command loses its key to a preset
// is cleared, so a preset never leaves two commands on one key. The key names follow each program's published defaults as best remembered
// and are meant to be tweaked in the editor.

export const PRESETS: Record<Exclude<PresetId, 'default'>, Bindings> = {
  solidworks: {
    'view-front': 'Ctrl+1', 'view-back': 'Ctrl+2', 'view-left': 'Ctrl+3', 'view-right': 'Ctrl+4', 'view-top': 'Ctrl+5', 'view-bottom': 'Ctrl+6', 'view-iso': 'Ctrl+7',
    fit: 'F', redo: 'Ctrl+Y', palette: 'Ctrl+K',
    'sketch-tool-line': 'L', 'sketch-tool-rectangle': 'R', 'sketch-tool-circle': 'C', 'sketch-tool-dimension': 'D',
  },
  fusion: {
    'add-extrude': 'E', 'add-fillet': 'F', 'add-hole': 'H',
    'sketch-tool-line': 'L', 'sketch-tool-rectangle': 'R', 'sketch-tool-circle': 'C', 'sketch-tool-dimension': 'D',
    redo: 'Ctrl+Shift+Z', fit: 'Shift+F', 'view-iso': 'F6', palette: 'S',
  },
  freecad: {
    'view-front': '1', 'view-top': '2', 'view-right': '3', 'view-back': '4', 'view-bottom': '5', 'view-left': '6', 'view-iso': '0',
    redo: 'Ctrl+Y', fit: 'V', 'delete-feature': 'Delete',
    'sketch-tool-line': 'L', 'sketch-tool-circle': 'C', 'sketch-tool-rectangle': 'R',
  },
};

/** The defaults with a preset on top. A default whose combo the preset gives to another command is dropped (null) unless the preset also rebinds that command. */
export function applyPreset(defaults: Bindings, preset: PresetId): Bindings {
  const out: Bindings = { ...defaults };
  if (preset === 'default') return out;
  const set = PRESETS[preset];
  const taken = new Map<Combo, string[]>();
  for (const [id, c] of Object.entries(set)) { const n = c && normalizeCombo(c); if (n) taken.set(n, [...(taken.get(n) ?? []), id]); }
  for (const [id, c] of Object.entries(out)) {
    if (id in set || !c) continue;
    const n = normalizeCombo(c);
    if (n && taken.get(n)?.some((o) => contextsOverlap(o, id))) out[id] = null;
  }
  for (const [id, c] of Object.entries(set)) if (id in defaults || c !== null) out[id] = c;
  return out;
}

/** The bindings in force: defaults, then the preset, then the user's overrides. */
export function effectiveBindings(defaults: Bindings, state: KeymapState): Bindings {
  const out = applyPreset(defaults, state.preset);
  for (const [id, c] of Object.entries(state.overrides)) out[id] = c;
  return out;
}

export interface BindResult { state: KeymapState; /** ids that lost the combo to this binding */ stolenFrom: string[]; conflicts: string[]; error: ReturnType<typeof bindError> }

/** Bind `combo` (or unbind with null) to `id` as an override. A conflict leaves the state unchanged and lists the ids in the way,
 *  unless `steal` is set: then those ids are unbound too. */
export function setBinding(defaults: Bindings, state: KeymapState, id: string, combo: Combo | null, steal = false): BindResult {
  if (combo === null) return { state: withOverride(defaults, state, id, null), stolenFrom: [], conflicts: [], error: null };
  const n = normalizeCombo(combo);
  const error = bindError(id, combo);
  if (error || !n) return { state, stolenFrom: [], conflicts: [], error: error ?? 'invalid' };
  const conflicts = conflictsFor(effectiveBindings(defaults, state), id, n);
  if (conflicts.length && !steal) return { state, stolenFrom: [], conflicts, error: null };
  let next = state;
  for (const o of conflicts) next = withOverride(defaults, next, o, null);
  return { state: withOverride(defaults, next, id, n), stolenFrom: conflicts, conflicts, error: null };
}

/** Set an override, or drop it when it equals what the preset would give anyway. */
function withOverride(defaults: Bindings, state: KeymapState, id: string, combo: Combo | null): KeymapState {
  const base = applyPreset(defaults, state.preset)[id] ?? null;
  const overrides = { ...state.overrides };
  if (base === combo || (base && combo && normalizeCombo(base) === normalizeCombo(combo))) delete overrides[id];
  else overrides[id] = combo;
  return { ...state, overrides };
}

/** Drop one command's override (it falls back to the preset's or the default key). */
export function resetBinding(state: KeymapState, id: string): KeymapState {
  const overrides = { ...state.overrides };
  delete overrides[id];
  return { ...state, overrides };
}

/** Choosing a preset clears the overrides: the preset is a fresh starting point. */
export function setPreset(state: KeymapState, preset: PresetId): KeymapState {
  return { preset, overrides: {} };
}

export const isOverridden = (state: KeymapState, id: string): boolean => id in state.overrides;

// ---------------------------------------------------------------------------------------------------------------------------------
// Saved form and import / export

export const KEYMAP_FORMAT = 'cadkit-keymap';
export interface KeymapFile { format: typeof KEYMAP_FORMAT; version: 1; preset: PresetId; overrides: Bindings }

/** Read untrusted JSON (storage or an imported file) into a state. Bad entries are dropped and named in `skipped`. */
export function sanitizeKeymap(raw: unknown): { state: KeymapState; skipped: string[] } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const preset = (PRESET_IDS as unknown[]).includes(r.preset) ? (r.preset as PresetId) : 'default';
  const overrides: Bindings = {};
  const skipped: string[] = [];
  const o = r.overrides && typeof r.overrides === 'object' && !Array.isArray(r.overrides) ? (r.overrides as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(o)) {
    if (!/^[\w.-]{1,64}$/.test(id) || id === '__proto__') { skipped.push(id); continue; }
    if (v === null) { overrides[id] = null; continue; }
    const n = typeof v === 'string' ? normalizeCombo(v) : null;
    if (n && !bindError(id, n)) overrides[id] = n; else skipped.push(id);
  }
  return { state: { preset, overrides }, skipped };
}

export function exportKeymap(state: KeymapState): string {
  const file: KeymapFile = { format: KEYMAP_FORMAT, version: 1, preset: state.preset, overrides: state.overrides };
  return JSON.stringify(file, null, 2);
}

/** Parse an exported file. Null when it is not JSON or not a keymap file. */
export function importKeymap(text: string): { state: KeymapState; skipped: string[] } | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== KEYMAP_FORMAT) return null;
  return sanitizeKeymap(raw);
}

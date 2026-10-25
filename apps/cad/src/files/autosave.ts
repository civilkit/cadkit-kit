// Autosave of the open part to localStorage. Pure apart from the storage and timer passed in.
import type { KV } from './storage';

export const AUTOSAVE_KEY = 'cad.autosave.v1';
/** localStorage holds about 5 MB of UTF-16; a document over 3 MB of text (a font embedded whole is up to 2 MB of it) is skipped rather than risk the quota. */
export const AUTOSAVE_MAX = 3 * 1024 * 1024;
export const AUTOSAVE_DELAY = 400;

export interface Autosave { name: string; doc: unknown; savedAt: number }
export type WriteResult = 'saved' | 'tooBig' | 'quota' | 'unavailable';

/** `docText` is the document already serialised: a 1.4 MB part is stringified once per save, not once to compare and once to store. */
export function writeAutosave(kv: KV | null, name: string, doc: unknown, now = Date.now(), docText?: string): WriteResult {
  if (!kv) return 'unavailable';
  let text: string;
  try { text = docText !== undefined ? `{"name":${JSON.stringify(name)},"doc":${docText},"savedAt":${now}}` : JSON.stringify({ name, doc, savedAt: now } satisfies Autosave); } catch { return 'unavailable'; }
  if (text.length > AUTOSAVE_MAX) return 'tooBig';
  try { kv.setItem(AUTOSAVE_KEY, text); return 'saved'; } catch { return 'quota'; }
}

export function readAutosave(kv: KV | null): Autosave | null {
  try {
    const v = JSON.parse(kv?.getItem(AUTOSAVE_KEY) ?? 'null') as Autosave | null;
    if (!v || typeof v !== 'object' || typeof v.savedAt !== 'number' || !v.doc || typeof v.doc !== 'object') return null;
    return { name: typeof v.name === 'string' ? v.name : '', doc: v.doc, savedAt: v.savedAt };
  } catch { return null; }
}

export function clearAutosave(kv: KV | null): void { try { kv?.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ } }

/** Several changed parts at once (document tabs): stored as one autosave whose `doc` is this; a single changed part is stored as itself, as before. */
export interface AutosaveTabs { format: 'cad-tabs'; tabs: Array<{ name: string; doc: unknown; active: boolean }> }
export const isTabs = (d: unknown): d is AutosaveTabs => !!d && typeof d === 'object' && (d as { format?: unknown }).format === 'cad-tabs' && Array.isArray((d as { tabs?: unknown }).tabs);
/** The parts a stored session holds, in tab order (one for the single-part form). */
export function sessionParts(a: Autosave): Array<{ name: string; doc: unknown; active: boolean }> {
  return isTabs(a.doc) ? a.doc.tabs.filter((x) => x && typeof x === 'object' && x.doc && typeof x.doc === 'object') : [{ name: a.name, doc: a.doc, active: true }];
}

/** Whether a stored session is worth offering: it has something in it, or is not just the blank part it would open as. */
export function worthRestoring(a: Autosave | null): a is Autosave {
  if (!a) return false;
  return sessionParts(a).some((x) => { const d = x.doc as { features?: unknown[] }; return Array.isArray(d.features) && d.features.length > 0; });
}

/**
 * Debounced writer. `schedule(get)` replaces any pending write; `get` runs when the timer fires and returns the
 * document and name to store (or null for nothing). `onProblem` is called once per kind of failure ("say once").
 */
export function createAutosaver(kv: KV | null, opts: { delay?: number; /** true while a rebuild runs: the write waits (a big part is not serialised in the middle of one) */ busy?(): boolean; onProblem?(r: Exclude<WriteResult, 'saved'>): void; timers?: { set(f: () => void, ms: number): unknown; clear(h: unknown): void }; now?: () => number } = {}) {
  const timers = opts.timers ?? { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const told = new Set<string>();
  let handle: unknown = null;
  let last = '';
  const flushWith = (get: () => { name: string; doc: unknown } | null, force = false) => {
    handle = null;
    if (!force && opts.busy?.()) { handle = timers.set(() => flushWith(get), 1000); return; }
    const v = get();
    if (!v) return;
    const key = JSON.stringify(v.doc);
    if (key === last) return;
    const r = writeAutosave(kv, v.name, v.doc, opts.now?.(), key);
    if (r === 'saved') last = key;
    else if (!told.has(r)) { told.add(r); opts.onProblem?.(r); }
  };
  return {
    /** `delay` overrides the default: a big part is written less eagerly. */
    schedule(get: () => { name: string; doc: unknown } | null, delay?: number) {
      if (handle !== null) timers.clear(handle);
      handle = timers.set(() => flushWith(get), delay ?? opts.delay ?? AUTOSAVE_DELAY);
    },
    /** Write now (page hiding). */
    flush(get: () => { name: string; doc: unknown } | null) {
      if (handle !== null) timers.clear(handle);
      flushWith(get, true);
    },
    /** Forget the stored copy (after Save): a pending write is dropped too. */
    clear() { if (handle !== null) timers.clear(handle); handle = null; last = ''; clearAutosave(kv); },
  };
}

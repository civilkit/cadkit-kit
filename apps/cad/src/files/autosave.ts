// Autosave of the open part to localStorage. Pure apart from the storage and timer passed in.
import type { KV } from './storage';

export const AUTOSAVE_KEY = 'cad.autosave.v1';
/** localStorage holds about 5 MB of UTF-16; a document over 2 MB of text is skipped rather than risk the quota. */
export const AUTOSAVE_MAX = 2 * 1024 * 1024;
export const AUTOSAVE_DELAY = 400;

export interface Autosave { name: string; doc: unknown; savedAt: number }
export type WriteResult = 'saved' | 'tooBig' | 'quota' | 'unavailable';

export function writeAutosave(kv: KV | null, name: string, doc: unknown, now = Date.now()): WriteResult {
  if (!kv) return 'unavailable';
  let text: string;
  try { text = JSON.stringify({ name, doc, savedAt: now } satisfies Autosave); } catch { return 'unavailable'; }
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

/** Whether a stored session is worth offering: it has something in it, or is not just the blank part it would open as. */
export function worthRestoring(a: Autosave | null): a is Autosave {
  if (!a) return false;
  const d = a.doc as { features?: unknown[]; name?: string };
  return Array.isArray(d.features) && d.features.length > 0;
}

/**
 * Debounced writer. `schedule(get)` replaces any pending write; `get` runs when the timer fires and returns the
 * document and name to store (or null for nothing). `onProblem` is called once per kind of failure ("say once").
 */
export function createAutosaver(kv: KV | null, opts: { delay?: number; onProblem?(r: Exclude<WriteResult, 'saved'>): void; timers?: { set(f: () => void, ms: number): unknown; clear(h: unknown): void }; now?: () => number } = {}) {
  const timers = opts.timers ?? { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const told = new Set<string>();
  let handle: unknown = null;
  let last = '';
  const flushWith = (get: () => { name: string; doc: unknown } | null) => {
    handle = null;
    const v = get();
    if (!v) return;
    const key = JSON.stringify(v.doc);
    if (key === last) return;
    const r = writeAutosave(kv, v.name, v.doc, opts.now?.());
    if (r === 'saved') last = key;
    else if (!told.has(r)) { told.add(r); opts.onProblem?.(r); }
  };
  return {
    schedule(get: () => { name: string; doc: unknown } | null) {
      if (handle !== null) timers.clear(handle);
      handle = timers.set(() => flushWith(get), opts.delay ?? AUTOSAVE_DELAY);
    },
    /** Write now (page hiding). */
    flush(get: () => { name: string; doc: unknown } | null) {
      if (handle !== null) timers.clear(handle);
      flushWith(get);
    },
    /** Forget the stored copy (after Save): a pending write is dropped too. */
    clear() { if (handle !== null) timers.clear(handle); handle = null; last = ''; clearAutosave(kv); },
  };
}

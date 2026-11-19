// Autosave of the open part to localStorage. Pure apart from the storage and timer passed in.
import type { KV } from './storage';

/** The single slot every tab used to share. Still read (as a slot nobody owns) so a session left by an older build is offered once. */
export const AUTOSAVE_KEY = 'cad.autosave.v1';
/** One slot per open tab, and a small heartbeat key beside it: while the beat is fresh the tab is open and its slot is not offered to other tabs. */
export const SLOT_PREFIX = 'cad.autosave.v2.';
export const BEAT_PREFIX = 'cad.autosave.beat.v2.';
/** A tab touches its beat every BEAT_EVERY ms; a beat older than BEAT_LIVE ms (or removed on pagehide) means the tab is gone. */
export const BEAT_EVERY = 5000;
export const BEAT_LIVE = 15000;
/** Slots kept: the newest SLOTS_KEEP, and any younger than SLOTS_MAX_AGE. */
export const SLOTS_KEEP = 5;
export const SLOTS_MAX_AGE = 7 * 24 * 3600 * 1000;
export const slotKey = (tabId: string) => SLOT_PREFIX + tabId;
export const beatKey = (tabId: string) => BEAT_PREFIX + tabId;
export const newTabId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
/** localStorage holds about 5 MB of UTF-16; a document over 3 MB of text (a font embedded whole is up to 2 MB of it) is skipped rather than risk the quota. */
export const AUTOSAVE_MAX = 3 * 1024 * 1024;
export const AUTOSAVE_DELAY = 400;

export interface Autosave { name: string; doc: unknown; savedAt: number; /** the storage key it was read from (set by listSlots / pickRestorable) */ key?: string }
export type WriteResult = 'saved' | 'tooBig' | 'quota' | 'unavailable';
/** What the backup leaves out, said once: imported meshes too large for the browser's storage (see files/assets.ts). */
export type BackupProblem = Exclude<WriteResult, 'saved'> | 'assets';
/** The part of AUTOSAVE_MAX the packed meshes may use; past it they are left out of the backup (the part and its STEP text stay). */
export const AUTOSAVE_ASSET_BUDGET = 2 * 1024 * 1024;
/** What the autosaver asks for: the document to store, and the names of the meshes left out of it. */
export interface AutosavePayload { name: string; doc: unknown; omitted?: string[] }

/** `docText` is the document already serialised: a 1.4 MB part is stringified once per save, not once to compare and once to store. */
export function writeAutosave(kv: KV | null, name: string, doc: unknown, now = Date.now(), docText?: string, key = AUTOSAVE_KEY): WriteResult {
  if (!kv) return 'unavailable';
  let text: string;
  try { text = docText !== undefined ? `{"name":${JSON.stringify(name)},"doc":${docText},"savedAt":${now}}` : JSON.stringify({ name, doc, savedAt: now } satisfies Autosave); } catch { return 'unavailable'; }
  if (text.length > AUTOSAVE_MAX) return 'tooBig';
  try { kv.setItem(key, text); return 'saved'; } catch { /* below */ }
  // no room: the slots of tabs that are gone are the first to go, then one more try
  if (key !== AUTOSAVE_KEY && pruneSlots(kv, { ownKey: key, now, keep: 0, maxAge: 0 }) > 0) { try { kv.setItem(key, text); return 'saved'; } catch { /* below */ } }
  return 'quota';
}

export function readAutosave(kv: KV | null, key = AUTOSAVE_KEY): Autosave | null {
  try {
    const v = JSON.parse(kv?.getItem(key) ?? 'null') as Autosave | null;
    if (!v || typeof v !== 'object' || typeof v.savedAt !== 'number' || !v.doc || typeof v.doc !== 'object') return null;
    return { name: typeof v.name === 'string' ? v.name : '', doc: v.doc, savedAt: v.savedAt };
  } catch { return null; }
}

export function clearAutosave(kv: KV | null, key = AUTOSAVE_KEY): void { try { kv?.removeItem(key); } catch { /* ignore */ } }

/** Say this tab is open (its slot is not for other tabs to offer). */
export function touchBeat(kv: KV | null, tabId: string, now = Date.now()): void { try { kv?.setItem(beatKey(tabId), String(now)); } catch { /* ignore */ } }
/** Say this tab is gone (page hiding for good): its slot is at once free to offer. */
export function dropBeat(kv: KV | null, tabId: string): void { try { kv?.removeItem(beatKey(tabId)); } catch { /* ignore */ } }

const keysOf = (kv: KV | null, prefix: string): string[] => {
  const out: string[] = [];
  try { for (let i = 0; kv && i < (kv.length ?? 0); i++) { const k = kv.key?.(i); if (k && k.startsWith(prefix)) out.push(k); } } catch { /* ignore */ }
  return out;
};
const liveTab = (kv: KV, id: string, now: number, live: number): boolean => {
  try { const b = Number(kv.getItem(beatKey(id))); return Number.isFinite(b) && b > 0 && now - b < live; } catch { return false; }
};

const withKey = (a: Autosave | null, key: string): Autosave | null => (a ? { ...a, key } : null);

/** Every stored slot (the legacy shared one too), with whether a tab that is still open owns it. */
export function listSlots(kv: KV | null, now = Date.now(), live = BEAT_LIVE): Array<{ key: string; id: string; autosave: Autosave | null; live: boolean }> {
  if (!kv) return [];
  const slots = keysOf(kv, SLOT_PREFIX).map((key) => { const id = key.slice(SLOT_PREFIX.length); return { key, id, autosave: withKey(readAutosave(kv, key), key), live: liveTab(kv, id, now, live) }; });
  if (kv.getItem(AUTOSAVE_KEY) !== null) slots.push({ key: AUTOSAVE_KEY, id: '', autosave: withKey(readAutosave(kv), AUTOSAVE_KEY), live: false });
  return slots;
}

/** The session to offer at start: the most recently written slot, worth restoring, that is not this tab's own and not owned by a tab that is still open. */
export function pickRestorable(kv: KV | null, ownId: string, now = Date.now(), live = BEAT_LIVE): Autosave | null {
  let best: Autosave | null = null;
  for (const s of listSlots(kv, now, live)) {
    if (s.live || s.id === ownId || !worthRestoring(s.autosave)) continue;
    if (!best || s.autosave.savedAt > best.savedAt) best = s.autosave;
  }
  return best;
}

/**
 * Drop slots nobody needs: the newest `keep` (5) are kept, and any younger than `maxAge` (7 days); a slot of an open tab or
 * this tab's own is never dropped. Stale heartbeat keys go too. Returns how many slots were removed.
 */
export function pruneSlots(kv: KV | null, o: { ownKey?: string; now?: number; keep?: number; maxAge?: number; live?: number } = {}): number {
  if (!kv) return 0;
  const now = o.now ?? Date.now(), keep = o.keep ?? SLOTS_KEEP, maxAge = o.maxAge ?? SLOTS_MAX_AGE, live = o.live ?? BEAT_LIVE;
  const slots = listSlots(kv, now, live);
  const byAge = [...slots].sort((a, b) => (b.autosave?.savedAt ?? 0) - (a.autosave?.savedAt ?? 0));
  let removed = 0;
  byAge.forEach((s, i) => {
    if (s.live || s.key === o.ownKey) return;
    const young = !!s.autosave && now - s.autosave.savedAt < maxAge;
    if (i < keep || young) return;
    clearAutosave(kv, s.key); removed++;
  });
  for (const k of keysOf(kv, BEAT_PREFIX)) if (!liveTab(kv, k.slice(BEAT_PREFIX.length), now, live)) { try { kv.removeItem(k); } catch { /* ignore */ } }
  return removed;
}

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
  // a reference mesh alone is something to come back to (a scan to sketch on)
  return sessionParts(a).some((x) => { const d = x.doc as { features?: unknown[]; meshes?: unknown[] }; return (Array.isArray(d.features) && d.features.length > 0) || (Array.isArray(d.meshes) && d.meshes.length > 0); });
}

/**
 * Debounced writer. `schedule(get)` replaces any pending write; `get` runs when the timer fires and returns the
 * document and name to store (or null for nothing). `onProblem` is called once per kind of failure ("say once").
 */
export function createAutosaver(kv: KV | null, opts: { /** this tab's slot (see slotKey); without it the old shared key is used */ key?: string; delay?: number; /** true while a rebuild runs: the write waits (a big part is not serialised in the middle of one) */ busy?(): boolean; onProblem?(r: BackupProblem): void; timers?: { set(f: () => void, ms: number): unknown; clear(h: unknown): void }; now?: () => number } = {}) {
  const timers = opts.timers ?? { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const told = new Set<string>();
  let handle: unknown = null;
  let last = '';
  const flushWith = (get: () => AutosavePayload | null, force = false) => {
    handle = null;
    if (!force && opts.busy?.()) { handle = timers.set(() => flushWith(get), 1000); return; }
    const v = get();
    if (!v) return;
    const key = JSON.stringify(v.doc);
    if (key === last) return;
    const r = writeAutosave(kv, v.name, v.doc, opts.now?.(), key, opts.key);
    if (r === 'saved') last = key;
    else if (!told.has(r)) { told.add(r); opts.onProblem?.(r); }
    if (v.omitted?.length && !told.has('assets')) { told.add('assets'); opts.onProblem?.('assets'); }
  };
  return {
    /** `delay` overrides the default: a big part is written less eagerly. */
    schedule(get: () => AutosavePayload | null, delay?: number) {
      if (handle !== null) timers.clear(handle);
      handle = timers.set(() => flushWith(get), delay ?? opts.delay ?? AUTOSAVE_DELAY);
    },
    /** Write now (page hiding). */
    flush(get: () => AutosavePayload | null) {
      if (handle !== null) timers.clear(handle);
      flushWith(get, true);
    },
    /** Forget the stored copy (after Save): a pending write is dropped too. */
    clear() { if (handle !== null) timers.clear(handle); handle = null; last = ''; clearAutosave(kv, opts.key); },
  };
}

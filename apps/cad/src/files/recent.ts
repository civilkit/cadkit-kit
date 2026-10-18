// Recent files: the last 8 samples opened and files saved or opened. Only names, ids and times are stored here;
// File System Access handles (when there are any) live in IndexedDB under the entry's `id`.
import type { KV } from './storage';

export const RECENT_KEY = 'cad.recent.v1';
export const RECENT_MAX = 8;

export interface RecentEntry {
  kind: 'sample' | 'file';
  /** sample id, or the file name for a file (also the handle store key) */
  id: string;
  name: string;
  at: number;
  /** sample url, so a click needs no second lookup */
  url?: string;
  /** a handle is kept in the handle store */
  handle?: boolean;
}

export function readRecent(kv: KV | null): RecentEntry[] {
  try {
    const v = JSON.parse(kv?.getItem(RECENT_KEY) ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((e): e is RecentEntry => !!e && (e.kind === 'sample' || e.kind === 'file') && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.at === 'number').slice(0, RECENT_MAX);
  } catch { return []; }
}

/** The list with `e` at the top: an entry for the same thing moves up rather than repeating. */
export function pushRecent(list: RecentEntry[], e: RecentEntry): RecentEntry[] {
  return [e, ...list.filter((x) => !(x.kind === e.kind && x.id === e.id))].slice(0, RECENT_MAX);
}

export function addRecent(kv: KV | null, e: RecentEntry): RecentEntry[] {
  const next = pushRecent(readRecent(kv), e);
  try { kv?.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota or private window: the list is a convenience */ }
  return next;
}

/** Entries pushed out of the list (their handles can be dropped from the store). */
export function dropped(before: RecentEntry[], after: RecentEntry[]): RecentEntry[] {
  return before.filter((b) => b.handle && !after.some((a) => a.kind === b.kind && a.id === b.id));
}

export const RECENT_THUMBS_KEY = 'cad.recent.thumbs.v1';
/** Pictures of recent files, data URLs by file name. */
export function readRecentThumbs(kv: KV | null): Record<string, string> {
  try {
    const v = JSON.parse(kv?.getItem(RECENT_THUMBS_KEY) ?? '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, u]) => typeof u === 'string' && u.startsWith('data:image/png;base64,')) as Array<[string, string]>);
  } catch { return {}; }
}
/** Set (or with `id` null just prune) the pictures: only files that are in `list` keep one. */
export function setRecentThumb(kv: KV | null, id: string | null, url: string, list: RecentEntry[]): void {
  if (!kv) return;
  const have = readRecentThumbs(kv);
  if (id !== null) have[id] = url;
  const keep = Object.fromEntries(Object.entries(have).filter(([k]) => list.some((e) => e.kind === 'file' && e.id === k)));
  try { kv.setItem(RECENT_THUMBS_KEY, JSON.stringify(keep)); } catch { /* quota: pictures are a convenience */ }
}

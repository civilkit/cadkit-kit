// State of the Libraries tab (signals: only the list redraws on typing).
import { signal } from '@preact/signals';

export type SourceFilter = 'all' | 'included' | 'addon';

// The last category and tags of each surface (the top-bar Library picker, the Catalog's Libraries tab) are remembered on this device.
// Storage may be missing or refuse (private window, blocked site data): every access is guarded and the filter simply starts empty.
export type FilterSurface = 'picker' | 'catalog';
export interface RememberedFilter { category: string; tags: string[] }
const KEY = (s: FilterSurface): string => `ck.library.filter.${s}`;

export function loadFilter(surface: FilterSurface): RememberedFilter {
  const none = (): RememberedFilter => ({ category: 'all', tags: [] });
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY(surface)) ?? 'null') as Partial<RememberedFilter> | null;
    if (!v || typeof v.category !== 'string' || v.category.length > 40 || !Array.isArray(v.tags)) return none();
    return { category: v.category, tags: v.tags.filter((x): x is string => typeof x === 'string' && x.length <= 40).slice(0, 20) };
  } catch { return none(); }
}
export function saveFilter(surface: FilterSurface, f: RememberedFilter): void {
  try {
    if (f.category === 'all' && !f.tags.length) globalThis.localStorage?.removeItem(KEY(surface));
    else globalThis.localStorage?.setItem(KEY(surface), JSON.stringify({ category: f.category, tags: f.tags }));
  } catch { /* storage unavailable: nothing is remembered */ }
}

const remembered = loadFilter('catalog');
export const libQuery = signal('');
export const libSource = signal<SourceFilter>('all');
export const libCategory = signal(remembered.category);
/** Tags the Libraries tab is narrowed by (every one must be on the part). */
export const libTags = signal<string[]>(remembered.tags);
/** The selected card: an entry key (see entries.ts), or null. */
export const libSelected = signal<string | null>(null);

/** Words of a search box; every word must be found in the part's title, id, category or tags. */
export function matches(p: { id: string; title: string; category: string; tags: string[] }, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${p.title} ${p.id} ${p.category} ${p.tags.join(' ')}`.toLowerCase();
  return terms.every((w) => hay.includes(w));
}

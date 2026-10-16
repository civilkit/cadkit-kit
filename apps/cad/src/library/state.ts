// State of the Libraries tab (signals: only the list redraws on typing).
import { signal } from '@preact/signals';

export type SourceFilter = 'all' | 'included' | 'addon';
export const libQuery = signal('');
export const libSource = signal<SourceFilter>('all');
export const libCategory = signal('all');
/** The selected card: an entry key (see entries.ts), or null. */
export const libSelected = signal<string | null>(null);

/** Words of a search box; every word must be found in the part's title, id, category or tags. */
export function matches(p: { id: string; title: string; category: string; tags: string[] }, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${p.title} ${p.id} ${p.category} ${p.tags.join(' ')}`.toLowerCase();
  return terms.every((w) => hay.includes(w));
}

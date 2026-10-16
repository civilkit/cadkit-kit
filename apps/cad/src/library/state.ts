// State of the Libraries section (signals: only the section redraws on typing).
import { signal } from '@preact/signals';

export const libSelected = signal<string | null>(null);
export const libQuery = signal('');
export const libCategory = signal('all');
export const libPart = signal<string | null>(null);

/** Words of a search box; every word must be found in the part's title, id, category or tags. */
export function matches(p: { id: string; title: string; category: string; tags: string[] }, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${p.title} ${p.id} ${p.tags.join(' ')}`.toLowerCase();
  return terms.every((w) => hay.includes(w));
}

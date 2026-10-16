// Search box of the parts library: the skill package's BM25F ranking with its CAD synonym table (so "pipe" finds Tube and
// "hex" finds Regular prism), over the entry name, tags and BOSL2 module name.
import { Bm25f } from '../../../../../packages/skill/src/search';
import { BOSL_ENTRIES, type BoslEntry, type Category } from './entries';

let index: Bm25f | null = null;
const idx = (): Bm25f => (index ??= new Bm25f(BOSL_ENTRIES.map((e) => ({ id: e.id, fields: { name: e.name, tags: e.tags.join(' '), module: e.source.module.replace(/_/g, ' '), category: e.category } })), { weights: { name: 3, tags: 2, module: 2, category: 1 } }));

/** Entries matching `query` (best first) in `category`; an empty query lists the category in catalogue order. */
export function searchEntries(query: string, category: Category | 'all' = 'all'): BoslEntry[] {
  const q = query.trim();
  const inCat = (e: BoslEntry): boolean => category === 'all' || e.category === category;
  if (!q) return BOSL_ENTRIES.filter(inCat);
  const byId = new Map(BOSL_ENTRIES.map((e) => [e.id, e]));
  return idx().search(q, BOSL_ENTRIES.length).map((h) => byId.get(h.id)!).filter(inCat);
}

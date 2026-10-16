// The ONE list of the Libraries tab: BOSL2's parametric entries and the parts of every library (the app's bundled samples, and the
// libraries the user added) as the same kind of entry, with where they come from (Included in the app, or an Add-on).
import { t } from '../i18n';
import { BOSL_ENTRIES, type BoslEntry } from '../catalog/bosl/entries';
import { searchEntries } from '../catalog/bosl/search';
import { registerDynamicItem, type CatalogItem } from '../catalog/shapes';
import type { LibraryManifest, LibraryPart } from './manifest';
import type { LibraryRecord } from './registry';
import { matches, type SourceFilter } from './state';

/** The id the BOSL2 entries have as a library in the list (it is not in the registry: it is part of the app). */
export const BOSL_LIB_ID = 'bosl2';
export const BOSL_CATEGORIES: readonly string[] = ['blocks', 'cylinders', 'round', 'profiles', 'masks'];
export type Origin = 'included' | 'addon';

export interface LibEntry {
  /** unique in the list: `bosl2::cuboid`, `<library id>::<part id>` */
  key: string;
  origin: Origin;
  libId: string;
  libName: string;
  kind: 'bosl' | 'part';
  id: string;
  title: string;
  category: string;
  tags: string[];
  bosl?: BoslEntry;
  part?: LibraryPart;
  licence?: string;
}

/** What the list says about one library (BOSL2 included): its row in "Libraries". */
export interface LibInfo {
  id: string;
  name: string;
  origin: Origin;
  count: number;
  licence?: string;
  description?: string;
  /** set for libraries from the registry */
  record?: LibraryRecord;
  homepage?: string;
  loading?: boolean;
  error?: string;
  offline?: boolean;
}

export const entryKey = (libId: string, id: string): string => `${libId}::${id}`;

export function boslEntries(libName: string): LibEntry[] {
  return BOSL_ENTRIES.map((e) => ({ key: entryKey(BOSL_LIB_ID, e.id), origin: 'included', libId: BOSL_LIB_ID, libName, kind: 'bosl', id: e.id, title: t('catalog.bosl.entry.' + e.id), category: e.category, tags: e.tags, bosl: e, licence: e.source.licence }));
}
export function partEntries(rec: LibraryRecord, m: LibraryManifest): LibEntry[] {
  return m.parts.map((p) => ({ key: entryKey(rec.id, p.id), origin: rec.builtin ? 'included' : 'addon', libId: rec.id, libName: rec.name, kind: 'part', id: p.id, title: p.title, category: p.category, tags: p.tags, part: p, licence: p.licence ?? m.licence }));
}

/** The catalog item a part stands for: dragging it (or arming it) places the part; the part itself is fetched when needed. */
export function partItem(e: LibEntry): CatalogItem {
  return registerDynamicItem({ id: 'lib:' + e.key, kind: 'block', op: 'add', part: { libId: e.libId, partId: e.id, title: e.title } });
}

export interface Filter { q: string; source: SourceFilter; category: string }

/** The entries a search, a source chip and a category leave. BOSL2 matches come first, best first; parts keep their library order. */
export function filterEntries(all: LibEntry[], f: Filter): LibEntry[] {
  const q = f.q.trim();
  const rank = q ? new Map(searchEntries(q, 'all').map((e, i) => [e.id, i] as const)) : null;
  const out = all.filter((e) => (f.source === 'all' || f.source === e.origin) && (f.category === 'all' || e.category === f.category)
    && (!q || (e.kind === 'bosl' ? rank!.has(e.id) : matches(e, q))));
  if (!rank) return out;
  const b = out.filter((e) => e.kind === 'bosl').sort((x, y) => rank.get(x.id)! - rank.get(y.id)!);
  return [...b, ...out.filter((e) => e.kind === 'part')];
}

/** Categories of the entries a source chip leaves, BOSL2's first in their own order, then the others A to Z. */
export function categoriesOf(all: LibEntry[], source: SourceFilter): string[] {
  const set = new Set(all.filter((e) => source === 'all' || source === e.origin).map((e) => e.category));
  return [...BOSL_CATEGORIES.filter((c) => set.has(c)), ...[...set].filter((c) => !BOSL_CATEGORIES.includes(c)).sort()];
}
export const categoryLabel = (c: string): string => (c === 'all' ? t('library.cat.all') : BOSL_CATEGORIES.includes(c) ? t('catalog.bosl.cat.' + c) : c);

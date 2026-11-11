// The ONE list of the Libraries tab: BOSL2's parametric entries and the parts of every library (the app's bundled samples, and the
// libraries the user added) as the same kind of entry, with where they come from (Included in the app, or an Add-on).
import { t } from '../i18n';
import { BOSL_ENTRIES, type BoslEntry } from '../catalog/bosl/entries';
import { searchEntries } from '../catalog/bosl/search';
import { registerDynamicItem, type CatalogItem } from '../catalog/shapes';
import type { LibraryManifest, LibraryPart } from './manifest';
import type { LibraryRecord } from './registry';
import type { SourceFilter } from './state';

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
  /** the part's own category, as its library wrote it (shown as is, and searched) */
  category: string;
  /** what the category filter uses: a core category when `category` maps onto one (see mapCategory), else `category` itself */
  group: string;
  tags: string[];
  /** extra searchable text (the bundled samples' longer description) */
  detail?: string;
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
  /** false: switched off (kept in the list, not browsed) */
  enabled?: boolean;
}

export const entryKey = (libId: string, id: string): string => `${libId}::${id}`;

export function boslEntries(libName: string): LibEntry[] {
  return BOSL_ENTRIES.map((e) => ({ key: entryKey(BOSL_LIB_ID, e.id), origin: 'included', libId: BOSL_LIB_ID, libName, kind: 'bosl', id: e.id, title: t('catalog.bosl.entry.' + e.id), category: e.category, group: e.category, tags: e.tags, bosl: e, licence: e.source.licence }));
}
export function partEntries(rec: LibraryRecord, m: LibraryManifest): LibEntry[] {
  return m.parts.map((p) => ({ key: entryKey(rec.id, p.id), origin: rec.builtin ? 'included' : 'addon', libId: rec.id, libName: rec.name, kind: 'part', id: p.id, title: p.title, category: p.category, group: mapCategory(p.category), tags: p.tags, part: p, licence: p.licence ?? m.licence }));
}

/** The catalog item a part stands for: dragging it (or arming it) places the part; the part itself is fetched when needed. */
export function partItem(e: LibEntry): CatalogItem {
  return registerDynamicItem({ id: 'lib:' + e.key, kind: 'block', op: 'add', part: { libId: e.libId, partId: e.id, title: e.title } });
}

// ---- Categories -------------------------------------------------------------------------------------------------------------
// The app's CORE categories (what a part IS or is FOR; the bundled samples use them). A library may use any category text: it is
// shown as the library wrote it, and `mapCategory` also puts it on a core category for the category filter when a rule matches
// (below). A category that matches no rule stays as it is. Categories with fewer than FOLD_BELOW parts in the shown source fold
// into "Other" in the category list only: the part keeps its own category, and search still finds it by it.
export const CORE_CATEGORIES = ['fasteners', 'power-transmission', 'motors-electronics', 'pipe-fluid', 'fans-impellers', 'mechanisms', 'brackets-structural', 'enclosures', 'sheet-metal', 'consumer-products', 'printing', 'marine'] as const;
export const OTHER_CATEGORY = 'other';
export const FOLD_BELOW = 3;

/** Words of an external category (singular, lower case) by the core category they stand for. */
const CATEGORY_WORDS: Record<string, string> = {};
for (const [core, words] of Object.entries({
  'fasteners': 'fastener screw bolt nut washer rivet threaded rod insert',
  'pipe-fluid': 'tubing tube pipe fitting hose plumbing ducting duct conduit',
  'mechanisms': 'bearing bushing linear motion rail slide shaft guide mechanism hinge spring latch linkage',
  'power-transmission': 'gear pulley belt chain sprocket coupling collar drive',
  'motors-electronics': 'motor stepper servo actuator electronic electrical connector pcb sensor battery switch power supply cabling wire',
  'printing': 'printing 3d printable gridfinity',
  'brackets-structural': 'hardware bracket mount angle plate corner brace structural extrusion profile beam framing tslot t-slot',
  'enclosures': 'enclosure case box panel housing',
  'sheet-metal': 'sheetmetal',
  'fans-impellers': 'fan cooling blower impeller propeller',
  'consumer-products': 'consumer household kitchen bottle container knob handle',
  'marine': 'marine boat vehicle automotive aerospace',
})) for (const w of words.split(' ')) CATEGORY_WORDS[w] = core;
CATEGORY_WORDS['sheet metal'] = 'sheet-metal'; CATEGORY_WORDS['3d printing'] = 'printing'; CATEGORY_WORDS['linear motion'] = 'mechanisms'; CATEGORY_WORDS['threaded rod'] = 'fasteners';
for (const c of CORE_CATEGORIES) CATEGORY_WORDS[c] = c;

const singular = (w: string): string => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** The core category an external category stands for, or the category unchanged when no rule matches. Case, `&` / `and` and plurals
 *  do not matter; a `core/sub` form (`fasteners/screws`) maps by its first part; a phrase maps by its whole text, else by its first known word. */
export function mapCategory(category: string): string {
  const c = category.trim().toLowerCase();
  if (!c) return OTHER_CATEGORY;
  if ((CORE_CATEGORIES as readonly string[]).includes(c) || c === OTHER_CATEGORY) return c;
  const head = c.split('/')[0].trim();
  const words = head.replace(/&/g, ' and ').split(/[^a-z0-9-]+/).filter((w) => w && w !== 'and').map(singular);
  const hit = CATEGORY_WORDS[words.join(' ')] ?? words.map((w) => CATEGORY_WORDS[w]).find(Boolean);
  return hit ?? c;
}

/** The categories that fold into Other for these entries: fewer than FOLD_BELOW parts (BOSL2's own categories never fold). */
export function foldedGroups(all: LibEntry[], source: SourceFilter): Set<string> {
  const n = new Map<string, number>();
  for (const e of all) if (source === 'all' || source === e.origin) n.set(e.group, (n.get(e.group) ?? 0) + 1);
  return new Set([...n].filter(([g, k]) => k < FOLD_BELOW && !BOSL_CATEGORIES.includes(g) && g !== OTHER_CATEGORY).map(([g]) => g));
}
const bucket = (e: LibEntry, folded: Set<string>): string => (folded.has(e.group) ? OTHER_CATEGORY : e.group);

export const categoryLabel = (c: string): string => (c === 'all' ? t('library.cat.all') : BOSL_CATEGORIES.includes(c) ? t('catalog.bosl.cat.' + c)
  : c === OTHER_CATEGORY ? t('library.cat.other') : (CORE_CATEGORIES as readonly string[]).includes(c) ? t('library.core.' + c) : c);

// ---- Filtering and counting -------------------------------------------------------------------------------------------------
export interface Filter {
  q: string; source: SourceFilter; category: string;
  /** every one of these tags must be on the part (AND) */
  tags?: string[];
}

/** Every word of the search must be in the part's title, id, category (its own text and the core label), tags or detail. */
export function matchEntry(e: LibEntry, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = `${e.title} ${e.id} ${e.category} ${categoryLabel(e.group)} ${e.tags.join(' ')} ${e.detail ?? ''}`.toLowerCase();
  return terms.every((w) => hay.includes(w));
}

/** The entries a search, a source chip, a category and tags leave. BOSL2 matches come first, best first; parts keep their library order. */
export function filterEntries(all: LibEntry[], f: Filter): LibEntry[] {
  const q = f.q.trim();
  const rank = q ? new Map(searchEntries(q, 'all').map((e, i) => [e.id, i] as const)) : null;
  const folded = f.category === 'all' ? null : foldedGroups(all, f.source);
  const tags = f.tags ?? [];
  const out = all.filter((e) => (f.source === 'all' || f.source === e.origin) && (!folded || bucket(e, folded) === f.category)
    && tags.every((x) => e.tags.includes(x)) && (!q || (e.kind === 'bosl' ? rank!.has(e.id) : matchEntry(e, q))));
  if (!rank) return out;
  const b = out.filter((e) => e.kind === 'bosl').sort((x, y) => rank.get(x.id)! - rank.get(y.id)!);
  return [...b, ...out.filter((e) => e.kind === 'part')];
}

/** Categories (after folding) of the entries a source chip leaves: BOSL2's first in their own order, then the core ones in their order,
 *  then the library-own ones A to Z, Other last. */
export function categoriesOf(all: LibEntry[], source: SourceFilter): string[] {
  const folded = foldedGroups(all, source);
  const set = new Set(all.filter((e) => source === 'all' || source === e.origin).map((e) => bucket(e, folded)));
  const core = CORE_CATEGORIES as readonly string[];
  const own = [...set].filter((c) => !BOSL_CATEGORIES.includes(c) && !core.includes(c) && c !== OTHER_CATEGORY).sort();
  return [...BOSL_CATEGORIES.filter((c) => set.has(c)), ...core.filter((c) => set.has(c)), ...own, ...(set.has(OTHER_CATEGORY) ? [OTHER_CATEGORY] : [])];
}

/** How many entries each category holds under the OTHER filters (source, search, tags: the category itself is not applied), plus the total. */
export function categoryCounts(all: LibEntry[], f: Filter): { total: number; counts: Map<string, number> } {
  const rest = filterEntries(all, { ...f, category: 'all' });
  const folded = foldedGroups(all, f.source);
  const counts = new Map<string, number>();
  for (const e of rest) { const b = bucket(e, folded); counts.set(b, (counts.get(b) ?? 0) + 1); }
  return { total: rest.length, counts };
}

/** The tags of the current result set (every filter applied), most common first then A to Z, each with its count; the selected tags always come first. */
export function tagCounts(all: LibEntry[], f: Filter): Array<{ tag: string; count: number }> {
  const n = new Map<string, number>();
  for (const e of filterEntries(all, f)) for (const x of new Set(e.tags)) n.set(x, (n.get(x) ?? 0) + 1);
  const sel = f.tags ?? [];
  const rows = [...n].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return [...sel.map((tag) => rows.find((r) => r.tag === tag) ?? { tag, count: 0 }), ...rows.filter((r) => !sel.includes(r.tag))];
}

/** Drops what a remembered filter says that no longer exists (a category or tag the libraries do not have now). */
export function sanitizeFilter(all: LibEntry[], f: { category: string; tags: string[]; source: SourceFilter }): { category: string; tags: string[] } {
  const cats = categoriesOf(all, f.source);
  const known = new Set(all.flatMap((e) => e.tags));
  return { category: f.category !== 'all' && !cats.includes(f.category) ? 'all' : f.category, tags: f.tags.filter((x) => known.has(x)) };
}

// ---- Wizard links -----------------------------------------------------------------------------------------------------------
export type WizardId = 'screw' | 'bearing';
/** "Make one with a wizard": the existing wizard that makes a kind of part, shown at the top of a category or of a selected tag.
 *  To register a new wizard add one line here and its label strings (`library.wizard.<id>`) and pass its opener as `wizards.<id>`. */
export const WIZARD_LINKS: ReadonlyArray<{ id: WizardId; category?: string; tag?: string }> = [
  { id: 'screw', category: 'fasteners' },
  { id: 'bearing', tag: 'bearing' },
  // { id: 'washer', category: 'fasteners' },   // the Washer wizard: register here when it lands
];
export const wizardsFor = (category: string, tags: string[]): WizardId[] => WIZARD_LINKS.filter((w) => (w.category && w.category === category) || (w.tag && tags.includes(w.tag))).map((w) => w.id);

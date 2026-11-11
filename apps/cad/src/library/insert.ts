// Insert a library part into the open document: the part's features are appended after the existing ones as ONE DocPatch (one undo
// step) with the part's variables renamed under a prefix that cannot clash and its feature ids renumbered after the document's.
// `place` (see place.ts) moves the renumbered features onto the drop target; without it the part stays at its own origin.
// Nothing from the part is executed; `script`, configurations and viewer fields of the part are not carried over.
import type { PartDoc } from '@ck/part-model';
import type { DocPatch } from '../docFields';
import { evalExpr, resolveVariables } from '@kit/ui';
import { eachExpr } from '../variables';

export interface SourceEntry {
  library: string;
  libraryId: string;
  part: string;
  partId: string;
  /** the ref the library was read at (`HEAD`, a branch or a tag), or empty for a URL or local library */
  ref: string;
  sha256: string;
  licence?: string;
  url?: string;
  /** the feature ids this insert made, in the document */
  features: string[];
  /** the prefix of the part's variables in the document */
  variablePrefix: string;
  at: number;
}
export type InsertMeta = Omit<SourceEntry, 'features' | 'variablePrefix' | 'at'> & { at?: number };

type Obj = Record<string, unknown>;
const ID_IN_STRING = /(?<![A-Za-z0-9_])F\d+(?![A-Za-z0-9_])/g;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Variable prefix not used in the document: `motor2212_1_`, `motor2212_2_`... */
export function freePrefix(variables: Array<{ name: string }>, partId: string): string {
  let slug = partId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  if (!slug || /^[0-9]/.test(slug)) slug = 'p' + slug;
  const names = variables.map((v) => v.name);
  for (let k = 1; ; k++) {
    const pfx = `${slug}_${k}_`;
    if (!names.some((n) => n.startsWith(pfx))) return pfx;
  }
}

const renameVars = (expr: string, map: Map<string, string>, re: RegExp | null): string => (re ? expr.replace(re, (m) => map.get(m) ?? m) : expr);
function mapStrings(node: unknown, f: (s: string) => string): unknown {
  if (typeof node === 'string') return f(node);
  if (Array.isArray(node)) return node.map((x) => mapStrings(x, f));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node as Obj).map(([k, v]) => [k, mapStrings(v, f)]));
  return node;
}

/** The part with every expression worked out to a number and no variables: what a live preview needs (the open document does not have the part's variables yet). */
export function inlineVariables(part: PartDoc): PartDoc {
  const vars = ((part as unknown as { variables?: Array<{ name: string; expr: string }> }).variables ?? []);
  if (!vars.length) return part;
  const values = resolveVariables(vars).values;
  const out = structuredClone(part) as unknown as { features: Obj[]; variables?: unknown[] };
  for (const f of out.features) {
    eachExpr(f, '', (c, k, v) => {
      const r = evalExpr(v, values);
      if (r.ok) (c as Record<string | number, unknown>)[k] = k === 'expr' ? String(r.value) : r.value;
    });
  }
  out.variables = [];
  return out as unknown as PartDoc;
}

export interface Inserted { patch: DocPatch; entry: SourceEntry; idMap: Record<string, string>; variableMap: Record<string, string> }

export function buildInsert(doc: PartDoc, part: PartDoc, meta: InsertMeta, place?: (features: Obj[]) => Obj[]): Inserted {
  const existing = ((doc as unknown as { variables?: Array<{ name: string; expr: string }> }).variables ?? []);
  const partVars = ((part as unknown as { variables?: Array<{ name: string; expr: string; unit?: string; comment?: string }> }).variables ?? []);
  const prefix = freePrefix(existing, meta.partId);
  const varMap = new Map(partVars.map((v) => [v.name, prefix + v.name] as const));
  const varRe = varMap.size ? new RegExp('(?<![A-Za-z0-9_.])(?:' + [...varMap.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|') + ')(?![A-Za-z0-9_])', 'g') : null;

  // renumber the features after the document's own
  const maxNum = doc.features.reduce((m, f) => Math.max(m, /^F(\d+)$/.test(f.id) ? Number(f.id.slice(1)) : 0), 0);
  const start = Math.max(Number(doc.seq ?? 1), maxNum + 1);
  const idMap = new Map<string, string>();
  (part.features as unknown as Obj[]).forEach((f, i) => idMap.set(String(f.id), `F${start + i}`));
  const remapId = (s: string): string => idMap.get(s) ?? s.replace(ID_IN_STRING, (m) => idMap.get(m) ?? m);

  const features = (part.features as unknown as Obj[]).map((f) => {
    const copy = structuredClone(f);
    eachExpr(copy, '', (c, k, v) => { (c as Record<string | number, unknown>)[k] = renameVars(v, varMap, varRe); });
    return mapStrings(copy, remapId) as Obj;
  });
  const placed = place ? place(features) : features;

  const variables = [
    ...structuredClone(existing),
    ...partVars.map((v) => ({ ...structuredClone(v), name: prefix + v.name, expr: renameVars(v.expr, varMap, varRe) })),
  ];
  const entry: SourceEntry = { ...meta, features: placed.map((f) => String(f.id)), variablePrefix: prefix, at: meta.at ?? Date.now() };
  // an imported body (importStep / importBody) names its STEP text by key in the part's `blobs`: the texts come along (the keys are hashes, so nothing clashes)
  const keys = new Set<string>();
  const collect = (f: Obj): void => { if (typeof f.blob === 'string') keys.add(f.blob); };
  placed.forEach(collect);
  const partBlobs = ((part as unknown as { blobs?: Record<string, unknown> }).blobs ?? {});
  const blobs = Object.fromEntries([...keys].flatMap((k) => (typeof partBlobs[k] === 'string' ? [[k, partBlobs[k] as string]] : [])));
  return {
    patch: { variables, append: placed, seq: start + placed.length, ...(Object.keys(blobs).length ? { blobs } : {}) },
    entry, idMap: Object.fromEntries(idMap), variableMap: Object.fromEntries(varMap),
  };
}

// ---- provenance: the document's `sources` field ----

/** The recorded sources of a document (shape-checked: a hand-edited file may hold anything). */
export function readSources(doc: { sources?: unknown } | null | undefined): SourceEntry[] {
  const raw = doc?.sources;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is SourceEntry => !!e && typeof e === 'object' && typeof (e as SourceEntry).libraryId === 'string' && typeof (e as SourceEntry).partId === 'string' && Array.isArray((e as SourceEntry).features));
}
/** The sources plus a new one; entries whose features are gone from the document (undone or deleted) are dropped. */
export function withSource(doc: PartDoc, entry: SourceEntry): SourceEntry[] {
  return [...liveSources(doc), entry];
}
/** What the UI shows: only entries whose features are all still in the document. */
export function liveSources(doc: PartDoc | null): SourceEntry[] {
  if (!doc) return [];
  const have = new Set(doc.features.map((f) => f.id));
  return readSources(doc as { sources?: unknown }).filter((e) => e.features.every((id) => have.has(id)));
}

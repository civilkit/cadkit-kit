// app_state for an agent that pays for every character: compact rows, a filter, fields, a page and a delta since an earlier revision, never a
// silent cut (docs/specs/mcp-token-efficiency-2026-11-16.md, item 2). Pure: the handler passes in the document, the statuses and the revision.
import { BridgeError } from '@kit/agent-link';

export const STATE_FIELDS = ['type', 'name', 'status', 'suppressed', 'error', 'params'] as const;
export type StateField = typeof STATE_FIELDS[number];
export const DEFAULT_FIELDS: readonly StateField[] = ['type', 'name', 'status'];
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;
/** A parameter longer than this many characters of JSON is a blob: left out (with its size) unless includeBlobs. */
export const BLOB_CHARS = 200;
const KEEP_REVISIONS = 32;
const SELECTION_SHOWN = 20;

export interface StateInput {
  ids?: string[]; query?: string; types?: string[]; fields?: string[]; limit?: number; cursor?: string; sinceRevision?: number; includeBlobs?: boolean;
}
export interface StateSource {
  documentId: string;
  revision: number;
  name: string | null;
  features: Array<Record<string, unknown>>;
  /** Build errors by feature id. */
  bad: Map<string, { code?: string; hint?: string }>;
  variableCount: number;
  selection: string[];
  hasSolid: boolean;
  faces?: number;
  bounds?: { min: number[]; max: number[] } | null;
}
export interface Delta { sinceRevision: number; revision: number; available: boolean; reason?: string; added: string[]; changed: string[]; removed: string[] }

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** FNV-1a over the feature's JSON and its status: two revisions of a feature with the same hash are the same feature. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
export const featureHash = (f: Record<string, unknown>, bad: StateSource['bad']): string => hash(JSON.stringify(f) + '|' + (bad.get(String(f.id))?.code ?? ''));

/** What the app saw at the last revisions: per feature a hash, so `sinceRevision` can say what changed. Observed at every state read and around every edit. */
export class RevisionTracker {
  private snaps: Array<{ documentId: string; revision: number; hashes: Map<string, string> }> = [];
  observe(s: Pick<StateSource, 'documentId' | 'revision' | 'features' | 'bad'>): void {
    if (this.snaps.length && this.snaps[this.snaps.length - 1].documentId !== s.documentId) this.snaps = [];   // another document: nothing carries over
    const hashes = new Map(s.features.map((f) => [String(f.id), featureHash(f, s.bad)] as const));
    const last = this.snaps[this.snaps.length - 1];
    if (last && last.revision === s.revision) last.hashes = hashes;
    else { this.snaps.push({ documentId: s.documentId, revision: s.revision, hashes }); if (this.snaps.length > KEEP_REVISIONS) this.snaps.shift(); }
  }
  delta(s: Pick<StateSource, 'documentId' | 'revision' | 'features' | 'bad'>, since: number): Delta {
    const base = { sinceRevision: since, revision: s.revision, added: [] as string[], changed: [] as string[], removed: [] as string[] };
    const old = this.snaps.find((x) => x.documentId === s.documentId && x.revision === since);
    if (!old) return { ...base, available: false, reason: since > s.revision ? 'sinceRevision is newer than the document' : 'that revision is no longer (or was never) observed: the whole list is returned' };
    const now = new Map(s.features.map((f) => [String(f.id), featureHash(f, s.bad)] as const));
    for (const [id, h] of now) { const o = old.hashes.get(id); if (o === undefined) base.added.push(id); else if (o !== h) base.changed.push(id); }
    for (const id of old.hashes.keys()) if (!now.has(id)) base.removed.push(id);
    return { ...base, available: true };
  }
}

const isBlob = (v: unknown): boolean => (typeof v === 'string' ? v.length > BLOB_CHARS : v !== null && typeof v === 'object' && JSON.stringify(v).length > BLOB_CHARS);
const blobSize = (v: unknown): number => (typeof v === 'string' ? v.length : JSON.stringify(v).length);
const SKIP_PARAMS = new Set(['id', 'type', 'name', 'suppressed']);

/** One feature as a row of the chosen fields; the id is always there. */
export function featureRow(f: Record<string, unknown>, fields: ReadonlySet<StateField>, bad: StateSource['bad'], includeBlobs: boolean): Record<string, unknown> {
  const id = String(f.id), err = bad.get(id);
  const row: Record<string, unknown> = { id };
  if (fields.has('type')) row.type = String(f.type);
  if (fields.has('name') && f.name) row.name = String(f.name);
  if (fields.has('status') && (err || f.suppressed)) row.status = err ? 'error' : 'suppressed';   // absent means ok: most rows are, and say nothing
  if (fields.has('suppressed') && f.suppressed) row.suppressed = true;
  if (fields.has('error') && err) row.error = { code: err.code, ...(err.hint ? { hint: err.hint } : {}) };
  if (fields.has('params')) {
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) if (!SKIP_PARAMS.has(k)) params[k] = !includeBlobs && isBlob(v) ? { blob: blobSize(v) } : v;
    row.params = params;
  }
  return row;
}

const encodeCursor = (documentId: string, revision: number, offset: number): string => btoa(`${documentId}|${revision}|${offset}`);
function decodeCursor(c: string): { documentId: string; revision: number; offset: number } | null {
  try {
    const [documentId, rev, off] = atob(c).split('|');
    const revision = Number(rev), offset = Number(off);
    return documentId && Number.isInteger(revision) && Number.isInteger(offset) && offset >= 0 ? { documentId, revision, offset } : null;
  } catch { return null; }
}

/** The answer to a compact `app_state`. Always says how many matched (`totalCount`), how many are here (`returnedCount`) and where the rest is (`nextCursor`). */
export function compactState(src: StateSource, input: StateInput, tracker: RevisionTracker): Record<string, unknown> {
  const bad = (m: string, hint?: string) => new BridgeError('bad_input', m, hint);
  for (const f of input.fields ?? []) if (!(STATE_FIELDS as readonly string[]).includes(f)) throw bad(`unknown field ${f}`, `fields: ${STATE_FIELDS.join(', ')} (id is always there)`);
  const fields = new Set<StateField>((input.fields?.length ? input.fields : DEFAULT_FIELDS) as StateField[]);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(input.limit ?? DEFAULT_LIMIT)));
  let offset = 0;
  if (input.cursor !== undefined) {
    const c = decodeCursor(input.cursor);
    if (!c) throw new BridgeError('bad_cursor', 'that cursor is not one this tool made');
    if (c.documentId !== src.documentId || c.revision !== src.revision) throw new BridgeError('stale_cursor', `the document changed since that page (revision ${c.revision}, now ${src.revision})`, 'ask again without a cursor; sinceRevision gives only what changed');
    offset = c.offset;
  }
  const q = input.query?.trim().toLowerCase();
  const ids = input.ids?.length ? new Set(input.ids) : null;
  const types = input.types?.length ? new Set(input.types) : null;
  const delta = input.sinceRevision === undefined ? undefined : tracker.delta(src, input.sinceRevision);
  const only = delta?.available ? new Set([...delta.added, ...delta.changed]) : null;
  const matches = src.features.filter((f) => {
    const id = String(f.id);
    if (ids && !ids.has(id)) return false;
    if (types && !types.has(String(f.type))) return false;
    if (only && !only.has(id)) return false;
    return !q || `${id} ${String(f.type)} ${String(f.name ?? '')}`.toLowerCase().includes(q);
  });
  const page = matches.slice(offset, offset + limit);
  const includeBlobs = input.includeBlobs === true;
  const next = offset + page.length < matches.length ? encodeCursor(src.documentId, src.revision, offset + page.length) : undefined;
  const bounds = src.bounds ? [...src.bounds.min, ...src.bounds.max].map(r3) : undefined;
  return {
    open: true, documentId: src.documentId, revision: src.revision, name: src.name, units: 'mm', hasSolid: src.hasSolid,
    ...(bounds ? { bounds } : {}), ...(src.faces !== undefined ? { faces: src.faces } : {}),
    ...(matches.length !== src.features.length ? { documentFeatureCount: src.features.length } : {}), totalCount: matches.length, returnedCount: page.length, ...(next ? { nextCursor: next } : {}),
    features: page.map((f) => featureRow(f, fields, src.bad, includeBlobs)),
    ...(src.variableCount ? { variableCount: src.variableCount } : {}),
    ...(src.selection.length ? { selectionCount: src.selection.length, selection: src.selection.slice(0, SELECTION_SHOWN) } : {}),
    ...(delta ? { delta } : {}),
  };
}

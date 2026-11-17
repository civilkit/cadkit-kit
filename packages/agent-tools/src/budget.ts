// Output budget: a tool result that does not fit is NOT cut and forgotten. It is summarised (arrays cut to what fits, long strings shortened, with the
// counts), and the whole result is kept behind a handle the caller can fetch in pieces (`fetch_result`) or read as the resource ck://result/<id>.
// The summary is always valid JSON and says it is a summary (`_budget`). Pure TypeScript; the store lives in the daemon.
import { ToolError } from './errors';

/** What a tool result may cost by default (characters of text), and the most a caller may ask for. */
export const DEFAULT_BUDGET_CHARS = 4000;
export const MIN_BUDGET_CHARS = 500;
export const MAX_BUDGET_CHARS = 48000;
export const clampBudget = (n: unknown, fallback = DEFAULT_BUDGET_CHARS): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(MIN_BUDGET_CHARS, Math.min(MAX_BUDGET_CHARS, Math.floor(n))) : fallback;

export interface StoredResult { id: string; text: string; value: unknown; at: number; hits: number }
export interface ResultStoreOptions { maxEntries?: number; maxChars?: number; ttlMs?: number; now?: () => number }

/** The full results behind handles: a small LRU with a size cap and a life, so a long session cannot fill the daemon. Identical results share one handle. */
export class ResultStore {
  private m = new Map<string, StoredResult>();
  private chars = 0;
  private seq = 0;
  private readonly o: Required<ResultStoreOptions>;
  constructor(o: ResultStoreOptions = {}) { this.o = { maxEntries: o.maxEntries ?? 24, maxChars: o.maxChars ?? 64 * 1024 * 1024, ttlMs: o.ttlMs ?? 30 * 60_000, now: o.now ?? Date.now }; }
  put(value: unknown, text: string): string {
    this.expire();
    for (const r of this.m.values()) if (r.text === text) { r.at = this.o.now(); this.m.delete(r.id); this.m.set(r.id, r); return r.id; }   // the same result again: the same handle
    const id = `r${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.m.set(id, { id, text, value, at: this.o.now(), hits: 0 });
    this.chars += text.length;
    while (this.m.size > this.o.maxEntries || (this.chars > this.o.maxChars && this.m.size > 1)) this.drop(this.m.keys().next().value as string);
    return id;
  }
  get(id: string): StoredResult | null {
    this.expire();
    const r = this.m.get(id);
    if (r) { r.hits++; r.at = this.o.now(); this.m.delete(id); this.m.set(id, r); }
    return r ?? null;
  }
  list(): Array<{ id: string; chars: number }> { this.expire(); return [...this.m.values()].map((r) => ({ id: r.id, chars: r.text.length })); }
  get size(): number { this.expire(); return this.m.size; }
  private drop(id: string): void { const r = this.m.get(id); if (r) { this.chars -= r.text.length; this.m.delete(id); } }
  private expire(): void { const t = this.o.now() - this.o.ttlMs; for (const r of [...this.m.values()]) if (r.at < t) this.drop(r.id); }
}

export interface Budgeted { text: string; exceeded: boolean; totalChars: number; handle?: string }

const SMALL_VECTOR = 8;
function shrink(v: unknown, keep: number, strMax: number): unknown {
  if (Array.isArray(v)) {
    if (v.length <= SMALL_VECTOR && v.every((x) => typeof x === 'number')) return v;     // a vector or a bounding box stays whole
    const head = v.slice(0, keep).map((x) => shrink(x, keep, strMax));
    return v.length > keep ? [...head, { _omitted: v.length - keep, of: v.length }] : head;
  }
  if (v && typeof v === 'object' && !(v instanceof Uint8Array)) return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shrink(x, keep, strMax)]));
  if (typeof v === 'string' && v.length > strMax) return `${v.slice(0, strMax)}... [${v.length - strMax} more characters]`;
  return v;
}
const outline = (v: unknown): unknown => {
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v && typeof v === 'object') return `object(${Object.keys(v).length} keys)`;
  if (typeof v === 'string') return v.length > 80 ? `string(${v.length})` : v;
  return v;
};

/** The JSON text of `value` if it fits `max` characters; otherwise a valid JSON summary of at most `max` characters that carries `_budget` and, with a store, the handle of the whole. */
export function budgetJson(value: unknown, o: { max: number; store?: ResultStore }): Budgeted {
  const full = JSON.stringify(value) ?? 'null';   // compact: the budget buys data, not indentation
  if (full.length <= o.max) return { text: full, exceeded: false, totalChars: full.length };
  const handle = o.store?.put(value, full);
  const meta = { exceeded: true, maxChars: o.max, totalChars: full.length, ...(handle ? { handle, fetch: { tool: 'fetch_result', args: { handle } } } : { note: 'no result store: ask for less (ids, fields, limit)' }) };
  const wrap = (body: unknown) => JSON.stringify(body && typeof body === 'object' && !Array.isArray(body) ? { ...(body as object), _budget: meta } : { value: body, _budget: meta });
  for (const [keep, strMax] of [[50, 1000], [20, 500], [10, 300], [5, 200], [3, 120], [1, 80], [0, 60]] as const) {
    const text = wrap(shrink(value, keep, strMax));
    if (text.length <= o.max) return { text, exceeded: true, totalChars: full.length, ...(handle ? { handle } : {}) };
  }
  // still too big (very many keys): the top level as an outline, cut to fit
  const top = value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as object).map(([k, x]) => [k, outline(x)])) : { value: outline(value) };
  const keys = Object.keys(top);
  for (let n = keys.length; n >= 0; n--) {
    const text = wrap({ _outline: Object.fromEntries(keys.slice(0, n).map((k) => [k, (top as Record<string, unknown>)[k]])), ...(n < keys.length ? { _keysOmitted: keys.length - n } : {}) });
    if (text.length <= o.max || n === 0) return { text, exceeded: true, totalChars: full.length, ...(handle ? { handle } : {}) };
  }
  return { text: wrap({}), exceeded: true, totalChars: full.length, ...(handle ? { handle } : {}) };
}

export interface FetchInput { handle: string; path?: string; offset?: number; limit?: number }

/** `fetch_result`: a piece of a stored result. A `path` (dot-separated keys and array indexes) gives that part (an array can be paged with offset and limit, counted in items);
 *  without a path the text is paged by characters. Never throws for a large answer: it pages. */
export function fetchResult(store: ResultStore, i: FetchInput, max: number): { data: unknown; /** a page already sized by the caller's limit: not to be budgeted again */ paged: boolean } {
  const r = store.get(i.handle);
  if (!r) throw new ToolError('no_such_result', `no result ${i.handle} (it expired, or the server restarted)`, 'run the tool again; results are kept for 30 minutes');
  const offset = Math.max(0, Math.floor(i.offset ?? 0));
  if (i.path) {
    let node: unknown = r.value;
    const parts = i.path.split('.').filter(Boolean);
    for (const [n, p] of parts.entries()) {
      const here = parts.slice(0, n).join('.') || '(top)';
      if (Array.isArray(node)) { const k = Number(p); if (!Number.isInteger(k) || k < 0 || k >= node.length) throw new ToolError('bad_path', `${here} is an array of ${node.length}; ${p} is not an index in it`, `indexes 0..${node.length - 1}`); node = node[k]; }
      else if (node && typeof node === 'object' && p in (node as object)) node = (node as Record<string, unknown>)[p];
      else throw new ToolError('bad_path', `no ${p} at ${here}`, node && typeof node === 'object' ? `keys: ${Object.keys(node as object).slice(0, 40).join(', ')}` : 'that is a plain value');
    }
    if (Array.isArray(node) && (i.offset !== undefined || i.limit !== undefined)) {
      // the page is as many items as fit the budget (or `limit`), so a page is never itself cut
      let n = Math.max(1, Math.floor(i.limit ?? node.length));
      let body: { handle: string; path: string; total: number; offset: number; returned: number; nextOffset?: number; items: unknown[] };
      do {
        const items = node.slice(offset, offset + n);
        body = { handle: i.handle, path: i.path, total: node.length, offset, returned: items.length, ...(offset + items.length < node.length ? { nextOffset: offset + items.length } : {}), items };
        if (JSON.stringify(body).length <= max || n === 1) break;
        n = Math.max(1, Math.floor(n / 2));
      } while (true);
      return { data: body, paged: true };
    }
    return { data: { handle: i.handle, path: i.path, value: node }, paged: false };
  }
  const limit = Math.max(1, Math.min(MAX_BUDGET_CHARS, Math.floor(i.limit ?? max)));
  const piece = r.text.slice(offset, offset + limit);
  return { data: { handle: i.handle, totalChars: r.text.length, offset, returnedChars: piece.length, ...(offset + piece.length < r.text.length ? { nextOffset: offset + piece.length } : {}), text: piece }, paged: true };
}

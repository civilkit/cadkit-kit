// Document-level changes the session has no op for: the variables and configurations. The session keeps the whole document it is
// given (it clones it for every edit and every undo snapshot), so a change here is a normal step in its history: the kernel regens
// the candidate first, a failure leaves the document as it was, and undo restores the old fields with the rest of the document.
// This reaches into the session's private state because the session has no `variables` op (spec gap, see docs/equations.md).
import type { EditRecord, Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';

export interface DocPatch {
  variables?: unknown[];
  configurations?: unknown[];
  /** null clears */
  activeConfig?: string | null;
  /** whole replacement features by id (a rename rewrites the expressions that used the old name) */
  features?: Record<string, Record<string, unknown>>;
  /** the feature ids in their new order (every id once): moves a feature together with the sketch under it, which no list of single `move` ops can do (the session checks each against the document before any applies) */
  order?: string[];
  /** features appended at the end (with `seq` the document's next feature number): the parts library adds its features together with the variables they use, as ONE step */
  append?: Array<Record<string, unknown>>;
  seq?: number;
  /** STEP texts (key = SHA-256 of the text) added to the document's `blobs` table, for imported-body features that arrive in `append` */
  blobs?: Record<string, string>;
}

interface Internals {
  doc: PartDoc;
  stack: Array<{ record: EditRecord; before: PartDoc }>;
  editSeq: number;
  regen(doc: PartDoc): Promise<{ errors: Array<[string, { code: string }]> }>;
}

const clone = <T,>(x: T): T => structuredClone(x);

/** Single `move`s that turn `cur` into `order`, front to back (what the record says happened). */
function moveOps(cur: string[], order: string[] | undefined): Array<{ op: 'move'; id: string; to: number }> {
  const c = [...cur], out: Array<{ op: 'move'; id: string; to: number }> = [];
  for (let to = 0; to < (order?.length ?? 0); to++) {
    const id = order![to];
    if (c[to] === id) continue;
    out.push({ op: 'move', id, to });
    c.splice(c.indexOf(id), 1); c.splice(to, 0, id);
  }
  return out;
}

/** The candidate document with the patch applied (empty lists are dropped). */
export function patched(doc: PartDoc, patch: DocPatch): PartDoc {
  const d = clone(doc) as PartDoc & Record<string, unknown>;
  if (patch.variables) { if (patch.variables.length) d.variables = clone(patch.variables); else delete d.variables; }
  if (patch.configurations) { if (patch.configurations.length) d.configurations = clone(patch.configurations); else delete d.configurations; }
  if (patch.activeConfig !== undefined) { if (patch.activeConfig) d.activeConfig = patch.activeConfig; else delete d.activeConfig; }
  if (patch.features) d.features = d.features.map((f) => (patch.features![f.id] ? ({ ...clone(patch.features![f.id]), id: f.id } as typeof f) : f));
  if (patch.order && patch.order.length === d.features.length && new Set(patch.order).size === d.features.length) {
    const byId = new Map(d.features.map((f) => [f.id, f] as const));
    if (patch.order.every((id) => byId.has(id))) d.features = patch.order.map((id) => byId.get(id)!);
  }
  if (patch.append?.length) d.features = [...d.features, ...clone(patch.append) as typeof d.features];
  if (patch.seq !== undefined) d.seq = patch.seq;
  if (patch.blobs && Object.keys(patch.blobs).length) (d as unknown as { blobs: Record<string, string> }).blobs = { ...((d as unknown as { blobs?: Record<string, string> }).blobs ?? {}), ...clone(patch.blobs) };
  return d;
}

export type DocFieldsResult = { ok: true; record: EditRecord } | { ok: false; errors: Array<{ feature: string; code: string }> };

/** Apply the patch as one history step. `ok:false` lists the features that failed to rebuild; the document is unchanged. */
export async function setDocFields(session: Session, patch: DocPatch, reason: string): Promise<DocFieldsResult> {
  const s = session as unknown as Internals;
  const before = clone(s.doc);
  const candidate = patched(before, patch);
  const res = await s.regen(candidate);
  if (res.errors.length) {
    await s.regen(s.doc).catch(() => null);   // put the kernel back on the document
    return { ok: false, errors: res.errors.map(([feature, e]) => ({ feature, code: e.code })) };
  }
  s.doc = candidate;
  const ops = [
    ...moveOps(before.features.map((f) => f.id), patch.order),
    ...Object.keys(patch.features ?? {}).map((id) => ({ op: 'replace' as const, id, feature: clone(candidate.features.find((f) => f.id === id) as unknown as Record<string, unknown>) })),
    ...(patch.append ?? []).map((feature) => ({ op: 'add' as const, feature: clone(feature) })),
  ];
  const record: EditRecord = { id: `edit-${s.editSeq++}`, author: session.author, time: Date.now(), ops, reason };
  s.stack.push({ record, before });
  return { ok: true, record };
}

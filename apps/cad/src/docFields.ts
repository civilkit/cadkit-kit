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
}

interface Internals {
  doc: PartDoc;
  stack: Array<{ record: EditRecord; before: PartDoc }>;
  editSeq: number;
  regen(doc: PartDoc): Promise<{ errors: Array<[string, { code: string }]> }>;
}

const clone = <T,>(x: T): T => structuredClone(x);

/** The candidate document with the patch applied (empty lists are dropped). */
export function patched(doc: PartDoc, patch: DocPatch): PartDoc {
  const d = clone(doc) as PartDoc & Record<string, unknown>;
  if (patch.variables) { if (patch.variables.length) d.variables = clone(patch.variables); else delete d.variables; }
  if (patch.configurations) { if (patch.configurations.length) d.configurations = clone(patch.configurations); else delete d.configurations; }
  if (patch.activeConfig !== undefined) { if (patch.activeConfig) d.activeConfig = patch.activeConfig; else delete d.activeConfig; }
  if (patch.features) d.features = d.features.map((f) => (patch.features![f.id] ? ({ ...clone(patch.features![f.id]), id: f.id } as typeof f) : f));
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
  const ops = Object.keys(patch.features ?? {}).map((id) => ({ op: 'replace' as const, id, feature: clone(candidate.features.find((f) => f.id === id) as unknown as Record<string, unknown>) }));
  const record: EditRecord = { id: `edit-${s.editSeq++}`, author: session.author, time: Date.now(), ops, reason };
  s.stack.push({ record, before });
  return { ok: true, record };
}

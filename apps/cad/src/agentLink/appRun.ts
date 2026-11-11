// Run an agent's script on the OPEN document: attach mode (the script's features are added after the ones there, built on a scratch
// kernel state), then applied as ONE undo step the user can undo. The same path the parts library uses to place a part.
import { runScript, type ScriptHost } from '@kit/script';
import type { Controller } from '../controller';
import type { RunReport } from './appHandlers';

type C = Pick<Controller, 'document' | 'canScratchBuild' | 'scratchBuild' | 'scratchRelease' | 'scratchFacts' | 'applyDocPatch'>;

export async function runAgentScript(c: C, code: string, reason: string): Promise<RunReport> {
  const doc = c.document() as unknown as { features: Array<Record<string, unknown>>; seq?: number; variables?: unknown[] } | null;
  if (!doc) return { ok: false, errors: [{ line: 0, message: 'no document is open' }], created: [], featureCount: 0 };
  if (!c.canScratchBuild()) return { ok: false, errors: [{ line: 0, message: 'the kernel cannot build scripts right now' }], created: [], featureCount: doc.features.length };
  // attach mode never loads or edits through the host: it only builds on the scratch kernel
  const host: ScriptHost = {
    load: async () => {}, edit: async () => ({ ok: true }), geometry: () => ({ mesh: null, edges: [], box: null }),
    build: (d, view) => c.scratchBuild(d as never, view) as never, release: () => c.scratchRelease(), facts: (need) => c.scratchFacts(need as never) as never,
  };
  const existing = doc.variables ?? [];
  const r = await runScript(code, host, existing.length ? { variables: existing } : {}, { prefix: { features: doc.features, seq: doc.seq ?? 1 } });
  if (r.errors.length || !r.document) return { ok: false, errors: r.errors.map((e) => ({ line: e.line, message: e.message })), created: [], featureCount: doc.features.length };
  const made = r.ops.map((o) => o.feature as Record<string, unknown>);
  const res = await c.applyDocPatch({ variables: (r.document as { variables?: unknown[] }).variables ?? existing, append: made, seq: Number(r.document.seq) }, reason);
  if (!res.ok) return { ok: false, errors: [{ line: 0, message: res.errors.map((e) => `${e.feature}: ${e.code}`).join('; ') || 'the rebuild failed; nothing changed' }], created: [], featureCount: doc.features.length };
  return { ok: true, errors: [], created: made.map((f) => String(f.id)), featureCount: doc.features.length + made.length };
}

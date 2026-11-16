// Add a teardrop wedge to the open part: its script is built on a scratch kernel in attach mode (the features go after the ones already there), grouped in
// one tree folder, and applied as ONE undo step. The same path as an agent's script (agentLink/appRun.ts), plus the folder.
import { runScript, type ScriptHost } from '@kit/script';
import type { Controller } from './controller';
import { groupPatch } from './wizardGroup';

type C = Pick<Controller, 'document' | 'canScratchBuild' | 'scratchBuild' | 'scratchRelease' | 'scratchFacts' | 'applyDocPatch'>;
export type ApplyResult = { ok: true; created: number } | { ok: false; message: string };

export async function applyTeardrop(c: C, code: string, folder: string, reason = 'Teardrop hole'): Promise<ApplyResult> {
  const doc = c.document() as unknown as { features: Array<Record<string, unknown>>; seq?: number; variables?: unknown[] } | null;
  if (!doc) return { ok: false, message: 'no document is open' };
  if (!c.canScratchBuild()) return { ok: false, message: 'the kernel cannot build right now' };
  const host: ScriptHost = {
    load: async () => {}, edit: async () => ({ ok: true }), geometry: () => ({ mesh: null, edges: [], box: null }),
    build: (d, view) => c.scratchBuild(d as never, view) as never, release: () => c.scratchRelease(), facts: (need) => c.scratchFacts(need as never) as never,
  };
  const existing = doc.variables ?? [];
  const r = await runScript(code, host, existing.length ? { variables: existing } : {}, { prefix: { features: doc.features, seq: doc.seq ?? 1 } });
  if (r.errors.length || !r.document) return { ok: false, message: r.errors[0]?.message ?? 'the script did not build' };
  const made = r.ops.map((o) => o.feature as Record<string, unknown>);
  const patch = groupPatch({ variables: (r.document as { variables?: unknown[] }).variables ?? existing, append: made, seq: Number(r.document.seq) }, folder);
  const res = await c.applyDocPatch(patch as never, reason);
  if (!res.ok) return { ok: false, message: res.errors.map((e) => `${e.feature}: ${e.code}`).join('; ') || 'the rebuild failed; nothing changed' };
  return { ok: true, created: made.length };
}

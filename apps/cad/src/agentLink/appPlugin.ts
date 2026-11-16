// What a linked agent can do with the app's plugins: list the generators (with the same JSON schema the form and the headless tools use) and run one on the
// open document. A run goes through pluginOps like the Plugins panel's Add: one tree folder, one undo step (colours and the run's record undone with it).
import { toJsonSchema, type PluginRegistry } from '@kit/plugin';
import type { Controller } from '../controller';
import { docUpAxis, loadNavPrefs } from '../navPrefs';
import { pluginOps } from '../pluginRun';
import type { PluginGeneratorInfo, PluginRunReport } from './appHandlers';

type C = Pick<Controller, 'document' | 'canScratchBuild' | 'scratchBuild' | 'scratchRelease' | 'scratchFacts' | 'commit' | 'cancelPreview' | 'setUndoableExtras' | 'bodyFaces' | 'bodyEdges' | 'bodyBox'>;

export function listPlugins(registry: PluginRegistry) {
  return registry.plugins().map((p) => ({
    id: p.manifest.id, name: p.manifest.name, version: p.manifest.version, builtin: p.builtin,
    generators: p.manifest.contributes.generators.map((g): PluginGeneratorInfo => ({ plugin: p.manifest.id, generator: g.id, title: g.title, ...(g.description ? { description: g.description } : {}), parameters: toJsonSchema(g.params) })),
  }));
}

export async function runPluginOnApp(c: C, registry: PluginRegistry, plugin: string, generator: string, params: Record<string, unknown>): Promise<PluginRunReport> {
  const doc = c.document() as unknown as { features: Array<Record<string, unknown>>; seq?: number } | null;
  if (!doc) return { ok: false, message: 'no document is open' };
  if (!c.canScratchBuild()) return { ok: false, message: 'the kernel cannot build plugin results right now' };
  const host = {
    load: async () => {}, edit: async () => ({ ok: true }), geometry: () => ({ mesh: c.bodyFaces(), edges: c.bodyEdges(), box: c.bodyBox() }),
    build: (d: unknown, view?: unknown) => c.scratchBuild(d as never, view as never), release: () => c.scratchRelease(), facts: (need: unknown) => c.scratchFacts(need as never),
  };
  const r = await pluginOps(registry, doc as never, { pluginId: plugin, generatorId: generator, values: params as never }, host as never, docUpAxis(doc) ?? loadNavPrefs().upAxis);
  if (!r.ok) return { ok: false, message: r.message, issues: r.issues };
  await c.cancelPreview();
  const done = await c.commit(r.ops, 'plugin');
  if (!done.ok) return { ok: false, message: `the rebuild failed; nothing changed: ${(done as { schemaError?: string }).schemaError ?? done.hints?.map((h) => h.hint).join('; ') ?? 'edit failed'}` };
  c.setUndoableExtras(r.extras, { withLastEdit: true });
  return { ok: true, ...(r.group ? { group: r.group } : {}), created: r.ops.filter((o) => o.op === 'add').length, featureCount: (c.document() as unknown as { features: unknown[] }).features.length };
}

// @kit/plugin-tools: plugin generators as agent tools (kept out of @kit/plugin, which the browser app bundles, because it needs the Node-side agent-tools)
// Plugin generators as agent tools (plan section 7): each generator is `plugin_<id>_<generator>` with the parameter list as its JSON schema,
// and one read tool lists what is installed. Pass the result next to createTools(): callTool(a, [...createTools(), ...pluginTools(registry)], ...).
// A run is `run_script` in attach mode with replace 'none': atomic, one undo step, nothing of the open document is replaced.
import { summarize, ToolError, type ToolDef } from '@kit/agent-tools';
import { contextOf, toJsonSchema, type PluginRegistry } from '@kit/plugin';

export const toolName = (pluginId: string, generatorId: string): string => `plugin_${pluginId.replace(/[.-]/g, '_')}_${generatorId.replace(/-/g, '_')}`;

/** Every name the document already uses: features, tree folders and bodies. */
const namesIn = (features: Array<Record<string, unknown>>): string[] => features.flatMap((f) => [f.name, f.group, f.body].filter((x): x is string => typeof x === 'string'));

export function pluginTools(registry: PluginRegistry): ToolDef[] {
  const tools: ToolDef[] = [{
    name: 'plugin_list',
    description: 'The installed plugins and the generators they add. Each generator is also a tool (plugin_<id>_<generator>) whose parameters are in its schema; calling it adds ordinary features to the open document in one undo step.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      const rows = registry.plugins().map((p) => ({ id: p.manifest.id, name: p.manifest.name, version: p.manifest.version, builtin: p.builtin, generators: p.manifest.contributes.generators.map((g) => ({ id: g.id, title: g.title, tool: toolName(p.manifest.id, g.id), parameters: g.params.map((d) => d.name) })) }));
      return { summary: `${rows.length} plugin${rows.length === 1 ? '' : 's'}`, data: { plugins: rows } };
    },
  }];
  for (const { plugin, decl } of registry.generators()) {
    const id = plugin.manifest.id;
    tools.push({
      name: toolName(id, decl.id),
      description: `${decl.title}${decl.description ? ': ' + decl.description : ''} (plugin ${plugin.manifest.name} ${plugin.manifest.version}). Adds ordinary features to the open document in ONE undo step; the hand-made features stay. Check the result with facts / bodies / snapshot.`,
      inputSchema: toJsonSchema(decl.params),
      async handler(input, a) {
        const p = await registry.prepare(id, decl.id, input, contextOf(namesIn(a.doc.features as unknown as Array<Record<string, unknown>>)));
        if (!p.ok) throw new ToolError('bad_input', p.message, 'see the parameter descriptions in the tool schema; plugin_list names every generator');
        const rep = await a.runScript(p.script, 'attach', { replace: 'none' });
        const sum = rep.ok ? await summarize(a) : null;
        return {
          summary: rep.ok ? `${decl.title}: added ${rep.created.length} features` : `${decl.title} failed: ${rep.errors[0]?.message}`,
          data: { ok: rep.ok, plugin: p.record, errors: rep.errors, warnings: rep.warnings, created: rep.created, ...(sum ?? {}) },
        };
      },
    });
  }
  return tools;
}

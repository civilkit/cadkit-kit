// The plugin registry: manifests plus the code behind each generator. Built-in plugins (tier 1, in this repo) register here; installed
// and local-folder plugins (P2/P3) will register through the same call once they run in the sandbox. A generator is a pure function from
// checked parameter values to a script in the app's own dialect, so a run is an ordinary, atomic `run_script` and nothing else.
import { parseManifest, type GeneratorDecl, type PluginManifest } from './manifest';
import { checkParams, type ParamIssue, type Values } from './params';

/** What a generator may ask about the document it will add to (read-only; plan 4's `host.model`, reduced to what the built-ins need). */
export interface GenerateContext {
  /** every name the document uses (features, folders, bodies), for generators that run as scripts */
  readonly used: readonly string[];
  /** the up axis of the document the result goes into ('y' is the app's default view); a plugin written Z-up turns its output for 'y'. Absent: keep the plugin's own numbers. */
  readonly up?: 'y' | 'z';
  /** `base`, or `base 2`, `base 3`... the first name no feature, folder or body of the document uses yet */
  uniqueName(base: string): string;
}
/** Parameter values in, script source out. May throw: the message is reported as a generator failure. */
export type GenerateFn = (values: Values, ctx: GenerateContext) => string | Promise<string>;
/** A context over a set of names already in use (a document's feature names, folders and bodies). */
export function contextOf(used: Iterable<string>, opts: { up?: 'y' | 'z' } = {}): GenerateContext {
  const taken = new Set(used);
  return { used: [...taken], ...(opts.up ? { up: opts.up } : {}), uniqueName(base) { if (!taken.has(base)) return base; for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`; } };
}
export interface Plugin { manifest: PluginManifest; generate: Readonly<Record<string, GenerateFn>>; builtin: boolean }
/** What a run records so "Edit parameters" can run it again (stored in the document by the app, see TODO: the document field). */
export interface RunRecord { plugin: string; generator: string; params: Values; /** the id of the first feature the run added: finds the folder again after it is renamed */ first?: string }
export type Prepared = { ok: true; script: string; values: Values; record: RunRecord } | { ok: false; issues: ParamIssue[]; message: string };

export class PluginRegistry {
  private readonly list = new Map<string, Plugin>();

  /** Register a plugin. The manifest is validated; every generator it declares needs code and nothing else may have code. */
  add(manifest: unknown, generate: Record<string, GenerateFn>, opts: { builtin?: boolean } = {}): Plugin {
    const p = parseManifest(manifest);
    if (!p.ok) throw new Error(`invalid plugin manifest: ${p.errors.join('; ')}`);
    const m = p.manifest;
    if (this.list.has(m.id)) throw new Error(`plugin ${m.id} is already registered`);
    const declared = m.contributes.generators.map((g) => g.id);
    const missing = declared.filter((id) => typeof generate[id] !== 'function');
    if (missing.length) throw new Error(`plugin ${m.id}: no code for generator(s) ${missing.join(', ')}`);
    const extra = Object.keys(generate).filter((id) => !declared.includes(id));
    if (extra.length) throw new Error(`plugin ${m.id}: code for undeclared generator(s) ${extra.join(', ')}`);
    const plugin: Plugin = { manifest: m, generate: { ...generate }, builtin: opts.builtin ?? false };
    this.list.set(m.id, plugin);
    return plugin;
  }

  remove(id: string): boolean { return this.list.delete(id); }
  plugins(): Plugin[] { return [...this.list.values()]; }
  get(id: string): Plugin | undefined { return this.list.get(id); }
  generators(): Array<{ plugin: Plugin; decl: GeneratorDecl }> { return this.plugins().flatMap((plugin) => plugin.manifest.contributes.generators.map((decl) => ({ plugin, decl }))); }
  find(pluginId: string, generatorId: string): { plugin: Plugin; decl: GeneratorDecl } | undefined {
    const plugin = this.list.get(pluginId);
    const decl = plugin?.manifest.contributes.generators.find((g) => g.id === generatorId);
    return plugin && decl ? { plugin, decl } : undefined;
  }

  /** Check the parameters and produce the script (not yet run). Same path for the form, the agent tool and the tests. */
  async prepare(pluginId: string, generatorId: string, input: Record<string, unknown> | undefined, ctx: GenerateContext = contextOf([])): Promise<Prepared> {
    const f = this.find(pluginId, generatorId);
    if (!f) return { ok: false, issues: [], message: `no generator ${pluginId}/${generatorId}` };
    const c = checkParams(f.decl.params, input);
    if (!c.ok) return { ok: false, issues: c.issues, message: c.issues.map((i) => `${i.param} ${i.message}`).join('; ') };
    let script: string;
    try { script = await f.plugin.generate[generatorId](c.values, ctx); } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, issues: [], message: `the generator failed: ${message}` };
    }
    return { ok: true, script, values: c.values, record: { plugin: `${pluginId}@${f.plugin.manifest.version}`, generator: generatorId, params: c.values } };
  }
}

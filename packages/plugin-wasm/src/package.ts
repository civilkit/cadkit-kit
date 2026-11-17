// Generators of an installed wasm plugin. Each generator runs one entry of the component through the replay host and returns the
// recorded command list as a script (the app's own dialect); from there it is an ordinary attach-mode run like every other plugin.
import type { GenerateFn, InstalledPlugin } from '@kit/plugin';
import { runPlugin, type Loaded } from './host';
import { Interpreter, type Scratch } from './interpreter';
import { friendlyPluginError } from './errors';

/** How a package's compiled files become a component: tests load from disk, the app from a blob URL in the sandboxed Worker. */
export interface ComponentLoader { load(p: InstalledPlugin): Promise<Loaded> }

/** Loads the jco output of a package through data: and blob-less means usable in Node and in a Worker that allows data: modules. */
export const dataUrlLoader: ComponentLoader = {
  async load(p) {
    const w = p.manifest.wasm!;
    const js = p.files[w.js];
    const mod = await import(/* @vite-ignore */ `data:text/javascript;base64,${btoa(unescape(encodeURIComponent(js)))}`);
    const compiled = new Map<string, Promise<WebAssembly.Module>>();
    return {
      instantiate: mod.instantiate,
      getCoreModule: (path: string) => {
        // jco asks for the core files by the names it wrote; a package stores them under the manifest's paths, found by file name
        let m = compiled.get(path);
        if (!m) {
          const key = w.cores.find((c) => c === path || c.endsWith(`/${path}`));
          const bytes = key ? p.binaries?.[key] : undefined;
          if (!bytes) return Promise.reject(new Error(`core module ${path} is not in the package`));
          compiled.set(path, (m = WebAssembly.compile(bytes as BufferSource)));
        }
        return m;
      },
    };
  },
};

/** Runs one entry somewhere the package's JavaScript cannot reach the page (sandbox.ts in the app); absent: in this thread (tests and Node only). */
export type EntryRunner = (p: InstalledPlugin, entry: string, params: unknown, handler: (command: string, args: unknown) => Promise<unknown>, o: { deadlineMs: number; maxCommands: number }) => Promise<unknown>;

export interface WasmDeps {
  runner?: EntryRunner;
  /** the app's colour for a board material (its material library); a name it does not know falls back to the plugin's own colour */
  look?: (material: string) => string | undefined;
  loader?: ComponentLoader;
  /** the kernel's scratch build, for reads (`inspect.measure`); absent: a plugin that reads fails with a clear message */
  scratch?: () => Scratch;
}

export function wasmGenerators(p: InstalledPlugin, deps: WasmDeps = {}): Record<string, GenerateFn> {
  const w = p.manifest.wasm!;
  const loader = deps.loader ?? dataUrlLoader;
  let loaded: Promise<Loaded> | undefined;
  const allow = new Set(w.commands);
  return Object.fromEntries(p.manifest.contributes.generators.map((g) => [g.id, async (values, ctx) => {
    if (!deps.runner) loaded ??= loader.load(p);
    const scratch: Scratch = ctx.scratch ?? deps.scratch?.() ?? { async build() { throw new Error('this plugin asked to measure the model, which needs the scratch build'); } };
    const { place_x = 0, place_y = 0, place_z = 0, ...own } = values as Record<string, unknown>;   // Position is the app's, not the plugin's
    const I = new Interpreter(scratch, { ...(ctx.up ? { up: ctx.up } : {}), ...(ctx.doc ? { doc: { ...ctx.doc, bodies: [...ctx.doc.bodies], selection: [...ctx.doc.selection], ...(ctx.up ? { up: ctx.up } : {}) } } : {}) });
    const limits = { deadlineMs: w.limits?.deadlineMs ?? 30000, maxCommands: w.limits?.maxCommands ?? 256 };
    try {
    if (deps.runner) await deps.runner(p, g.entry!, own, (c, a) => I.run(c, a), limits);
    else await runPlugin(await loaded!, g.entry!, own, (c, a) => I.run(c, a), { allow, deadlineMs: w.limits?.deadlineMs ?? 30000, maxCommands: w.limits?.maxCommands ?? 256, sync: (c, a) => I.runSync(c, a) });
    } catch (e) { throw new Error(friendlyPluginError((e as Error).message)); }
    if (!I.order.length) throw new Error('the plugin made no geometry');
    return I.script({ part: g.title, ...(ctx.up ? { up: ctx.up } : {}), offset: [Number(place_x), Number(place_y), Number(place_z)], ...(deps.look ? { look: deps.look } : {}) });
  }]));
}

// Generators of an installed wasm plugin. Each generator runs one entry of the component through the replay host and returns the
// recorded command list as a script (the app's own dialect); from there it is an ordinary attach-mode run like every other plugin.
import type { GenerateContext, GenerateFn, InstalledPlugin, ReadFn } from '@kit/plugin';
import { runPlugin, type Loaded } from './host';
import { Interpreter, type MaterialLook, type Scratch } from './interpreter';
import { friendlyPluginError } from './errors';
import { checkSaved } from './sandbox';

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
  /** the app's colour or PBR look for a board material (its material library); a name it does not know falls back to the plugin's own look */
  look?: (material: string) => string | Partial<MaterialLook> | undefined;
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
    if (g.effect === 'read') throw new Error('this entry only reads the model: run it from its form');
    if (!deps.runner) loaded ??= loader.load(p);
    const scratch: Scratch = ctx.scratch ?? deps.scratch?.() ?? { async build() { throw new Error('this plugin asked to measure the model, which needs the scratch build'); } };
    const { place_x = 0, place_y = 0, place_z = 0, ...own } = values as Record<string, unknown>;   // Position is the app's, not the plugin's
    // a generator with a Name (a prefix for its bodies) gets the next free one, as a script generator's uniqueName does: "Cabinet", then "Cabinet 2" ... A name is taken when a feature of the document
    // (ctx.used: the folder being edited is not in it) is the name itself or starts with it and a space (its bodies: "Cabinet Side L").
    if (typeof own.name === 'string' && own.name.trim()) {
      const base = own.name.trim(), taken = (n: string) => ctx.used.some((u) => u === n || u.startsWith(`${n} `));
      let n = base; for (let k = 2; taken(n); k++) n = `${base} ${k}`;
      own.name = n;
    }
    const I = new Interpreter(scratch, { ...(ctx.openSketch ? { openSketch: ctx.openSketch } : {}), ...(ctx.up ? { up: ctx.up } : {}), ...(ctx.doc ? { doc: { ...ctx.doc, bodies: [...ctx.doc.bodies], selection: [...ctx.doc.selection], ...(ctx.up ? { up: ctx.up } : {}) } } : {}) });
    const limits = { deadlineMs: w.limits?.deadlineMs ?? 30000, maxCommands: w.limits?.maxCommands ?? 256 };
    try {
    if (deps.runner) await deps.runner(p, g.entry!, own, (c, a) => I.run(c, a), limits);
    else await runPlugin(await loaded!, g.entry!, own, (c, a) => I.run(c, a), { allow, deadlineMs: w.limits?.deadlineMs ?? 30000, maxCommands: w.limits?.maxCommands ?? 256, sync: (c, a) => I.runSync(c, a) });
    } catch (e) { throw new Error(friendlyPluginError((e as Error).message)); }
    // a run in an open sketch draws into that sketch: the app adds the curves to it, there is no script
    const drawn = I.hostAdds();
    if (drawn.length && ctx.sketchOut) { ctx.sketchOut(drawn); return ''; }
    if (!I.order.length && !I.assigned.size) throw new Error('the plugin made no geometry');   // Material only gives bodies a board material
    const offset = [Number(place_x), Number(place_y), Number(place_z)];
    const stored = I.componentMetadata();
    const joints = I.jointHints({ ...(ctx.up ? { up: ctx.up } : {}), offset });
    if (Object.keys(stored).length || joints.length) {
      ctx.remember?.({ ...(Object.keys(stored).length ? { components: stored } : {}), ...(joints.length ? { joints } : {}) });
    }
    return I.script({ part: g.title, ...(ctx.up ? { up: ctx.up } : {}), offset, ...(deps.look ? { look: deps.look } : {}) });
  }]));
}

/** The read entries of an installed wasm plugin (`effect: read`): each runs read-only against the open document (its bodies and selection come from `ctx.doc`) and gives back
 *  the entry's result plus the files it saved, already checked against the manifest's grants. Nothing is added to the document. */
export function wasmReaders(p: InstalledPlugin, deps: WasmDeps = {}): Record<string, ReadFn> {
  const w = p.manifest.wasm!;
  const loader = deps.loader ?? dataUrlLoader;
  let loaded: Promise<Loaded> | undefined;
  const allow = new Set(w.commands);
  const grants = new Set((w.files ?? []).filter((f) => f.write).map((f) => f.name));
  const files = Object.fromEntries([...grants].map((n) => [n, true]));
  return Object.fromEntries(p.manifest.contributes.generators.filter((g) => g.effect === 'read').map((g) => [g.id, async (values: Record<string, unknown>, ctx: GenerateContext) => {
    if (!deps.runner) loaded ??= loader.load(p);
    const scratch: Scratch = ctx.scratch ?? deps.scratch?.() ?? { async build() { throw new Error('this plugin asked to measure the model, which needs the scratch build'); } };
    const I = new Interpreter(scratch, { readEntry: true, ...(ctx.up ? { up: ctx.up } : {}), ...(ctx.doc ? { doc: { ...ctx.doc, bodies: [...ctx.doc.bodies], selection: [...ctx.doc.selection], ...(ctx.up ? { up: ctx.up } : {}) } } : {}) });
    const limits = { deadlineMs: w.limits?.deadlineMs ?? 30000, maxCommands: w.limits?.maxCommands ?? 256 };
    let out: { result?: unknown; files?: unknown } | undefined;
    try {
      out = (deps.runner
        ? await deps.runner(p, g.entry!, values, (c, a) => I.run(c, a), limits)
        : await runPlugin(await loaded!, g.entry!, values, (c, a) => I.run(c, a), { allow, files, ...limits, sync: (c, a) => I.runSync(c, a) })) as { result?: unknown; files?: unknown };
    } catch (e) { throw new Error(friendlyPluginError((e as Error).message)); }
    // the Node path hands back {grant, path, data}; the sandbox has checked and renamed them already
    const raw = Array.isArray(out?.files) ? (out!.files as Array<{ grant?: unknown; path?: unknown; name?: unknown; data?: unknown }>).map((f) => ({ grant: f.grant, path: f.path ?? f.name, data: f.data })) : [];
    const saved = checkSaved(raw, grants);
    if (typeof saved === 'string') throw new Error(saved);
    return { result: out?.result, files: saved };
  }]));
}

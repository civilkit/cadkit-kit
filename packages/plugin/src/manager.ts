// The plugin manager: what is installed, whether it is enabled, and the registry the app reads. Installing is two steps so the user can see what
// they are about to trust: `inspectPackage` (no side effects) and `install` (writes the store, adds the generators). The store is a small
// interface (IndexedDB in the app, memory in tests). Built-in plugins are registered once and cannot be replaced or removed.
import { engineOk, withPlacement, type PluginManifest } from './manifest';
import { inspectPackage, type Inspection } from './package';
import { PluginRegistry, type GenerateFn } from './registry';
import { scriptGenerator } from './script';

export interface PluginSource { kind: 'zip' | 'github'; /** file name, or the github: spec */ name: string }
export interface InstalledPlugin {
  id: string;
  version: string;
  manifest: PluginManifest;
  /** every file of the package by path (text) */
  files: Record<string, string>;
  /** generator id -> script */
  scripts: Record<string, string>;
  /** the .wasm files of a wasm package by path */
  binaries?: Record<string, Uint8Array>;
  /** the pin: sha256 of the whole package */
  hash: string;
  source: PluginSource;
  installedAt: number;
  enabled: boolean;
  /** why it is switched off by the app (a deny-list hit or an engine mismatch), shown in the list */
  blocked?: string;
}
export interface PluginStore {
  all(): Promise<InstalledPlugin[]>;
  put(p: InstalledPlugin): Promise<void>;
  remove(id: string): Promise<void>;
}
export function memoryStore(): PluginStore {
  const m = new Map<string, InstalledPlugin>();
  return {
    async all() { return [...m.values()].map((p) => structuredClone(p)); },
    async put(p) { m.set(p.id, structuredClone(p)); },
    async remove(id) { m.delete(id); },
  };
}

/** What replacing an installed plugin changes, for the confirmation. */
export interface Change { from: string; to: string; added: string[]; removed: string[]; paramsChanged: string[]; sameHash: boolean }
export interface Plan { inspection: Inspection; existing?: InstalledPlugin; change?: Change; refusal?: string }

export interface ManagerOpts {
  registry: PluginRegistry;
  store: PluginStore;
  /** the app's script API version, for the engine range */
  appVersion: string;
  /** the kill switch: a reason when this plugin id / package hash must not run (a remote deny-list in a later version) */
  denied?: (id: string, hash: string) => string | null;
  /** builds the generators of a wasm package (the sandboxed runner); an app build without one lists such plugins as switched off */
  wasm?: (p: InstalledPlugin) => Record<string, GenerateFn>;
}

export class PluginManager {
  private installed = new Map<string, InstalledPlugin>();
  constructor(private readonly o: ManagerOpts) {}
  get registry(): PluginRegistry { return this.o.registry; }
  list(): InstalledPlugin[] { return [...this.installed.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)); }
  builtinIds(): string[] { return this.o.registry.plugins().filter((p) => p.builtin).map((p) => p.manifest.id); }

  /** Read the store and register every enabled plugin. A plugin the app cannot run any more (engine range, deny-list) stays listed, switched off, with the reason. */
  async load(): Promise<void> {
    this.installed.clear();
    for (const p of await this.o.store.all()) {
      this.installed.set(p.id, p);
      this.sync(p);
    }
  }

  private sync(p: InstalledPlugin): void {
    this.o.registry.remove(p.id);
    const reason = !engineOk(p.manifest.engine, this.o.appVersion) ? `needs app ${p.manifest.engine}` : this.o.denied?.(p.id, p.hash) ?? null;
    p.blocked = reason ?? undefined;
    if (!p.enabled || reason) return;
    if (p.manifest.wasm && !this.o.wasm) { p.blocked = 'this app build cannot run WebAssembly plugins'; return; }
    try {
      if (p.manifest.wasm) { this.o.registry.add(withPlacement(p.manifest), this.o.wasm!(p)); return; }
      this.o.registry.add(p.manifest, Object.fromEntries(p.manifest.contributes.generators.map((g) => [g.id, scriptGenerator(p.scripts[g.id] ?? '')])));
    } catch (e) { p.blocked = (e as Error).message; }
  }

  /** Step 1: what installing this package would do. No side effects. */
  async plan(files: Map<string, Uint8Array>): Promise<Plan> {
    const inspection = await inspectPackage(files);
    if (!inspection.ok || !inspection.manifest || !inspection.hash) return { inspection };
    const m = inspection.manifest;
    if (this.builtinIds().includes(m.id)) return { inspection, refusal: `"${m.id}" is a built-in plugin and cannot be replaced` };
    if (!engineOk(m.engine, this.o.appVersion)) return { inspection, refusal: `this plugin needs app ${m.engine}; this is ${this.o.appVersion}` };
    const denied = this.o.denied?.(m.id, inspection.hash);
    if (denied) return { inspection, refusal: `blocked: ${denied}` };
    const existing = this.installed.get(m.id);
    if (!existing) return { inspection };
    const gens = (x: PluginManifest) => new Map(x.contributes.generators.map((g) => [g.id, g]));
    const a = gens(existing.manifest), b = gens(m);
    return {
      inspection, existing,
      change: {
        from: existing.version, to: m.version, sameHash: existing.hash === inspection.hash,
        added: [...b.keys()].filter((k) => !a.has(k)), removed: [...a.keys()].filter((k) => !b.has(k)),
        paramsChanged: [...b.keys()].filter((k) => a.has(k) && JSON.stringify(a.get(k)!.params) !== JSON.stringify(b.get(k)!.params)),
      },
    };
  }

  /** Step 2: install (or replace) after the user confirmed the plan. Returns the installed record. */
  async install(plan: Plan, source: PluginSource): Promise<InstalledPlugin> {
    const i = plan.inspection;
    if (plan.refusal || !i.ok || !i.manifest || !i.hash || !i.files || !i.scripts) throw new Error(plan.refusal ?? i.errors.join('; ') ?? 'not installable');
    const rec: InstalledPlugin = { id: i.manifest.id, version: i.manifest.version, manifest: i.manifest, files: i.files, scripts: i.scripts, ...(i.binaries ? { binaries: i.binaries } : {}), hash: i.hash, source, installedAt: Date.now(), enabled: plan.existing?.enabled ?? true };
    await this.o.store.put(rec);
    this.installed.set(rec.id, rec);
    this.sync(rec);
    return rec;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const p = this.installed.get(id);
    if (!p) return;
    p.enabled = enabled;
    await this.o.store.put(p);
    this.sync(p);
  }

  async remove(id: string): Promise<void> {
    this.o.registry.remove(id);
    this.installed.delete(id);
    await this.o.store.remove(id);
  }
}

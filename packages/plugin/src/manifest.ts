// The plugin manifest (plan section 4, with the review's amendments): identity, engine range, the commands/capabilities model of SolidCraft's
// plugins where it applies, and `contributes`. Version 1 has one contribution kind, generators; reports, checks and libraries come later.
import { checkDefs, type ParamDef } from './params';

export interface GeneratorDecl {
  id: string;
  title: string;
  category?: string;
  description?: string;
  /** the parameter list: the form, the agent tool schema and the validation all come from it */
  params: ParamDef[];
  /** help page, relative to the plugin (shown from the form's "?") */
  help?: string;
  /** the generator's script, relative to the plugin (installed plugins; built-ins have their code in the registry). Written in the app's script dialect; `params` and `uniqueName()` are in scope. */
  script?: string;
  /** the entry of the plugin's wasm component this generator runs (plugins with a `wasm` section; the form comes from `params` like any other) */
  entry?: string;
  /** where the host may show this entry besides the Plugins list (SolidCraft's slots): a `menu` named File or Help, or a `ribbon` named for a tab. Any other name: the Plugins list only. */
  slots?: Array<{ kind: 'menu' | 'ribbon'; name: string }>;
  /** `read`: the entry only reads the model and returns a result to show (a cut list); it adds no features, so the form has Run, not Add. Absent: it edits. */
  effect?: 'read';
}
/** A compiled SolidCraft `craft:plugin@0.1.0` component, transpiled by jco: one JS file and its core wasm modules. It runs only in the sandboxed Worker and can only call the commands listed here. */
/** a place the plugin may save files to: this app has no folders, so each file it writes there comes back as a download (nothing is ever read) */
export interface FileGrant { name: string; read?: boolean; write?: boolean }
export interface WasmDecl { js: string; cores: string[]; commands: string[]; files?: FileGrant[]; limits?: { deadlineMs?: number; maxCommands?: number } }
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** semver range of the app's script API this plugin needs, e.g. ">=0.8.0" (checked by compareEngine) */
  engine?: string;
  license?: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** sha256 (hex) of every file of the package except plugin.json: what an install verifies and what pins a GitHub install to its tag */
  files?: Record<string, string>;
  /** present for a wasm package: its generators then name `entry` instead of `script` */
  wasm?: WasmDecl;
  contributes: { generators: GeneratorDecl[] };
}

/** A relative path inside a package: no leading /, no .. segment, no backslash, no empty segment. */
export const safePath = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && p.length <= 200 && !p.startsWith('/') && !p.includes('\\') && !p.includes('\0') && p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
const SHA = /^[0-9a-f]{64}$/;
const ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const GEN_ID = /^[a-z][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export type ParsedManifest = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] };

/** Validate untrusted manifest JSON. Never throws; every problem is listed so the author fixes them in one pass. */
export function parseManifest(raw: unknown): ParsedManifest {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['the manifest must be a JSON object'] };
  const m = raw as Record<string, unknown>;
  const str = (k: string, required = true): string | undefined => {
    const v = m[k];
    if (v === undefined) { if (required) errors.push(`${k}: required`); return undefined; }
    if (typeof v !== 'string' || !v.trim()) { errors.push(`${k}: must be a non-empty string`); return undefined; }
    return v;
  };
  const id = str('id'); const name = str('name'); const version = str('version');
  if (id && !ID.test(id)) errors.push(`id: "${id}" must look like "owner.name" (lowercase letters, digits, hyphens, at least one dot)`);
  if (version && !SEMVER.test(version)) errors.push(`version: "${version}" is not a semantic version (1.2.3)`);
  const engine = str('engine', false);
  if (engine && !/^(>=|>|<=|<|\^|~)?\d+\.\d+\.\d+$/.test(engine.trim())) errors.push(`engine: "${engine}" must be one comparator and a version, e.g. ">=0.8.0"`);
  const license = str('license', false); const description = str('description', false); const author = str('author', false); const homepage = str('homepage', false);
  let files: Record<string, string> | undefined;
  if (m.files !== undefined) {
    if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) errors.push('files: must be an object of path -> sha256');
    else {
      files = {};
      for (const [k, v] of Object.entries(m.files as Record<string, unknown>)) {
        if (!safePath(k)) errors.push(`files: "${k}" is not a safe relative path`);
        else if (typeof v !== 'string' || !SHA.test(v)) errors.push(`files["${k}"]: must be a lowercase hex sha256`);
        else files[k] = v;
      }
    }
  }
  let wasm: WasmDecl | undefined;
  if (m.wasm !== undefined) {
    const w = m.wasm as Record<string, unknown>;
    if (!w || typeof w !== 'object' || Array.isArray(w)) errors.push('wasm: must be an object');
    else {
      if (!safePath(w.js) || !String(w.js).endsWith('.js')) errors.push('wasm.js: must be a relative path to the jco .js file');
      const cores = Array.isArray(w.cores) ? w.cores : [];
      if (!Array.isArray(w.cores) || !cores.length || !cores.every((c) => safePath(c) && String(c).endsWith('.wasm'))) errors.push('wasm.cores: must be a non-empty list of relative .wasm paths');
      const cmds = Array.isArray(w.commands) ? w.commands : [];
      if (!Array.isArray(w.commands) || !cmds.every((c) => typeof c === 'string' && /^[a-z_]+(\.[a-z_]+)+$/.test(c))) errors.push('wasm.commands: must be a list of command ids such as "solid.box"');
      const lim = w.limits as { deadlineMs?: unknown; maxCommands?: unknown } | undefined;
      if (lim !== undefined && (typeof lim !== 'object' || (lim.deadlineMs !== undefined && !(Number(lim.deadlineMs) > 0)) || (lim.maxCommands !== undefined && !(Number(lim.maxCommands) > 0)))) errors.push('wasm.limits: deadlineMs and maxCommands must be positive numbers');
      const fg = w.files as unknown;
      let files: FileGrant[] | undefined;
      if (fg !== undefined) {
        if (!Array.isArray(fg) || fg.length > 8 || !fg.every((f) => f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test((f as { name: string }).name))) errors.push('wasm.files: a list of at most 8 {name, read?, write?} with lowercase names');
        else files = (fg as FileGrant[]).map((f) => ({ name: f.name, ...(f.read ? { read: true } : {}), ...(f.write ? { write: true } : {}) }));
      }
      if (!errors.some((e) => e.startsWith('wasm'))) wasm = { js: w.js as string, cores: cores as string[], commands: cmds as string[], ...(files?.length ? { files } : {}), ...(lim ? { limits: lim as WasmDecl['limits'] } : {}) };
    }
  }
  const c = m.contributes;
  const gens: GeneratorDecl[] = [];
  if (!c || typeof c !== 'object') errors.push('contributes: required');
  else {
    const list = (c as { generators?: unknown }).generators;
    if (list === undefined) errors.push('contributes.generators: required (version 1 has no other contribution kind)');
    else if (!Array.isArray(list) || !list.length) errors.push('contributes.generators: must be a non-empty list');
    else {
      const seen = new Set<string>();
      list.forEach((g, i) => {
        const at = `contributes.generators[${i}]`;
        if (!g || typeof g !== 'object') { errors.push(`${at}: must be an object`); return; }
        const x = g as Record<string, unknown>;
        if (typeof x.id !== 'string' || !GEN_ID.test(x.id)) { errors.push(`${at}.id: must be lowercase letters, digits and hyphens`); return; }
        if (seen.has(x.id)) errors.push(`${at}.id: "${x.id}" is used twice`);
        seen.add(x.id);
        if (typeof x.title !== 'string' || !x.title.trim()) errors.push(`${at}.title: required`);
        if (!Array.isArray(x.params)) { errors.push(`${at}.params: required (a list, possibly empty)`); return; }
        for (const e of checkDefs(x.params as ParamDef[])) errors.push(`${at}: ${e}`);
        if (x.script !== undefined && !safePath(x.script)) errors.push(`${at}.script: "${String(x.script)}" must be a relative path inside the plugin (no .., no leading /)`);
        if (x.entry !== undefined && (typeof x.entry !== 'string' || !/^[a-z0-9-]+$/.test(x.entry))) errors.push(`${at}.entry: must be the component's entry name (lowercase letters, digits, hyphens)`);
        if (x.slots !== undefined && !(Array.isArray(x.slots) && x.slots.length <= 8 && x.slots.every((q) => q && typeof q === 'object' && ((q as { kind?: unknown }).kind === 'menu' || (q as { kind?: unknown }).kind === 'ribbon') && typeof (q as { name?: unknown }).name === 'string' && (q as { name: string }).name.length > 0 && (q as { name: string }).name.length <= 60))) errors.push(`${at}.slots: a list of at most 8 {kind: "menu" | "ribbon", name} items`);
        if (m.wasm !== undefined && typeof x.entry !== 'string') errors.push(`${at}.entry: required in a wasm plugin`);
        if (m.wasm === undefined && x.entry !== undefined) errors.push(`${at}.entry: only a plugin with a "wasm" section has entries`);
        gens.push({ id: x.id, ...(typeof x.script === 'string' ? { script: x.script } : {}), ...(typeof x.entry === 'string' ? { entry: x.entry } : {}), title: String(x.title ?? ''), params: x.params as ParamDef[], ...(typeof x.category === 'string' ? { category: x.category } : {}), ...(typeof x.description === 'string' ? { description: x.description } : {}), ...(typeof x.help === 'string' ? { help: x.help } : {}), ...(x.effect === 'read' ? { effect: 'read' as const } : {}), ...(Array.isArray(x.slots) && x.slots.length ? { slots: (x.slots as Array<{ kind: 'menu' | 'ribbon'; name: string }>).map((q) => ({ kind: q.kind, name: q.name })) } : {}) });
      });
    }
  }
  if (errors.length || !id || !name || !version) return { ok: false, errors };
  return { ok: true, manifest: { id, name, version, ...(engine ? { engine: engine.trim() } : {}), ...(license ? { license } : {}), ...(description ? { description } : {}), ...(author ? { author } : {}), ...(homepage ? { homepage } : {}), ...(files ? { files } : {}), ...(wasm ? { wasm } : {}), contributes: { generators: gens } } };
}

const parts = (v: string): number[] => v.split('-')[0].split('.').map(Number);
const cmp = (a: number[], b: number[]): number => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };
/** Does `appVersion` satisfy the engine range of a manifest (one comparator; absent range: always)? */
export function engineOk(range: string | undefined, appVersion: string): boolean {
  if (!range) return true;
  const m = /^(>=|>|<=|<|\^|~)?(\d+\.\d+\.\d+)$/.exec(range.trim());
  if (!m) return false;
  const want = parts(m[2]), have = parts(appVersion), c = cmp(have, want);
  switch (m[1] ?? '') {
    case '>=': return c >= 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    case '<': return c < 0;
    case '^': return c >= 0 && (want[0] > 0 ? have[0] === want[0] : have[0] === 0 && have[1] === want[1]);
    case '~': return c >= 0 && have[0] === want[0] && have[1] === want[1];
    default: return c === 0;
  }
}

/** The Position fields every wasm generator gets: a SolidCraft plugin builds at the origin, so the app adds where to put the result. The names cannot clash with a plugin's own (they start with "place_"). */
export const PLACEMENT_PARAMS: ParamDef[] = (['x', 'y', 'z'] as const).map((a) => ({ name: `place_${a}`, type: 'number', title: `Move ${a.toUpperCase()}`, description: `Shift the whole result along ${a.toUpperCase()} (document axes).`, unit: 'mm', default: 0, group: 'Position' }));
/** The manifest as the app registers it: a wasm plugin's generators plus the Position fields. */
export function withPlacement(m: PluginManifest): PluginManifest {
  if (!m.wasm) return m;
  return { ...m, contributes: { generators: m.contributes.generators.map((g) => (g.effect === 'read' || g.params.some((d) => d.name === 'place_x') ? g : { ...g, params: [...g.params, ...PLACEMENT_PARAMS] })) } };
}

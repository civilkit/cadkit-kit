// Installs an author's SolidCraft release as it comes (their plugin.json with a `runtime` block, plus the .wasm component and a LICENSE): the app turns it
// into one of our packages, so nobody has to run tools/plugin_wasm_pack.mjs. Same steps and the same options as that tool and `jco transpile -I async`:
// the component becomes JavaScript plus its core modules, and our plugin.json is written with the generators, the command allow-list and a sha256 for
// every file. The transpiler (jco's bindgen, about 6 MB of wasm) is loaded only when such a release is installed.
import { sha256Hex, packageHash, stripWrapper, type ParamDef } from '@kit/plugin';
import { schemaToParams } from './schema';

/** Turns a component into the files of its JavaScript form (name -> bytes). The default is jco's bindgen; a test passes its own. */
export type Transpile = (component: Uint8Array) => Promise<Map<string, Uint8Array>>;

export interface Converted {
  /** the files of our package, plugin.json included */
  files: Map<string, Uint8Array>;
  /** what the install dialog should say about the conversion (what was left out, where the licence and the owner came from) */
  notes: string[];
  /** the pin of the author's own release (packageHash of the files as downloaded), so it can be compared with the author's site */
  sourceHash: string;
}
export type Conversion = Converted | { error: string };

interface Entry { name: string; kind?: string; effect?: string; slots?: Array<{ kind?: string; name?: string }>; input_schema?: unknown }
interface Release {
  id?: string; name?: string; version?: string; capabilities?: unknown; description?: string; license?: string; author?: string; homepage?: string;
  runtime?: { module?: string; entries?: Entry[]; commands?: string[]; limits?: { deadline_ms?: number }; permissions?: { files?: Array<{ name?: string; read?: boolean; write?: boolean }> } };
}

const decode = (b: Uint8Array): string => new TextDecoder().decode(b);
const parse = (b: Uint8Array | undefined): Release | null => { if (!b) return null; try { const j = JSON.parse(decode(b)); return j && typeof j === 'object' ? j : null; } catch { return null; } };

/** An author release has a runtime block naming a .wasm and no `wasm` / `contributes` of ours. Our own packages are never converted. A missing .wasm still counts: the converter says so. */
export function isRelease(input: Map<string, Uint8Array>): boolean {
  const files = stripWrapper(input);
  const j = parse(files.get('plugin.json')) as (Release & { wasm?: unknown; contributes?: unknown }) | null;
  if (!j || j.wasm !== undefined || j.contributes !== undefined) return false;
  const m = j.runtime?.module;
  return typeof m === 'string' && Array.isArray(j.runtime?.entries);
}

/** The licence id from a LICENSE text (the common ones); null when it is not one of them. */
function licenceOf(text: string): string | null {
  if (/MIT License|Permission is hereby granted, free of charge/i.test(text)) return 'MIT';
  if (/Apache License,? Version 2\.0/i.test(text)) return 'Apache-2.0';
  if (/Redistribution and use in source and binary forms/i.test(text)) return /Neither the name/i.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (/Mozilla Public License,? v?\.? ?2\.0/i.test(text)) return 'MPL-2.0';
  return null;
}
/** "Copyright (c) 2026 TomasDJo" -> "TomasDJo" */
const holderOf = (text: string): string | null => /copyright\s*(?:\(c\)|©)?\s*(?:\d{4}(?:\s*[-,]\s*\d{4})*)?\s*,?\s*([^\n]+)/i.exec(text)?.[1]?.trim().replace(/\.$/, '') || null;
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '');

/** Entries this app cannot run yet: an importer (another component world, it opens a file as a new design) and
 *  the plugin's own "edit" entry (the app edits a run's parameters itself). */
const leftOut = (e: Entry): boolean => e.effect === 'open' || e.kind === 'importer' || e.name === 'edit';
/** the slots a host may draw (menu and ribbon items with a name); anything else the entry declares is not placed anywhere */
const slotsOf = (e: Entry): Array<{ kind: 'menu' | 'ribbon'; name: string }> => (e.slots ?? []).flatMap((q) => ((q.kind === 'menu' || q.kind === 'ribbon') && typeof q.name === 'string' && q.name ? [{ kind: q.kind, name: q.name.replace(/…$/, '') }] : []));
const title = (e: Entry): string => (e.slots?.[0]?.name ?? e.name).replace(/…$/, '');
/** the interface versions this host has been run against; a plugin built for another one still installs, with a note */
const TESTED_CAPABILITIES = ['commands@0.1'];

let bindgen: Promise<Transpile> | null = null;
/** jco's bindgen, loaded on first use, with the options `jco transpile -I async` uses (jco's declaration defaults included, so the output is byte for byte the pack tool's). */
export const jcoTranspile: Transpile = (component) => {
  bindgen ??= import('@bytecodealliance/jco-transpile/component').then((m) => async (bytes: Uint8Array) => {
    const r = await m.callBindgen(() => m.generate(bytes, {
      name: 'component', instantiation: { tag: 'async' }, noTypescript: true,
      nominalResources: false, asyncImportsMayReturnSync: false, typedErrorClasses: false, separateInterfaceTypes: false, optionalResultPayloads: false,
    } as never));
    return new Map<string, Uint8Array>(r.files as Array<[string, Uint8Array]>);
  });
  return bindgen.then((f) => f(component));
};

export async function convertRelease(input: Map<string, Uint8Array>, transpile: Transpile = jcoTranspile): Promise<Conversion> {
  const files = stripWrapper(input);
  const theirs = parse(files.get('plugin.json'));
  const rt = theirs?.runtime;
  if (!theirs || !rt?.module || !Array.isArray(rt.entries)) return { error: 'this is not a SolidCraft plugin release (plugin.json has no "runtime" with a .wasm module)' };
  const wasm = files.get(rt.module);
  if (!wasm) return { error: `the release names ${rt.module} but it is not in the zip` };
  const sourceHash = await packageHash(Object.fromEntries(files));
  const notes: string[] = [];

  const licFile = [...files.keys()].find((n) => /^(license|licence|copying)(\.(md|txt))?$/i.test(n));
  const licText = licFile ? decode(files.get(licFile)!) : '';
  const holder = holderOf(licText);
  const owner = slug(theirs.author ?? holder ?? '') || 'community';
  const name = slug(theirs.id ?? theirs.name ?? '') || 'plugin';
  const id = `${owner}.${name}`;
  const license = theirs.license ?? licenceOf(licText) ?? undefined;
  if (!theirs.author && !holder) notes.push(`the release does not say who wrote it: installed as "${id}"`);
  else if (!theirs.author) notes.push(`the author is taken from the LICENSE file: ${holder}`);
  if (!license) notes.push('the release states no licence that this app recognises');

  const out = await transpile(wasm).catch((e: Error) => e);
  if (out instanceof Error) return { error: `the component could not be converted to run here: ${out.message}` };
  if (!out.has('component.js')) return { error: 'the converter produced no component.js' };

  const caps = Array.isArray(theirs.capabilities) ? theirs.capabilities.filter((c): c is string => typeof c === 'string') : [];
  const other = caps.filter((c) => !TESTED_CAPABILITIES.includes(c));
  if (other.length) notes.push(`built for ${other.join(', ')}; this app has only been tested with ${TESTED_CAPABILITIES.join(', ')}`);
  const skipped = rt.entries.filter(leftOut);
  if (skipped.length) notes.push(`left out, this app cannot run them yet: ${skipped.map(title).join(', ')}`);
  // an entry whose form this app cannot draw (a selection list, say) is left out on its own; the rest of the plugin still installs
  const generators: Array<{ id: string; entry: string; title: string; params: ParamDef[]; effect?: 'read'; slots?: Array<{ kind: 'menu' | 'ribbon'; name: string }> }> = [];
  for (const e of rt.entries.filter((x) => !leftOut(x))) {
    try { generators.push({ id: e.name, entry: e.name, title: title(e), ...(e.effect === 'read' ? { effect: 'read' as const } : {}), params: schemaToParams(e.input_schema) as ParamDef[], ...(slotsOf(e).length ? { slots: slotsOf(e) } : {}) }); }
    catch (err) { notes.push(`left out ${title(e)}: ${(err as Error).message}`); }
  }
  if (!generators.length) return { error: 'the plugin has no entry this app can run' };

  const grants = (rt.permissions?.files ?? []).filter((f) => typeof f?.name === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(f.name)).slice(0, 8).map((f) => ({ name: f.name!, ...(f.read ? { read: true } : {}), ...(f.write ? { write: true } : {}) }));
  const pkg = new Map<string, Uint8Array>();
  for (const [n, b] of out) if (!n.endsWith('.d.ts')) pkg.set(n, b);
  if (licFile) pkg.set(licFile, files.get(licFile)!);
  const cores = [...pkg.keys()].filter((n) => n.endsWith('.wasm')).sort();
  const hashes: Record<string, string> = {};
  for (const n of [...pkg.keys()].sort()) hashes[n] = await sha256Hex(pkg.get(n)!);
  const manifest = {
    id, name: theirs.name ?? name, version: theirs.version ?? '0.0.0', ...(license ? { license } : {}),
    ...(theirs.description ? { description: theirs.description } : {}), ...(theirs.author ?? holder ? { author: theirs.author ?? holder } : {}), ...(theirs.homepage ? { homepage: theirs.homepage } : {}),
    wasm: { js: 'component.js', cores, commands: rt.commands ?? [], ...(grants.length ? { files: grants } : {}), limits: { deadlineMs: rt.limits?.deadline_ms ?? 30000, maxCommands: 256 } },
    contributes: { generators }, files: hashes,
  };
  pkg.set('plugin.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n'));
  return { files: pkg, notes, sourceHash };
}

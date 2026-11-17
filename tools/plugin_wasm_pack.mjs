#!/usr/bin/env node
// Packs a SolidCraft plugin (a folder with plugin.json and one wasm component) as a CivilKit wasm package: transpiles the component with jco,
// writes our plugin.json (generators from the chosen entries, the allow-list of commands, a sha256 for every file) and zips the result.
//   node tools/plugin_wasm_pack.mjs --from <their folder> --jco <path to the jco bin> --id <owner.name> --entries cabinet,corner --out <dir> [--author ..] [--homepage ..] [--license SPDX] [--describe id=text ...]
// jco is not a dependency of the app: `npm install` in tools/plugin-wasm-dev (see its README) and --jco defaults to that copy.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const from = resolve(arg('from', '')), out = resolve(arg('out', '')), jco = resolve(arg('jco', new URL('./plugin-wasm-dev/node_modules/@bytecodealliance/jco/dist/jco.js', import.meta.url).pathname)), id = arg('id'), entries = (arg('entries', '') || '').split(',').filter(Boolean);
if (!from || !out || !id || !entries.length) { console.error('usage: --from <dir> --jco <jco bin> --id <owner.name> --entries a,b --out <dir>'); process.exit(2); }
const theirs = JSON.parse(readFileSync(join(from, 'plugin.json'), 'utf8'));
const rt = theirs.runtime ?? theirs;
const module = rt.module;
mkdirSync(out, { recursive: true });
execFileSync(process.execPath, [jco, 'transpile', join(from, module), '-I', 'async', '-o', out, '--name', 'component'], { stdio: 'inherit' });
if (existsSync(join(from, 'LICENSE'))) copyFileSync(join(from, 'LICENSE'), join(out, 'LICENSE'));

const toParams = (schema) => Object.entries(schema?.properties ?? {}).map(([name, p]) => {
  const d = { name, type: p.enum ? 'enum' : p.type };
  if (p.enum) d.options = p.enum.map((value) => ({ value }));
  if (p.title) d.title = p.title; if (p.description) d.description = p.description;
  if (p.default !== undefined) d.default = p.default; else if (!(schema.required ?? []).includes(name)) d.optional = true;
  if (p.minimum !== undefined) d.min = p.minimum; if (p.maximum !== undefined) d.max = p.maximum; if (p.maxLength !== undefined) d.maxLength = p.maxLength;
  return d;
});
// --describe id="text" (repeatable): a help text for one generator, shown under its title in the form. The plugin's own manifest has none for most entries.
const describe = Object.fromEntries(process.argv.flatMap((a, i, all) => (a === '--describe' && all[i + 1] ? [[all[i + 1].slice(0, all[i + 1].indexOf('=')), all[i + 1].slice(all[i + 1].indexOf('=') + 1)]] : [])));
const generators = entries.map((e) => {
  const ent = rt.entries.find((x) => x.name === e);
  if (!ent) throw new Error(`no entry "${e}" in ${join(from, 'plugin.json')}`);
  return { id: e, entry: e, title: (ent.slots?.[0]?.name ?? e).replace(/…$/, ''), ...(describe[e] ? { description: describe[e] } : {}), params: toParams(ent.input_schema) };
});
const cores = readdirSync(out).filter((f) => f.endsWith('.wasm')).sort();
const sha = (f) => createHash('sha256').update(readFileSync(join(out, f))).digest('hex');
const files = Object.fromEntries(readdirSync(out).filter((f) => f !== 'plugin.json' && !f.endsWith('.d.ts') && !f.endsWith('.zip') && statSync(join(out, f)).isFile()).sort().map((f) => [f, sha(f)]));
const manifest = {
  id, name: theirs.name ?? id, version: theirs.version ?? '0.0.0', license: arg('license') ?? theirs.license ?? 'MIT',   // their plugin.json has no licence field: pass --license (e.g. Apache-2.0) from their repository; the default is only a placeholder
   description: theirs.description, author: arg('author'), homepage: arg('homepage'),
  wasm: { js: 'component.js', cores, commands: rt.commands, limits: { deadlineMs: rt.limits?.deadline_ms ?? 30000, maxCommands: 256 } },
  contributes: { generators }, files,
};
for (const k of Object.keys(manifest)) if (manifest[k] === undefined) delete manifest[k];
writeFileSync(join(out, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
const zip = `${out}.zip`;
execFileSync('zip', ['-q', '-r', '-j', zip, ...Object.keys(files).map((f) => join(out, f)), join(out, 'plugin.json')]);
console.log(`packed ${Object.keys(files).length} files -> ${zip}`);

#!/usr/bin/env node
// i18n verifier. Static (regex based, no build needed, ~1 s). Usage:
//   node tools/i18n_check.mjs [--fast] [--update-baseline] [--report] [--json]
//   --fast             skip the hardcoded-string scan and the unused-key scan (pre-commit)
//   --update-baseline  rewrite tools/i18n_baseline.json with the current hardcoded-string counts
// Exit 1 on: missing key, unlisted dynamic key, duplicate key, locale key not in en, placeholder mismatch,
// unlabelled editor enum value, hardcoded-string count above the baseline. Everything else is a warning.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIRS = ['apps', 'packages'];
const isTest = (f) => /\.(test|kernel\.test)\.(ts|tsx)$/.test(f) || /\/stubs\//.test(f);

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.') || n === 'dist' || n === 'public') continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}
const rel = (f) => relative(ROOT, f);
export function sourceFiles() { return SRC_DIRS.flatMap((d) => walk(join(ROOT, d))); }

const KEY = String.raw`[A-Za-z][\w\-]*(?:\.[\w\-]+)+`;
const ENTRY_RE = new RegExp(String.raw`(^|[\s,{])'(${KEY})'\s*:\s*(?=['"\`{])`, 'g');
const placeholders = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',');
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

/** Read a catalogue file: entries { key, line, value } (value = text up to the end of the entry, for placeholders). */
export function readCatalog(file) {
  const text = readFileSync(file, 'utf8');
  const entries = [];
  const ms = [...text.matchAll(ENTRY_RE)];
  ms.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < ms.length ? ms[i + 1].index : text.length;
    let value = text.slice(start, end);
    // plural objects: take the whole {...}; strings: first quoted literal
    const q = value[0];
    if (q === '{') value = value.slice(0, value.indexOf('}') + 1);
    else { let j = 1; while (j < value.length && value[j] !== q) j += value[j] === '\\' ? 2 : 1; value = value.slice(0, j + 1); }
    entries.push({ key: m[2], line: lineOf(text, m.index + m[1].length), value });
  });
  return { file, entries };
}

export function catalogFiles(files) {
  return files.filter((f) => !isTest(f) && (/\/locales\/|\/strings\.ts$/.test(f)) && (text(f).match(new RegExp(String.raw`^\s*.*'${KEY}'\s*:\s*['"\`{]`, 'gm')) ?? []).length >= 5);
}
const cache = new Map();
function text(f) { if (!cache.has(f)) cache.set(f, readFileSync(f, 'utf8')); return cache.get(f); }

/** English catalogue (all catalogue files except language files) and language catalogues keyed by code. */
export function loadCatalogs(files) {
  const en = new Map(); const dups = []; const langs = {};
  for (const f of catalogFiles(files)) {
    const b = basename(f, '.ts');
    const isLang = /\/locales\/[a-z]{2,3}(-[A-Za-z]+)?\.ts$/.test(f) && b !== 'en' && /^[a-z]{2,3}(-[A-Za-z]+)?$/.test(b) && !['assembly', 'drawing', 'inspect', 'toolbar'].includes(b);
    const { entries } = readCatalog(f);
    if (isLang) { langs[b] = new Map(entries.map((e) => [e.key, { ...e, file: rel(f) }])); continue; }
    for (const e of entries) {
      if (en.has(e.key)) dups.push({ key: e.key, at: `${rel(f)}:${e.line}`, first: `${en.get(e.key).file}:${en.get(e.key).line}` });
      else en.set(e.key, { ...e, file: rel(f) });
    }
  }
  return { en, dups, langs };
}

const KEYLIKE = /^[A-Za-z][\w\-]*(\.[\w\-]+)+$/;
/** All t(...) call sites: literal keys, and dynamic ones (template with ${} or 'prefix.' + x). */
export function scanCalls(files) {
  const literal = []; const dynamic = [];
  for (const f of files) {
    if (isTest(f) || /\/locales\//.test(f)) continue;
    const src = text(f).replace(/^(\s*)\/\/.*$/gm, '$1');   // comment lines out (same length semantics not needed: lines kept)
    for (const m of src.matchAll(/(?<![\w.$])t\(\s*/g)) {
      // first argument: up to the top-level comma or closing paren
      let i = m.index + m[0].length; let depth = 0; let j = i; let inStr = null;
      for (; j < src.length; j++) {
        const c = src[j];
        if (inStr) { if (c === '\\') j++; else if (c === inStr) inStr = null; else if (inStr === '`' && c === '$' && src[j + 1] === '{') { depth++; j++; } else if (inStr === '`' && c === '}' && depth) depth--; continue; }
        if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
        else if (c === ',' && depth === 0) break;
      }
      const arg = src.slice(i, j); const line = lineOf(src, m.index); const at = `${rel(f)}:${line}`;
      if (!arg.trim()) continue;
      const tpl = arg.match(/^\s*`([^`]*)`\s*$/);
      if (tpl) { if (tpl[1].includes('${')) dynamic.push({ id: tpl[1], at }); else literal.push({ key: tpl[1], at }); continue; }
      if (/^\s*'[^']*'\s*\+/.test(arg) || /^\s*"[^"]*"\s*\+/.test(arg)) { dynamic.push({ id: arg.match(/['"]([^'"]*)['"]/)[1] + '+', at }); continue; }
      const lits = [...arg.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((x) => x[1] ?? x[2]);
      if (/^\s*[A-Za-z_$][\w$.]*\s*$/.test(arg)) continue;                    // t(variable): the key is built elsewhere (see unused-scan caveat)
      if (/\bprefix\b|\+/.test(arg) && !lits.length) continue;
      for (const k of lits) if (KEYLIKE.test(k)) literal.push({ key: k, at });
    }
  }
  return { literal, dynamic };
}

export function loadDynamic() {
  const p = join(ROOT, 'tools/i18n_dynamic.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

/** Editor enums (ENUMS in FeatureEditor.tsx) -> keys that must exist. */
export function editorEnums() {
  const f = join(ROOT, 'packages/ui/src/FeatureEditor.tsx');
  const src = readFileSync(f, 'utf8');
  const block = src.match(/export const ENUMS[^=]*=\s*\{([\s\S]*?)\n\};/);
  const out = {};
  if (block) for (const m of block[1].matchAll(/'?([\w.]+)'?:\s*\[([^\]]*)\]/g)) out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return out;
}

/** The kernel checkout: CK_REBUILD, else the sibling of the kit. jsdom tests have no file module URL and run from the kit root. */
function kernelDir() {
  if (process.env.CK_REBUILD) return process.env.CK_REBUILD;
  const here = import.meta.url.startsWith('file:') ? dirname(fileURLToPath(import.meta.url)) : join(process.cwd(), 'tools');
  return join(here, '../../rebuild');
}

/** String-union fields of the kernel's feature schema (part-model/features.ts): field -> values. Best effort; [] when the kernel checkout is absent. */
export function schemaUnions() {
  const fw = kernelDir();
  const f = join(fw, 'packages/part-model/src/features.ts');
  if (!existsSync(f)) return {};
  const src = readFileSync(f, 'utf8'); const out = {};
  for (const m of src.matchAll(/^\s*(\w+)\??:\s*((?:'[\w]+'\s*\|\s*)+'[\w]+')/gm)) {
    const vals = [...m[2].matchAll(/'([\w]+)'/g)].map((x) => x[1]);
    out[m[1]] = [...new Set([...(out[m[1]] ?? []), ...vals])];
  }
  return out;
}

/** Per feature type: { field: [union values] } from the kernel's interfaces. {} when the kernel checkout is absent. */
export function schemaFeatures() {
  const fw = kernelDir();
  const f = join(fw, 'packages/part-model/src/features.ts');
  if (!existsSync(f)) return {};
  const src = readFileSync(f, 'utf8'); const out = {};
  for (const b of src.matchAll(/export interface \w+Feature \{([\s\S]*?)\n\}/g)) {
    const type = b[1].match(/^\s*type:\s*'(\w+)'/m)?.[1];
    if (!type) continue;
    out[type] = {};
    for (const m of b[1].matchAll(/^\s*(\w+)\??:\s*\|?\s*((?:'\w+'\s*\|\s*)+'\w+')/gm)) out[type][m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
  }
  return out;
}

const UNIT_OK = /^(mm|cm|m|in|deg|rad|px|kg|g|N|Pa|MPa|X|Y|Z|XY|XZ|YZ|DOF|STEP|DXF|STL|OBJ|PDF|SVG|PNG|CAD|OK|M\d+|\d+)$/;
/** Heuristic JSX scan: literal text in JSX children and in title/aria-label/placeholder/alt attributes. */
export function scanHardcoded(files) {
  const found = [];
  for (const f of files) {
    if (isTest(f) || !f.endsWith('.tsx') || /\/locales\//.test(f)) continue;
    const lines = text(f).split('\n');
    lines.forEach((raw, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(raw) || /\bt\(/.test(raw) && !/>[^<>{}]*[A-Za-z]{2,}[^<>{}]*</.test(raw)) return;
      const ln = raw.replace(/=>/g, '=_').replace(/&&/g, '__').replace(/<=|>=/g, '__');
      for (const m of ln.matchAll(/(?:<[A-Za-z][\w.]*(?:\s[^<>]*)?|<\/[\w.]+|\/)>([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g)) {
        const s = m[1].trim();
        if (s && !UNIT_OK.test(s) && /[A-Za-z]{3,}/.test(s) && !/[;=(]|\bPromise\b|\bArray\b/.test(s)) found.push({ at: `${rel(f)}:${i + 1}`, file: rel(f), text: s });
      }
      // a line that is only text, directly after a line ending a tag (multi-line JSX children)
      if (i > 0 && /[>]\s*$/.test(lines[i - 1]) && !/=>\s*$/.test(lines[i - 1]) && /^\s*[A-Za-z][A-Za-z ,.'!?-]{3,}[A-Za-z.!?]\s*$/.test(raw) && !/^\s*(return|const|let|export|import|case|default|else|type|interface)\b/.test(raw)) {
        found.push({ at: `${rel(f)}:${i + 1}`, file: rel(f), text: raw.trim() });
      }
      for (const m of ln.matchAll(/\b(title|aria-label|placeholder|alt)="([^"{}]*[A-Za-z]{2,}[^"{}]*)"/g)) {
        if (!UNIT_OK.test(m[2])) found.push({ at: `${rel(f)}:${i + 1}`, file: rel(f), text: `${m[1]}="${m[2]}"` });
      }
    });
  }
  return found;
}

/** One-off helper: seed tools/i18n_dynamic.json with the en keys each dynamic call site can currently produce. Review the diff by hand. */
export function bootstrapDynamic() {
  const files = sourceFiles(); const { en } = loadCatalogs(files); const { dynamic } = scanCalls(files);
  const out = { _comment: 'dynamic t() keys -> the full keys they can produce; each must exist in en. Add variants here when a call site gains values.' };
  for (const d of dynamic) {
    if (d.id in out) continue;
    const re = d.id.endsWith('+') ? new RegExp('^' + d.id.slice(0, -1).replace(/[.]/g, '\\.') + '[^.]+$')
      : new RegExp('^' + d.id.replace(/\$\{[^}]*\}/g, '\u0000').replace(/[.]/g, '\\.').replace(/\u0000/g, '[^.]+') + '$');
    out[d.id] = [...en.keys()].filter((k) => re.test(k)).sort();
  }
  writeFileSync(join(ROOT, 'tools/i18n_dynamic.json'), JSON.stringify(out, null, 1) + '\n');
  return out;
}

export function run({ fast = false, updateBaseline = false, report = false } = {}) {
  const files = sourceFiles();
  const errors = []; const warnings = []; const stats = {};
  const { en, dups, langs } = loadCatalogs(files);
  stats.keys = en.size;
  for (const d of dups) errors.push(`duplicate key ${d.key} at ${d.at} (first at ${d.first})`);

  // (a) used keys exist
  const { literal, dynamic } = scanCalls(files);
  const missing = literal.filter((l) => !en.has(l.key));
  for (const m of missing) errors.push(`missing key ${m.key} used at ${m.at}`);
  stats.callSites = literal.length + dynamic.length; stats.missing = missing.length;
  const dyn = loadDynamic(); const dynSeen = new Set();
  for (const d of dynamic) {
    dynSeen.add(d.id);
    if (!(d.id in dyn)) { errors.push(`dynamic key ${JSON.stringify(d.id)} at ${d.at} is not listed in tools/i18n_dynamic.json`); continue; }
  }
  for (const [id, keys] of Object.entries(dyn)) {
    if (id.startsWith('_')) continue;
    for (const k of keys) if (!en.has(k)) errors.push(`dynamic key ${JSON.stringify(id)} expects ${k}, absent from en`);
    if (!dynSeen.has(id) && dynamic.length) warnings.push(`tools/i18n_dynamic.json lists ${JSON.stringify(id)} but no t() call builds it any more`);
  }
  stats.dynamic = dynamic.length;

  // (c) other locales
  stats.locales = Object.keys(langs);
  for (const [code, cat] of Object.entries(langs)) {
    let gaps = 0;
    for (const [k, e] of cat) {
      const base = en.get(k);
      if (!base) errors.push(`locale ${code}: key ${k} (${e.file}:${e.line}) is not in en`);
      else if (placeholders(base.value) !== placeholders(e.value)) errors.push(`locale ${code}: ${k} placeholders {${placeholders(e.value)}} differ from en {${placeholders(base.value)}}`);
    }
    for (const k of en.keys()) if (!cat.has(k)) gaps++;
    if (gaps) warnings.push(`locale ${code}: ${gaps} keys untranslated (falls back to English at runtime)`);
  }

  // (d) enum coverage (static)
  const enums = editorEnums(); let enumKeys = 0;
  for (const [ek, vals] of Object.entries(enums)) for (const v of vals) {
    enumKeys++;
    if (!en.has(`ui.editor.value.${ek}.${v}`)) errors.push(`enum label missing: ui.editor.value.${ek}.${v}`);
  }
  stats.editorEnumValues = enumKeys;

  if (!fast) {
    // (b) unused keys
    const used = new Set(literal.map((l) => l.key));
    const lits = new Set();
    for (const f of files) {
      if (isTest(f) || catalogFiles([f]).length) continue;
      for (const m of text(f).matchAll(/['"`]([A-Za-z][\w\-]*(?:\.[\w\-]+)+)['"`]/g)) lits.add(m[1]);
    }
    const dynPrefixes = [...new Set([...dynamic.map((d) => d.id.replace(/\$\{.*$/s, '').replace(/\+$/, '')), ...Object.values(dyn).flat().filter(Boolean)])];
    const unused = [...en.keys()].filter((k) => !used.has(k) && !lits.has(k) && !Object.values(dyn).some((a) => Array.isArray(a) && a.includes(k)) && !dynPrefixes.some((p) => p.length > 3 && k.startsWith(p)));
    stats.unused = unused.length;
    if (unused.length) warnings.push(`${unused.length} en keys look unused (see tools/i18n_report.txt)`);
    stats.unusedList = unused;

    // (e) hardcoded strings, ratchet
    const hard = scanHardcoded(files);
    const perFile = {};
    for (const h of hard) perFile[h.file] = (perFile[h.file] ?? 0) + 1;
    stats.hardcoded = hard.length; stats.hardcodedFiles = Object.keys(perFile).length;
    const bp = join(ROOT, 'tools/i18n_baseline.json');
    if (updateBaseline) writeFileSync(bp, JSON.stringify({ hardcoded: Object.fromEntries(Object.entries(perFile).sort()) }, null, 2) + '\n');
    const base = existsSync(bp) ? JSON.parse(readFileSync(bp, 'utf8')).hardcoded ?? {} : {};
    for (const [f, n] of Object.entries(perFile)) if (n > (base[f] ?? 0)) {
      errors.push(`hardcoded UI strings in ${f}: ${n} (baseline ${base[f] ?? 0}). Use t(); lines: ${hard.filter((h) => h.file === f).map((h) => h.at.split(':')[1]).join(',')}`);
    }
    if (hard.length) warnings.push(`${hard.length} hardcoded UI strings in ${stats.hardcodedFiles} files (baseline ratchet)`);
    if (report || updateBaseline || true) {
      const out = [`# i18n report (generated by tools/i18n_check.mjs)`, `## hardcoded strings (${hard.length})`, ...hard.map((h) => `${h.at}  ${h.text}`), '', `## unused en keys (${unused.length})`, ...unused];
      writeFileSync(join(ROOT, 'tools/i18n_report.txt'), out.join('\n') + '\n');
    }
  }
  return { errors, warnings, stats };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2);
  if (a.includes('--bootstrap-dynamic')) { const o = bootstrapDynamic(); console.log(Object.entries(o).filter(([k, v]) => Array.isArray(v) && !v.length).map(([k]) => 'EMPTY ' + k).join('\n')); process.exit(0); }
  const t0 = Date.now();
  const r = run({ fast: a.includes('--fast'), updateBaseline: a.includes('--update-baseline'), report: a.includes('--report') });
  if (a.includes('--json')) console.log(JSON.stringify(r, (k, v) => (k === 'unusedList' ? undefined : v), 2));
  else {
    for (const w of r.warnings) console.log('warn  ' + w);
    for (const e of r.errors) console.log('ERROR ' + e);
    const { unusedList, ...s } = r.stats;
    console.log(`i18n: ${r.errors.length} errors, ${r.warnings.length} warnings ${JSON.stringify(s)} in ${Date.now() - t0} ms`);
  }
  process.exit(r.errors.length ? 1 : 0);
}

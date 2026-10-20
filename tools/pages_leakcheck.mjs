#!/usr/bin/env node
// Scans a built static site for things that must not be published: internal hostnames, IPs, absolute paths, e-mail addresses,
// dev-server URLs, secret-looking strings and product names we do not mention.
//   node tools/pages_leakcheck.mjs <dir> [--allow tools/pages_leakcheck.allow.json]
// Exit code 1 on any hit that is not allow-listed (each allow entry needs a reason). Wasm binaries are scanned for their printable strings.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ipv4Ok = (s) => {
  const p = s.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return false;
  return s !== '127.0.0.1' && s !== '0.0.0.0';   // loopback / unspecified addresses are fine (library code, dev only)
};

/** Each pattern: id, regex (global), optional `accept(match)` returning false for a non-hit. */
export const PATTERNS = [
  { id: 'internal-host', re: /(?:internal-host|internal-host|internal-org|internal-host|maho-?commerce|mem\.internal-org)/gi },
  // not preceded by a letter/digit/dot/minus and not followed by another number: minified SVG path data ("l1.2.4.5 1 1.1") is not an address
  { id: 'ipv4', re: /(?<![\w.-])(?:\d{1,3}\.){3}\d{1,3}(?![\w.]|[ ,-]-?\.?\d)/g, accept: ipv4Ok },
  { id: 'abs-path', re: /(?:\/Users\/|\/Volumes\/|\/private\/tmp|[A-Za-z]:\\\\?(?:Users|Documents and Settings)\\)[\w.-]*/g },
  { id: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, accept: (m) => !/\.(png|jpe?g|webp|gif|svg|css|js|mjs|json|wasm|html?)$/i.test(m) },   // icon@2x.png is a file name
  // 127.0.0.1:7461 is the documented default address of the optional local kernel service (Settings > Kernel); any other local address is a dev leftover
  { id: 'localhost-url', re: /(?:localhost|127\.0\.0\.1):\d{2,5}/g, accept: (m) => m !== '127.0.0.1:7461' },
  { id: 'api-key', re: /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})/g },
  { id: 'secret-near-word', re: /(?:key|token|secret|passw(?:or)?d|credential)s?["']?\s*[:=]\s*["'][A-Za-z0-9+/_=-]{24,}["']/gi },
  { id: 'product-name', re: /ironcad|tri-?ball/gi },
  { id: 'source-map', re: /sourceMappingURL\s*=/g },
];

/** @returns {Array<{id:string, match:string, context:string, index:number}>} */
export function scanText(text, patterns = PATTERNS) {
  const out = [];
  for (const p of patterns) {
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) {
      if (p.accept && !p.accept(m[0])) continue;
      const i = m.index ?? 0;
      out.push({ id: p.id, match: m[0], index: i, context: text.slice(Math.max(0, i - 40), i + m[0].length + 40).replace(/\s+/g, ' ') });
    }
  }
  return out;
}

/** Printable ASCII runs (>= minLen) of a binary, joined by newlines. */
export function extractStrings(bytes, minLen = 6) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const c = i < bytes.length ? bytes[i] : 0;
    const printable = c >= 0x20 && c < 0x7f;
    if (printable && start < 0) start = i;
    if (!printable && start >= 0) { if (i - start >= minLen) runs.push(Buffer.from(bytes.subarray(start, i)).toString('latin1')); start = -1; }
  }
  return runs.join('\n');
}

const TEXT_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.ckpart', '.svg', '.txt', '.map', '.webmanifest', '.xml', '.md']);
const BINARY_SKIP = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf']);

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* walk(p); else yield p;
  }
}

/**
 * @param {string} dir built site
 * @param {Array<{id:string, file?:string, match?:string, reason:string}>} allow allow-listed false positives: `match` is an exact matched string, `file` a path prefix or substring
 */
export function scanDir(dir, allow = []) {
  for (const a of allow) if (!a.reason || !a.id) throw new Error('leak-check allow entry needs "id" and "reason": ' + JSON.stringify(a));
  const hits = [];
  const allowed = [];
  let files = 0;
  for (const p of walk(dir)) {
    const rel = relative(dir, p).split('\\').join('/');
    const ext = extname(p).toLowerCase();
    if (BINARY_SKIP.has(ext)) continue;
    files++;
    let text;
    if (ext === '.map') { hits.push({ file: rel, id: 'source-map', match: rel, context: 'a source map file must not be published', index: 0 }); continue; }
    if (ext === '.wasm') text = extractStrings(readFileSync(p));
    else if (TEXT_EXT.has(ext)) text = readFileSync(p, 'utf8');
    else { text = extractStrings(readFileSync(p)); }   // unknown type: treat as binary
    for (const h of scanText(text)) {
      const a = allow.find((x) => x.id === h.id && (!x.match || x.match === h.match) && (!x.file || rel.includes(x.file)));
      (a ? allowed : hits).push({ file: rel, ...h, ...(a ? { reason: a.reason } : {}) });
    }
  }
  return { hits, allowed, files };
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--allow');
  const ai = args.indexOf('--allow');
  const allowFile = ai >= 0 ? args[ai + 1] : join(here, 'pages_leakcheck.allow.json');
  if (!dir) { console.error('usage: node tools/pages_leakcheck.mjs <dir> [--allow file.json]'); process.exit(2); }
  let allow = [];
  try { allow = JSON.parse(readFileSync(allowFile, 'utf8')).allow ?? []; } catch { /* no allow file */ }
  const r = scanDir(resolve(dir), allow);
  for (const a of r.allowed) console.log(`allowed  ${a.id}  ${a.file}: ${a.match}  (${a.reason})`);
  for (const h of r.hits) console.error(`LEAK  ${h.id}  ${h.file}\n      ${h.context}`);
  console.log(`leak check: ${r.files} files scanned, ${r.hits.length} hit(s), ${r.allowed.length} allow-listed`);
  process.exit(r.hits.length ? 1 : 0);
}

// The desktop app's version is the kit's: copy it from the root package.json into desktop/package.json and src-tauri/Cargo.toml (run before every build).
import { readFileSync, writeFileSync } from 'node:fs';
const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const pj = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pj, 'utf8'));
if (pkg.version !== root) { pkg.version = root; writeFileSync(pj, JSON.stringify(pkg, null, 2) + '\n'); }
const ct = new URL('../src-tauri/Cargo.toml', import.meta.url);
const toml = readFileSync(ct, 'utf8');
const next = toml.replace(/^version = ".*"$/m, `version = "${root}"`);
if (next !== toml) writeFileSync(ct, next);
console.log(`desktop version ${root}`);

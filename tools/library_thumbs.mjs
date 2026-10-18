#!/usr/bin/env node
// Make the thumbnails of a parts library: node tools/library_thumbs.mjs <library folder> [--force] [--only id,id] [--size 480x360] [--png]
// node tools/library_thumbs.mjs <folder> --check lists missing or outdated pictures and exits 1 (CI; no kernel needed). E.g. for the samples: node tools/library_thumbs.mjs apps/cad/public/samples --check
// Renders every .ckpart under the folder through the kernel to thumbs/<id>.webp (png when cwebp is not installed or with --png) and
// fills `thumb` in library.json for the parts it lists. Runs tools/library_thumbs_cli.ts through vite-node (repo aliases, kernel session).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = resolve(root, 'node_modules/.bin/vite-node');
const r = spawnSync(bin, ['--config', resolve(root, 'vite.config.ts'), resolve(root, 'tools/library_thumbs_cli.ts'), '--', ...process.argv.slice(2)], { stdio: 'inherit', cwd: process.cwd(), env: { ...process.env, CK_WASM: process.env.CK_WASM ?? resolve(root, 'apps/cad/public/kernel/ck_wasm.wasm') } });
process.exit(r.status ?? 1);

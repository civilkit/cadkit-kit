#!/usr/bin/env node
// Render a .ckpart to a PNG: node tools/snapshot.mjs <part.ckpart> --view iso --out x.png --section y=5
// Runs tools/snapshot_cli.ts through vite-node (repo aliases and the kernel session). --help lists the options.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = resolve(root, 'node_modules/.bin/vite-node');
const r = spawnSync(bin, ['--config', resolve(root, 'vite.config.ts'), resolve(root, 'tools/snapshot_cli.ts'), '--', ...process.argv.slice(2)], { stdio: 'inherit', cwd: process.cwd(), env: { ...process.env, CK_WASM: process.env.CK_WASM ?? resolve(root, 'apps/cad/public/kernel/ck_wasm.wasm') } });
process.exit(r.status ?? 1);

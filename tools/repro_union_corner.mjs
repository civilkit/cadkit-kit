#!/usr/bin/env node
// node tools/repro_union_corner.mjs  (CK_WASM overrides the kernel); prints, for four tiny scripts, validity, volume, open mesh edges and faces without triangles.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(resolve(root, 'node_modules/.bin/vite-node'), ['--config', resolve(root, 'vite.config.ts'), resolve(root, process.env.REPRO_TS ?? 'tools/repro_union_corner.ts')], { stdio: 'inherit', env: { ...process.env, CK_WASM: process.env.CK_WASM ?? resolve(root, 'apps/cad/public/kernel/ck_wasm.wasm') } });
process.exit(r.status ?? 1);

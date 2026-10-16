#!/usr/bin/env node
// node tools/repro_text_lens.mjs  (CK_WASM overrides the kernel); see docs/kernel-bug-text-lens.md
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(resolve(root, 'node_modules/.bin/vite-node'), ['--config', resolve(root, 'vite.config.ts'), resolve(root, 'tools/repro_text_lens.ts')], { stdio: 'inherit', env: { ...process.env, CK_WASM: process.env.CK_WASM ?? resolve(root, 'apps/cad/public/kernel/ck_wasm.wasm') } });
process.exit(r.status ?? 1);

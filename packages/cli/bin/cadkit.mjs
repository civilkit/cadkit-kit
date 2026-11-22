#!/usr/bin/env node
// cadkit: headless CLI for CadKit (regen, check, export, mcp).
// In a source checkout, runs packages/cli/src/run.ts through vite-node so the @kit/* and @ck/* aliases of vite.config.ts apply.
// If a prebuilt bundle exists at dist-cli/cadkit.mjs, runs it directly without vite-node.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const bundled = join(root, 'dist-cli/cadkit.mjs');

let args;
if (existsSync(bundled) && process.env.CK_CLI_SOURCE !== '1') {
  args = [bundled, ...process.argv.slice(2)];
} else {
  const viteNode = ['node_modules/vite-node/vite-node.mjs', 'node_modules/vite-node/dist/cli.mjs']
    .map((p) => join(root, p))
    .find(existsSync);
  if (!viteNode) {
    process.stderr.write(`cadkit: vite-node not found under ${root}/node_modules (run npm install in the repo)\n`);
    process.exit(1);
  }
  args = [
    viteNode,
    '--root', root,
    '--config', join(root, 'vite.config.ts'),
    join(root, 'packages/cli/src/run.ts'),
    '--',
    ...process.argv.slice(2),
  ];
}

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: { ...process.env, CK_CLI_BIN: fileURLToPath(import.meta.url) },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

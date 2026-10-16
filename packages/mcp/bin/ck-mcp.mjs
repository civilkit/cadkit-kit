#!/usr/bin/env node
// ck-mcp: MCP server for the CAD kernel. The sources are TypeScript; this launcher runs them through vite-node (the repo's
// own dev dependency, so the @kit/* and @ck/* aliases of vite.config.ts apply). Arguments are passed through:
//   ck-mcp.mjs                 stdio shim, starts the shared daemon on demand
//   ck-mcp.mjs --stdio-direct  no daemon
//   ck-mcp.mjs --status | --stop | --daemon
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const viteNode = ['node_modules/vite-node/vite-node.mjs', 'node_modules/vite-node/dist/cli.mjs'].map((p) => join(root, p)).find(existsSync);
if (!viteNode) { process.stderr.write(`ck-mcp: vite-node not found under ${root}/node_modules (run npm install in the repo)\n`); process.exit(1); }
const child = spawn(process.execPath, [viteNode, '--root', root, '--config', join(root, 'vite.config.ts'), join(root, 'packages/mcp/src/run.ts'), '--', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, CK_MCP_BIN: fileURLToPath(import.meta.url) } });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

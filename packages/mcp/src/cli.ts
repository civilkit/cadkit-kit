// Entry point (run through vite-node by bin/ck-mcp.mjs).
//   (default)        stdio shim -> daemon (started on demand)
//   --stdio-direct   no daemon: the kernel lives in this process (tests, simple setups)
//   --daemon         run the daemon in the foreground
//   --status | --stop
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentSession } from '@kit/agent-tools';
import { startDaemon } from './daemon';
import { agentBackend, McpProtocol } from './protocol';
import { daemonAlive, ensureDaemon, httpJson, requestPairCode, runShim } from './shim';
import { clearState, readState } from './state';
import { serveStdio } from './stdio';

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  const p = argv.find((a) => a.startsWith(`${name}=`));
  return p?.slice(name.length + 1);
}

/** The kernel wasm: --wasm, CK_WASM, or the build next to this repo. */
function wasmPath(argv: string[]): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  return arg('--wasm', argv) ?? process.env.CK_WASM ?? [resolve(here, '../../../apps/cad/public/kernel/ck_wasm.wasm')].find((p) => existsSync(p));
}

export async function main(argv: string[]): Promise<number> {
  const wasm = wasmPath(argv);
  if (argv.includes('--stdio-direct')) {
    const a = await AgentSession.open({ wasmPath: wasm });
    const proto = new McpProtocol(agentBackend(a));
    await serveStdio((l) => proto.handleText(l), process.stdin, process.stdout);
    await a.close();
    return 0;
  }
  if (argv.includes('--daemon')) {
    const idle = arg('--idle-seconds', argv);
    const idleMs = idle !== undefined ? Number(idle) * 1000 : process.env.CK_MCP_IDLE_SECONDS ? Number(process.env.CK_MCP_IDLE_SECONDS) * 1000 : undefined;
    const origins = (arg('--allow-origin', argv) ?? '').split(',').filter(Boolean);
    const d = await startDaemon({ wasmPath: wasm, idleMs, allowedOrigins: origins });
    process.stderr.write(`ck-cad daemon on 127.0.0.1:${d.port} (pid ${process.pid})\n`);
    await new Promise<void>((r) => d.server.once('close', () => r()));
    return 0;
  }
  if (argv.includes('--status')) {
    const st = readState();
    const alive = await daemonAlive(st);
    process.stdout.write(`${JSON.stringify({ running: alive, ...(alive ? { port: st!.port, pid: st!.pid } : {}) })}\n`);
    return 0;
  }
  if (argv.includes('--stop')) {
    const st = readState();
    if (st && await daemonAlive(st)) await httpJson(st, 'POST', '/shutdown', '', 5000).catch(() => null);
    else clearState();
    return 0;
  }
  if (argv.includes('--pair')) {
    // prints a one-time pairing code for the app (Settings, Agent link, or the Chat panel); starts the daemon if needed
    const bin = process.env.CK_MCP_BIN ?? join(dirname(fileURLToPath(import.meta.url)), '../bin/ck-mcp.mjs');
    const pass: string[] = [];
    for (const k of ['--wasm', '--idle-seconds', '--allow-origin']) { const v = arg(k, argv); if (v !== undefined) pass.push(k, v); }
    const st = await ensureDaemon(() => { spawn(process.execPath, [bin, '--daemon', ...pass], { detached: true, stdio: 'ignore', env: process.env }).unref(); });
    const code = await requestPairCode(st);
    process.stdout.write(`${code}\n`);
    return 0;
  }
  // the shim: start the daemon with this same entry in --daemon mode
  const bin = process.env.CK_MCP_BIN ?? join(dirname(fileURLToPath(import.meta.url)), '../bin/ck-mcp.mjs');
  const pass: string[] = [];
  for (const k of ['--wasm', '--idle-seconds', '--allow-origin']) { const v = arg(k, argv); if (v !== undefined) pass.push(k, v); }
  await runShim({
    input: process.stdin, output: process.stdout,
    spawnDaemon: () => { spawn(process.execPath, [bin, '--daemon', ...pass], { detached: true, stdio: 'ignore', env: process.env }).unref(); },
  });
  return 0;
}

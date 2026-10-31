// Start the dev server of a kit checkout on a free port (5500-5549) for the UX tools; stop() ends it.
//   CK_REBUILD (the kernel checkout) and VITE_CACHE_DIR come from the environment like they do for `npm run dev`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startVite(root, scratch) {
  for (let port = 5500; port < 5550; port++) {
    try { await fetch(`http://localhost:${port}/`); continue; } catch { /* free */ }
    const cache = existsSync(scratch) ? join(scratch, 'vite-cache') : join(root, 'node_modules/.vite-ux');
    const proc = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'apps/cad', '--config', 'vite.config.ts', '--port', String(port), '--strictPort'], { cwd: root, env: { ...process.env, VITE_CACHE_DIR: cache }, stdio: 'ignore' });
    for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://localhost:${port}/`)).ok) return { url: `http://localhost:${port}/`, stop: () => proc.kill('SIGTERM') }; } catch { /* booting */ } await sleep(500); }
    proc.kill('SIGTERM'); throw new Error('vite did not start');
  }
  throw new Error('no free port in 5500-5549');
}

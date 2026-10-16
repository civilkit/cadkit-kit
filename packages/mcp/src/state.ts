// The daemon's state file: { port, token, pid, ... } in a user-only directory (0700) and file (0600).
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DaemonState { port: number; token: string; pid: number; startedAt: number; version: string }

export function stateDir(): string {
  const d = process.env.CK_MCP_HOME || join(homedir(), '.ck-cad');
  mkdirSync(d, { recursive: true, mode: 0o700 });
  try { chmodSync(d, 0o700); } catch { /* not ours */ }
  return d;
}
export const stateFile = (dir = stateDir()): string => join(dir, 'daemon.json');
export const lockFile = (dir = stateDir()): string => join(dir, 'daemon.lock');

export function writeState(s: DaemonState, dir = stateDir()): void {
  const f = stateFile(dir);
  writeFileSync(f, JSON.stringify(s), { mode: 0o600 });
  chmodSync(f, 0o600);
}
export function readState(dir = stateDir()): DaemonState | null {
  try {
    const f = stateFile(dir);
    if (!existsSync(f)) return null;
    const s = JSON.parse(readFileSync(f, 'utf8')) as DaemonState;
    return typeof s.port === 'number' && typeof s.token === 'string' ? s : null;
  } catch { return null; }
}
export function clearState(dir = stateDir(), onlyToken?: string): void {
  const s = readState(dir);
  if (onlyToken && s && s.token !== onlyToken) return;   // a newer daemon owns the file
  rmSync(stateFile(dir), { force: true });
}

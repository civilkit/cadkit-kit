// The desktop app's CSP has to allow the sandbox relay script by hash (the srcdoc frame inherits the page's policy, which has no 'unsafe-inline').
// If the relay changes, this fails with the new hash: put it in desktop/src-tauri/tauri.conf.json's script-src.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { frameHtml, relayScript, SANDBOX_CSP } from './sandbox';

// vitest runs from the repo root (or a package folder)
const confPath = ['desktop/src-tauri/tauri.conf.json', '../../desktop/src-tauri/tauri.conf.json'].map((f) => resolve(process.cwd(), f)).find(existsSync)!;
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
const csp: string = conf.app.security.csp;
const directive = (name: string): string[] => (csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name) ?? []).slice(1);

describe('sandbox under the desktop CSP', () => {
  it('the relay script is allowed by hash', () => {
    const hash = `'sha256-${createHash('sha256').update(relayScript(), 'utf8').digest('base64')}'`;
    expect(directive('script-src'), `add ${hash} to script-src`).toContain(hash);
    expect(frameHtml()).toContain(`<script>${relayScript()}</script>`);
  });
  it('the desktop policy does not open inline scripts, data: or blob: scripts for the whole app', () => {
    const s = directive('script-src');
    for (const bad of ["'unsafe-inline'", 'data:', 'blob:', '*']) expect(s).not.toContain(bad);
  });
  it('the sandbox policy itself stays closed: no network, no frames', () => {
    expect(SANDBOX_CSP).toMatch(/^default-src 'none';/);
    expect(SANDBOX_CSP).not.toMatch(/connect-src|frame-src|img-src/);
    expect(SANDBOX_CSP).not.toMatch(/https?:|\*/);
  });
  it('the desktop policy lets the sandbox frame and worker exist', () => {
    expect(directive('worker-src')).toContain('blob:');
  });
});

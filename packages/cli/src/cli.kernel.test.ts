// Real-kernel end-to-end tests for the CadKit headless CLI (runs when CK_WASM or CK_KERNEL_URL is set).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT_OK, main, type CliIo } from './index';

const tmpDir = mkdtempSync(join(tmpdir(), 'cadkit-cli-test-'));
afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function captureIo(): { io: CliIo; out: () => string; err: () => string } {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: (s) => { stdout += s; },
      stderr: (s) => { stderr += s; },
    },
    out: () => stdout,
    err: () => stderr,
  };
}

/** Simple 20x20x10 mm box part (volume = 4000 mm^3). */
function writeBoxPart(name = 'box.ckpart'): string {
  const doc = {
    format: 'ck-part',
    version: 1,
    name: 'TestBox',
    seq: 3,
    features: [
      {
        id: 'F1',
        type: 'sketch',
        name: 'Base',
        plane: { kind: 'std', id: 'top' },
        points: [
          { id: 'O', x: 0, y: 0, fixed: true },
          { id: 'p1', x: 0, y: 0 },
          { id: 'p2', x: 20, y: 0 },
          { id: 'p3', x: 20, y: 20 },
          { id: 'p4', x: 0, y: 20 },
        ],
        entities: [
          { id: 'e1', type: 'line', p1: 'p1', p2: 'p2' },
          { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' },
          { id: 'e3', type: 'line', p1: 'p3', p2: 'p4' },
          { id: 'e4', type: 'line', p1: 'p4', p2: 'p1' },
        ],
        constraints: [],
      },
      {
        id: 'F2',
        type: 'extrude',
        name: 'Box',
        sketch: 'F1',
        op: 'add',
        end: 'blind',
        depth: 10,
      },
    ],
  };
  const file = join(tmpDir, name);
  writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

describe('cadkit CLI (real kernel)', () => {
  it('regenerates, validates with fdm-print profile, and exports STEP/STL/GLB/USDZ/HTML/URDF', async () => {
    const partFile = writeBoxPart();

    // 1. regen
    const regenCap = captureIo();
    const regenCode = await main(['regen', partFile, '--json'], { io: regenCap.io });
    expect(regenCode, regenCap.err()).toBe(EXIT_OK);
    const regenRes = JSON.parse(regenCap.out());
    expect(regenRes.ok).toBe(true);
    expect(regenRes.solids).toBe(1);
    expect(regenRes.volumeMm3).toBeCloseTo(4000, 1);

    // 2. check with fdm-print profile
    const checkCap = captureIo();
    const checkCode = await main(['check', partFile, '--profile', 'fdm-print', '--json'], { io: checkCap.io });
    expect(checkCode, checkCap.err()).toBe(EXIT_OK);
    const checkRes = JSON.parse(checkCap.out());
    expect(checkRes.ok).toBe(true);
    expect(checkRes.validation.ok).toBe(true);
    expect(checkRes.mass.volumeMm3).toBeCloseTo(4000, 1);
    expect(checkRes.profile.profile.id).toBe('fdm-print');
    expect(checkRes.profile.ok).toBe(true);

    // 3. export STEP
    const stepOut = join(tmpDir, 'box.step');
    const stepCap = captureIo();
    expect(await main(['export', partFile, '--format', 'step', '--out', stepOut, '--json'], { io: stepCap.io })).toBe(EXIT_OK);
    expect(readFileSync(stepOut, 'utf8')).toContain('ISO-10303-21');

    // 4. export binary STL, GLB, USDZ, HTML, URDF
    for (const [fmt, ext] of [['stl', 'stl'], ['glb', 'glb'], ['usdz', 'usdz'], ['html', 'html'], ['urdf', 'zip']] as const) {
      const outPath = join(tmpDir, `box.${ext}`);
      const cap = captureIo();
      const code = await main(['export', partFile, '--format', fmt, '--out', outPath, '--json'], { io: cap.io });
      expect(code, `export ${fmt}: ${cap.err()}`).toBe(EXIT_OK);
      const res = JSON.parse(cap.out());
      expect(res.ok).toBe(true);
      expect(res.bytes).toBeGreaterThan(100);
    }
  });
});

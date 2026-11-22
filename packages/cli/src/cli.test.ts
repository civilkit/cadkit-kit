import { describe, expect, it } from 'vitest';
import { emptyPart, type PartDoc } from '@ck/part-model';
import {
  CLI_VERSION,
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  EXPORT_FORMATS,
  main,
  normalizeFormat,
  normalizeProfile,
  parseArgs,
  type CliDeps,
  type CliIo,
  type CliSession,
} from './index';

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

/** 12-triangle watertight 10x10x10 mm cube mesh (0..10 on each axis). */
function cubeMesh() {
  const v: [number, number, number][] = [
    [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
    [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10],
  ];
  const tris: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2], // -Z
    [4, 5, 6], [4, 6, 7], // +Z
    [0, 1, 5], [0, 5, 4], // -Y
    [2, 3, 7], [2, 7, 6], // +Y
    [0, 4, 7], [0, 7, 3], // -X
    [1, 2, 6], [1, 6, 5], // +X
  ];
  const positions = new Float32Array(tris.length * 9);
  const normals = new Float32Array(tris.length * 9);
  const triFace = new Int32Array(tris.length);
  tris.forEach(([a, b, c], ti) => {
    positions.set([...v[a], ...v[b], ...v[c]], ti * 9);
    triFace[ti] = Math.floor(ti / 2);
  });
  return {
    positions,
    normals,
    triFace,
    faceIds: ['F1.C0', 'F1.C1', 'F1.S0', 'F1.S1', 'F1.S2', 'F1.S3'],
  };
}

function cubeEdges() {
  return [
    { key: 'F1.C0|F1.S0', pts: [] },
    { key: 'F1.C0|F1.S1', pts: [] },
    { key: 'F1.C0|F1.S2', pts: [] },
    { key: 'F1.C0|F1.S3', pts: [] },
    { key: 'F1.C1|F1.S0', pts: [] },
    { key: 'F1.C1|F1.S1', pts: [] },
    { key: 'F1.C1|F1.S2', pts: [] },
    { key: 'F1.C1|F1.S3', pts: [] },
  ];
}

function makeMockSession(
  doc: PartDoc,
  overrides: Partial<CliSession> = {},
): CliSession & { closed: boolean; exportMeshCalls: unknown[] } {
  const mesh = cubeMesh();
  const edges = cubeEdges();
  const state = {
    closed: false,
    exportMeshCalls: [] as unknown[],
  };
  const base: CliSession = {
    document: doc,
    async regenReport() {
      return { errors: [], hints: [], warnings: [], threads: [], surfaces: [] };
    },
    async facts() {
      return {
        faces: mesh.faceIds,
        edges: edges.map((e) => e.key),
        solids: 1,
        volume: 1000,
        box: { min: [0, 0, 0], max: [10, 10, 10] },
      };
    },
    async validate() {
      return { ok: true, issues: [] };
    },
    async massProps() {
      return {
        volume: 1000,
        area: 600,
        com: [5, 5, 5],
        bodies: [{ volume: 1000, area: 600, com: [5, 5, 5] }],
      };
    },
    async check() {
      return { passed: 1, failed: 0, results: [{ kind: 'solids', pass: true, expected: 1, measured: 1 }] };
    },
    async profiles() {
      return {
        profiles: [
          { id: 'fdm-print', name: 'FDM 3D Print', description: 'FDM printability rules', rules: [{ id: 'minWall', title: 'Minimum wall', severity: 'error' }] },
          { id: 'cnc-3axis', name: '3-Axis CNC', description: '3-axis milling rules', rules: [{ id: 'minRadius', title: 'Min radius', severity: 'warn' }] },
        ],
      };
    },
    async checkProfile(profile: string) {
      return {
        profile: { id: profile, name: profile },
        ok: true,
        issues: [],
        summary: { errors: 0, warnings: 0, infos: 0, total: 0, rules: [{ rule: 'minWall', severity: 'error', issues: 0, passed: true }] },
      };
    },
    async step(name?: string) {
      return `ISO-10303-21;\nHEADER;\nFILE_NAME('${name ?? 'Part'}');\nENDSEC;\nEND-ISO-10303-21;\n`;
    },
    async bodyForView() {
      return {
        mesh,
        edges,
        box: { min: [0, 0, 0], max: [10, 10, 10] },
        sketches: [],
        curves: [],
        planes: [],
        markers: [],
      };
    },
    async exportMesh(opts) {
      state.exportMeshCalls.push(opts);
      return { chord: opts?.chord_mm ?? 0.05, angle: 0.1, triangles: 12, failed: [], mesh };
    },
    async close() {
      state.closed = true;
    },
  };
  const obj = Object.assign(base, overrides) as CliSession & { closed: boolean; exportMeshCalls: unknown[] };
  Object.defineProperties(obj, {
    closed: { get: () => state.closed, enumerable: true },
    exportMeshCalls: { get: () => state.exportMeshCalls, enumerable: true },
  });
  return obj;
}

describe('parseArgs', () => {
  it('routes help, version, and unknown commands', () => {
    expect(parseArgs([])).toEqual({ kind: 'help' });
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['help', 'export'])).toEqual({ kind: 'help', topic: 'export' });
    expect(parseArgs(['export', '--help'])).toEqual({ kind: 'help', topic: 'export' });
    expect(parseArgs(['--version'])).toEqual({ kind: 'version', json: false });
    expect(parseArgs(['--version', '--json'])).toEqual({ kind: 'version', json: true });
    expect(parseArgs(['bogus'])).toMatchObject({ kind: 'error', message: /unknown command: bogus/ });
  });

  it('parses regen flags and validates positionals', () => {
    expect(parseArgs(['regen', 'bracket.ckpart', '--json', '--wasm=/tmp/k.wasm'])).toEqual({
      kind: 'regen',
      file: 'bracket.ckpart',
      json: true,
      wasmPath: '/tmp/k.wasm',
    });
    expect(parseArgs(['regen'])).toMatchObject({ kind: 'error', topic: 'regen' });
    expect(parseArgs(['regen', 'a.ckpart', 'b.ckpart'])).toMatchObject({ kind: 'error', topic: 'regen' });
  });

  it('parses check flags, profile aliases, and --list-profiles', () => {
    expect(parseArgs(['check', 'part.ckpart', '--profile', 'printing', '--tol', '0.01', '--json'])).toEqual({
      kind: 'check',
      file: 'part.ckpart',
      profile: 'fdm-print',
      listProfiles: false,
      tol: 0.01,
      json: true,
      wasmPath: undefined,
    });
    expect(normalizeProfile('cnc')).toBe('cnc-3axis');
    expect(normalizeProfile('fdm-print')).toBe('fdm-print');
    expect(parseArgs(['check', '--list-profiles', '--json'])).toMatchObject({
      kind: 'check',
      listProfiles: true,
      json: true,
    });
    expect(parseArgs(['check', 'p.ckpart', '--tol', '-1'])).toMatchObject({ kind: 'error', topic: 'check' });
  });

  it('parses export flags for all supported formats', () => {
    for (const fmt of EXPORT_FORMATS) {
      expect(parseArgs(['export', 'part.ckpart', '--format', fmt, '--out', `out.${fmt}`])).toMatchObject({
        kind: 'export',
        file: 'part.ckpart',
        format: fmt,
        out: `out.${fmt}`,
      });
    }
    expect(normalizeFormat('STP')).toBe('step');
    expect(parseArgs(['export', 'part.ckpart', '-f', 'stl', '--ascii', '--quality', 'fine', '--chord', '0.05'])).toMatchObject({
      kind: 'export',
      format: 'stl',
      ascii: true,
      quality: 'fine',
      chordMm: 0.05,
    });
    expect(parseArgs(['export', 'part.ckpart'])).toMatchObject({ kind: 'error', message: /--format/ });
    expect(parseArgs(['export', 'part.ckpart', '--format', 'dxf'])).toMatchObject({ kind: 'error', message: /unsupported format/ });
    expect(parseArgs(['export', 'part.ckpart', '--format', 'stl', '--quality', 'ultra'])).toMatchObject({ kind: 'error', topic: 'export' });
  });

  it('forwards mcp flags cleanly', () => {
    expect(parseArgs(['mcp', '--wasm', '/a/ck_wasm.wasm', '--daemon'])).toEqual({
      kind: 'mcp',
      passthrough: ['--wasm', '/a/ck_wasm.wasm', '--daemon'],
      wasmPath: '/a/ck_wasm.wasm',
    });
    expect(parseArgs(['mcp', '--help'])).toEqual({ kind: 'help', topic: 'mcp' });
  });
});

describe('CLI commands (mock session)', () => {
  const sampleDoc = emptyPart('Bracket');

  it('prints help and version with exit code 0, usage errors with exit code 2', async () => {
    const cap1 = captureIo();
    expect(await main(['--help'], { io: cap1.io })).toBe(EXIT_OK);
    expect(cap1.out()).toContain('CadKit Headless CLI');

    const cap2 = captureIo();
    expect(await main(['--version', '--json'], { io: cap2.io })).toBe(EXIT_OK);
    expect(JSON.parse(cap2.out())).toEqual({ name: 'cadkit', version: CLI_VERSION });

    const cap3 = captureIo();
    expect(await main(['unknown'], { io: cap3.io })).toBe(EXIT_USAGE);
    expect(cap3.err()).toContain('unknown command: unknown');
  });

  it('regen reports summary and exits 0 on success, 1 on regen errors', async () => {
    const cap = captureIo();
    const sess = makeMockSession(sampleDoc);
    const code = await main(['regen', 'bracket.ckpart', '--json'], {
      io: cap.io,
      loadPart: () => sampleDoc,
      openSession: async () => sess,
    });
    expect(code).toBe(EXIT_OK);
    expect(sess.closed).toBe(true);
    expect(JSON.parse(cap.out())).toMatchObject({
      ok: true,
      command: 'regen',
      part: 'Bracket',
      solids: 1,
      volumeMm3: 1000,
      errors: [],
    });

    const capFail = captureIo();
    const badSess = makeMockSession(sampleDoc, {
      async regenReport() {
        return {
          errors: [['F2', { code: 'missingReference', params: { ref: 'F1.C0' } }]],
          hints: [{ feature: 'F2', code: 'missingReference', hint: 'reselect face' }],
          warnings: [],
          threads: [],
          surfaces: [],
        };
      },
    });
    const failCode = await main(['regen', 'bracket.ckpart'], {
      io: capFail.io,
      loadPart: () => sampleDoc,
      openSession: async () => badSess,
    });
    expect(failCode).toBe(EXIT_FAIL);
    expect(capFail.out()).toContain('regen FAILED');
    expect(capFail.out()).toContain('missingReference');
  });

  it('check validates geometry, mass properties, and design-check profiles', async () => {
    const cap = captureIo();
    const sess = makeMockSession(sampleDoc);
    const code = await main(['check', 'bracket.ckpart', '--profile', 'fdm-print', '--json'], {
      io: cap.io,
      loadPart: () => sampleDoc,
      openSession: async () => sess,
    });
    expect(code).toBe(EXIT_OK);
    expect(sess.closed).toBe(true);
    const parsed = JSON.parse(cap.out());
    expect(parsed).toMatchObject({
      ok: true,
      validation: { ok: true },
      mass: { volumeMm3: 1000, areaMm2: 600, bodies: 1 },
      profile: { profile: { id: 'fdm-print' }, ok: true },
    });

    const capBad = captureIo();
    const badProfileSess = makeMockSession(sampleDoc, {
      async checkProfile(profile: string) {
        return {
          profile: { id: profile, name: 'FDM' },
          ok: false,
          issues: [{ rule: 'minWall', severity: 'error', message: 'Wall is 0.4 mm', faces: ['F1.S0'], edges: [], value: 0.4, limit: 1.2, unit: 'mm' }],
          summary: { errors: 1, warnings: 0, infos: 0, total: 1, rules: [{ rule: 'minWall', severity: 'error', issues: 1, passed: false }] },
        };
      },
    });
    const failCode = await main(['check', 'bracket.ckpart', '--profile', 'printing'], {
      io: capBad.io,
      loadPart: () => sampleDoc,
      openSession: async () => badProfileSess,
    });
    expect(failCode).toBe(EXIT_FAIL);
    expect(capBad.out()).toContain('check FAIL');
    expect(capBad.out()).toContain('minWall');

    const capList = captureIo();
    const listCode = await main(['check', '--list-profiles', '--json'], {
      io: capList.io,
      openSession: async () => makeMockSession(sampleDoc),
    });
    expect(listCode).toBe(EXIT_OK);
    expect(JSON.parse(capList.out()).profiles.map((p: { id: string }) => p.id)).toEqual(['fdm-print', 'cnc-3axis']);
  });

  it('export supports step, stl, obj, 3mf, glb, urdf, usdz, and html', async () => {
    const written = new Map<string, string | Uint8Array>();
    const baseDeps = (sess: CliSession): CliDeps => ({
      loadPart: () => sampleDoc,
      openSession: async () => sess,
      writeOutput: (outPath, data) => {
        written.set(outPath, data);
        return typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength;
      },
    });

    for (const fmt of EXPORT_FORMATS) {
      const cap = captureIo();
      const sess = makeMockSession(sampleDoc);
      const outFile = `out/test.${fmt}`;
      const code = await main(['export', 'bracket.ckpart', '--format', fmt, '--out', outFile, '--json'], {
        ...baseDeps(sess),
        io: cap.io,
      });
      expect(code, `format ${fmt}`).toBe(EXIT_OK);
      expect(sess.closed).toBe(true);
      const res = JSON.parse(cap.out());
      expect(res).toMatchObject({ ok: true, format: fmt, out: outFile });
      expect(res.bytes).toBeGreaterThan(0);
      expect(written.has(outFile)).toBe(true);
    }

    expect(String(written.get('out/test.step'))).toContain('ISO-10303-21');
    expect(written.get('out/test.stl')).toBeInstanceOf(Uint8Array);
    expect(String(written.get('out/test.obj'))).toContain('v ');
    // GLB magic 'glTF'
    const glb = written.get('out/test.glb') as Uint8Array;
    expect(new TextDecoder().decode(glb.subarray(0, 4))).toBe('glTF');
    // 3MF, URDF, USDZ are ZIP archives ('PK\x03\x04')
    for (const z of ['out/test.3mf', 'out/test.urdf', 'out/test.usdz']) {
      const bytes = written.get(z) as Uint8Array;
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);
    }
    expect(String(written.get('out/test.html'))).toContain('<!DOCTYPE html>');

    // Custom mesh quality triggers session.exportMesh
    const capQ = captureIo();
    const sessQ = makeMockSession(sampleDoc);
    const codeQ = await main(['export', 'bracket.ckpart', '-f', 'stl', '--ascii', '--quality', 'fine', '--chord', '0.1'], {
      ...baseDeps(sessQ),
      io: capQ.io,
    });
    expect(codeQ).toBe(EXIT_OK);
    expect(sessQ.exportMeshCalls).toEqual([{ quality: 'fine', chord_mm: 0.1 }]);
    expect(String(written.get('Bracket.stl'))).toContain('solid Bracket');
  });

  it('mcp defaults to --stdio-direct and forwards daemon flags cleanly', async () => {
    const calls: string[][] = [];
    const deps: CliDeps = {
      env: {},
      runMcp: async (argv) => {
        calls.push(argv);
        return 0;
      },
    };
    expect(await main(['mcp'], deps)).toBe(EXIT_OK);
    expect(calls[0][0]).toBe('--stdio-direct');

    expect(await main(['mcp', '--status'], deps)).toBe(EXIT_OK);
    expect(calls[1]).not.toContain('--stdio-direct');
    expect(calls[1]).toContain('--status');

    expect(await main(['mcp', '--shim'], deps)).toBe(EXIT_OK);
    expect(calls[2]).not.toContain('--stdio-direct');
    expect(calls[2]).not.toContain('--shim');
  });
});

describe('CLI version', () => {
  it('follows the root package.json version', async () => {
    const { readFileSync } = await import('node:fs');
    const root = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(CLI_VERSION).toBe(root.version);
  });
});

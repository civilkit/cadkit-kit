// Subcommand implementations for the CadKit headless CLI: regen, check, export, mcp.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { PartDoc } from '@ck/part-model';
import { Session, type BodyFacts, type ViewBody } from '@ck/session';
import { fileStem } from '../../../apps/cad/src/exportFiles';
import {
  defaultExtensionFor,
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  formatHelp,
  parseArgs,
  type ExportFormat,
  type ExportQuality,
} from './args';
import { ExportModelError, exportMeshFormat } from './exportModel';
import { loadPartFile, resolveWasmPath } from './part';

/** The root package.json version. tools/build_cli_npm.mjs inlines it (esbuild define); from source (tests, vite-node) it is read from the repository's package.json,
 *  so tools/release.mjs bumping package.json is the only edit a release needs. */
declare const __CK_CLI_VERSION__: string | undefined;
function sourceVersion(): string {
  const read = (p: string): string | null => { try { return (JSON.parse(readFileSync(p, 'utf8')) as { version?: string }).version ?? null; } catch { return null; } };
  let here: string | null = null;
  try { here = read(fileURLToPath(new URL('../../../package.json', import.meta.url))); } catch { /* a test environment with a non-file URL: fall back to the working directory */ }
  return here ?? read('package.json') ?? '0.0.0';
}
export const CLI_VERSION: string = typeof __CK_CLI_VERSION__ === 'string' ? __CK_CLI_VERSION__ : sourceVersion();

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const defaultIo: CliIo = {
  stdout: (s) => { process.stdout.write(s); },
  stderr: (s) => { process.stderr.write(s); },
};

/** Minimal Session surface used by CLI commands (satisfied by `@ck/session` `Session` and unit-test mocks). */
export interface CliSession {
  readonly document: PartDoc;
  regenReport(): Promise<{
    errors: Array<[string, { code: string; params?: Record<string, unknown> }]>;
    hints: Array<{ feature: string; code: string; hint: string }>;
    warnings: unknown[];
    threads: unknown[];
    surfaces: unknown;
  }>;
  facts(): Promise<BodyFacts>;
  validate(tol?: number): Promise<{ ok: boolean; issues: Array<{ code: string; entity: string; detail: string }> }>;
  massProps(opts?: { bodies?: boolean }): Promise<{
    volume?: number;
    area?: number;
    com?: number[];
    principal?: number[];
    axes?: number[][];
    inertia?: number[][];
    bodies?: Array<{ volume: number; area: number; com: number[]; inertia?: number[][]; principal?: number[]; axes?: number[][] }>;
  }>;
  check(expect: Array<Record<string, unknown>>): Promise<{
    passed: number;
    failed: number;
    results: Array<{ kind: string; pass: boolean; expected?: unknown; measured?: unknown; detail?: string }>;
  }>;
  profiles(): Promise<{
    profiles: Array<{ id: string; name: string; description: string; rules: Array<{ id: string; title: string; severity: string }> }>;
  }>;
  checkProfile(profile: string): Promise<{
    profile: { id: string; name: string };
    ok: boolean;
    issues: Array<{
      rule: string;
      severity: 'error' | 'warn' | 'info';
      message: string;
      faces: string[];
      edges: string[];
      value: number | null;
      limit: number | null;
      unit: string;
    }>;
    summary: {
      errors: number;
      warnings: number;
      infos: number;
      total: number;
      rules: Array<{ rule: string; severity: string; issues: number; passed: boolean }>;
    };
  }>;
  step(name?: string): Promise<string>;
  bodyForView(): Promise<ViewBody | null>;
  exportMesh(opts?: { quality?: ExportQuality; chord_mm?: number }): Promise<{
    chord: number;
    angle: number;
    triangles: number;
    failed: string[];
    mesh: { positions: Float32Array; normals: Float32Array; triFace: Int32Array; faceIds: string[] };
  }>;
  close(): Promise<void>;
}

export interface CliDeps {
  io?: CliIo;
  openSession?: (doc: PartDoc | undefined, opts: { wasmPath?: string }) => Promise<CliSession>;
  loadPart?: (filePath: string) => PartDoc;
  writeOutput?: (outPath: string, data: string | Uint8Array) => number;
  runMcp?: (argv: string[]) => Promise<number>;
  env?: Record<string, string | undefined>;
}

const defaultOpenSession = (doc: PartDoc | undefined, opts: { wasmPath?: string }): Promise<CliSession> =>
  Session.open(doc, { wasmPath: opts.wasmPath }) as unknown as Promise<CliSession>;

const defaultWriteOutput = (outPath: string, data: string | Uint8Array): number => {
  const abs = resolve(outPath);
  mkdirSync(dirname(abs), { recursive: true });
  if (typeof data === 'string') {
    const buf = Buffer.from(data, 'utf8');
    writeFileSync(abs, buf);
    return buf.byteLength;
  }
  writeFileSync(abs, data);
  return data.byteLength;
};

const defaultRunMcp = async (argv: string[]): Promise<number> => {
  const { main: mcpMain } = await import('@kit/mcp');
  return mcpMain(argv);
};

function fmtNum(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  return Number(n.toFixed(digits)).toString();
}

function fmtBbox(box: { min: number[]; max: number[] } | null | undefined): string {
  if (!box || box.min.length < 3 || box.max.length < 3) return 'n/a';
  const dx = box.max[0] - box.min[0];
  const dy = box.max[1] - box.min[1];
  const dz = box.max[2] - box.min[2];
  return `${fmtNum(dx, 2)} x ${fmtNum(dy, 2)} x ${fmtNum(dz, 2)} mm`;
}

function writeJson(io: CliIo, payload: unknown): void {
  io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeError(io: CliIo, json: boolean, message: string, code = 'error'): void {
  if (json) {
    io.stdout(`${JSON.stringify({ ok: false, error: { code, message } }, null, 2)}\n`);
  } else {
    io.stderr(`cadkit: ${message}\n`);
  }
}

// ---------------------------------------------------------------- regen

export async function runRegen(
  opts: { file: string; json: boolean; wasmPath?: string },
  deps: CliDeps = {},
): Promise<number> {
  const io = deps.io ?? defaultIo;
  const loadPart = deps.loadPart ?? loadPartFile;
  const openSession = deps.openSession ?? defaultOpenSession;
  const wasmPath = resolveWasmPath(opts.wasmPath, deps.env);

  let doc: PartDoc;
  try {
    doc = loadPart(opts.file);
  } catch (e) {
    writeError(io, opts.json, String((e as Error)?.message ?? e), 'load_error');
    return EXIT_FAIL;
  }

  const t0 = Date.now();
  let session: CliSession | null = null;
  try {
    session = await openSession(doc, { wasmPath });
    const report = await session.regenReport();
    const facts = await session.facts();
    const elapsedMs = Date.now() - t0;

    const errors = report.errors.map(([feature, err], idx) => ({
      feature,
      code: err.code,
      ...(err.params ? { params: err.params } : {}),
      ...(report.hints[idx]?.hint ? { hint: report.hints[idx].hint } : {}),
    }));
    const ok = errors.length === 0;
    const payload = {
      ok,
      command: 'regen',
      file: opts.file,
      part: doc.name,
      features: doc.features.length,
      solids: facts.solids,
      faces: facts.faces.length,
      edges: facts.edges.length,
      volumeMm3: facts.volume,
      bbox: facts.box,
      errors,
      warnings: report.warnings,
      elapsedMs,
    };

    if (opts.json) {
      writeJson(io, payload);
    } else {
      const status = ok ? 'OK' : 'FAILED';
      io.stdout(`regen ${status}: ${doc.name} (${opts.file})\n`);
      io.stdout(
        `  features: ${doc.features.length}  solids: ${facts.solids}  faces: ${facts.faces.length}  edges: ${facts.edges.length}\n`,
      );
      if (facts.volume !== null) {
        io.stdout(`  volume: ${fmtNum(facts.volume, 3)} mm^3  bbox: ${fmtBbox(facts.box)}\n`);
      }
      if (report.warnings.length > 0) {
        io.stdout(`  warnings: ${report.warnings.length}\n`);
      }
      if (errors.length > 0) {
        io.stdout(`  errors (${errors.length}):\n`);
        for (const e of errors) {
          io.stdout(`    - [${e.feature || 'part'}] ${e.code}${e.hint ? `: ${e.hint}` : ''}\n`);
        }
      }
      io.stdout(`  elapsed: ${elapsedMs} ms\n`);
    }
    return ok ? EXIT_OK : EXIT_FAIL;
  } catch (e) {
    writeError(io, opts.json, String((e as Error)?.message ?? e), 'regen_error');
    return EXIT_FAIL;
  } finally {
    if (session) await session.close().catch(() => null);
  }
}

// ---------------------------------------------------------------- check

export async function runCheck(
  opts: { file?: string; profile?: string; listProfiles: boolean; tol?: number; json: boolean; wasmPath?: string },
  deps: CliDeps = {},
): Promise<number> {
  const io = deps.io ?? defaultIo;
  const loadPart = deps.loadPart ?? loadPartFile;
  const openSession = deps.openSession ?? defaultOpenSession;
  const wasmPath = resolveWasmPath(opts.wasmPath, deps.env);

  if (opts.listProfiles) {
    let session: CliSession | null = null;
    try {
      session = await openSession(undefined, { wasmPath });
      const { profiles } = await session.profiles();
      if (opts.json) {
        writeJson(io, { ok: true, command: 'check', profiles });
      } else {
        io.stdout(`Available design-check profiles (${profiles.length}):\n`);
        for (const p of profiles) {
          io.stdout(`  ${p.id.padEnd(14)} ${p.name} — ${p.description} (${p.rules.length} rules)\n`);
        }
      }
      return EXIT_OK;
    } catch (e) {
      writeError(io, opts.json, String((e as Error)?.message ?? e), 'profile_error');
      return EXIT_FAIL;
    } finally {
      if (session) await session.close().catch(() => null);
    }
  }

  let doc: PartDoc;
  try {
    doc = loadPart(opts.file!);
  } catch (e) {
    writeError(io, opts.json, String((e as Error)?.message ?? e), 'load_error');
    return EXIT_FAIL;
  }

  let session: CliSession | null = null;
  try {
    session = await openSession(doc, { wasmPath });
    const regen = await session.regenReport();
    const regenErrors = regen.errors.map(([feature, err], idx) => ({
      feature,
      code: err.code,
      ...(regen.hints[idx]?.hint ? { hint: regen.hints[idx].hint } : {}),
    }));

    if (regenErrors.length > 0) {
      const payload = {
        ok: false,
        command: 'check',
        file: opts.file,
        part: doc.name,
        regen: { ok: false, errors: regenErrors, warnings: regen.warnings },
      };
      if (opts.json) {
        writeJson(io, payload);
      } else {
        io.stdout(`check FAILED: ${doc.name} (${regenErrors.length} regen error(s))\n`);
        for (const e of regenErrors) {
          io.stdout(`  - [${e.feature || 'part'}] ${e.code}${e.hint ? `: ${e.hint}` : ''}\n`);
        }
      }
      return EXIT_FAIL;
    }

    const [validation, mass] = await Promise.all([
      session.validate(opts.tol),
      session.massProps({ bodies: true }).catch(() => null),
    ]);

    const expectList = (doc as unknown as { expect?: Array<Record<string, unknown>> }).expect;
    const expectations = expectList?.length
      ? await session.check(expectList)
      : null;

    let profileReport: Awaited<ReturnType<CliSession['checkProfile']>> | null = null;
    if (opts.profile) {
      profileReport = await session.checkProfile(opts.profile);
    }

    const expectOk = expectations ? expectations.failed === 0 : true;
    const profileOk = profileReport ? profileReport.ok : true;
    const ok = validation.ok && expectOk && profileOk;

    const payload = {
      ok,
      command: 'check',
      file: opts.file,
      part: doc.name,
      validation,
      mass: mass
        ? {
            volumeMm3: mass.volume ?? null,
            areaMm2: mass.area ?? null,
            comMm: mass.com ?? null,
            bodies: mass.bodies?.length ?? 0,
          }
        : null,
      ...(expectations ? { expectations } : {}),
      ...(profileReport ? { profile: profileReport } : {}),
    };

    if (opts.json) {
      writeJson(io, payload);
    } else {
      io.stdout(`check ${ok ? 'PASS' : 'FAIL'}: ${doc.name} (${opts.file})\n`);
      io.stdout(`  geometry: ${validation.ok ? 'valid' : `INVALID (${validation.issues.length} issue(s))`}\n`);
      for (const iss of validation.issues.slice(0, 10)) {
        io.stdout(`    - [${iss.entity}] ${iss.code}: ${iss.detail}\n`);
      }
      if (mass) {
        const com = mass.com ? `[${mass.com.map((v) => fmtNum(v, 2)).join(', ')}]` : 'n/a';
        io.stdout(
          `  mass: volume=${fmtNum(mass.volume, 3)} mm^3  area=${fmtNum(mass.area, 3)} mm^2  com=${com}  bodies=${mass.bodies?.length ?? 0}\n`,
        );
      }
      if (expectations) {
        io.stdout(`  expectations: ${expectations.passed} passed, ${expectations.failed} failed\n`);
        for (const r of expectations.results.filter((x) => !x.pass)) {
          io.stdout(`    - ${r.kind}: expected ${JSON.stringify(r.expected)}, measured ${JSON.stringify(r.measured)}\n`);
        }
      }
      if (profileReport) {
        const s = profileReport.summary;
        io.stdout(
          `  profile (${profileReport.profile.id}): ${profileReport.ok ? 'PASS' : 'FAIL'} (${s.errors} errors, ${s.warnings} warnings, ${s.infos} infos)\n`,
        );
        for (const iss of profileReport.issues.slice(0, 15)) {
          const faces = iss.faces.length ? ` [${iss.faces.slice(0, 3).join(', ')}]` : '';
          io.stdout(`    - ${iss.severity.toUpperCase()} ${iss.rule}: ${iss.message}${faces}\n`);
        }
      }
    }
    return ok ? EXIT_OK : EXIT_FAIL;
  } catch (e) {
    writeError(io, opts.json, String((e as Error)?.message ?? e), 'check_error');
    return EXIT_FAIL;
  } finally {
    if (session) await session.close().catch(() => null);
  }
}

// ---------------------------------------------------------------- export

export async function runExport(
  opts: {
    file: string;
    format: ExportFormat;
    out?: string;
    quality?: ExportQuality;
    chordMm?: number;
    ascii: boolean;
    json: boolean;
    wasmPath?: string;
  },
  deps: CliDeps = {},
): Promise<number> {
  const io = deps.io ?? defaultIo;
  const loadPart = deps.loadPart ?? loadPartFile;
  const openSession = deps.openSession ?? defaultOpenSession;
  const writeOutput = deps.writeOutput ?? defaultWriteOutput;
  const wasmPath = resolveWasmPath(opts.wasmPath, deps.env);

  let doc: PartDoc;
  try {
    doc = loadPart(opts.file);
  } catch (e) {
    writeError(io, opts.json, String((e as Error)?.message ?? e), 'load_error');
    return EXIT_FAIL;
  }

  const stem = fileStem(doc.name);
  const outPath = opts.out ?? `${stem}${defaultExtensionFor(opts.format)}`;

  let session: CliSession | null = null;
  try {
    session = await openSession(doc, { wasmPath });
    const regen = await session.regenReport();
    if (regen.errors.length > 0) {
      const first = regen.errors[0];
      writeError(
        io,
        opts.json,
        `regeneration failed (${regen.errors.length} error(s), first: [${first[0]}] ${first[1].code})`,
        'regen_error',
      );
      return EXIT_FAIL;
    }

    let data: string | Uint8Array;
    let triangles: number | undefined;
    let bodiesCount: number | undefined;

    if (opts.format === 'step') {
      data = await session.step(doc.name);
    } else {
      try {
        const r = await exportMeshFormat(session, doc, opts.format, { quality: opts.quality, chordMm: opts.chordMm, ascii: opts.ascii });
        data = r.data;
        triangles = r.triangles;
        bodiesCount = r.bodies;
      } catch (e) {
        if (e instanceof ExportModelError) {
          writeError(io, opts.json, e.message, e.code);
          return EXIT_FAIL;
        }
        throw e;
      }
    }

    const bytes = writeOutput(outPath, data);
    const payload = {
      ok: true,
      command: 'export',
      file: opts.file,
      part: doc.name,
      format: opts.format,
      out: outPath,
      bytes,
      ...(triangles !== undefined ? { triangles } : {}),
      ...(bodiesCount !== undefined ? { bodies: bodiesCount } : {}),
    };

    if (opts.json) {
      writeJson(io, payload);
    } else {
      const extra = [
        triangles !== undefined ? `${triangles} triangles` : null,
        bodiesCount !== undefined ? `${bodiesCount} ${bodiesCount === 1 ? 'body' : 'bodies'}` : null,
        `${bytes} bytes`,
      ].filter(Boolean).join(', ');
      io.stdout(`exported ${opts.format.toUpperCase()} -> ${outPath} (${extra})\n`);
    }
    return EXIT_OK;
  } catch (e) {
    writeError(io, opts.json, String((e as Error)?.message ?? e), 'export_error');
    return EXIT_FAIL;
  } finally {
    if (session) await session.close().catch(() => null);
  }
}

// ---------------------------------------------------------------- mcp

export async function runMcp(
  opts: { passthrough: string[]; wasmPath?: string },
  deps: CliDeps = {},
): Promise<number> {
  const runMcpMain = deps.runMcp ?? defaultRunMcp;
  const raw = [...opts.passthrough];
  const wantsShim = raw.includes('--shim');
  const filtered = raw.filter((a) => a !== '--shim');
  const hasModeFlag =
    wantsShim ||
    filtered.includes('--stdio-direct') ||
    filtered.includes('--daemon') ||
    filtered.includes('--status') ||
    filtered.includes('--stop') ||
    filtered.includes('--pair');

  // Default to --stdio-direct so `cadkit mcp` works cleanly in headless CI and Docker containers
  // without spawning a detached background daemon.
  const argv = hasModeFlag ? filtered : ['--stdio-direct', ...filtered];
  const resolvedWasm = resolveWasmPath(opts.wasmPath, deps.env);
  if (resolvedWasm && !argv.includes('--wasm') && !argv.some((a) => a.startsWith('--wasm='))) {
    argv.push('--wasm', resolvedWasm);
  }
  return runMcpMain(argv);
}

// ---------------------------------------------------------------- main

export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIo;
  const cmd = parseArgs(argv);

  switch (cmd.kind) {
    case 'help':
      io.stdout(`${formatHelp(cmd.topic)}\n`);
      return EXIT_OK;
    case 'version':
      if (cmd.json) writeJson(io, { name: 'cadkit', version: CLI_VERSION });
      else io.stdout(`cadkit ${CLI_VERSION}\n`);
      return EXIT_OK;
    case 'error':
      io.stderr(`cadkit: ${cmd.message}\n`);
      io.stderr(`Run 'cadkit ${cmd.topic ? `${cmd.topic} ` : ''}--help' for usage.\n`);
      return EXIT_USAGE;
    case 'regen':
      return runRegen(cmd, deps);
    case 'check':
      return runCheck(cmd, deps);
    case 'export':
      return runExport(cmd, deps);
    case 'mcp':
      return runMcp(cmd, deps);
  }
}

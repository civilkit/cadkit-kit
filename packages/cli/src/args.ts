// Pure argument parser and help text for the CadKit headless CLI.

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;

export const EXPORT_FORMATS = ['step', 'stl', 'obj', '3mf', 'glb', 'urdf', 'usdz', 'html'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_QUALITIES = ['coarse', 'normal', 'fine'] as const;
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];

/** Friendly process aliases accepted by `--profile` in addition to exact kernel profile ids. */
export const PROFILE_ALIASES: Record<string, string> = {
  printing: 'fdm-print',
  fdm: 'fdm-print',
  cnc: 'cnc-3axis',
  milling: 'cnc-3axis',
  injection: 'injection',
};

const FORMAT_ALIASES: Record<string, ExportFormat> = {
  step: 'step',
  stp: 'step',
  stl: 'stl',
  obj: 'obj',
  '3mf': '3mf',
  glb: 'glb',
  urdf: 'urdf',
  usdz: 'usdz',
  html: 'html',
};

export interface CommonOpts {
  json: boolean;
  wasmPath?: string;
}

export type ParsedCommand =
  | { kind: 'help'; topic?: string }
  | { kind: 'version'; json: boolean }
  | { kind: 'regen'; file: string } & CommonOpts
  | { kind: 'check'; file?: string; profile?: string; listProfiles: boolean; tol?: number } & CommonOpts
  | {
      kind: 'export';
      file: string;
      format: ExportFormat;
      out?: string;
      quality?: ExportQuality;
      chordMm?: number;
      ascii: boolean;
    } & CommonOpts
  | { kind: 'mcp'; passthrough: string[]; wasmPath?: string }
  | { kind: 'error'; message: string; topic?: string };

export function normalizeFormat(raw: string): ExportFormat | null {
  return FORMAT_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function normalizeProfile(raw: string): string {
  const key = raw.trim().toLowerCase();
  return PROFILE_ALIASES[key] ?? raw.trim();
}

export function defaultExtensionFor(format: ExportFormat): string {
  return format === 'urdf' ? '-urdf.zip' : `.${format}`;
}

export function formatHelp(topic?: string): string {
  switch (topic) {
    case 'regen':
      return [
        'Usage: cadkit regen <file.ckpart> [options]',
        '',
        'Regenerate a .ckpart document against the CadKit kernel and print a summary.',
        'Exits 0 when regeneration succeeds without errors, 1 on regeneration errors.',
        '',
        'Options:',
        '  --json           Emit machine-readable JSON',
        '  --wasm <path>    Path to ck_wasm.wasm (or set CK_WASM)',
        '  -h, --help       Show this help',
      ].join('\n');
    case 'check':
      return [
        'Usage: cadkit check <file.ckpart> [options]',
        '       cadkit check --list-profiles [--json] [--wasm <path>]',
        '',
        'Validate B-rep geometry, compute mass properties, check document expectations,',
        'and optionally run a manufacturing design-check profile.',
        'Exits 0 when all checks pass, 1 when any check fails.',
        '',
        'Options:',
        '  --profile <id>   Run design-check profile (e.g. fdm-print, cnc-3axis, injection)',
        '  --list-profiles  List built-in kernel design-check profiles and exit',
        '  --tol <mm>       Validation tolerance in millimetres',
        '  --json           Emit machine-readable JSON',
        '  --wasm <path>    Path to ck_wasm.wasm (or set CK_WASM)',
        '  -h, --help       Show this help',
      ].join('\n');
    case 'export':
      return [
        'Usage: cadkit export <file.ckpart> --format <fmt> [--out <path>] [options]',
        '',
        'Export a .ckpart document headlessly to exact STEP or mesh/viewer formats.',
        '',
        `Formats: ${EXPORT_FORMATS.join(' | ')}`,
        '',
        'Options:',
        '  -f, --format <fmt>     Output format (required)',
        '  -o, --out <path>       Output file path (default: <part-stem>.<ext>)',
        '  --quality <preset>     Mesh quality: coarse | normal | fine',
        '  --chord <mm>           Absolute tessellation chord height in mm',
        '  --ascii                Write ASCII STL instead of binary STL',
        '  --json                 Emit machine-readable JSON',
        '  --wasm <path>          Path to ck_wasm.wasm (or set CK_WASM)',
        '  -h, --help             Show this help',
      ].join('\n');
    case 'mcp':
      return [
        'Usage: cadkit mcp [options]',
        '',
        'Launch the CadKit MCP server over stdio (direct single-process mode by default).',
        '',
        'Options:',
        '  --wasm <path>          Path to ck_wasm.wasm (or set CK_WASM)',
        '  --daemon               Run shared background daemon in the foreground',
        '  --shim                 Connect stdio through the shared daemon',
        '  --status               Print daemon status as JSON',
        '  --stop                 Stop the running daemon',
        '  --pair                 Print a one-time browser pairing code',
        '  -h, --help             Show this help',
      ].join('\n');
    default:
      return [
        'CadKit Headless CLI',
        '',
        'Usage: cadkit <command> [arguments] [options]',
        '',
        'Commands:',
        '  regen <file.ckpart>    Regenerate part and report features, bodies, errors, warnings',
        '  check <file.ckpart>    Validate geometry, mass properties, and design-check profiles',
        '  export <file.ckpart>   Export to step, stl, obj, 3mf, glb, urdf, usdz, or html',
        '  mcp                    Launch the CadKit MCP server over stdio',
        '',
        'Global options:',
        '  --json                 Emit machine-readable JSON output',
        '  --wasm <path>          Override kernel WASM path (or set CK_WASM)',
        '  -v, --version          Print CLI version',
        '  -h, --help             Show help (use `cadkit <command> --help` for details)',
      ].join('\n');
  }
}

interface FlagResult {
  flags: Map<string, string | boolean>;
  positionals: string[];
  error?: string;
}

const VALUE_FLAGS = new Set(['--wasm', '--profile', '--tol', '--format', '-f', '--out', '-o', '--quality', '--chord']);
const BOOL_FLAGS = new Set(['--json', '--help', '-h', '--version', '-v', '--list-profiles', '--ascii']);

function parseFlags(argv: string[]): FlagResult {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('-')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        const name = a.slice(0, eq);
        const val = a.slice(eq + 1);
        if (VALUE_FLAGS.has(name)) {
          flags.set(name, val);
          continue;
        }
        return { flags, positionals, error: `unknown option: ${name}` };
      }
      if (BOOL_FLAGS.has(a)) {
        flags.set(a, true);
        continue;
      }
      if (VALUE_FLAGS.has(a)) {
        if (i + 1 >= argv.length) {
          return { flags, positionals, error: `missing value for ${a}` };
        }
        flags.set(a, argv[++i]);
        continue;
      }
      return { flags, positionals, error: `unknown option: ${a}` };
    }
    positionals.push(a);
  }
  return { flags, positionals };
}

function getStr(flags: Map<string, string | boolean>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = flags.get(n);
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function getBool(flags: Map<string, string | boolean>, ...names: string[]): boolean {
  return names.some((n) => flags.get(n) === true);
}

export function parseArgs(argv: string[]): ParsedCommand {
  if (argv.length === 0) return { kind: 'help' };

  const first = argv[0];
  if (first === '-h' || first === '--help') return { kind: 'help' };
  if (first === 'help') return { kind: 'help', topic: argv[1] };
  if (first === '-v' || first === '--version') {
    return { kind: 'version', json: argv.includes('--json') };
  }

  // `mcp` forwards its own flags directly to @kit/mcp (except -h/--help).
  if (first === 'mcp') {
    const rest = argv.slice(1);
    if (rest.includes('-h') || rest.includes('--help')) return { kind: 'help', topic: 'mcp' };
    let wasmPath: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--wasm' && rest[i + 1]) wasmPath = rest[i + 1];
      else if (rest[i].startsWith('--wasm=')) wasmPath = rest[i].slice('--wasm='.length);
    }
    return { kind: 'mcp', passthrough: rest, wasmPath };
  }

  if (first !== 'regen' && first !== 'check' && first !== 'export') {
    return { kind: 'error', message: `unknown command: ${first}` };
  }

  const { flags, positionals, error } = parseFlags(argv.slice(1));
  if (getBool(flags, '-h', '--help')) return { kind: 'help', topic: first };
  if (error) return { kind: 'error', message: error, topic: first };

  const json = getBool(flags, '--json');
  const wasmPath = getStr(flags, '--wasm');

  if (first === 'regen') {
    if (positionals.length !== 1) {
      return { kind: 'error', message: 'regen requires exactly one <file.ckpart> argument', topic: 'regen' };
    }
    return { kind: 'regen', file: positionals[0], json, wasmPath };
  }

  if (first === 'check') {
    const listProfiles = getBool(flags, '--list-profiles');
    const profileRaw = getStr(flags, '--profile');
    const tolRaw = getStr(flags, '--tol');
    let tol: number | undefined;
    if (tolRaw !== undefined) {
      tol = Number(tolRaw);
      if (!Number.isFinite(tol) || tol <= 0) {
        return { kind: 'error', message: `invalid --tol value: ${tolRaw} (expected positive number)`, topic: 'check' };
      }
    }
    if (!listProfiles && positionals.length !== 1) {
      return { kind: 'error', message: 'check requires a <file.ckpart> argument (or --list-profiles)', topic: 'check' };
    }
    if (positionals.length > 1) {
      return { kind: 'error', message: `unexpected argument: ${positionals[1]}`, topic: 'check' };
    }
    return {
      kind: 'check',
      file: positionals[0],
      profile: profileRaw ? normalizeProfile(profileRaw) : undefined,
      listProfiles,
      tol,
      json,
      wasmPath,
    };
  }

  // export
  if (positionals.length !== 1) {
    return { kind: 'error', message: 'export requires exactly one <file.ckpart> argument', topic: 'export' };
  }
  const formatRaw = getStr(flags, '--format', '-f');
  if (!formatRaw) {
    return { kind: 'error', message: 'export requires --format <step|stl|obj|3mf|glb|urdf|usdz|html>', topic: 'export' };
  }
  const format = normalizeFormat(formatRaw);
  if (!format) {
    return {
      kind: 'error',
      message: `unsupported format: ${formatRaw} (supported: ${EXPORT_FORMATS.join(', ')})`,
      topic: 'export',
    };
  }
  const out = getStr(flags, '--out', '-o');
  const qualityRaw = getStr(flags, '--quality');
  let quality: ExportQuality | undefined;
  if (qualityRaw !== undefined) {
    const q = qualityRaw.trim().toLowerCase();
    if (!(EXPORT_QUALITIES as readonly string[]).includes(q)) {
      return {
        kind: 'error',
        message: `invalid --quality value: ${qualityRaw} (expected: ${EXPORT_QUALITIES.join(', ')})`,
        topic: 'export',
      };
    }
    quality = q as ExportQuality;
  }
  const chordRaw = getStr(flags, '--chord');
  let chordMm: number | undefined;
  if (chordRaw !== undefined) {
    chordMm = Number(chordRaw);
    if (!Number.isFinite(chordMm) || chordMm <= 0) {
      return { kind: 'error', message: `invalid --chord value: ${chordRaw} (expected positive number)`, topic: 'export' };
    }
  }
  const ascii = getBool(flags, '--ascii');
  return {
    kind: 'export',
    file: positionals[0],
    format,
    out,
    quality,
    chordMm,
    ascii,
    json,
    wasmPath,
  };
}

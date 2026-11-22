// Builds the standalone headless CLI bundle into dist-cli/: one bundled ESM entry (`cadkit.mjs`),
// the kernel worker (`worker-host.js`), and the kernel WASM (`ck_wasm.wasm`), so the CLI or Docker
// image runs with Node 22 and zero devDependencies.
//   node tools/build_cli_npm.mjs [--kernel-repo <checkout>] [--wasm <ck_wasm.wasm>] [--out dist-cli]
import { build } from 'esbuild';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };

const defaultKernel = [
  process.env.CK_REBUILD,
  resolve(ROOT, '../rebuild'),
  resolve(ROOT, '../kernel'),
].find((p) => p && existsSync(resolve(p, 'packages/part-model/src/index.ts')));

const FW = resolve(opt('--kernel-repo', defaultKernel ?? resolve(ROOT, '../rebuild')));
const defaultWasm = [
  process.env.CK_WASM,
  process.env.WASM_SRC,
  resolve(ROOT, 'apps/cad/public/kernel/ck_wasm.wasm'),
  resolve(FW, 'target/wasm32-unknown-unknown/release/ck_wasm.wasm'),
].find((p) => p && existsSync(p));
const WASM = resolve(opt('--wasm', defaultWasm ?? resolve(ROOT, 'apps/cad/public/kernel/ck_wasm.wasm')));
const NAME = opt('--name', 'cadkit-cli');
const OUT = resolve(ROOT, opt('--out', 'dist-cli'));
const version = opt('--version', JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version ?? '0.0.0');

const die = (m) => { console.error(`build_cli_npm: ${m}`); process.exit(1); };
if (!existsSync(FW + '/packages/part-model/src/index.ts')) die(`no kernel checkout at ${FW} (--kernel-repo)`);
if (!existsSync(WASM)) die(`no kernel wasm at ${WASM} (--wasm)`);
if (!OUT.startsWith(ROOT + '/')) die('--out must be inside the repository');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const alias = {
  '@kit/store': 'packages/store/src/index.ts',
  '@kit/i18n': 'packages/i18n/src/index.ts',
  '@kit/platform': 'packages/platform/src/index.ts',
  '@kit/io': 'packages/io/src/index.ts',
  '@kit/fcstd': 'packages/fcstd/src/index.ts',
  '@kit/solidcraft': 'packages/solidcraft/src/index.ts',
  '@kit/sketch': 'packages/sketch/src/index.ts',
  '@kit/script': 'packages/script/src/index.ts',
  '@kit/skill': 'packages/skill/src/index.ts',
  '@kit/agent-tools': 'packages/agent-tools/src/index.ts',
  '@kit/plugin': 'packages/plugin/src/index.ts',
  '@kit/plugin-tools': 'packages/plugin-tools/src/index.ts',
  '@kit/readback': 'packages/readback/src/index.ts',
  '@kit/mcp': 'packages/mcp/src/index.ts',
  '@kit/cli': 'packages/cli/src/index.ts',
  '@kit/agent-link': 'packages/agent-link/src/index.ts',
  '@kit/snapshot': 'packages/snapshot/src/index.ts',
  '@kit/viewdata': 'packages/viewdata/src/index.ts',
  '@kit/cad-drawing': 'packages/drawing/src/drawing/headless.ts',
};
for (const [k, v] of Object.entries(alias)) alias[k] = resolve(ROOT, v);
Object.assign(alias, {
  '@ck/driver-verify': FW + '/packages/driver/src/verify.ts',
  '@ck/session': FW + '/packages/session/src/session.ts',
  '@ck/mesh': FW + '/packages/render/src/mesh.ts',
  '@ck/part-model': FW + '/packages/part-model/src/index.ts',
  '@ck/kernel-client/node': FW + '/packages/kernel-client/src/worker.ts',
  '@ck/kernel-client/browser': FW + '/packages/kernel-client/src/browser.ts',
  '@ck/kernel-client/native': FW + '/packages/kernel-client/src/native.ts',
  '@ck/kernel-client/mock': FW + '/packages/kernel-client/src/mock-service.ts',
});

// Vite-only syntax in UI modules (unused by the headless CLI): replace with empty table.
const noGlob = {
  name: 'no-import-meta-glob',
  setup(b) {
    b.onLoad({ filter: /\.tsx?$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      return src.includes('import.meta.glob(')
        ? { contents: src.replace(/import\.meta\.glob\([^)]*\)/g, '({})'), loader: args.path.endsWith('x') ? 'tsx' : 'ts' }
        : undefined;
    });
  },
};

const common = {
  plugins: [noGlob],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias,
  logLevel: 'warning',
  legalComments: 'none',
};

const banner = [
  '#!/usr/bin/env node',
  `import { createRequire as __cr } from 'node:module';`,
  `import { fileURLToPath as __fu } from 'node:url';`,
  'const require = __cr(import.meta.url);',
  'process.env.CK_CLI_BIN ??= __fu(import.meta.url);',
  'process.env.CK_MCP_BIN ??= __fu(import.meta.url);',
  '',
].join('\n');

await build({
  ...common,
  entryPoints: [resolve(ROOT, 'packages/cli/src/run.ts')],
  outfile: OUT + '/cadkit.mjs',
  banner: { js: banner },
  define: { __CK_CLI_VERSION__: JSON.stringify(version) },
});
await build({
  ...common,
  entryPoints: [FW + '/packages/kernel-client/src/worker-host.ts'],
  outfile: OUT + '/worker-host.js',
  banner: { js: `import { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);\n` },
});

chmodSync(OUT + '/cadkit.mjs', 0o755);
copyFileSync(WASM, OUT + '/ck_wasm.wasm');

writeFileSync(
  OUT + '/package.json',
  JSON.stringify(
    {
      name: NAME,
      version,
      type: 'module',
      description: 'Headless CLI for CadKit: regenerate, validate, export STEP/mesh/viewer formats, and run the MCP server.',
      bin: { cadkit: 'cadkit.mjs' },
      files: ['cadkit.mjs', 'worker-host.js', 'ck_wasm.wasm'],
      engines: { node: '>=22' },
      license: 'MIT OR Apache-2.0',
    },
    null,
    2,
  ) + '\n',
);

console.log(`built ${NAME}@${version} into ${OUT}`);

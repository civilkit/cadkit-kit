// Builds the npm package of the local service (ck-mcp) into dist-mcp-npm/: one bundled file, the kernel worker and the kernel wasm, so
//   npx civilkit-mcp --pair --allow-origin https://civilkit.io
// needs no clone and no build. Publishing is a separate, deliberate step (npm publish in dist-mcp-npm/).
//   node tools/build_mcp_npm.mjs --kernel-repo <kernel checkout> --wasm <ck_wasm.wasm> [--name civilkit-mcp] [--version 0.7.3] [--out dist-mcp-npm]
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const FW = resolve(opt('--kernel-repo', process.env.CK_REBUILD ?? resolve(ROOT, '../kernel')));
const WASM = resolve(opt('--wasm', process.env.WASM_SRC ?? resolve(ROOT, 'apps/cad/public/kernel/ck_wasm.wasm')));
const NAME = opt('--name', 'civilkit-mcp');
const OUT = resolve(ROOT, opt('--out', 'dist-mcp-npm'));
const version = opt('--version', JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version ?? '0.0.0');
const die = (m) => { console.error(`build_mcp_npm: ${m}`); process.exit(1); };
if (!existsSync(FW + '/packages/part-model/src/index.ts')) die(`no kernel checkout at ${FW} (--kernel-repo)`);
if (!existsSync(WASM)) die(`no kernel wasm at ${WASM} (--wasm)`);
if (!OUT.startsWith(ROOT + '/')) die('--out must be inside the repository');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const alias = {
  '@kit/store': 'packages/store/src/index.ts', '@kit/i18n': 'packages/i18n/src/index.ts', '@kit/platform': 'packages/platform/src/index.ts',
  '@kit/io': 'packages/io/src/index.ts', '@kit/fcstd': 'packages/fcstd/src/index.ts', '@kit/solidcraft': 'packages/solidcraft/src/index.ts',
  '@kit/sketch': 'packages/sketch/src/index.ts', '@kit/script': 'packages/script/src/index.ts', '@kit/skill': 'packages/skill/src/index.ts',
  '@kit/agent-tools': 'packages/agent-tools/src/index.ts', '@kit/plugin': 'packages/plugin/src/index.ts', '@kit/plugin-tools': 'packages/plugin-tools/src/index.ts', '@kit/readback': 'packages/readback/src/index.ts', '@kit/mcp': 'packages/mcp/src/index.ts',
  '@kit/agent-link': 'packages/agent-link/src/index.ts', '@kit/snapshot': 'packages/snapshot/src/index.ts', '@kit/viewdata': 'packages/viewdata/src/index.ts',
  '@kit/cad-drawing': 'packages/drawing/src/drawing/headless.ts',
};
for (const [k, v] of Object.entries(alias)) alias[k] = resolve(ROOT, v);
Object.assign(alias, {
  '@ck/driver-verify': FW + '/packages/driver/src/verify.ts', '@ck/session': FW + '/packages/session/src/session.ts', '@ck/mesh': FW + '/packages/render/src/mesh.ts',
  '@ck/part-model': FW + '/packages/part-model/src/index.ts', '@ck/kernel-client/node': FW + '/packages/kernel-client/src/worker.ts',
  '@ck/kernel-client/browser': FW + '/packages/kernel-client/src/browser.ts', '@ck/kernel-client/native': FW + '/packages/kernel-client/src/native.ts',
  '@ck/kernel-client/mock': FW + '/packages/kernel-client/src/mock-service.ts',
});
// Vite-only syntax in the UI package (icon art, unused by the service): an empty table in this build
const noGlob = { name: 'no-import-meta-glob', setup(b) { b.onLoad({ filter: /\.tsx?$/ }, (args) => {
  const src = readFileSync(args.path, 'utf8');
  return src.includes('import.meta.glob(') ? { contents: src.replace(/import\.meta\.glob\([^)]*\)/g, '({})'), loader: args.path.endsWith('x') ? 'tsx' : 'ts' } : undefined;
}); } };
const common = { plugins: [noGlob], bundle: true, platform: 'node', format: 'esm', target: 'node22', alias, logLevel: 'warning', legalComments: 'none' };
const banner = `#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module';\nimport { fileURLToPath as __fu } from 'node:url';\nconst require = __cr(import.meta.url);\nprocess.env.CK_MCP_BIN ??= __fu(import.meta.url);\n`;
await build({ ...common, entryPoints: [resolve(ROOT, 'packages/mcp/src/run.ts')], outfile: OUT + '/ck-mcp.mjs', banner: { js: banner } });
await build({ ...common, entryPoints: [FW + '/packages/kernel-client/src/worker-host.ts'], outfile: OUT + '/worker-host.js', banner: { js: `import { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);\n` } });
copyFileSync(WASM, OUT + '/ck_wasm.wasm');
writeFileSync(OUT + '/package.json', JSON.stringify({
  name: NAME, version, type: 'module', description: 'The local service that lets Claude Code, Codex or another agent drive CivilKit CAD (https://civilkit.io/cad/).',
  bin: { 'civilkit-mcp': 'ck-mcp.mjs', 'ck-mcp': 'ck-mcp.mjs' }, files: ['ck-mcp.mjs', 'worker-host.js', 'ck_wasm.wasm', 'README.md'],
  engines: { node: '>=22' }, license: 'SEE LICENSE IN README.md', homepage: 'https://civilkit.io/cad/', repository: { type: 'git', url: 'https://github.com/civilkit/cadkit-kit' },
}, null, 2) + '\n');
writeFileSync(OUT + '/README.md', `# ${NAME}\n\nThe local service for CivilKit CAD (https://civilkit.io/cad/). Run it, paste the pairing code into the app's Chat panel, and an agent such as Claude Code can drive the part you have open.\n\n\`\`\`sh\nnpx ${NAME} --pair --allow-origin https://civilkit.io\n\`\`\`\n\nNeeds Node 22. Other commands: \`--status\`, \`--stop\`. Without \`--pair\` it is an MCP server on stdio for an MCP client. Source and guide: https://github.com/civilkit/cadkit-kit and https://civilkit.io/docs/cad/automation/mcp.html.\n`);
console.log(`built ${NAME}@${version} into ${OUT}`);

import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { fileURLToPath } from 'node:url'

// the kernel repo checkout whose packages (session, part-model, kernel-client) the kit uses; CK_REBUILD overrides it
const FW = process.env.CK_REBUILD ?? fileURLToPath(new URL('../rebuild', import.meta.url))
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Static-site build (tools/build_pages.mjs): PAGES_BUILD=1 puts the output in PAGES_OUT, serves from PAGES_BASE (default './', which works
// under any sub-path and at a domain root), writes no source maps and copies nothing from public/ (the script assembles kernel, samples and licences).
const pages = process.env.PAGES_BUILD === '1'

/** Pages build only: the move/rotate-ball feature is called `triball` in identifiers, i18n keys, CSS classes and storage keys throughout the source,
 *  and the public site must not carry that word (tools/pages_leakcheck.mjs). Every kit module gets the same rename, so the bundle stays consistent. */
const renameInternalWord = (): import('vite').Plugin => ({
  name: 'pages-rename-ball-feature',
  enforce: 'pre',
  // import specifiers are rewritten too (./triball/useTriBall), so map them back to the real file names
  resolveId(source, importer, opts) {
    if (!/moveball/i.test(source)) return null;
    return this.resolve(source.replace(/moveball/g, 'triball').replace(/MoveBall/g, 'TriBall'), importer, { ...opts, skipSelf: true });
  },
  transform(code, id) {
    if (id.includes('node_modules')) return null;
    if (!/\.(tsx?|css|json)(\?|$)/.test(id)) return null;
    const out = code.replace(/(tri)(ball)/gi, (_m, a: string, b: string) => (a === 'Tri' ? 'Move' : a === 'TRI' ? 'MOVE' : 'move') + b);
    return out === code ? null : { code: out, map: null };
  },
});

export default defineConfig(({ command }) => ({
  plugins: [preact(), ...(pages ? [renameInternalWord()] : [])],
  ...(pages ? {
    base: process.env.PAGES_BASE || './',
    publicDir: false as const,
    build: { outDir: process.env.PAGES_OUT || here('./dist-pages'), emptyOutDir: true, sourcemap: false },
  } : {}),
  // several dev servers (one per worktree) share node_modules; give each its own dependency cache with VITE_CACHE_DIR
  ...(process.env.VITE_CACHE_DIR ? { cacheDir: process.env.VITE_CACHE_DIR } : {}),
  resolve: {
    alias: [
      // The browser build never uses the Node worker client that Session loads lazily; stub it so it is not bundled.
      ...(command === 'build' ? [{ find: /^.*kernel-client\/src\/worker\.(js|ts)$/, replacement: here('./apps/cad/src/stubs/node-worker.ts') }] : []),
      ...Object.entries({
      '@kit/store': here('./packages/store/src/index.ts'),
      '@kit/i18n': here('./packages/i18n/src/index.ts'),
      '@kit/viewport': here('./packages/viewport/src/index.ts'),
      '@kit/platform': here('./packages/platform/src/index.ts'),
      '@kit/io': here('./packages/io/src/index.ts'),
      '@kit/fcstd': here('./packages/fcstd/src/index.ts'),
      '@kit/solidcraft': here('./packages/solidcraft/src/index.ts'),
      '@kit/sketch': here('./packages/sketch/src/index.ts'),
      '@kit/script': here('./packages/script/src/index.ts'),
      '@kit/skill': here('./packages/skill/src/index.ts'),
      '@kit/ui': here('./packages/ui/src/index.ts'),
      '@kit/agent-tools': here('./packages/agent-tools/src/index.ts'),
      '@kit/mcp': here('./packages/mcp/src/index.ts'),
      '@kit/snapshot': here('./packages/snapshot/src/index.ts'),
      '@ck/driver-verify': FW + '/packages/driver/src/verify.ts',
      '@ck/session': FW + '/packages/session/src/session.ts',
      '@ck/mesh': FW + '/packages/render/src/mesh.ts',
      '@ck/part-model': FW + '/packages/part-model/src/index.ts',
      '@ck/kernel-client/browser': FW + '/packages/kernel-client/src/browser.ts',
      '@ck/kernel-client/node': FW + '/packages/kernel-client/src/worker.ts',
      '@ck/kernel-client/native': FW + '/packages/kernel-client/src/native.ts',
      '@ck/kernel-client/mock': FW + '/packages/kernel-client/src/mock-service.ts',
      }).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}', 'tools/**/*.test.{ts,tsx}'],
    // CK_KERNEL_URL (+ CK_KERNEL_TOKEN) runs the kernel suites against a local native service instead of CK_WASM (docs/local-kernel-service.md)
    setupFiles: ['./tools/vitest.kernel-env.ts']
  },
  server: {
    fs: {
      allow: [here('.'), FW]
    }
  }
}))

import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { fileURLToPath } from 'node:url'

// the kernel repo checkout whose packages (session, part-model, kernel-client) the kit uses; CK_REBUILD overrides it
const FW = process.env.CK_REBUILD ?? '/path/to/work/rebuild'
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig(({ command }) => ({
  plugins: [preact()],
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
      '@kit/sketch': here('./packages/sketch/src/index.ts'),
      '@kit/ui': here('./packages/ui/src/index.ts'),
      '@ck/session': FW + '/packages/session/src/session.ts',
      '@ck/mesh': FW + '/packages/render/src/mesh.ts',
      '@ck/part-model': FW + '/packages/part-model/src/index.ts',
      '@ck/kernel-client/browser': FW + '/packages/kernel-client/src/browser.ts',
      '@ck/kernel-client/node': FW + '/packages/kernel-client/src/worker.ts',
      }).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}']
  },
  server: {
    fs: {
      allow: [here('.'), FW]
    }
  }
}))

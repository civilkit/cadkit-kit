import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { fileURLToPath } from 'node:url'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig(({ command }) => ({
  plugins: [preact()],
  resolve: {
    alias: [
      // The browser build never uses the Node worker client that Session loads lazily; stub it so it is not bundled.
      ...(command === 'build' ? [{ find: /^.*kernel-client\/src\/worker\.(js|ts)$/, replacement: here('./apps/cad/src/stubs/node-worker.ts') }] : []),
      ...Object.entries({
      '@kit/store': here('./packages/store/src/index.ts'),
      '@kit/i18n': here('./packages/i18n/src/index.ts'),
      '@kit/viewport': here('./packages/viewport/src/index.ts'),
      '@kit/platform': here('./packages/platform/src/index.ts'),
      '@kit/sketch': here('./packages/sketch/src/index.ts'),
      '@kit/ui': here('./packages/ui/src/index.ts'),
      '@ck/session': '/path/to/work/rebuild/packages/session/src/session.ts',
      '@ck/part-model': '/path/to/work/rebuild/packages/part-model/src/index.ts',
      '@ck/kernel-client/browser': '/path/to/work/rebuild/packages/kernel-client/src/browser.ts',
      '@ck/kernel-client/node': '/path/to/work/rebuild/packages/kernel-client/src/worker.ts',
      }).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}']
  },
  server: {
    fs: {
      allow: [here('.'), '/path/to/work/rebuild']
    }
  }
}))

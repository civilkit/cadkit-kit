import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { fileURLToPath } from 'node:url'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@kit/store': here('./packages/store/src/index.ts'),
      '@kit/viewport': here('./packages/viewport/src/index.ts'),
      '@kit/platform': here('./packages/platform/src/index.ts'),
      '@kit/ui': here('./packages/ui/src/index.ts'),
      '@ck/session': '/path/to/work/rebuild/packages/session/src/session.ts',
      '@ck/part-model': '/path/to/work/rebuild/packages/part-model/src/index.ts',
      '@ck/kernel-client/browser': '/path/to/work/rebuild/packages/kernel-client/src/browser.ts',
      '@ck/kernel-client/node': '/path/to/work/rebuild/packages/kernel-client/src/worker.ts',
    }
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
})
// Vitest setup. With CK_KERNEL_URL set (and CK_WASM not), the kernel suites run against a local native kernel service:
// Session.open reads CK_KERNEL_URL / CK_KERNEL_TOKEN itself, and the suites switch on CK_WASM, so give it the app's own wasm path
// (the file need not exist: it is only the switch, plus what the few capability checks try to read). Nothing happens without CK_KERNEL_URL.
import { resolve } from 'node:path';

if (process.env.CK_KERNEL_URL && !process.env.CK_WASM) {
  process.env.CK_WASM = resolve(process.cwd(), 'apps/cad/public/kernel/ck_wasm.wasm');
}

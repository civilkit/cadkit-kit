// The browser side of feature recognition: quiddity built to WebAssembly (tools/quiddity_wasm, Apache-2.0), loaded only when asked for.
// It runs in a worker made from a small inline script, so a few seconds of recognition on a big part never freezes the page, and the 6 MB module
// is not part of the app's own bundle: the worker fetches `quiddity/quiddity_wasm.js` and its .wasm from beside the app the first time.
export interface RecogniseReply { json: string; version: string }
export type Recogniser = (step: Uint8Array) => Promise<RecogniseReply>;

const SOURCE = `
let mod = null;
self.onmessage = async (e) => {
  const { id, base, bytes } = e.data;
  try {
    if (!mod) {
      const m = await import(base + 'quiddity/quiddity_wasm.js');
      await m.default({ module_or_path: base + 'quiddity/quiddity_wasm_bg.wasm' });
      mod = m;
    }
    self.postMessage({ id, ok: true, json: mod.recognise(bytes), version: mod.version() });
  } catch (err) { self.postMessage({ id, ok: false, message: String(err && err.message ? err.message : err) }); }
};`;

/** Where the module sits: next to the app, like the kernel (`kernel/ck_wasm.wasm`). */
export function moduleBase(): string {
  return new URL(import.meta.env.BASE_URL, document.baseURI).href;
}

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { ok(r: RecogniseReply): void; fail(e: Error): void }>();

function start(): Worker {
  if (worker) return worker;
  const w = new Worker(URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' })));
  w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; json?: string; version?: string; message?: string }>) => {
    const p = waiting.get(e.data.id);
    if (!p) return;
    waiting.delete(e.data.id);
    if (e.data.ok) p.ok({ json: e.data.json ?? '', version: e.data.version ?? '' }); else p.fail(new Error(e.data.message ?? 'recognition failed'));
  };
  w.onerror = (e) => { for (const p of waiting.values()) p.fail(new Error(e.message || 'the recognition worker stopped')); waiting.clear(); worker = null; };
  worker = w;
  return w;
}

/** Recognise the features of a STEP file's bytes (the module is fetched the first time). */
export const recogniseInBrowser: Recogniser = (step) => new Promise((ok, fail) => {
  const id = ++seq;
  waiting.set(id, { ok, fail });
  // a copy: the buffer is transferred to the worker
  const bytes = step.slice();
  start().postMessage({ id, base: moduleBase(), bytes }, [bytes.buffer]);
});

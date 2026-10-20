import type { Platform } from './index';
import { idbHandleStore, readHandleWith, saveDocumentWith, type FsEnv } from './fsaccess';

const MIME: Record<string, string> = { stl: 'model/stl', obj: 'model/obj', dxf: 'image/vnd.dxf', step: 'model/step', stp: 'model/step', ckpart: 'application/json', json: 'application/json' };
const mimeFor = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export function createWebPlatform(opts: { base?: string } = {}): Platform {
  const base = opts.base ?? '/';
  return {
    openFile(opts?: { accept?: string[] }): Promise<{ name: string; text: string; bytes?: Uint8Array } | null> {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        // both cases of each extension: some pickers match the accept list case-sensitively
        if (opts?.accept?.length) input.accept = [...new Set(opts.accept.flatMap((e) => [e.toLowerCase(), e.toUpperCase().replace(/^\./, '.')]))].join(',');
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          if (/\.(fcstd|sldprt|skp)$/i.test(f.name)) return resolve({ name: f.name, text: '', bytes: new Uint8Array(await f.arrayBuffer()) });   // binary container: text would be garbage
          resolve({ name: f.name, text: await f.text() });
        };
        // Cancel has no change event; a later focus with no selection means cancel.
        input.oncancel = () => resolve(null);
        input.click();
      });
    },
    saveFile(name: string, data: string | Uint8Array, mime?: string): Promise<void> {
      const blob = new Blob([data as BlobPart], { type: mime ?? mimeFor(name) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      return Promise.resolve();
    },
    async listSamples(): Promise<Array<{ id: string; title: string; url: string }>> {
      try {
        const r = await fetch(`${base}samples/index.json`);
        if (!r.ok) return [];
        const entries = (await r.json()) as Array<{ id: string; title: string; file: string }>;
        return entries.map((e) => ({ id: e.id, title: e.title, url: `${base}samples/${e.file}` }));
      } catch {
        return [];
      }
    },
    canOverwrite: () => typeof (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function',
    saveDocument(name, data, opts) {
      const env: FsEnv = {
        showSaveFilePicker: (globalThis as { showSaveFilePicker?: FsEnv['showSaveFilePicker'] }).showSaveFilePicker?.bind(globalThis),
        download: (n, d) => this.saveFile(n, d),
      };
      return saveDocumentWith(env, name, data, opts);
    },
    readHandle: readHandleWith,
    handleStore: () => { try { return idbHandleStore(globalThis.indexedDB); } catch { return null; } },
    wasmUrl(): string {
      const path = `${base}kernel/ck_wasm.wasm`;
      // The kernel worker fetches this from its own script URL (assets/...), so a relative base (a static site that may sit
      // under any sub-path) must be made absolute against the page first.
      if (/^(\/|[a-z][a-z0-9+.-]*:)/i.test(path)) return path;
      const doc = (globalThis as { document?: { baseURI?: string } }).document;
      return doc?.baseURI ? new URL(path, doc.baseURI).href : path;
    },
  };
}

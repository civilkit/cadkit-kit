import type { Platform } from './index';

export function createWebPlatform(opts: { base?: string } = {}): Platform {
  const base = opts.base ?? '/';
  return {
    openFile(): Promise<{ name: string; text: string } | null> {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          resolve({ name: f.name, text: await f.text() });
        };
        // Cancel has no change event; a later focus with no selection means cancel.
        input.oncancel = () => resolve(null);
        input.click();
      });
    },
    saveFile(name: string, text: string): Promise<void> {
      const blob = new Blob([text], { type: 'application/json' });
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
    wasmUrl(): string {
      return `${base}kernel/ck_wasm.wasm`;
    },
  };
}

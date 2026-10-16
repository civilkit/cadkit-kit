// The Text panel's font picker, wired to the controller: a pick loads the font into the kernel and sets the text entity's `font` / `fontHash`.
import type { Controller } from './controller';
import { fontSlug, type CuratedFont, type FontSource, type LocalFace } from './fonts';
import type { FontOutcome, FontsApi } from './FontPicker';
import type { TextPatch } from '@kit/sketch';

/** `window.queryLocalFonts` (Local Font Access API, Chromium only); null where the browser lacks it. */
export function localFontLister(win: { queryLocalFonts?: () => Promise<LocalFace[]> } | undefined = typeof window === 'undefined' ? undefined : (window as never)): FontsApi['localFonts'] {
  const q = win?.queryLocalFonts;
  return typeof q === 'function' ? () => q.call(win) : null;
}

export function makeFontsApi(deps: { controller: Controller; source: FontSource; apply(patch: TextPatch): void; localFonts?: FontsApi['localFonts'] }): FontsApi {
  const { controller, source } = deps;
  let list: Promise<CuratedFont[]> | null = null;
  const done = async (r: Awaited<ReturnType<Controller['addFont']>>): Promise<FontOutcome> => {
    if (!r.ok) return { ok: false, code: r.problem.code, detail: r.problem.message };
    deps.apply({ font: r.name, fontHash: r.pin ?? null });
    return { ok: true, name: r.name, warnings: r.info.warnings };
  };
  const bytesOf = (blob: Blob): Promise<Uint8Array> => (typeof blob.arrayBuffer === 'function'
    ? blob.arrayBuffer().then((b) => new Uint8Array(b))
    : new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer)); r.onerror = () => reject(r.error); r.readAsArrayBuffer(blob); }));
  return {
    curated: () => (list ??= source.manifest().catch(() => { list = null; return []; })),
    pickCurated: async (id) => done(await controller.addFont({ curated: id })),
    pickFile: async (file) => {
      const family = file.name.replace(/\.[^.]+$/, '');
      return done(await controller.addFont({ bytes: await bytesOf(file), family, name: (h) => fontSlug(family, h) }));
    },
    localFonts: deps.localFonts === undefined ? localFontLister() : deps.localFonts,
    pickLocal: async (face) => {
      const bytes = await bytesOf(await face.blob());
      return done(await controller.addFont({ bytes, family: face.family, name: (h) => fontSlug(face.family, h) }));
    },
    describe: (name) => {
      const i = controller.fontInfo(name);
      return i.loaded ? { family: i.info?.family ?? null, subset: i.subset } : null;
    },
  };
}

// What the three part actions do, kept out of main.tsx: the provenance entry of a part, the text of "Open as new document" (the part
// with its provenance, without any stored script) and the file name of a download.
import type { PartDoc } from '@ck/part-model';
import type { LibraryRecord, PartData } from './registry';
import { sourceLink, parseSource } from './source';
import { openableText } from './partFile';
import { buildInsert, withSource, type InsertMeta, type SourceEntry } from './insert';
import type { Controller } from '../controller';

export function metaOf(lib: LibraryRecord, data: PartData): InsertMeta {
  let url: string | undefined = data.part.source;
  let ref = '';
  try {
    if (!lib.builtin && !lib.source.startsWith('local:')) {
      const s = parseSource(lib.source);
      if (s.kind === 'github') ref = s.ref ?? 'HEAD';
      url ??= sourceLink(s) ?? undefined;
    }
  } catch { /* keep what we have */ }
  return { library: lib.name, libraryId: lib.id, part: data.part.title, partId: data.part.id, ref, sha256: data.sha256, ...(data.licence ? { licence: data.licence } : {}), ...(url ? { url } : {}) };
}

/** The part as a new document: its own features and variables, recorded as coming from the library. */
export function openText(lib: LibraryRecord, data: PartData): string {
  const doc = JSON.parse(openableText(data.doc)) as PartDoc & { sources?: SourceEntry[] };
  const entry: SourceEntry = { ...metaOf(lib, data), features: doc.features.map((f) => f.id), variablePrefix: '', at: Date.now() };
  doc.sources = [entry];
  return JSON.stringify(doc);
}

export const downloadName = (data: PartData): string => `${data.part.id.replace(/[^A-Za-z0-9._-]/g, '_')}.ckpart`;

/** Insert the part into the open document as one undo step and record where it came from. */
export async function insertPart(c: Pick<Controller, 'document' | 'applyDocPatch' | 'setDocExtra'>, lib: LibraryRecord, data: PartData): Promise<{ ok: true; entry: SourceEntry } | { ok: false; errors: Array<{ feature: string; code: string }> }> {
  const cur = c.document();
  if (!cur) return { ok: false, errors: [] };
  const ins = buildInsert(cur, data.doc, metaOf(lib, data));
  const r = await c.applyDocPatch(ins.patch, 'library.insert');
  if (!r.ok) return r;
  c.setDocExtra('sources', withSource(c.document()!, ins.entry));
  return { ok: true, entry: ins.entry };
}

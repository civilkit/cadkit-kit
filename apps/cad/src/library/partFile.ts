// A downloaded part goes through the same checks as a file the user opens: it must be a .ckpart document (JSON) with a feature
// list; the kernel validates the features when the part is opened or inserted. Nothing in it is ever executed.
import type { PartDoc } from '@ck/part-model';
import { LibraryError } from './source';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new LibraryError('unsupported', 'crypto.subtle');
  const d = new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parse and shape-check part bytes. Throws LibraryError('part', reason). */
export function parsePart(bytes: Uint8Array): PartDoc {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new LibraryError('part', 'encoding'); }
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { throw new LibraryError('part', 'json'); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new LibraryError('part', 'notObject');
  const d = doc as Record<string, unknown>;
  if (d.format !== undefined && d.format !== 'ck-part') throw new LibraryError('part', 'format');
  if (!Array.isArray(d.features) || d.features.length === 0) throw new LibraryError('part', 'features');
  const ids = new Set<string>();
  for (const f of d.features) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) throw new LibraryError('part', 'feature');
    const { id, type } = f as Record<string, unknown>;
    if (typeof id !== 'string' || typeof type !== 'string' || ids.has(id)) throw new LibraryError('part', 'feature');
    ids.add(id);
  }
  if (d.variables !== undefined) {
    if (!Array.isArray(d.variables)) throw new LibraryError('part', 'variables');
    for (const v of d.variables) {
      const x = v as Record<string, unknown> | null;
      if (!x || typeof x.name !== 'string' || !IDENT.test(x.name) || typeof x.expr !== 'string') throw new LibraryError('part', 'variables');
    }
  }
  return doc as PartDoc;
}

/** The same part as text for "Open as new document": any stored script is dropped (a library part is data only, nothing is run). */
export function openableText(doc: PartDoc): string {
  const { script: _script, ...rest } = doc as PartDoc & { script?: unknown };
  return JSON.stringify(rest);
}

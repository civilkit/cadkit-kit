// The stored view of the open document, for `export ckpart` with `cache: true`: the same value the app writes with "Save geometry in
// file" (see @kit/viewdata), built from the Session's regen reply of the document instead of the controller's state. Nothing is
// written that the app would show differently, so a document the headless path cannot reproduce exactly is refused.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { registerCatalog } from '@kit/i18n';
import { buildViewData, createBuildId, diagStrings, embedSnapshot, mayHaveTip, type EmbeddedView } from '@kit/viewdata';
import type { AgentSession } from './agent-session';
import { ToolError } from './errors';

const refuse = (why: string, hint: string): never => { throw new ToolError('view_unavailable', `a stored view cannot be written for this document: ${why}`, hint); };
const HINT = 'export without cache: true (the file is then rebuilt on open, as always)';

/** Fonts the kernel has built in (same list as the app's isBuiltinFont): their glyphs come from the kernel itself, so the app and this server draw the same outlines. */
const BUILTIN_FONT = new Set(['gauge', 'engrave', 'sans', 'serif', 'default']);

/**
 * A text entity or feature anywhere in the document that names a font other than the built-in ones. Such a font (curated or embedded)
 * is loaded into the kernel by the app's font pool, which this server has no counterpart of: the server's own build of that text
 * reports textFontNotLoaded, so a stored view would not match what the app builds. Text in a built-in font needs no pool.
 */
export function usesPooledFont(v: unknown, depth = 0): boolean {
  if (depth > 40) return true;
  if (Array.isArray(v)) return v.some((x) => usesPooledFont(x, depth + 1));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.font === 'string' && !BUILTIN_FONT.has(o.font)) return true;
    return Object.values(o).some((x) => usesPooledFont(x, depth + 1));
  }
  return false;
}

/** Path of the wasm the open kernel runs, or null when the kernel is not a local wasm (e.g. a native service). */
function wasmPathOf(a: AgentSession): string | null {
  const own = (a.transport as unknown as { wasmPath?: unknown }).wasmPath;
  if (typeof own === 'string' && own) return own;
  if (process.env.CK_KERNEL_URL) return null;
  return a.opts.wasmPath ?? process.env.CK_WASM ?? null;
}

/** The kernel build id the app uses: the SHA-256 of the wasm bytes. null when the kernel's wasm file is not known. */
export function kernelBuildOf(a: AgentSession): () => Promise<string | null> {
  const p = wasmPathOf(a);
  return createBuildId(async () => {
    if (!p || !existsSync(p)) throw new Error('no wasm');
    const b = await readFile(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
}

/** The `viewCache` field for the open document as it will be written. Throws ToolError('view_unavailable') when it cannot be built exactly. */
export async function viewCacheField(a: AgentSession, written: object): Promise<EmbeddedView> {
  const doc = written as { format?: unknown; rollback?: unknown; fonts?: unknown; features: Array<{ id: string; type?: string }> };
  if (doc.format !== 'ck-part') refuse(`the document format is ${JSON.stringify(doc.format)}, not ck-part (the app converts it on open, so its view would not match)`, HINT);
  if (doc.rollback !== null && doc.rollback !== undefined) refuse('the document is rolled back; the app stores only the fully built state', 'clear the rollback marker first, or ' + HINT);
  const listed = Array.isArray(doc.fonts) ? doc.fonts.length > 0 : doc.fonts !== undefined && doc.fonts !== null;
  if (listed || usesPooledFont(doc.features)) refuse('it uses a font that is not built in (a curated or embedded one); the app loads those through its font pool, which this server does not have, so the view could differ', 'use the built-in fonts (gauge, engrave), or ' + HINT);
  const build = kernelBuildOf(a);
  if (!(await build())) refuse('the kernel build id is unknown (the kernel is not a local wasm file whose bytes can be hashed)', HINT);
  registerCatalog('en', diagStrings);   // the status hints use the app's English error texts
  const body = await a.session.bodyForView();
  const report = await a.session.regenReport();
  const extra = await a.viewReplyExtras();
  const features = doc.features;
  const data = buildViewData(features, { body: body as never, report: report as never, limits: mayHaveTip(features as never) ? extra.limits : undefined, components: extra.components });
  // the key is of the document as the file will hold it
  const field = await embedSnapshot(build, JSON.parse(JSON.stringify(written)), data);
  if (!field) return refuse('the view could not be encoded', HINT);
  return field;
}

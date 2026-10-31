// SolidWorks .SLDPRT as an editable part. The kernel reads the file's solid exactly (the same body SolidWorks writes to STEP: volume and
// box agree with that STEP), but as a body of its own, which is view only (see stepImport.ts). To make it part of the document the
// solid is written back out as STEP by the kernel and held by the part as an `importStep` feature: the body can then be cut, drilled,
// filleted and measured like any other, and it is saved with the part. The kernel's own text is read back and measured before it is
// used (the volume of the part must agree with the body that was read from the file); when it does not, the caller keeps the view-only body.
import type { PartDoc } from '@ck/part-model';
import { emptyPart } from '@ck/part-model';
import { base64Of, viewOfImport, type StepImportResult } from './stepImport';

export interface SldprtKernel { request(msg: Record<string, unknown>): Promise<{ ok?: boolean; trap?: string; error?: unknown; result?: unknown }> }

export type SldprtPartResult =
  | { ok: true; part: PartDoc; view: Extract<StepImportResult, { ok: true }>['view']; faces: number; volume: number; /** what became of each part of the file (see importReport.ts) */ parts: Extract<StepImportResult, { ok: true }>['parts'] }
  | { ok: false; code: string; message: string; /** the view-only body, when the file could be read but not turned into a part */ fallback?: Extract<StepImportResult, { ok: true }> };

/** The body read from the file and the part built from it must agree to this fraction of the volume. */
export const VOLUME_TOLERANCE = 0.005;
const SCRATCH = { file: 'sldprt-file', part: 'sldprt-part' };

async function sha256Hex(text: string): Promise<string> {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The part that holds a STEP text as one imported body (`feature`: the tree name of the import step). */
export async function partOfStep(step: string, name: string, feature = 'SolidWorks body'): Promise<PartDoc> {
  const key = await sha256Hex(step);
  // `heal`: as the importStep message reads a file (edges that follow their faces only to the file's accuracy get a tolerance;
  // a sound solid is left as it is). A part that is still not a valid solid comes in as a surface body, never as a solid.
  return { ...emptyPart(name), blobs: { [key]: step }, features: [{ type: 'importStep', id: 'F1', name: feature, blob: key, heal: true }], seq: 2 } as unknown as PartDoc;
}

const volumeOf = async (k: SldprtKernel, tag: string): Promise<number | null> => {
  const r = await k.request({ type: 'massProps', tag });
  const v = r.ok && r.result ? (r.result as { volume?: unknown }).volume : null;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/**
 * Read a .SLDPRT (its bytes) with the kernel and build an editable part from its solid. Never throws: a failure is `{ ok: false }`, and when the
 * file itself was read (only the part could not be built) `fallback` holds the view-only body to show instead.
 */
export async function sldprtAsPart(k: SldprtKernel, bytes: Uint8Array, name: string): Promise<SldprtPartResult> {
  let read;
  try { read = await k.request({ type: 'importSldprt', tag: SCRATCH.file, name, data: base64Of(bytes) }); } catch (e) { return { ok: false, code: 'trap', message: (e as Error).message }; }
  if (!read.ok || read.trap) return { ok: false, code: 'trap', message: String(read.trap ?? 'the kernel did not answer') };
  const shown = viewOfImport({ ...(read.result as object), errors: (read.result as { errors?: unknown[] })?.errors ?? [] } as never);
  if (!shown.ok) return shown;
  const fail = (code: string, message: string): SldprtPartResult => ({ ok: false, code, message, fallback: shown });
  // a file whose parts all came in as surface bodies has no solid to measure: the part holds the surface bodies (to repair)
  const surfacesOnly = shown.parts.length > 0 && shown.parts.every((p) => p.outcome !== 'solid');
  const fileVolume = surfacesOnly ? 0 : await volumeOf(k, SCRATCH.file);
  if (!surfacesOnly && (!fileVolume || fileVolume <= 0)) return fail('noVolume', 'the solid in the file has no volume');
  let step: string;
  try {
    const out = await k.request({ type: 'step', tag: SCRATCH.file, name });
    if (!out.ok || typeof out.result !== 'string' || !out.result.includes('ISO-10303-21')) return fail('stepExport', 'the solid could not be written as STEP');
    step = out.result;
  } catch (e) { return fail('stepExport', (e as Error).message); }
  const part = await partOfStep(step, name);
  // the part must give back the body that was read: regenerated as the document will be, with the same volume
  let regen;
  try { regen = await k.request({ type: 'regen', tag: SCRATCH.part, part, opts: { noView: true } }); } catch (e) { return fail('regen', (e as Error).message); }
  const errors = (regen.result as { errors?: unknown[] } | undefined)?.errors ?? [];
  if (!regen.ok || errors.length) return fail('regen', `the part built from the solid has errors (${JSON.stringify(errors[0] ?? regen.error ?? regen.trap).slice(0, 120)})`);
  if (surfacesOnly) return { ok: true, part, view: shown.view, faces: shown.faces, volume: 0, parts: shown.parts };
  const partVolume = await volumeOf(k, SCRATCH.part);
  if (!fileVolume || !partVolume || Math.abs(partVolume - fileVolume) > VOLUME_TOLERANCE * fileVolume) return fail('volumeDiffers', `the part has volume ${partVolume ?? 'none'} where the file's solid has ${fileVolume}`);
  return { ok: true, part, view: shown.view, faces: shown.faces, volume: partVolume, parts: shown.parts };
}

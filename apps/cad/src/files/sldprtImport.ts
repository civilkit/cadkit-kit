// SolidWorks .SLDPRT as an editable part. The kernel reads the file's solid exactly (the same body SolidWorks writes to STEP: volume and
// box agree with that STEP), but as a body of its own, which is view only (see stepImport.ts). To make it part of the document the
// solid is written back out as STEP by the kernel and held by the part as an `importStep` feature: the body can then be cut, drilled,
// filleted and measured like any other, and it is saved with the part. The kernel's own text is read back and measured before it is
// used (the volume of the part must agree with the body that was read from the file); when it does not, the caller keeps the view-only body.
// Before that, the kernel is asked for the file's feature history (`sldprtHistory`: sketches, extrudes, fillets, holes, shells ... rebuilt from
// the feature tree and the face tags). A history that regenerates to the file's volume is the part (the feature tree shows it, in one folder that switches it off; see historyFolder.ts); anything else
// (a kernel without the message, a file that does not rebuild, a rebuild with errors or another volume) falls back to the imported body.
import type { PartDoc } from '@ck/part-model';
import { emptyPart } from '@ck/part-model';
import { base64Of, viewOfImport, type StepImportResult } from './stepImport';
import { folderToggleOps, HISTORY_FOLDER, standInOrigin } from '../historyFolder';

export interface SldprtKernel { request(msg: Record<string, unknown>): Promise<{ ok?: boolean; trap?: string; error?: unknown; result?: unknown }> }

export type SldprtPartResult =
  | { ok: true; part: PartDoc; /** true when the part is the file's rebuilt feature history rather than one imported body */ history?: boolean; /** with `history`: how many features were rebuilt and whether that is the whole file */ historyInfo?: HistoryInfo; view: Extract<StepImportResult, { ok: true }>['view']; faces: number; volume: number; /** what became of each part of the file (see importReport.ts) */ parts: Extract<StepImportResult, { ok: true }>['parts'] }
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

type Feature = { id: string; type?: string; suppressed?: boolean; [k: string]: unknown };

/** What the open notice needs to say about a history part. */
export interface HistoryInfo {
  /** features rebuilt from the file (planes and sketches included), all of them in the history folder */
  rebuilt: number;
  /** false when the rest of the file is held as an imported body after the rebuilt features (`importBody`) */
  complete: boolean;
}

/** The part with the folder switched as the toggle in the tree does it (the same ops), to check the state the user gets from one click. */
function toggled(part: PartDoc): PartDoc {
  const feats = part.features as unknown as Feature[];
  const ids = feats.filter((f) => f.group === HISTORY_FOLDER).map((f) => f.id);
  const ops = folderToggleOps(feats, ids, HISTORY_FOLDER);
  const hit = new Map(ops.map((o) => [(o as { id: string }).id, (o as { value: boolean }).value]));
  return { ...part, features: feats.map((f) => (hit.has(f.id) ? { ...f, suppressed: hit.get(f.id) } : f)) } as unknown as PartDoc;
}

/**
 * The file's feature history as a part: every rebuilt feature in one folder (`HISTORY_FOLDER`), so the tree can be switched off as a whole.
 *  - complete history: the folder is the part; an `importBody` stand-in (the file's solid, suppressed) follows it for when the folder is off;
 *  - partial history: the folder holds the rebuilt features and the kernel's `importBody` (the rest of the file) follows it, always on.
 * Both states, folder on and folder off, are regenerated and must come out at the volume of the file's solid. Null for anything else (a
 * history of fewer than two features is no folder); never throws.
 */
async function historyPart(k: SldprtKernel, bytes: Uint8Array, name: string, fileVolume: number): Promise<{ part: PartDoc; volume: number; info: HistoryInfo } | null> {
  try {
    const h = await k.request({ type: 'sldprtHistory', name, data: base64Of(bytes) });
    const r = h.ok && !h.trap ? (h.result as { ok?: boolean; complete?: boolean; part?: PartDoc } | undefined) : undefined;
    if (!r?.ok || !r.part || !Array.isArray(r.part.features)) return null;
    const all = r.part.features as unknown as Feature[];
    const complete = r.complete === true;
    const tail = complete ? undefined : all.at(-1);
    if (!complete && tail?.type !== 'importBody') return null;
    const rebuilt = complete ? all : all.slice(0, -1);
    if (rebuilt.length < 2) return null;
    // the kernel's document carries the features (and blobs); the envelope (material, counters, the next feature number) is ours
    const top = Math.max(0, ...all.map((f) => Number(/^F(\d+)$/.exec(String(f.id))?.[1] ?? 0)));
    const blobs = { ...((r.part as { blobs?: Record<string, string> }).blobs ?? {}) };
    const features: Feature[] = rebuilt.map((f) => ({ ...f, group: HISTORY_FOLDER }));
    if (complete) {
      // the file's solid for the folder-off state, kept suppressed while the history is on
      const text = base64Of(bytes), key = await sha256Hex(text);
      blobs[key] = text;
      features.push({ type: 'importBody', id: `F${top + 1}`, name: 'Imported body', format: 'sldprt', blob: key, replace: true, suppressed: true, origin: standInOrigin(HISTORY_FOLDER) });
    } else features.push(tail!);
    const part = { ...emptyPart(name), ...r.part, name, features, blobs, seq: Math.max(top + 1 + (complete ? 1 : 0), r.part.seq ?? 1) } as unknown as PartDoc;
    // folder on, then folder off: neither may have errors, both give the volume of the file
    let volume = 0;
    for (const [i, doc] of [part, toggled(part)].entries()) {
      const regen = await k.request({ type: 'regen', tag: SCRATCH.part, part: doc, opts: { noView: true } });
      const errors = (regen.result as { errors?: unknown[] } | undefined)?.errors ?? [];
      if (!regen.ok || regen.trap || errors.length) return null;
      const v = await volumeOf(k, SCRATCH.part);
      if (!v || Math.abs(v - fileVolume) > VOLUME_TOLERANCE * fileVolume) return null;
      if (i === 0) volume = v;
    }
    return { part, volume, info: { rebuilt: rebuilt.length, complete } };
  } catch { return null; }
}

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
  if (!surfacesOnly && fileVolume) {
    const hist = await historyPart(k, bytes, name, fileVolume);
    if (hist) return { ok: true, part: hist.part, history: true, historyInfo: hist.info, view: shown.view, faces: shown.faces, volume: hist.volume, parts: shown.parts };
  }
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

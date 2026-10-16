// STEP import. The kernel reads the file into a body of its own (not a feature of the part), so the result is a
// view-only body: shown in the viewport, measured, but not part of the document and not saved with it.
import type { Session, ViewBody } from '@ck/session';
import { meshFromBody } from '@ck/mesh';

export type StepImportResult =
  | { ok: true; view: ViewBody; faces: number; edges: number }
  | { ok: false; code: string; message: string };

export async function importStepView(session: Pick<Session, 'importStep'>, text: string, name: string): Promise<StepImportResult> {
  let rep;
  try { rep = await session.importStep(text, name); } catch (e) { return { ok: false, code: 'trap', message: (e as Error).message }; }
  return viewOfImport(rep);
}

/** A SolidWorks .SLDPRT file (its bytes) as a view-only body, like STEP. */
export async function importSldprtView(session: Pick<Session, 'importSldprt'>, bytes: Uint8Array, name: string): Promise<StepImportResult> {
  let rep;
  try { rep = await session.importSldprt(base64Of(bytes), name); } catch (e) { return { ok: false, code: 'trap', message: (e as Error).message }; }
  return viewOfImport(rep);
}

function base64Of(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function viewOfImport(rep: Awaited<ReturnType<Session['importStep']>>): StepImportResult {
  if (rep.errors.length) {
    const [where, err] = rep.errors[0];
    return { ok: false, code: err.code, message: `${where}: ${err.code}` };
  }
  const body = rep.body as { faces?: unknown[]; edges?: Array<{ key?: string; pts: number[][] }>; box?: { min: number[]; max: number[] } } | null | undefined;
  if (!body || !body.faces?.length) return { ok: false, code: 'empty', message: 'no solid in the file' };
  const view: ViewBody = {
    mesh: meshFromBody(body as Parameters<typeof meshFromBody>[0]),
    edges: body.edges ?? [],
    box: body.box ?? { min: [0, 0, 0], max: [0, 0, 0] },
    sketches: [], curves: [], planes: [], markers: [],
  };
  return { ok: true, view, faces: body.faces.length, edges: view.edges.length };
}

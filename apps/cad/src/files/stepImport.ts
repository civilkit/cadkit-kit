// STEP import. The kernel reads the file into a body of its own (not a feature of the part), so the result is a
// view-only body: shown in the viewport, measured, but not part of the document and not saved with it.
import type { Session, ViewBody } from '@ck/session';
import { meshFromBody } from '@ck/mesh';
import { toViewSurfaces, withSurfaces } from '@kit/viewdata';
import { parseParts, type ImportPart } from './importReport';

/** `parts`: what became of each part of the file (solid / surface body / refused, with reasons; see importReport.ts). The parts that
 *  came in as surface bodies are shown with the solid (`view.surfaces`) and counted in `faces`. */
export type StepImportResult =
  | { ok: true; view: ViewBody; faces: number; edges: number; parts: ImportPart[] }
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

export function base64Of(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function viewOfImport(rep: Awaited<ReturnType<Session['importStep']>>): StepImportResult {
  if (rep.errors.length) {
    const [where, err] = rep.errors[0];
    return { ok: false, code: err.code, message: `${where}: ${err.code}` };
  }
  const body = rep.body as { faces?: unknown[]; edges?: Array<{ key?: string; pts: number[][] }>; box?: { min: number[]; max: number[] } } | null | undefined;
  const surfaces = toViewSurfaces((rep as { surfaces?: unknown }).surfaces);
  const surfaceFaces = countSurfaceFaces((rep as { surfaces?: unknown }).surfaces);
  if ((!body || !body.faces?.length) && !surfaces.length) return { ok: false, code: 'empty', message: 'no solid in the file' };
  const solidFaces = body?.faces?.length ?? 0;
  const solid: ViewBody = {
    mesh: meshFromBody((body ?? {}) as Parameters<typeof meshFromBody>[0]),
    edges: body?.edges ?? [],
    box: body?.box ?? surfaces[0]?.box ?? { min: [0, 0, 0], max: [0, 0, 0] },
    sketches: [], curves: [], planes: [], markers: [],
  };
  const view = (withSurfaces(solid as never, surfaces) ?? solid) as ViewBody;
  const parts = parseParts((rep as { import?: { parts?: unknown } }).import?.parts);
  return { ok: true, view, faces: solidFaces + surfaceFaces, edges: view.edges.length, parts };
}

/** Faces of the surface bodies of a reply (`surfaces: [[id, body], ..]`). */
function countSurfaceFaces(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.reduce((n, p) => n + (Array.isArray(p) && p[1] && Array.isArray((p[1] as { faces?: unknown[] }).faces) ? (p[1] as { faces: unknown[] }).faces.length : 0), 0);
}

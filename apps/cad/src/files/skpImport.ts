// SketchUp (.skp) import. The kernel answers like STEP / SLDPRT (a body of its own, view only) plus `import`: the materials, the material
// of each face, and how closed the surface model is. This module turns that into a view body, the per-face colours, and the facts the
// notice reports. Refusals keep their structured code (body.empty, limit.faces, ...) and the kernel's message.
import type { Session } from '@ck/session';
import { meshFromBody } from '@ck/mesh';
import type { BodyLookSpec, ViewBodyDef } from '@kit/viewport';
import { base64Of, type StepImportResult } from './stepImport';

/** Which way up an imported SketchUp model is placed. SketchUp is Z up, the kit is Y up. 'y' stands the model upright ((x,y,z) -> (x,z,-y)),
 *  'z' keeps the file's own axes (the model lies on its side in the kit), 'yFlip' is 'y' turned upside down ((x,y,z) -> (-x,-z,-y)). */
export type SkpOrient = 'z' | 'y' | 'yFlip';
/** A SketchUp file opens upright. */
export const SKP_DEFAULT_ORIENT: SkpOrient = 'y';
/** The order "Flip orientation" cycles through: upright, as in the file, upside down. */
export const SKP_ORIENTS: readonly SkpOrient[] = ['y', 'z', 'yFlip'];
export const nextSkpOrient = (o: SkpOrient): SkpOrient => SKP_ORIENTS[(SKP_ORIENTS.indexOf(o) + 1) % SKP_ORIENTS.length];
/** The importSkp options for an orientation and the hidden-geometry choice. `up` is always sent: the kernel's own default is 'z'. */
export const skpImportOpts = (orient: SkpOrient, hidden = false): { hidden?: boolean; up: SkpOrient } => (hidden ? { hidden: true, up: orient } : { up: orient });

export interface SkpNotice { text: string; level: 'info' | 'warn'; action?: { label: string; run(): void } }
type Tr = (key: string, params?: Record<string, string | number>) => string;

/** The notices after a SketchUp import, in order: what came in and how it is oriented (with the "Flip orientation" button), the hidden
 *  faces left out (with "Show hidden geometry", only when they were left out), and the open-surface warning. */
export function skpNotices(s: SkpSummary, o: { file: string; up: SkpOrient; hidden: boolean }, tr: Tr, act: { flip(): void; showHidden(): void }): SkpNotice[] {
  const out: SkpNotice[] = [{
    text: tr('files.skp.done', { name: o.file, faces: s.faces, pieces: s.pieces, materials: s.materials }) + ' ' + tr(`files.skp.orient.${o.up}`),
    level: s.closed ? 'info' : 'warn',
    action: { label: tr('files.skp.flip'), run: act.flip },
  }];
  if (!o.hidden && s.hiddenSkipped > 0) out.push({ text: tr('files.skp.hidden', { n: s.hiddenSkipped }), level: 'info', action: { label: tr('files.skp.showHidden'), run: act.showHidden } });
  if (!s.closed) out.push({ text: tr('files.skp.open', { open: s.openEdges + s.nonManifoldEdges }), level: 'warn' });
  return out;
}

export interface SkpMaterial { color: [number, number, number]; opacity: number; doubleSided?: boolean; textured?: boolean }

/** The `import` object of an importSkp reply, as far as the app reads it. */
export interface SkpFacts {
  faces: number; lumps: number; openEdges: number; nonManifoldEdges: number;
  materials: SkpMaterial[]; faceMaterials: number[];
  skippedFaces: number; hiddenSkipped: number; version: string | null; units: string | null;
}

/** How the imported faces are drawn: an opaque colour per face, and one translucent group per material with an opacity below 1. */
export interface SkpLook {
  faces: Record<string, BodyLookSpec>;
  /** pseudo bodies for the translucent materials (the viewport draws a body below full opacity in its transparent pass) */
  bodies: ViewBodyDef[];
  looks: Record<string, BodyLookSpec>;
}

export interface SkpSummary { faces: number; pieces: number; openEdges: number; nonManifoldEdges: number; materials: number; hiddenSkipped: number; closed: boolean }

export type SkpImportResult =
  | (Extract<StepImportResult, { ok: true }> & { look: SkpLook; summary: SkpSummary; /** the orientation the kernel applied */ up: SkpOrient })
  | Extract<StepImportResult, { ok: false }>;

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
/** `[r, g, b]` (0..255) as #rrggbb. */
export const hexOfRgb = (c: readonly number[]): string => `#${hex2(c[0] ?? 0)}${hex2(c[1] ?? 0)}${hex2(c[2] ?? 0)}`;

/** The index n of a face named `skp.F<n>`, or null for any other name. */
export const skpFaceIndex = (name: string): number | null => { const m = /^skp\.F(\d+)$/.exec(name); return m ? Number(m[1]) : null; };

/** Per-face colours from the materials. A face with a missing or unknown material keeps the viewport's default. Opacity below 1 goes to a
 *  group per material (`skp.m<i>`); those faces are left out of `faces` since the transparent pass colours them from the group's look. */
export function skpLook(faceNames: readonly string[], materials: readonly SkpMaterial[], faceMaterials: readonly number[]): SkpLook {
  const faces: Record<string, BodyLookSpec> = {};
  const groups = new Map<number, string[]>();
  for (const f of faceNames) {
    const n = skpFaceIndex(f);
    const mi = n === null ? undefined : faceMaterials[n];
    const m = mi === undefined ? undefined : materials[mi];
    if (!m || !Array.isArray(m.color)) continue;
    if (typeof m.opacity === 'number' && m.opacity < 1) { const g = groups.get(mi!) ?? []; g.push(f); groups.set(mi!, g); }
    else faces[f] = { color: hexOfRgb(m.color) };
  }
  const bodies: ViewBodyDef[] = [], looks: Record<string, BodyLookSpec> = {};
  for (const [mi, fs] of groups) {
    const key = `skp.m${mi}`, m = materials[mi];
    bodies.push({ key, faces: fs });
    looks[key] = { color: hexOfRgb(m.color), opacity: m.opacity, finish: 'plastic' };
  }
  return { faces, bodies, looks };
}

/** What the notice reports. Closed means no open and no non-manifold edge: only then can solid operations apply. */
export function skpSummary(f: Pick<SkpFacts, 'faces' | 'lumps' | 'openEdges' | 'nonManifoldEdges' | 'materials' | 'hiddenSkipped'>): SkpSummary {
  return { faces: f.faces, pieces: f.lumps, openEdges: f.openEdges, nonManifoldEdges: f.nonManifoldEdges, materials: f.materials.length, hiddenSkipped: f.hiddenSkipped, closed: f.openEdges === 0 && f.nonManifoldEdges === 0 };
}

/** A refusal as `code: message` parts (the code is kept, e.g. body.empty or limit.faces). */
export function skpRefusal(errors: Array<[string, { code: string; params?: Record<string, unknown> }]>): { code: string; message: string } {
  const [where, err] = errors[0];
  const m = err.params?.message;
  return { code: err.code, message: typeof m === 'string' && m ? m : `${where}: ${err.code}` };
}

export async function importSkpView(session: Pick<Session, 'importSkp'>, bytes: Uint8Array, name: string, opts: { hidden?: boolean; maxFaces?: number; up?: SkpOrient } = {}): Promise<SkpImportResult> {
  let rep;
  try { rep = await session.importSkp(base64Of(bytes), name, opts); } catch (e) { return { ok: false, code: 'trap', message: (e as Error).message }; }
  if (rep.errors.length) return { ok: false, ...skpRefusal(rep.errors) };
  const body = rep.body as { faces?: Array<{ id: string }>; edges?: Array<{ key?: string; pts: number[][] }>; box?: { min: number[]; max: number[] } } | null | undefined;
  const im = rep.import as (Partial<SkpFacts> & { up?: SkpOrient }) | undefined;
  if (!body || !body.faces?.length) return { ok: false, code: 'body.empty', message: 'no faces in the file' };
  const materials = im?.materials ?? [];
  const view = {
    mesh: meshFromBody(body as Parameters<typeof meshFromBody>[0]),
    edges: body.edges ?? [],
    box: body.box ?? { min: [0, 0, 0], max: [0, 0, 0] },
    sketches: [], curves: [], planes: [], markers: [],
  };
  const look = skpLook(body.faces.map((f) => f.id), materials, im?.faceMaterials ?? []);
  const summary = skpSummary({ faces: body.faces.length, lumps: im?.lumps ?? 1, openEdges: im?.openEdges ?? 0, nonManifoldEdges: im?.nonManifoldEdges ?? 0, materials, hiddenSkipped: im?.hiddenSkipped ?? 0 });
  return { ok: true, view, faces: body.faces.length, edges: view.edges.length, look, summary, up: im?.up ?? opts.up ?? 'z' };
}

// Builds the files the Export commands download from what the controller shows. Pure: no DOM, no platform; the
// caller saves `file` and shows `notices` (message key + params, translated by the caller).
import { bodiesToObj, checkMesh, meshToGlb, meshToObj, meshToStl, meshToThreeMf, sketchToDxf, zipWrite, viewsToDxf, type MeshBody, type MeshCheck, type SketchLike } from '@kit/io';
import { mergeTriangles } from './meshes/meshExport';

export interface ExportNotice { level: 'info' | 'warn' | 'error'; key: string; params?: Record<string, string | number> }
export interface ExportFile { name: string; data: string | Uint8Array; mime: string }
export interface ExportResult { file?: ExportFile; notices: ExportNotice[] }

/** A file name stem from a part name: no path separators or control characters, never empty. */
export function fileStem(name: string | undefined): string {
  const s = (name ?? '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return s || 'part';
}

export interface MeshSource { positions: ArrayLike<number> }

const noBody: ExportNotice = { level: 'error', key: 'io.noBody' };

function meshNotices(check: MeshCheck, label: string, name: string): ExportNotice[] {
  const out: ExportNotice[] = [{ level: 'info', key: 'io.done', params: { name: label, triangles: check.triangles } }];
  if (!check.watertight) out.push({ level: 'warn', key: 'io.notWatertight', params: { name, open: check.openEdges, nonManifold: check.nonManifoldEdges } });
  return out;
}

export type ExportQuality = 'coarse' | 'normal' | 'fine';
export type MeshRequest = { custom: false } | { custom: true; quality: ExportQuality; chord_mm?: number } | { error: ExportNotice };

/** What the export menu's mesh quality and chord text ask of the kernel. The normal preset with no chord is the mesh on screen (`custom: false`); a chord is a number of mm above 0 (a comma may be the decimal mark). */
export function meshRequest(quality: ExportQuality, chordText: string): MeshRequest {
  const text = chordText.trim();
  if (text === '') return quality === 'normal' ? { custom: false } : { custom: true, quality };
  const chord = Number(text.replace(',', '.'));
  if (!(Number.isFinite(chord) && chord > 0)) return { error: { level: 'error', key: 'io.badChord' } };
  return { custom: true, quality, chord_mm: chord };
}

/** The notice that reference meshes went into the file (none when there were none). */
function refNotices(refs: readonly MeshBody[], name: string): ExportNotice[] {
  if (!refs.length) return [];
  const triangles = refs.reduce((n, b) => n + Math.floor(b.positions.length / 9), 0);
  return [{ level: 'info', key: 'io.refMeshesIncluded', params: { name, count: refs.length, triangles } }];
}
/** The watertight warning is about the part: a reference mesh is often an open scan, and the user asked for it as it is. */
function partWatertight(part: { positions: ArrayLike<number> } | readonly MeshBody[] | null, stem: string): ExportNotice[] {
  const positions = !part ? [] : 'positions' in part ? part.positions : allTriangles(part);
  if (!positions.length) return [];
  const check = checkMesh({ positions });
  return check.watertight ? [] : [{ level: 'warn', key: 'io.notWatertight', params: { name: stem, open: check.openEdges, nonManifold: check.nonManifoldEdges } }];
}

/** STL: the part's triangles, then the triangles of the reference meshes in `refs` (already placed in the world), all in one solid. */
export function exportStl(mesh: MeshSource | null, partName: string | undefined, binary = true, refs: readonly MeshBody[] = []): ExportResult {
  const all = refs.length ? mergeTriangles(mesh, refs) : mesh;
  if (!all) return { notices: [noBody] };
  const stem = fileStem(partName);
  const r = meshToStl(all, { name: partName || stem, binary });
  const name = `${stem}.stl`;
  if (!refs.length) return { file: { name, data: r.data, mime: 'model/stl' }, notices: meshNotices(r.check, name, stem) };
  return { file: { name, data: r.data, mime: 'model/stl' }, notices: [{ level: 'info', key: 'io.done', params: { name, triangles: r.triangles } }, ...partWatertight(mesh, stem), ...refNotices(refs, name)] };
}

/** A body name as a file name (no path characters), made unique within one archive by a counter. */
export function bodyFileNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const base = fileStem(n) || 'body';
    const k = base.toLowerCase();
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c === 1 ? base : `${base}_${c}`;
  });
}

/** STL, one file per body: a zip of binary STLs, each named after its body (printing each colour or part on its own). Reference meshes in `refs` go in as bodies. */
export async function exportStlBodies(bodies: readonly MeshBody[] | null, partName: string | undefined, refs: readonly MeshBody[] = []): Promise<ExportResult> {
  const all = [...(bodies ?? []), ...refs].filter((b) => b.positions.length >= 9);
  if (!all.length) return { notices: [noBody] };
  const stem = fileStem(partName);
  const names = bodyFileNames(all.map((b) => b.name));
  let triangles = 0;
  const files = all.map((b, i) => {
    const r = meshToStl({ positions: b.positions }, { name: b.name, binary: true });
    triangles += r.triangles;
    return { name: `${names[i]}.stl`, data: r.data as Uint8Array };
  });
  const data = await zipWrite(files, { deflate: true });
  const name = `${stem}-stl.zip`;
  return { file: { name, data, mime: 'application/zip' }, notices: [{ level: 'info', key: 'io.doneStlBodies', params: { name, files: files.length, triangles } }, ...partWatertight(bodies ?? [], stem), ...refNotices(refs, name)] };
}

/** OBJ: one object, or, given the bodies (named, coloured when the body has a colour), one object per body with the colours on its vertices.
 *  Reference meshes in `refs` are extra objects after the part's. */
export function exportObj(mesh: MeshSource | null, partName: string | undefined, bodies?: readonly MeshBody[] | null, refs: readonly MeshBody[] = []): ExportResult {
  if (!mesh && !refs.length) return { notices: [noBody] };
  const stem = fileStem(partName);
  const name = `${stem}.obj`;
  if (refs.length) {
    const own: MeshBody[] = bodies?.length ? [...bodies] : mesh && mesh.positions.length ? [{ name: stem, positions: mesh.positions }] : [];
    const r = bodiesToObj([...own, ...refs]);
    if (!r.triangles) return { notices: [noBody] };
    return { file: { name, data: r.data, mime: 'model/obj' }, notices: [{ level: 'info', key: 'io.done', params: { name, triangles: r.triangles } }, ...partWatertight(own, stem), ...refNotices(refs, name)] };
  }
  if (!mesh) return { notices: [noBody] };
  if (bodies && bodies.length && (bodies.length > 1 || bodies[0].color)) {
    const r = bodiesToObj(bodies);
    if (!r.triangles) return { notices: [noBody] };
    return { file: { name, data: r.data, mime: 'model/obj' }, notices: meshNotices(checkMesh({ positions: allTriangles(bodies) }), name, stem) };
  }
  const r = meshToObj(mesh, { name: stem });
  return { file: { name, data: r.data, mime: 'model/obj' }, notices: meshNotices(checkMesh(mesh), name, stem) };
}

const allTriangles = (bodies: readonly MeshBody[]): number[] => bodies.flatMap((b) => Array.from(b.positions));

/** 3MF: a zip with one object per body (named, coloured when the body has a colour), millimetres, Z up. Reference meshes in `refs` are extra objects. */
export async function exportThreeMf(bodies: readonly MeshBody[] | null, partName: string | undefined, refs: readonly MeshBody[] = []): Promise<ExportResult> {
  const all = [...(bodies ?? []), ...refs];
  if (!all.length) return { notices: [noBody] };
  const stem = fileStem(partName);
  const r = await meshToThreeMf(all, { title: partName || stem });
  if (!r.triangles) return { notices: [noBody] };
  const name = `${stem}.3mf`;
  const notices: ExportNotice[] = [{ level: 'info', key: 'io.done3mf', params: { name, triangles: r.triangles, bodies: r.bodies } }];
  notices.push(...partWatertight(bodies ?? [], stem), ...refNotices(refs, name));
  return { file: { name, data: r.data, mime: 'model/3mf' }, notices };
}

/** GLB (binary glTF 2.0): one node and material per body, Y up, metres. Reference meshes in `refs` are extra nodes. */
export function exportGlb(bodies: readonly MeshBody[] | null, partName: string | undefined, refs: readonly MeshBody[] = []): ExportResult {
  const all = [...(bodies ?? []), ...refs];
  if (!all.length) return { notices: [noBody] };
  const stem = fileStem(partName);
  const r = meshToGlb(all, { name: partName || stem });
  if (!r.triangles) return { notices: [noBody] };
  const name = `${stem}.glb`;
  const notices: ExportNotice[] = [{ level: 'info', key: 'io.doneGlb', params: { name, triangles: r.triangles, bodies: r.bodies } }, ...refNotices(refs, name)];
  return { file: { name, data: r.data, mime: 'model/gltf-binary' }, notices };
}

export function exportStep(step: string | null, partName: string | undefined): ExportResult {
  if (!step) return { notices: [noBody] };
  const stem = fileStem(partName);
  return { file: { name: `${stem}.step`, data: step, mime: 'model/step' }, notices: [{ level: 'info', key: 'io.doneStep', params: { name: `${stem}.step` } }] };
}

/** A part file (`.ckpart`, the document as JSON text). */
export function exportCkpart(text: string | null, partName: string | undefined): ExportResult {
  if (!text) return { notices: [noBody] };
  const stem = fileStem(partName);
  return { file: { name: `${stem}.ckpart`, data: text, mime: 'application/json' }, notices: [{ level: 'info', key: 'io.doneStep', params: { name: `${stem}.ckpart` } }] };
}

export function exportSketchDxf(sketch: (SketchLike & { name?: string; id?: string }) | null, partName: string | undefined): ExportResult {
  if (!sketch) return { notices: [{ level: 'error', key: 'io.noSketch' }] };
  const r = sketchToDxf(sketch);
  const name = `${fileStem(partName)}-${fileStem(sketch.name ?? sketch.id ?? 'sketch')}.dxf`;
  if (r.entities === 0) return { notices: [{ level: 'error', key: 'io.emptySketch' }] };
  const notices: ExportNotice[] = [{ level: 'info', key: 'io.doneDxf', params: { name, count: r.entities } }];
  if (r.skipped) notices.push({ level: 'warn', key: 'io.dxfSkipped', params: { count: r.skipped } });
  return { file: { name, data: r.text, mime: 'image/vnd.dxf' }, notices };
}

export function exportViewsDxf(edges: Array<{ pts: number[][] }>, box: { min: number[]; max: number[] } | null, partName: string | undefined): ExportResult {
  if (!box || !edges.length) return { notices: [noBody] };
  const r = viewsToDxf(edges, box);
  const name = `${fileStem(partName)}-views.dxf`;
  return { file: { name, data: r.text, mime: 'image/vnd.dxf' }, notices: [{ level: 'info', key: 'io.doneDxf', params: { name, count: r.entities } }] };
}

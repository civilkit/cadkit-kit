// Builds the files the Export commands download from what the controller shows. Pure: no DOM, no platform; the
// caller saves `file` and shows `notices` (message key + params, translated by the caller).
import { checkMesh, meshToGlb, meshToObj, meshToStl, meshToThreeMf, sketchToDxf, viewsToDxf, type MeshBody, type MeshCheck, type SketchLike } from '@kit/io';

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

export function exportStl(mesh: MeshSource | null, partName: string | undefined, binary = true): ExportResult {
  if (!mesh) return { notices: [noBody] };
  const stem = fileStem(partName);
  const r = meshToStl(mesh, { name: partName || stem, binary });
  return { file: { name: `${stem}.stl`, data: r.data, mime: 'model/stl' }, notices: meshNotices(r.check, `${stem}.stl`, stem) };
}

export function exportObj(mesh: MeshSource | null, partName: string | undefined): ExportResult {
  if (!mesh) return { notices: [noBody] };
  const stem = fileStem(partName);
  const r = meshToObj(mesh, { name: stem });
  return { file: { name: `${stem}.obj`, data: r.data, mime: 'model/obj' }, notices: meshNotices(checkMesh(mesh), `${stem}.obj`, stem) };
}

const allTriangles = (bodies: readonly MeshBody[]): number[] => bodies.flatMap((b) => Array.from(b.positions));

/** 3MF: a zip with one object per body (named, coloured when the body has a colour), millimetres, Z up. */
export async function exportThreeMf(bodies: readonly MeshBody[] | null, partName: string | undefined): Promise<ExportResult> {
  if (!bodies?.length) return { notices: [noBody] };
  const stem = fileStem(partName);
  const r = await meshToThreeMf(bodies, { title: partName || stem });
  if (!r.triangles) return { notices: [noBody] };
  const name = `${stem}.3mf`;
  const notices: ExportNotice[] = [{ level: 'info', key: 'io.done3mf', params: { name, triangles: r.triangles, bodies: r.bodies } }];
  const check = checkMesh({ positions: allTriangles(bodies) });
  if (!check.watertight) notices.push({ level: 'warn', key: 'io.notWatertight', params: { name: stem, open: check.openEdges, nonManifold: check.nonManifoldEdges } });
  return { file: { name, data: r.data, mime: 'model/3mf' }, notices };
}

/** GLB (binary glTF 2.0): one node and material per body, Y up, metres. */
export function exportGlb(bodies: readonly MeshBody[] | null, partName: string | undefined): ExportResult {
  if (!bodies?.length) return { notices: [noBody] };
  const stem = fileStem(partName);
  const r = meshToGlb(bodies, { name: partName || stem });
  if (!r.triangles) return { notices: [noBody] };
  const name = `${stem}.glb`;
  const notices: ExportNotice[] = [{ level: 'info', key: 'io.doneGlb', params: { name, triangles: r.triangles, bodies: r.bodies } }];
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

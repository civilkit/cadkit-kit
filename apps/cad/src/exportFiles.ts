// Builds the files the Export commands download from what the controller shows. Pure: no DOM, no platform; the
// caller saves `file` and shows `notices` (message key + params, translated by the caller).
import { checkMesh, meshToObj, meshToStl, type MeshCheck } from '@kit/io';

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

export function exportStep(step: string | null, partName: string | undefined): ExportResult {
  if (!step) return { notices: [noBody] };
  const stem = fileStem(partName);
  return { file: { name: `${stem}.step`, data: step, mime: 'model/step' }, notices: [{ level: 'info', key: 'io.doneStep', params: { name: `${stem}.step` } }] };
}

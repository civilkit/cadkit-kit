// DXF import into the sketch being edited. The parse and the geometry are in @kit/io; this adds the result to the open
// draft through the controller's normal apply path (one sketch-undo step, solved and previewed by the kernel).
import { dxfToSketch, mergeIntoDraft, type DxfImportError } from '@kit/io';
import type { Controller } from './controller';
import type { ExportNotice } from './exportFiles';

export function importErrorNotice(e: DxfImportError): ExportNotice {
  switch (e.code) {
    case 'tooMany': return { level: 'error', key: 'io.dxf.tooMany', params: { count: e.count, max: e.max } };
    case 'nothing': return { level: 'error', key: 'io.dxf.nothing', params: { skipped: Object.entries(e.unsupported).map(([k, n]) => `${k} (${n})`).join(', ') || '-' } };
    case 'range': return { level: 'error', key: 'io.dxf.range', params: { max: e.max } };
    case 'binary': return { level: 'error', key: 'io.dxf.binary' };
    default: return { level: 'error', key: 'io.dxf.notDxf' };
  }
}

/** Add the geometry of a DXF file to the open sketch. Nothing is changed when the file is refused. */
export async function importDxfIntoSketch(controller: Controller, text: string): Promise<{ ok: boolean; notices: ExportNotice[] }> {
  const draft = controller.sketchDraft();
  if (!draft) return { ok: false, notices: [{ level: 'error', key: 'io.dxf.noSketch' }] };
  const imp = dxfToSketch(text);
  if (!imp.ok) return { ok: false, notices: [importErrorNotice(imp.error)] };
  const r = await controller.applySketchDraft(mergeIntoDraft(draft, imp));
  if (!r.ok && !r.stale) return { ok: false, notices: [{ level: 'error', key: 'io.dxf.solveFailed', params: { hint: r.hint ?? '' } }] };
  const notices: ExportNotice[] = [{ level: 'info', key: 'io.dxf.imported', params: { count: imp.entities.length, scale: imp.scale } }];
  const skipped = Object.entries(imp.unsupported);
  if (skipped.length) notices.push({ level: 'warn', key: 'io.dxf.skipped', params: { what: skipped.map(([k, n]) => `${k} (${n})`).join(', ') } });
  if (imp.unknownUnits !== null) notices.push({ level: 'warn', key: 'io.dxf.unknownUnits', params: { code: imp.unknownUnits } });
  if (imp.degenerate) notices.push({ level: 'warn', key: 'io.dxf.degenerate', params: { count: imp.degenerate } });
  if (imp.sampled) notices.push({ level: 'warn', key: 'io.dxf.sampled', params: { count: imp.sampled } });
  return { ok: true, notices };
}

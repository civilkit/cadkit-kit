// SVG import into the sketch being edited. The parse and the geometry are in @kit/io; this adds the result to the open
// draft through the controller's normal apply path (one sketch-undo step, solved and previewed by the kernel), like dxfSketch.ts.
import { svgToSketch, mergeIntoDraft, type SvgImportError } from '@kit/io';
import type { Controller } from './controller';
import type { ExportNotice } from './exportFiles';

const list = (u: Record<string, number>) => Object.entries(u).map(([k, n]) => `${k} (${n})`).join(', ');

export function svgErrorNotice(e: SvgImportError): ExportNotice {
  switch (e.code) {
    case 'tooMany': return { level: 'error', key: 'io.svg.tooMany', params: { count: e.count, max: e.max } };
    case 'tooLarge': return { level: 'error', key: 'io.svg.tooLarge', params: { mb: Math.round(e.max / 1048576) } };
    case 'nothing': return { level: 'error', key: 'io.svg.nothing', params: { skipped: list(e.unsupported) || '-' } };
    case 'range': return { level: 'error', key: 'io.svg.range', params: { max: e.max } };
    case 'unsafe': return { level: 'error', key: 'io.svg.unsafe' };
    default: return { level: 'error', key: 'io.svg.notSvg' };
  }
}

/** Add the geometry of an SVG file to the open sketch. Nothing is changed when the file is refused. */
export async function importSvgIntoSketch(controller: Controller, text: string): Promise<{ ok: boolean; notices: ExportNotice[] }> {
  const draft = controller.sketchDraft();
  if (!draft) return { ok: false, notices: [{ level: 'error', key: 'io.svg.noSketch' }] };
  const imp = svgToSketch(text);
  if (!imp.ok) return { ok: false, notices: [svgErrorNotice(imp.error)] };
  const r = await controller.applySketchDraft(mergeIntoDraft(draft, imp));
  if (!r.ok && !r.stale) return { ok: false, notices: [{ level: 'error', key: 'io.svg.solveFailed', params: { hint: r.hint ?? '' } }] };
  const scale = Math.round(imp.scale * 1e6) / 1e6;
  const notices: ExportNotice[] = [{ level: 'info', key: 'io.svg.imported', params: { count: imp.entities.length, scale } }];
  if (Object.keys(imp.unsupported).length) notices.push({ level: 'warn', key: 'io.svg.skipped', params: { what: list(imp.unsupported) } });
  if (imp.units === 'px') notices.push({ level: 'warn', key: 'io.svg.unitless', params: { scale } });
  if (imp.degenerate) notices.push({ level: 'warn', key: 'io.svg.degenerate', params: { count: imp.degenerate } });
  if (imp.duplicate) notices.push({ level: 'warn', key: 'io.svg.duplicate', params: { count: imp.duplicate } });
  if (imp.clipped) notices.push({ level: 'warn', key: 'io.svg.clipped', params: { count: imp.clipped } });
  return { ok: true, notices };
}

// @kit/aec — Clean-room AEC & industrial surface format importers (.ifc, .3dm, .dwg, .rvt).
// Roadmap 3.4: ISO 10303-21 IFC (IFC2x3 & IFC4), Rhino OpenNURBS (.3dm), AutoCAD DWG (.dwg), and Revit (.rvt OLE2/CFB).

import { decodeText } from './geom';
import { importIfc, looksLikeIfc } from './ifc';
import { import3dm, looksLike3dm } from './rhino3dm';
import { importDwg, importRvt, looksLikeDwg, looksLikeRvt } from './dwgRvt';
import type { AecFormat, AecImportReport } from './types';

export * from './types';
export * from './geom';
export * from './ifc';
export * from './rhino3dm';
export * from './dwgRvt';

/**
 * Detect whether `input` (or `fileName`) is an `.ifc`, `.3dm`, `.dwg`, or `.rvt` file.
 */
export function detectAecFormat(input: Uint8Array | string, fileName?: string): AecFormat | null {
  if (typeof input !== 'string') {
    if (looksLike3dm(input)) return '3dm';
    if (looksLikeDwg(input)) return 'dwg';
    if (looksLikeRvt(input)) return 'rvt';
    if (looksLikeIfc(input)) return 'ifc';
  } else {
    if (looksLikeIfc(input)) return 'ifc';
  }

  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'ifc') return 'ifc';
    if (ext === '3dm') return '3dm';
    if (ext === 'dwg') return 'dwg';
    if (ext === 'rvt' || ext === 'rfa') return 'rvt';
  }
  return null;
}

/**
 * Auto-detect and import any supported AEC / surface file (`.ifc`, `.3dm`, `.dwg`, `.rvt`)
 * into a CadKit `Part` and `AecImportReport`. Never throws on malformed input.
 */
export function importAec(input: Uint8Array | string, fileName = 'Model.ifc'): AecImportReport {
  const fmt = detectAecFormat(input, fileName) ?? 'ifc';
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;

  switch (fmt) {
    case '3dm':
      return import3dm(bytes, fileName);
    case 'dwg':
      return importDwg(bytes, fileName);
    case 'rvt':
      return importRvt(bytes, fileName);
    case 'ifc':
    default:
      return importIfc(typeof input === 'string' ? input : decodeText(bytes), fileName);
  }
}

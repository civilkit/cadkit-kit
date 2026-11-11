// Flat pattern exports: the DXF and the bend table are made by the kernel (`sheetDxf`, `sheetBendTable`, stateless requests on a flat
// pattern); this file builds the requests, keeps the last options and names the files. No DOM.
import type { FlatPattern } from './model';
import { fileStem } from '../exportFiles';

export const DXF_VERSIONS = ['R2000', 'R12'] as const;
export const DXF_UNITS = ['mm', 'cm', 'm', 'in', 'ft'] as const;
export interface DxfOptions {
  version: (typeof DXF_VERSIONS)[number]; units: (typeof DXF_UNITS)[number];
  bendLines: boolean; tangentLines: boolean; bendNotes: boolean; noteHeight: number;
  layers: 'roles' | 'single'; layerNames: 'cadkit' | 'reference';
}
export const DEFAULT_DXF: DxfOptions = { version: 'R2000', units: 'mm', bendLines: true, tangentLines: false, bendNotes: false, noteHeight: 3, layers: 'roles', layerNames: 'cadkit' };
export type BendFormat = 'csv' | 'json';
export interface DxfReply { dxf: string; bends: number; bounds: [number, number, number, number]; entities: Record<string, number> }
export interface BendTableReply { format: BendFormat; text: string; bends: number }

/** The `sheetDxf` request for a flat pattern. A note height that is not a positive number is left out (the kernel uses 3 mm). */
export function dxfRequest(flat: FlatPattern, o: DxfOptions): { type: 'sheetDxf'; [k: string]: unknown } {
  const { noteHeight, ...rest } = o;
  return { type: 'sheetDxf', flatPattern: flat, ...rest, ...(Number.isFinite(noteHeight) && noteHeight > 0 ? { noteHeight } : {}) };
}
/** The `sheetBendTable` request; `body` is the part's name, written in the first column. */
export const bendTableRequest = (flat: FlatPattern, format: BendFormat, body?: string): { type: 'sheetBendTable'; [k: string]: unknown } =>
  ({ type: 'sheetBendTable', flatPattern: flat, format, ...(body ? { body } : {}) });

export const dxfFileName = (partName: string | undefined): string => `${fileStem(partName)}-flat.dxf`;
export const bendFileName = (partName: string | undefined, format: BendFormat): string => `${fileStem(partName)}-bends.${format}`;
export const BEND_MIME: Record<BendFormat, string> = { csv: 'text/csv', json: 'application/json' };

const KEY = 'cad.sheet.dxf';
/** The options last used (a stored choice that is not valid is ignored field by field). */
export function loadDxfOptions(read: (k: string) => string | null = (k) => { try { return localStorage.getItem(k); } catch { return null; } }): DxfOptions {
  try {
    const o = JSON.parse(read(KEY) ?? '{}') as Partial<DxfOptions>;
    return {
      version: (DXF_VERSIONS as readonly string[]).includes(o.version as string) ? o.version! : DEFAULT_DXF.version,
      units: (DXF_UNITS as readonly string[]).includes(o.units as string) ? o.units! : DEFAULT_DXF.units,
      bendLines: typeof o.bendLines === 'boolean' ? o.bendLines : DEFAULT_DXF.bendLines,
      tangentLines: typeof o.tangentLines === 'boolean' ? o.tangentLines : DEFAULT_DXF.tangentLines,
      bendNotes: typeof o.bendNotes === 'boolean' ? o.bendNotes : DEFAULT_DXF.bendNotes,
      noteHeight: typeof o.noteHeight === 'number' && o.noteHeight > 0 ? o.noteHeight : DEFAULT_DXF.noteHeight,
      layers: o.layers === 'single' ? 'single' : 'roles',
      layerNames: o.layerNames === 'reference' ? 'reference' : 'cadkit',
    };
  } catch { return { ...DEFAULT_DXF }; }
}
export function saveDxfOptions(o: DxfOptions): void {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* private window: the options last for this session only */ }
}

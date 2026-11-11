import { describe, expect, it } from 'vitest';
import { BEND_MIME, DEFAULT_DXF, bendFileName, bendTableRequest, dxfFileName, dxfRequest, loadDxfOptions } from './exportSheet';
import type { FlatPattern } from './model';

const fp = { rule: 'S', thickness: 2, kFactor: 0.44, flatSize: [1, 1, 2], outline: [], bends: [], bendZones: [], unfolded: false } as FlatPattern;

describe('flat pattern export requests', () => {
  it('the DXF request carries the flat pattern and every option the kernel reads', () => {
    const r = dxfRequest(fp, { ...DEFAULT_DXF, bendNotes: true, noteHeight: 4, units: 'in' });
    expect(r).toMatchObject({ type: 'sheetDxf', flatPattern: fp, version: 'R2000', units: 'in', bendLines: true, tangentLines: false, bendNotes: true, noteHeight: 4, layers: 'roles', layerNames: 'cadkit' });
    expect(dxfRequest(fp, { ...DEFAULT_DXF, noteHeight: Number.NaN })).not.toHaveProperty('noteHeight');
  });
  it('the bend table request names the body only when there is one', () => {
    expect(bendTableRequest(fp, 'csv', 'Bracket')).toEqual({ type: 'sheetBendTable', flatPattern: fp, format: 'csv', body: 'Bracket' });
    expect(bendTableRequest(fp, 'json')).not.toHaveProperty('body');
  });
  it('names files after the part and never writes a bad name', () => {
    expect(dxfFileName('Bracket')).toBe('Bracket-flat.dxf');
    expect(bendFileName('a/b: c', 'json')).toBe('a_b_ c-bends.json');
    expect(dxfFileName(undefined)).toBe('part-flat.dxf');
    expect(BEND_MIME).toEqual({ csv: 'text/csv', json: 'application/json' });
  });
  it('remembers the last options and ignores a stored value that does not fit', () => {
    expect(loadDxfOptions(() => null)).toEqual(DEFAULT_DXF);
    expect(loadDxfOptions(() => '{not json')).toEqual(DEFAULT_DXF);
    expect(loadDxfOptions(() => JSON.stringify({ version: 'R12', units: 'furlongs', noteHeight: -1, layers: 'single', bendNotes: true }))).toEqual({ ...DEFAULT_DXF, version: 'R12', layers: 'single', bendNotes: true });
  });
});

// Standard washer sizes for the Washer wizard. One row per standard and nominal size; dimensions in mm.
//  - ISO 7089 (normal series, product grade A): table 1 of the standard, M1.6 to M64 (the bracketed non-preferred sizes included, flagged). DIN 125 form A has the same
//    dimensions over the common range, so it is not listed twice.
//  - ISO 7093-1 (large series, "penny"), M3 to M36 (replaces DIN 9021; same values over this range).
//  - DIN 127 B (spring lock washer, rectangular section, square ends): inner = d1 min, outer = d2 max, thickness = s. Sizes whose numbers could not be
//    confirmed from two sources (M2.5, M14, M18, M22, M27, M33) are left out rather than guessed.
// Sorted by standard, then by nominal diameter.
export type WasherKindId = 'flat' | 'spring';
export interface WasherSize {
  id: string;
  kind: WasherKindId;
  standard: string;
  /** nominal thread size, e.g. 'M8' */
  size: string;
  inner: number;
  outer: number;
  thickness: number;
  /** false for the sizes the standard puts in brackets */
  preferred?: false;
}

type Row = [size: string, inner: number, outer: number, thickness: number, nonPreferred?: true];
const make = (kind: WasherKindId, standard: string, code: string, rows: Row[]): WasherSize[] =>
  rows.map(([size, inner, outer, thickness, np]) => ({ id: `${code}-${size}`, kind, standard, size, inner, outer, thickness, ...(np ? { preferred: false as const } : {}) }));

export const WASHER_SIZES: WasherSize[] = [
  ...make('flat', 'ISO 7089', 'iso7089', [
    ['M1.6', 1.7, 4, 0.3], ['M2', 2.2, 5, 0.3], ['M2.5', 2.7, 6, 0.5], ['M3', 3.2, 7, 0.5], ['M3.5', 3.7, 8, 0.5, true], ['M4', 4.3, 9, 0.8], ['M5', 5.3, 10, 1],
    ['M6', 6.4, 12, 1.6], ['M8', 8.4, 16, 1.6], ['M10', 10.5, 20, 2], ['M12', 13, 24, 2.5], ['M14', 15, 28, 2.5, true], ['M16', 17, 30, 3], ['M18', 19, 34, 3, true],
    ['M20', 21, 37, 3], ['M22', 23, 39, 3, true], ['M24', 25, 44, 4], ['M27', 28, 50, 4, true], ['M30', 31, 56, 4], ['M33', 34, 60, 5, true], ['M36', 37, 66, 5],
    ['M39', 42, 72, 6, true], ['M42', 45, 78, 8], ['M45', 48, 85, 8, true], ['M48', 52, 92, 8], ['M52', 56, 98, 8, true], ['M56', 62, 105, 10], ['M60', 66, 110, 10, true], ['M64', 70, 115, 10],
  ]),
  ...make('flat', 'ISO 7093-1', 'iso7093', [
    ['M3', 3.2, 9, 0.8], ['M3.5', 3.7, 11, 0.8], ['M4', 4.3, 12, 1], ['M5', 5.3, 15, 1], ['M6', 6.4, 18, 1.6], ['M8', 8.4, 24, 2], ['M10', 10.5, 30, 2.5], ['M12', 13, 37, 3],
    ['M14', 15, 44, 3], ['M16', 17, 50, 3], ['M18', 19, 56, 4], ['M20', 21, 60, 4], ['M22', 23, 66, 5], ['M24', 25, 72, 5], ['M27', 30, 85, 6], ['M30', 33, 92, 6], ['M33', 36, 105, 6], ['M36', 39, 110, 8],
  ]),
  ...make('spring', 'DIN 127 B', 'din127b', [
    ['M2', 2.1, 4.4, 0.5], ['M3', 3.1, 6.2, 0.8], ['M4', 4.1, 7.6, 0.9], ['M5', 5.1, 9.2, 1.2], ['M6', 6.1, 11.8, 1.6], ['M8', 8.1, 14.8, 2], ['M10', 10.2, 18.1, 2.2],
    ['M12', 12.2, 21.1, 2.5], ['M16', 16.2, 27.4, 3.5], ['M20', 20.2, 33.6, 4], ['M24', 24.5, 40, 5], ['M30', 30.5, 48.2, 6], ['M36', 36.5, 58.2, 6],
  ]),
];

const g = (n: number): string => String(+n.toFixed(3));
/** 'M8 - 8.4 x 16 x 1.6 (ISO 7089)' */
export const washerLabel = (w: WasherSize): string => `${w.size} - ${g(w.inner)} x ${g(w.outer)} x ${g(w.thickness)} (${w.standard})`;
export const washerSizesOf = (kind: WasherKindId): WasherSize[] => WASHER_SIZES.filter((w) => w.kind === kind);
/** The row whose three numbers equal these (the wizard shows it as picked), if any. */
export const findWasherSize = (kind: WasherKindId, inner: number, outer: number, thickness: number): WasherSize | undefined =>
  WASHER_SIZES.find((w) => w.kind === kind && w.inner === inner && w.outer === outer && w.thickness === thickness);

// ISO 273 clearance holes, medium series, mm (the usual drawing-office choice; fine is a little smaller, coarse a little larger). Used to read a washer size off a hole.
export const CLEARANCE_MEDIUM: Record<string, number> = {
  "M1.6": 1.8, M2: 2.4, "M2.5": 2.9, M3: 3.4, "M3.5": 3.9, M4: 4.5, M5: 5.5, M6: 6.6, M8: 9, M10: 11, M12: 13.5, M14: 15.5, M16: 17.5, M18: 20, M20: 22, M22: 24, M24: 26,
  M27: 30, M30: 33, M33: 36, M36: 39, M39: 42, M42: 45, M45: 48, M48: 52, M52: 56, M56: 62, M60: 66, M64: 70,
};
export interface HoleSize {
  size: WasherSize;
  /** 'contains': the hole is at least the size's medium clearance hole and below the next size's. 'nearest': the hole is smaller than the smallest clearance hole of the table, so the smallest size stands in. */
  fit: 'contains' | 'nearest';
  clearance: number;
}
/** The size of a standard whose clearance hole the given hole contains: the largest nominal size of the standard whose medium clearance hole is not larger than `diameter`. A hole smaller than the standard's smallest clearance hole falls back to the smallest size ('nearest'). Null for an unknown standard or a bad diameter. */
export function sizeForHole(standard: string, diameter: number): HoleSize | null {
  if (!(diameter > 0)) return null;
  const rows = WASHER_SIZES.filter((w) => w.standard === standard && CLEARANCE_MEDIUM[w.size] !== undefined);
  if (!rows.length) return null;
  const fits = rows.filter((w) => CLEARANCE_MEDIUM[w.size] <= diameter + 1e-6);
  const size = fits.length ? fits[fits.length - 1] : rows[0];
  return { size, fit: fits.length ? 'contains' : 'nearest', clearance: CLEARANCE_MEDIUM[size.size] };
}

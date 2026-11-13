// Dimension tables of the fastener helpers (nut, standoff, heatSetInsert), in mm. Plain data: the Script helpers read them and so do the wizards in the app.
//
// PROVENANCE. The thread sizes (M2 to M16, coarse pitch, tap drill) are the ones of the kernel's thread table (the `metric` standard: ISO 724 / ISO 261, tap drills of the
// usual tapping charts). The nut tables are the maximum dimensions of ISO 4032 (hexagon nut style 1, regular), ISO 4035 (thin nut, chamfered, 0.5 d) and ISO 4033
// (hexagon nut style 2): s is the width across flats, m the maximum thickness. They were entered from the standards' public dimension tables and NOT checked against the
// standards' text, so every row is `verified: false`; the rows or fields listed in `unverified` are the ones less certain than the rest. Check against the drawing of the
// nut you buy before relying on a value. ISO 4033 starts at M5 (no style 2 below), and M3.5, M7, M9, M11 (in the thread table) are left out: they are not in the preferred
// series of ISO 4032 either.
// The standoff and heat-set insert tables are TYPICAL catalogue values (hex and round spacers of the common PCB and enclosure ranges, knurled brass inserts for 3D printed
// parts), not a standard: manufacturers differ by several tenths of a millimetre. Each row says so (`verified: false`); the ranges seen across catalogues are in the comments.

export type NutType = 'regular' | 'thin' | 'style2';
export const NUT_TYPES: readonly NutType[] = ['regular', 'thin', 'style2'];
/** The standard of each nut type. */
export const NUT_STANDARD: Record<NutType, string> = { regular: 'ISO 4032', thin: 'ISO 4035', style2: 'ISO 4033' };

export interface NutSize {
  /** nominal (major) diameter */ d: number;
  pitch: number;
  /** tap drill: the bore of a threaded (cosmetic or modelled) nut */ tap: number;
  /** width across flats, ISO 4032 / 4035 / 4033 */ s: number;
  /** maximum thickness m per type; absent where the standard has no such size */ m: Partial<Record<NutType, number>>;
  /** false: not a preferred size of ISO 4032 (the standard brackets it) */ preferred?: false;
  /** always false: see the provenance note above */ verified: false;
  /** the fields among 's' and the three types that are less certain than the rest */ unverified?: Array<'s' | NutType>;
}
export const NUT_SIZES: Record<string, NutSize> = {
  M2:     { d: 2,   pitch: 0.4,  tap: 1.6,  s: 4,   m: { regular: 1.6,  thin: 1.2 },                 verified: false, unverified: ['thin'] },
  'M2.5': { d: 2.5, pitch: 0.45, tap: 2.05, s: 5,   m: { regular: 2.0,  thin: 1.6 },                 verified: false, unverified: ['thin'] },
  M3:     { d: 3,   pitch: 0.5,  tap: 2.5,  s: 5.5, m: { regular: 2.4,  thin: 1.8 },                 verified: false },
  M4:     { d: 4,   pitch: 0.7,  tap: 3.3,  s: 7,   m: { regular: 3.2,  thin: 2.2 },                 verified: false },
  M5:     { d: 5,   pitch: 0.8,  tap: 4.2,  s: 8,   m: { regular: 4.7,  thin: 2.7,  style2: 5.1 },  verified: false },
  M6:     { d: 6,   pitch: 1,    tap: 5,    s: 10,  m: { regular: 5.2,  thin: 3.2,  style2: 5.7 },  verified: false },
  M8:     { d: 8,   pitch: 1.25, tap: 6.8,  s: 13,  m: { regular: 6.8,  thin: 4.0,  style2: 7.5 },  verified: false },
  M10:    { d: 10,  pitch: 1.5,  tap: 8.5,  s: 16,  m: { regular: 8.4,  thin: 5.0,  style2: 9.3 },  verified: false },
  M12:    { d: 12,  pitch: 1.75, tap: 10.2, s: 18,  m: { regular: 10.8, thin: 6.0,  style2: 12.0 }, verified: false },
  M14:    { d: 14,  pitch: 2,    tap: 12,   s: 21,  m: { regular: 12.8, thin: 7.0,  style2: 14.1 }, verified: false, preferred: false, unverified: ['s', 'regular', 'thin', 'style2'] },
  M16:    { d: 16,  pitch: 2,    tap: 14,   s: 24,  m: { regular: 14.8, thin: 8.0,  style2: 16.4 }, verified: false },
};

export interface StandoffSize {
  d: number; pitch: number; tap: number;
  /** round standoff outside diameter (typical catalogue value) */ round: number;
  /** hex standoff width across flats (typical: the width of the nut of the size) */ hex: number;
  /** default length of the female thread and of the male stud, mm */ thread: number;
  verified: false;
}
/** Typical PCB / enclosure standoffs. Round outside diameters seen across catalogues: M2 4 to 5, M2.5 5 to 6, M3 5 to 6.5, M4 7 to 8, M5 8 to 9, M6 10. Hex widths across flats: 4 / 5 / 5.5 / 7 / 8 / 10. */
export const STANDOFF_SIZES: Record<string, StandoffSize> = {
  M2:     { d: 2,   pitch: 0.4,  tap: 1.6,  round: 4,  hex: 4,   thread: 4, verified: false },
  'M2.5': { d: 2.5, pitch: 0.45, tap: 2.05, round: 5,  hex: 5,   thread: 5, verified: false },
  M3:     { d: 3,   pitch: 0.5,  tap: 2.5,  round: 6,  hex: 5.5, thread: 6, verified: false },
  M4:     { d: 4,   pitch: 0.7,  tap: 3.3,  round: 7,  hex: 7,   thread: 8, verified: false },
  M5:     { d: 5,   pitch: 0.8,  tap: 4.2,  round: 8,  hex: 8,   thread: 10, verified: false },
  M6:     { d: 6,   pitch: 1,    tap: 5,    round: 10, hex: 10,  thread: 12, verified: false },
};

export interface InsertSize {
  d: number; pitch: number; tap: number;
  /** outside diameter over the knurl, mm */ od: number;
  /** length of the insert, mm */ length: number;
  /** recommended hole diameter in the plastic, mm */ hole: number;
  /** recommended hole depth, mm (the insert length plus room for the displaced plastic and a sink) */ depth: number;
  verified: false;
}
/**
 * Typical cylindrical knurled brass heat-set inserts (the "short" to "standard" length ones sold for 3D printed parts). Ranges seen across manufacturers' sheets:
 * M2 length 3 to 4, outside 3.2 to 3.6, hole 3.0 to 3.2; M2.5 length 4 to 5, outside 3.6 to 4.2, hole 3.4 to 3.8; M3 length 4 to 5.7, outside 4.0 to 4.6, hole 3.8 to 4.2;
 * M4 length 6 to 8.1, outside 5.4 to 6.3, hole 5.0 to 5.6; M5 length 8 to 9.5, outside 6.4 to 7.0, hole 5.8 to 6.4; M6 length 10 to 12.7, outside 8.0 to 8.7, hole 7.2 to 8.0.
 * The row is a middle value of each range, NOT a manufacturer's drawing: check the sheet of the insert you buy.
 */
export const INSERT_SIZES: Record<string, InsertSize> = {
  M2:     { d: 2,   pitch: 0.4,  tap: 1.6,  od: 3.6, length: 4,    hole: 3.2, depth: 5,    verified: false },
  'M2.5': { d: 2.5, pitch: 0.45, tap: 2.05, od: 4,   length: 5,    hole: 3.6, depth: 6,    verified: false },
  M3:     { d: 3,   pitch: 0.5,  tap: 2.5,  od: 4.6, length: 5.7,  hole: 4,   depth: 7,    verified: false },
  M4:     { d: 4,   pitch: 0.7,  tap: 3.3,  od: 5.6, length: 8.1,  hole: 5,   depth: 9.5,  verified: false },
  M5:     { d: 5,   pitch: 0.8,  tap: 4.2,  od: 6.4, length: 9.5,  hole: 5.8, depth: 11,   verified: false },
  M6:     { d: 6,   pitch: 1,    tap: 5,    od: 8,   length: 12.7, hole: 7.2, depth: 14.5, verified: false },
};

/** Internal minor diameter D1 of a coarse metric thread: d - 1.082532 P (the kernel's thread table value). */
export const minorInternal = (d: number, pitch: number): number => d - 1.0825317547305482 * pitch;

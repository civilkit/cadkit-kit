// The NIST test assembly (MBE PMI models FTC 7, 8, 9, 10): which part is which, where each starts, and the mates that put it in place.
// All face names are the part's own (the importer's `F<id>.I1F<n>` and the history's `F<id>.S.*`); `@F<k>.1` names the component.
export const NIST_PARTS = [
  { n: '07', title: 'NIST FTC 7 base', fixed: true },
  { n: '08', title: 'NIST FTC 8 lid', fixed: false },
  { n: '09', title: 'NIST FTC 9 plate', fixed: false },
  { n: '10', title: 'NIST FTC 10 component', fixed: false },
] as const;

/**
 * Where each part starts (mm, degrees about one axis, then the shift). FTC 7 is turned half a turn about Y so that every other part is
 * reached by one axis turn; the mates then give the exact pose (the seeds only have to be near it).
 * FTC 8 lies on the rim (its z = 0 face on the y = 12.7 rim of FTC 7); FTC 9 is 3.03784 thick on the four standoffs at y = -104.14;
 * FTC 10 stands on FTC 9 (y = -104.14 + 3.03784), its four holes (140 x 57) on the FTC 9 pattern centred at (-28.65, -31.6).
 */
export const NIST_PLACEMENTS: Record<string, { dx?: number; dy?: number; dz?: number; axis?: 'x' | 'y' | 'z' | null; angle?: number }> = {
  '07': { axis: 'y', angle: 180 },
  '08': { axis: 'x', angle: -90, dy: 12.7 },
  '09': { axis: 'y', angle: 90, dy: -104.14 },
  '10': { dx: -31.6, dy: -101.10216, dz: 28.65 },
};

export interface NistMate { name: string; kind: string; a: string; b: string; flip?: boolean }
export const NIST_MATES: NistMate[] = [
  // lid on the rim, one of its four 1/4 inch bolt holes over the base's
  { name: 'Lid on rim', kind: 'coincident', a: 'F49.I1F4@F2.1', b: 'F4.I1F11@F1.1' },
  { name: 'Lid bolt hole', kind: 'concentric', a: 'F49.I1F20@F2.1', b: 'F4.I1F106@F1.1' },
  { name: 'Lid turn', kind: 'lock', a: 'F49.I1F4@F2.1', b: 'F4.I1F11@F1.1' },
  // plate on the standoffs
  { name: 'Plate on standoffs', kind: 'coincident', a: 'F2.C0@F3.1', b: 'F4.I1F39@F1.1' },
  { name: 'Plate screw hole', kind: 'concentric', a: 'F5.S.e1@F3.1', b: 'F4.I1F96@F1.1' },
  { name: 'Plate turn', kind: 'lock', a: 'F2.C0@F3.1', b: 'F4.I1F39@F1.1' },
  // component on the plate
  { name: 'Component on plate', kind: 'coincident', a: 'F21.I1F11@F4.1', b: 'F2.C1@F3.1' },
  { name: 'Component screw hole', kind: 'concentric', a: 'F21.I1F71@F4.1', b: 'F14.S.h1@F15.3@F3.1' },
  { name: 'Component turn', kind: 'lock', a: 'F21.I1F11@F4.1', b: 'F2.C1@F3.1' },
];

/**
 * The exploded view saved in the sample: the base stays, everything else is lifted along +Y (the lid's normal, the way the stack is
 * built) in stages, the plate first, then the component, then the lid, with the gaps below (mm, from the part boxes: base 311 x 136 x 222,
 * lid 311 x 48 x 222 on the rim at y = 12.7, plate 279 x 3 x 190 at y = -104.14, component 158 x 31 x 75 on the plate).
 *   plate     +60  : 60 above the standoffs, still inside the base
 *   component +110 : 50 above the lifted plate
 *   lid       +80  : 53 above the lifted component, 80 above the rim
 * Offsets are world-space and stay within the +-150 mm range of the panel's slider. `spread` is 0: only these offsets move parts.
 */
export const NIST_EXPLODE = { spread: 0, dir: 'auto', manual: { F2: [0, 80, 0], F3: [0, 60, 0], F4: [0, 110, 0] } } as const;

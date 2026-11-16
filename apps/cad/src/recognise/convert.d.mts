// Types for convert.mjs (plain ESM, shared with tools/step_features).
export interface Box { min: number[]; max: number[] }
export interface PrismStock { axis: number; area: number; points: Array<[number, number]>; lo: number; hi: number }
export interface TurnedLevel { h: number; loops: Array<{ r: number; c: [number, number]; round: boolean }> }
export interface ConvertOpts { stock?: Box | null; prism?: PrismStock | null; turned?: TurnedLevel[] | null }
/** `code` says why in a form the dialog can put in words: stock, fillet-kind, fillet-corner, pocket-shape, folded (a pattern of holes already rebuilt), family (not rebuilt yet), kernel (rejected by the kernel) */
export interface Skipped { id: string; why: string; code?: string; family?: string }
export interface ConvertResult {
  /** the kit script that rebuilds the part, or null when nothing could be built */
  script: string | null;
  lineIds?: string[];
  /** ids of the recognised features the script rebuilds */
  handled: string[];
  /** what was recognised but not rebuilt, with the reason */
  skipped: Skipped[];
  base: (Box & { volume: number | null; prism?: boolean; turned?: boolean }) | null;
}
export function convert(quiddityJson: unknown, opts?: ConvertOpts): ConvertResult;
export function turnedProfile(levels: TurnedLevel[], hLo: number, hHi: number): Array<[number, number]> | null;

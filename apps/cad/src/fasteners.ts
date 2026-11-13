// The rules of the three fastener wizards (Nut, Standoff, Heat-set insert): the parameter records with their defaults, the checks that need no kernel, the numbers shown under
// the fields and the ops. The ops come from the script helpers nut(), standoff() and heatSetInsert() (packages/script/src/features/fasteners.ts), so a wizard and the Script tab
// build the same part. Nothing here touches the DOM or the kernel. The dimension tables are in packages/script/src/features/fastenerData.ts (with their provenance).
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { groupOps, wizardGroupName } from './wizardGroup';
import {
  INSERT_SIZES, NUT_SIZES, NUT_STANDARD, NUT_TYPES, STANDOFF_SIZES, heatSetInsertEditOps, minorInternal, nutEditOps, nutGeometry, standoffEditOps,
  type FastenerThread, type HeatSetInsertOpts, type NutOpts, type NutType, type StandoffEnds, type StandoffKind, type StandoffOpts,
} from '@kit/script';

export { NUT_TYPES, NUT_STANDARD };
export const FASTENER_THREADS = ['plain', 'cosmetic', 'modeled'] as const;
export const STANDOFF_KINDS = ['round', 'hex'] as const;
export const STANDOFF_ENDS = ['female-female', 'male-female'] as const;
/** The way the part extends from its first face (a nut and an insert go down by default, a standoff up). */
export const FASTENER_AXES = ['nz', 'pz', 'nx', 'px', 'ny', 'py'] as const;
export type FastenerAxis = (typeof FASTENER_AXES)[number];
const AXIS_VEC: Record<FastenerAxis, [number, number, number]> = { nz: [0, 0, -1], pz: [0, 0, 1], nx: [-1, 0, 0], px: [1, 0, 0], ny: [0, -1, 0], py: [0, 1, 0] };
/** Largest print clearance either way, mm: the kernel's own bound. */
export const CLEARANCE_LIMIT = 1;
export const nutSizeNames = (type: NutType): string[] => Object.keys(NUT_SIZES).filter((n) => NUT_SIZES[n].m[type] !== undefined);
export const STANDOFF_SIZE_NAMES = Object.keys(STANDOFF_SIZES);
export const INSERT_SIZE_NAMES = Object.keys(INSERT_SIZES);

type Origin = [number, number, number];
type Doc = { features: Array<{ id?: string }>; seq?: number };
function nextSeq(doc: Doc): number {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return n;
}
export interface FastenerIssue { code: string; params: Record<string, string | number>; message: string }
const bad = (code: string, message: string, params: Record<string, string | number> = {}): FastenerIssue => ({ code, params, message });
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** the message of a throwing helper without its 'nut(): ' prefix */
const kernelIssue = (e: unknown): FastenerIssue => bad('kernel', (e as Error).message.replace(/^(nut|standoff|heatSetInsert)\(\): /, ''));
const clearanceIssue = (thread: FastenerThread, c: number): FastenerIssue | null => (thread === 'modeled' && !(Math.abs(c) <= CLEARANCE_LIMIT) ? bad('clearance', 'The print clearance must be between -1 and 1 mm', { max: CLEARANCE_LIMIT }) : null);

// ---------------------------------------------------------------- nut
export interface NutParams {
  size: string;
  type: NutType;
  thread: FastenerThread;
  /** modelled thread: print clearance, mm, positive = looser */
  clearance: number;
  chamfer: boolean;
  /** the centre of the first face */
  origin: Origin;
  axis: FastenerAxis;
}
/** An M8 regular nut (ISO 4032): 13 mm across flats, 6.8 mm thick, chamfered, plain bore. */
export const DEFAULT_NUT: NutParams = { size: 'M8', type: 'regular', thread: 'plain', clearance: 0, chamfer: true, origin: [0, 0, 0], axis: 'nz' };
export function nutOpts(p: NutParams, name?: string): NutOpts {
  return { size: p.size, type: p.type, thread: p.thread, ...(p.thread === 'modeled' && p.clearance ? { clearance: p.clearance } : {}), chamfer: p.chamfer, origin: p.origin, axis: AXIS_VEC[p.axis], ...(name ? { name } : {}) };
}
export function nutIssue(p: NutParams): FastenerIssue | null {
  if (!NUT_SIZES[p.size] || NUT_SIZES[p.size].m[p.type] === undefined) return bad('size', 'There is no such nut in the standard', { size: p.size, standard: NUT_STANDARD[p.type] });
  const c = clearanceIssue(p.thread, p.clearance);
  if (c) return c;
  try { nutEditOps(nutOpts(p), 1); } catch (e) { return kernelIssue(e); }
  return null;
}
/** What the panel shows under the fields: the standard, width across flats, corners, thickness, bore, and whether the row is one of the less certain ones. */
export function nutSummary(p: NutParams): { standard: string; s: number; e: number; m: number; bore: number; unverified: boolean } | null {
  const g = nutGeometry(p.size, p.type, p.thread);
  const row = NUT_SIZES[p.size];
  if (!g || !row) return null;
  return { standard: NUT_STANDARD[p.type], s: g.s, e: r3(g.e), m: g.m, bore: r3(g.bore), unverified: !!row.unverified?.some((f) => f === 's' || f === p.type) };
}
export function nutOps(doc: Doc & { features: Array<{ id?: string; group?: unknown }> }, p: NutParams): EditOp[] {
  const group = wizardGroupName(doc.features, t('nut.title'));
  return groupOps(nutEditOps(nutOpts(p, group), nextSeq(doc)) as unknown as EditOp[], group);   // the folder name is also the body name, so the bore and chamfer cuts reach only this nut
}

// ---------------------------------------------------------------- standoff
export interface StandoffParams {
  size: string;
  kind: StandoffKind;
  ends: StandoffEnds;
  length: number;
  /** outside diameter (round) or width across flats (hex) */
  outer: number;
  /** depth of each female thread and length of the male stud */
  threadLength: number;
  thread: FastenerThread;
  clearance: number;
  origin: Origin;
  axis: FastenerAxis;
}
/** The table values of a size for the standoff's kind: its outside dimension and thread length. */
export const standoffDefaults = (size: string, kind: StandoffKind): Pick<StandoffParams, 'outer' | 'threadLength'> => ({ outer: STANDOFF_SIZES[size][kind], threadLength: STANDOFF_SIZES[size].thread });
/** An M3 round female-female standoff, 6 mm across and 15 mm long. */
export const DEFAULT_STANDOFF: StandoffParams = { size: 'M3', kind: 'round', ends: 'female-female', length: 15, ...standoffDefaults('M3', 'round'), thread: 'plain', clearance: 0, origin: [0, 0, 0], axis: 'pz' };
export function standoffOpts(p: StandoffParams, name?: string): StandoffOpts {
  return { size: p.size, length: p.length, kind: p.kind, ends: p.ends, outer: p.outer, threadLength: p.threadLength, thread: p.thread, ...(p.thread === 'modeled' && p.clearance ? { clearance: p.clearance } : {}), origin: p.origin, axis: AXIS_VEC[p.axis], ...(name ? { name } : {}) };
}
export function standoffIssue(p: StandoffParams): FastenerIssue | null {
  const row = STANDOFF_SIZES[p.size];
  if (!row) return bad('size', 'There is no such size', { size: p.size });
  if (!(p.length > 0)) return bad('length', 'The length must be more than 0');
  if (!(p.threadLength > 0)) return bad('threadLength', 'The thread length must be more than 0');
  if (!(p.outer >= row.d + 1)) return bad('outer', 'The wall would be under 0.5 mm', { min: row.d + 1, size: p.size });
  if (p.ends === 'female-female' ? !(2 * p.threadLength < p.length) : !(p.threadLength < p.length)) {
    return p.ends === 'female-female' ? bad('threadMeet', 'The two threads would meet', { max: r3(p.length / 2), length: p.length }) : bad('threadLong', 'The thread must be shorter than the length', { length: p.length });
  }
  const c = clearanceIssue(p.thread, p.clearance);
  if (c) return c;
  try { standoffEditOps(standoffOpts(p), 1); } catch (e) { return kernelIssue(e); }
  return null;
}
export function standoffSummary(p: StandoffParams): { total: number; bore: number; volume: number } | null {
  const row = STANDOFF_SIZES[p.size];
  if (!row) return null;
  const bore = r3(p.thread === 'plain' ? minorInternal(row.d, row.pitch) : row.tap);
  const area = p.kind === 'round' ? Math.PI * (p.outer / 2) ** 2 : (Math.sqrt(3) / 2) * p.outer ** 2;
  const nBores = p.ends === 'female-female' ? 2 : 1;
  const volume = area * p.length - nBores * Math.PI * (bore / 2) ** 2 * p.threadLength + (p.ends === 'male-female' ? Math.PI * (row.d / 2) ** 2 * p.threadLength : 0);
  return { total: p.length + (p.ends === 'male-female' ? p.threadLength : 0), bore, volume };
}
export function standoffOps(doc: Doc & { features: Array<{ id?: string; group?: unknown }> }, p: StandoffParams): EditOp[] {
  const group = wizardGroupName(doc.features, t('standoff.title'));
  return groupOps(standoffEditOps(standoffOpts(p, group), nextSeq(doc)) as unknown as EditOp[], group);
}

// ---------------------------------------------------------------- heat-set insert
export interface InsertParams {
  size: string;
  /** outside diameter over the knurl, length, hole diameter and depth: the table row, editable */
  outer: number;
  length: number;
  holeDiameter: number;
  holeDepth: number;
  rings: number;
  /** also cut the recommended hole */
  hole: boolean;
  /** with `hole`: the body to cut it into by name, '' = every body the hole reaches */
  holeIn: string;
  thread: FastenerThread;
  clearance: number;
  /** the centre of the hole mouth */
  origin: Origin;
  axis: FastenerAxis;
}
export const insertDefaults = (size: string): Pick<InsertParams, 'outer' | 'length' | 'holeDiameter' | 'holeDepth' | 'rings'> => {
  const r = INSERT_SIZES[size];
  return { outer: r.od, length: r.length, holeDiameter: r.hole, holeDepth: r.depth, rings: r.length < 5 ? 2 : r.length < 9 ? 3 : 4 };
};
/** An M3 insert (typical: 4.6 mm over the knurl, 5.7 mm long, 4 mm hole 7 mm deep), no hole cut. */
export const DEFAULT_INSERT: InsertParams = { size: 'M3', ...insertDefaults('M3'), hole: false, holeIn: '', thread: 'plain', clearance: 0, origin: [0, 0, 0], axis: 'nz' };
export function insertOpts(p: InsertParams, name?: string): HeatSetInsertOpts {
  return {
    size: p.size, outer: p.outer, length: p.length, holeDiameter: p.holeDiameter, holeDepth: p.holeDepth, rings: p.rings, thread: p.thread,
    ...(p.thread === 'modeled' && p.clearance ? { clearance: p.clearance } : {}), ...(p.hole ? { hole: p.holeIn ? p.holeIn : true } : {}), origin: p.origin, axis: AXIS_VEC[p.axis], ...(name ? { name } : {}),
  };
}
export function insertIssue(p: InsertParams): FastenerIssue | null {
  if (!INSERT_SIZES[p.size]) return bad('size', 'There is no such size', { size: p.size });
  if (!(p.outer > 0)) return bad('outer', 'The outside diameter must be more than 0');
  if (!(p.length > 0)) return bad('length', 'The length must be more than 0');
  if (!(p.holeDiameter > 0) || p.holeDiameter > p.outer) return bad('holeDiameter', 'The hole must be smaller than the insert, or equal', { outer: p.outer });
  if (!(p.holeDepth >= p.length)) return bad('holeDepth', 'The hole must be at least as deep as the insert is long', { length: p.length });
  const c = clearanceIssue(p.thread, p.clearance);
  if (c) return c;
  try { heatSetInsertEditOps(insertOpts(p), 1); } catch (e) { return kernelIssue(e); }
  return null;
}
/** The interference of the press fit (the plastic the insert displaces, per side) and the bore. */
export function insertSummary(p: InsertParams): { interference: number; bore: number } | null {
  const row = INSERT_SIZES[p.size];
  if (!row) return null;
  return { interference: r3((p.outer - p.holeDiameter) / 2), bore: r3(p.thread === 'plain' ? minorInternal(row.d, row.pitch) : row.tap) };
}
export function insertOps(doc: Doc & { features: Array<{ id?: string; group?: unknown }> }, p: InsertParams): EditOp[] {
  const group = wizardGroupName(doc.features, t('insert.title'));
  return groupOps(heatSetInsertEditOps(insertOpts(p, group), nextSeq(doc)) as unknown as EditOp[], group);
}
/** The names of the document's bodies (the ones made with newBody), for the insert's "cut the hole into" list. */
export function bodyNames(features: ReadonlyArray<{ op?: string; body?: unknown }>): string[] {
  return [...new Set(features.filter((f) => f.op === 'newBody' && typeof f.body === 'string' && f.body.trim() !== '').map((f) => String(f.body)))];
}

// ---------------------------------------------------------------- the three as one (the app keeps one fastener wizard open at a time)
export type FastenerWizardState = { kind: 'nut'; params: NutParams } | { kind: 'standoff'; params: StandoffParams } | { kind: 'insert'; params: InsertParams };
export function fastenerIssue(w: FastenerWizardState): FastenerIssue | null { return w.kind === 'nut' ? nutIssue(w.params) : w.kind === 'standoff' ? standoffIssue(w.params) : insertIssue(w.params); }
export function fastenerOps(doc: Doc & { features: Array<{ id?: string; group?: unknown }> }, w: FastenerWizardState): EditOp[] {
  return w.kind === 'nut' ? nutOps(doc, w.params) : w.kind === 'standoff' ? standoffOps(doc, w.params) : insertOps(doc, w.params);
}
export function openFastener(kind: FastenerWizardState['kind']): FastenerWizardState {
  return kind === 'nut' ? { kind, params: { ...DEFAULT_NUT } } : kind === 'standoff' ? { kind, params: { ...DEFAULT_STANDOFF } } : { kind, params: { ...DEFAULT_INSERT } };
}

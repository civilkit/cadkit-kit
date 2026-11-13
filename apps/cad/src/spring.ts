// The Spring wizard's rules: the parameter record with its defaults, the checks that need no kernel, the numbers shown under the fields and the ops. The ops come from the
// script's spring() helper (packages/script/src/features/spring.ts), so the wizard and the Script tab build the same spring. Nothing here touches the DOM or the kernel.
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { groupOps, wizardGroupName } from './wizardGroup';
import { extensionEditOps, extensionPath, springEditOps, springGeometry, torsionEditOps, torsionPath, type SpringOpts, type ExtensionOpts, type TorsionOpts } from '@kit/script';

/** The way the spring extends from its first end. */
export const SPRING_AXES = ['pz', 'nz', 'px', 'nx', 'py', 'ny'] as const;
const AXIS_VEC: Record<(typeof SPRING_AXES)[number], [number, number, number]> = { 'nz': [0, 0, -1], 'pz': [0, 0, 1], 'nx': [-1, 0, 0], 'px': [1, 0, 0], 'ny': [0, -1, 0], 'py': [0, 1, 0] };
export const SPRING_HANDS = ['right', 'left'] as const;
/** compression: free length between the ends; extension: a tight body with a machine hook at each end */
export const SPRING_KINDS = ['compression', 'extension', 'torsion'] as const;
/** plain wire ends, closed (touching) end turns, or closed turns ground flat */
export const SPRING_ENDS = ['plain', 'closed', 'ground'] as const;

export interface SpringParams {
  kind: (typeof SPRING_KINDS)[number];
  outer: number;
  wire: number;
  /** free length, end to end */
  length: number;
  /** turns of the wire (extension: of the tight body between the hooks) */
  coils: number;
  hand: (typeof SPRING_HANDS)[number];
  ends: (typeof SPRING_ENDS)[number];
  /** closed and ground ends: touching turns at each end (counted in `coils`) */
  closedTurns: number;
  /** outside diameter at the far end; null: the same as `outer` (a cylinder), another value makes a cone */
  topOuter: number | null;
  /** the body's pitch at the far end divided by the pitch at the first end: 1 is even, below 1 the turns close up towards the far end */
  progression: number;
  /** torsion: the length of each leg, mm */
  leg1: number;
  leg2: number;
  /** the centre of the first end */
  origin: [number, number, number];
  axis: (typeof SPRING_AXES)[number];
}
/** A 20 mm outside diameter, 2 mm wire, 40 mm long compression spring with 8 turns (pitch 4.75). */
/** What the extension kind starts from: a 12 mm outside diameter, 1 mm wire, 15 turn body. */
export const EXTENSION_DEFAULTS = { outer: 12, wire: 1, coils: 15 } as const;
/** and the torsion kind: a 14 mm outside diameter, 1.2 mm wire, 5.25 turns (the legs at a right angle) and 21 mm legs. */
export const TORSION_DEFAULTS = { outer: 14, wire: 1.2, coils: 5.25, leg1: 21, leg2: 21 } as const;
export const DEFAULT_SPRING: SpringParams = { kind: 'compression', outer: 20, wire: 2, length: 40, coils: 8, hand: 'right', ends: 'plain', closedTurns: 1, topOuter: null, progression: 1, leg1: 21, leg2: 21, origin: [0, 0, 0], axis: 'pz' };

export function torsionOpts(p: SpringParams, name?: string): TorsionOpts {
  return { outer: p.outer, wire: p.wire, coils: p.coils, leg1: p.leg1, leg2: p.leg2, hand: p.hand, origin: p.origin, axis: AXIS_VEC[p.axis], ...(name ? { name } : {}) };
}

export function extensionOpts(p: SpringParams, name?: string): ExtensionOpts {
  return { outer: p.outer, wire: p.wire, coils: p.coils, hand: p.hand, origin: p.origin, axis: AXIS_VEC[p.axis], ...(name ? { name } : {}) };
}

export function springOpts(p: SpringParams, name?: string): SpringOpts {
  return { outer: p.outer, wire: p.wire, length: p.length, coils: p.coils, hand: p.hand, ends: p.ends, ...(p.ends !== 'plain' ? { closedTurns: p.closedTurns } : {}), ...(p.topOuter !== null && p.topOuter !== p.outer ? { topOuter: p.topOuter } : {}), ...(p.progression !== 1 ? { progression: p.progression } : {}), origin: p.origin, axis: AXIS_VEC[p.axis], ...(name ? { name } : {}) };
}

export type SpringIssueCode = 'topOuter' | 'progression' | 'wire' | 'outer' | 'length' | 'coils' | 'closed' | 'pitch' | 'hookOuter' | 'leg' | 'kernel';
export interface SpringIssue { code: SpringIssueCode; params: Record<string, string | number>; message: string }

/** The first problem with the parameters (none when the ops can be made). */
export function springIssue(p: SpringParams): SpringIssue | null {
  const bad = (code: SpringIssueCode, message: string, params: Record<string, string | number> = {}): SpringIssue => ({ code, params, message });
  if (!(p.wire > 0)) return bad('wire', 'The wire diameter must be more than 0');
  if (p.kind === 'torsion') {
    if (!(p.outer > 2 * p.wire)) return bad('outer', 'The outer diameter must be more than twice the wire diameter', { min: +(2 * p.wire).toFixed(4) });
    if (!(p.coils >= 1)) return bad('coils', 'The number of turns must be at least 1');
    if (!(p.leg1 > 0) || !(p.leg2 > 0)) return bad('leg', 'The legs must be longer than 0');
    try { torsionEditOps(torsionOpts(p), 1); } catch (e) { return bad('kernel', (e as Error).message.replace(/^torsionSpring\(\): /, '')); }
    return null;
  }
  if (p.kind === 'extension') {
    if (!(p.outer > 3 * p.wire)) return bad('hookOuter', 'The outer diameter must be more than three times the wire diameter', { min: +(3 * p.wire).toFixed(4) });
    if (!(p.coils >= 1)) return bad('coils', 'The number of turns must be at least 1');
    try { extensionEditOps(extensionOpts(p), 1); } catch (e) { return bad('kernel', (e as Error).message.replace(/^extensionSpring\(\): /, '')); }
    return null;
  }
  if (!(p.outer > 2 * p.wire)) return bad('outer', 'The outer diameter must be more than twice the wire diameter', { min: +(2 * p.wire).toFixed(4) });
  if (!(p.length > p.wire)) return bad('length', 'The length must be more than the wire diameter', { wire: p.wire });
  if (!(p.coils > 0)) return bad('coils', 'The number of turns must be more than 0');
  if (p.ends !== 'plain' && !(p.closedTurns > 0)) return bad('closed', 'The closed turns must be more than 0', { active: 0 });
  if (p.topOuter !== null && !(p.topOuter > 2 * p.wire)) return bad('topOuter', 'The far-end outer diameter must be more than twice the wire diameter', { min: +(2 * p.wire).toFixed(4) });
  if (!(p.progression > 0)) return bad('progression', 'The pitch ratio must be more than 0');
  const g = springGeometry({ ...p, topOuter: p.topOuter ?? undefined });
  if (p.ends !== 'plain' && !(g.activeCoils >= 1)) return bad('closed', 'The closed turns leave fewer than 1 turn for the body', { active: +g.activeCoils.toFixed(3) });
  if (!(g.minPitch > p.wire)) return bad('pitch', 'The turns would touch', { pitch: +g.minPitch.toFixed(3), wire: p.wire });
  try { springEditOps(springOpts(p), 1); } catch (e) { return bad('kernel', (e as Error).message.replace(/^spring\(\): /, '')); }
  return null;
}

/** The numbers that follow from the fields, for the panel to show: the pitch, the gap between turns, the length of wire and its volume. */
export function springSummary(p: SpringParams): { pitch: number; gap: number; wireLength: number; volume: number; meanDiameter: number; activeCoils: number; length: number; legAngle: number } {
  if (p.kind === 'torsion') {
    const e = torsionPath({ outer: p.outer, wire: p.wire, coils: p.coils, leg1: p.leg1, leg2: p.leg2, spin: p.hand === 'left' ? -1 : 1 });
    let len = 0;
    for (let i = 1; i < e.pts.length; i++) len += Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1], e.pts[i][2] - e.pts[i - 1][2]);
    return { pitch: p.wire * 1.05, gap: p.wire * 0.05, wireLength: len, volume: Math.PI * (p.wire / 2) ** 2 * len, meanDiameter: p.outer - p.wire, activeCoils: p.coils, length: e.length, legAngle: e.legAngle };
  }
  if (p.kind === 'extension') {
    const e = extensionPath({ outer: p.outer, wire: p.wire, coils: p.coils, spin: p.hand === 'left' ? -1 : 1 });
    let len = 0;
    for (let i = 1; i < e.pts.length; i++) len += Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1], e.pts[i][2] - e.pts[i - 1][2]);
    return { pitch: p.wire, gap: 0, wireLength: len, volume: Math.PI * (p.wire / 2) ** 2 * len, meanDiameter: p.outer - p.wire, activeCoils: p.coils, length: e.length, legAngle: 0 };
  }
  const g = springGeometry({ ...p, topOuter: p.topOuter ?? undefined });
  return { pitch: g.pitch, gap: g.pitch - p.wire, wireLength: g.wireLength, volume: g.volume, meanDiameter: p.outer - p.wire, activeCoils: g.activeCoils, length: p.length, legAngle: 0 };
}

/** The ops that append the spring to the document (all in one tree folder named after the wizard, see wizardGroup.ts), numbered from the document's next feature id. Throws with the helper's message. */
export function springOps(doc: { features: Array<{ id?: string }>; seq?: number }, p: SpringParams): EditOp[] {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  const group = wizardGroupName(doc.features, t('spring.title'));
  const ops = p.kind === 'extension' ? extensionEditOps(extensionOpts(p, group), n) : p.kind === 'torsion' ? torsionEditOps(torsionOpts(p, group), n) : springEditOps(springOpts(p, group), n);
  return groupOps(ops as unknown as EditOp[], group);   // the folder name is also the body name, so a ground spring's end cuts reach only that spring
}

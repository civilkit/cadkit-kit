// The Spring wizard's rules: the parameter record with its defaults, the checks that need no kernel, the numbers shown under the fields and the ops. The ops come from the
// script's spring() helper (packages/script/src/features/spring.ts), so the wizard and the Script tab build the same spring. Nothing here touches the DOM or the kernel.
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { groupOps, wizardGroupName } from './wizardGroup';
import { springEditOps, springGeometry, type SpringOpts } from '@kit/script';

/** The way the spring extends from its first end. */
export const SPRING_AXES = ['pz', 'nz', 'px', 'nx', 'py', 'ny'] as const;
const AXIS_VEC: Record<(typeof SPRING_AXES)[number], [number, number, number]> = { 'nz': [0, 0, -1], 'pz': [0, 0, 1], 'nx': [-1, 0, 0], 'px': [1, 0, 0], 'ny': [0, -1, 0], 'py': [0, 1, 0] };
export const SPRING_HANDS = ['right', 'left'] as const;

export interface SpringParams {
  outer: number;
  wire: number;
  /** free length, end to end */
  length: number;
  /** turns of the wire */
  coils: number;
  hand: (typeof SPRING_HANDS)[number];
  /** the centre of the first end */
  origin: [number, number, number];
  axis: (typeof SPRING_AXES)[number];
}
/** A 20 mm outside diameter, 2 mm wire, 40 mm long compression spring with 8 turns (pitch 4.75). */
export const DEFAULT_SPRING: SpringParams = { outer: 20, wire: 2, length: 40, coils: 8, hand: 'right', origin: [0, 0, 0], axis: 'pz' };

export function springOpts(p: SpringParams): SpringOpts {
  return { outer: p.outer, wire: p.wire, length: p.length, coils: p.coils, hand: p.hand, origin: p.origin, axis: AXIS_VEC[p.axis] };
}

export type SpringIssueCode = 'wire' | 'outer' | 'length' | 'coils' | 'pitch' | 'kernel';
export interface SpringIssue { code: SpringIssueCode; params: Record<string, string | number>; message: string }

/** The first problem with the parameters (none when the ops can be made). */
export function springIssue(p: SpringParams): SpringIssue | null {
  const bad = (code: SpringIssueCode, message: string, params: Record<string, string | number> = {}): SpringIssue => ({ code, params, message });
  if (!(p.wire > 0)) return bad('wire', 'The wire diameter must be more than 0');
  if (!(p.outer > 2 * p.wire)) return bad('outer', 'The outer diameter must be more than twice the wire diameter', { min: +(2 * p.wire).toFixed(4) });
  if (!(p.length > p.wire)) return bad('length', 'The length must be more than the wire diameter', { wire: p.wire });
  if (!(p.coils > 0)) return bad('coils', 'The number of turns must be more than 0');
  const g = springGeometry(p);
  if (!(g.pitch > p.wire)) {
    return bad('pitch', 'The turns would touch', { pitch: +g.pitch.toFixed(3), wire: p.wire });
  }
  try { springOps({ features: [] }, p); } catch (e) { return bad('kernel', (e as Error).message.replace(/^spring\(\): /, '')); }
  return null;
}

/** The numbers that follow from the fields, for the panel to show: the pitch, the gap between turns, the length of wire and its volume. */
export function springSummary(p: SpringParams): { pitch: number; gap: number; wireLength: number; volume: number; meanDiameter: number } {
  const g = springGeometry(p);
  return { pitch: g.pitch, gap: g.pitch - p.wire, wireLength: g.wireLength, volume: g.volume, meanDiameter: p.outer - p.wire };
}

/** The ops that append the spring to the document (all in one tree folder named after the wizard, see wizardGroup.ts), numbered from the document's next feature id. Throws with the helper's message. */
export function springOps(doc: { features: Array<{ id?: string }>; seq?: number }, p: SpringParams): EditOp[] {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return groupOps(springEditOps(springOpts(p), n) as unknown as EditOp[], wizardGroupName(doc.features, t('spring.title')));
}

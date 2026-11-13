// The rules of the Case wizard: the parameter record with its defaults, the checks that need no kernel, the numbers shown under the fields and the ops. The ops come from the
// script helper caseBox() (packages/script/src/features/enclosure.ts), so the wizard and the Script tab build the same case: two shelled cups, a tongue on one rim and a groove in the other, in one folder.
// Nothing here touches the DOM or the kernel.
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { groupOps, wizardGroupName } from './wizardGroup';
import { caseEditOps, caseGeometry, type CaseBoxOpts } from '@kit/script';

export const CASE_TONGUE_SIDES = ['lid', 'base'] as const;
export type CaseTongueSide = (typeof CASE_TONGUE_SIDES)[number];
/** The thinnest wall the wizard accepts, mm. */
export const MIN_WALL = 0.4;

export interface CaseParams {
  /** outside size, mm */
  width: number;
  depth: number;
  height: number;
  wall: number;
  /** outside corner radius of the plan; 0 = sharp */
  radius: number;
  /** height of the lid, mm. While `lidAuto` it follows the height and the wall: a quarter of the height, at least three walls. */
  lidHeight: number;
  lidAuto: boolean;
  /** how far the tongue stands out of its half, mm. While `tongueAuto` it follows the wall (0.75 of it). */
  tongueHeight: number;
  tongueAuto: boolean;
  /** tongue width as a fraction of the wall */
  tongueFraction: number;
  clearance: number;
  tongueOn: CaseTongueSide;
  baseName: string;
  lidName: string;
  /** the centre of the bottom face */
  origin: [number, number, number];
}
export const autoLid = (height: number, wall: number): number => r3(Math.max(height / 4, 3 * wall));
export const autoTongue = (wall: number): number => r3(0.75 * wall);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** An 80 x 50 x 30 mm case with 2 mm walls, a lid a quarter of the height, a tongue 1 mm wide and 1.5 mm high on the lid, 0.2 mm clearance. */
export const DEFAULT_CASE: CaseParams = {
  width: 80, depth: 50, height: 30, wall: 2, radius: 0, lidHeight: autoLid(30, 2), lidAuto: true, tongueHeight: autoTongue(2), tongueAuto: true, tongueFraction: 0.5, clearance: 0.2, tongueOn: 'lid',
  baseName: 'Base', lidName: 'Lid', origin: [0, 0, 0],
};

/** The parameters after a change: the automatic lid height and tongue height follow the height and the wall. */
export function withChange(p: CaseParams, patch: Partial<CaseParams>): CaseParams {
  const n = { ...p, ...patch };
  if (patch.lidHeight !== undefined) n.lidAuto = false;
  if (patch.tongueHeight !== undefined) n.tongueAuto = false;
  if (n.lidAuto && (patch.height !== undefined || patch.wall !== undefined)) n.lidHeight = autoLid(n.height, n.wall);
  if (n.tongueAuto && patch.wall !== undefined) n.tongueHeight = autoTongue(n.wall);
  return n;
}

/** The helper's options for these parameters. */
export function caseOpts(p: CaseParams): CaseBoxOpts {
  return {
    width: p.width, depth: p.depth, height: p.height, wall: p.wall, radius: p.radius, lidHeight: p.lidHeight, tongueHeight: p.tongueHeight, tongueWidth: r3(p.tongueFraction * p.wall),
    clearance: p.clearance, tongueOn: p.tongueOn, names: [p.baseName.trim(), p.lidName.trim()], origin: p.origin,
  };
}

export type CaseIssueCode = 'size' | 'wall' | 'wallThick' | 'radius' | 'radiusBig' | 'lid' | 'groove' | 'tongue' | 'tongueFit' | 'clearance' | 'names' | 'kernel';
export interface CaseIssue { code: CaseIssueCode; params: Record<string, string | number>; message: string }
const bad = (code: CaseIssueCode, message: string, params: Record<string, string | number> = {}): CaseIssue => ({ code, params, message });

/** The first problem with the parameters (none when the ops can be made). */
export function caseIssue(p: CaseParams): CaseIssue | null {
  if (!(p.width > 0) || !(p.depth > 0) || !(p.height > 0)) return bad('size', 'The width, depth and height must be more than 0');
  if (!(p.wall >= MIN_WALL)) return bad('wall', 'The wall must be at least 0.4 mm', { min: MIN_WALL });
  const small = Math.min(p.width, p.depth, p.height);
  if (!(2 * p.wall < small)) return bad('wallThick', 'The two walls must be thinner than the smallest outside size', { max: r3(small / 2), small: r3(small) });
  if (!(p.radius >= 0)) return bad('radius', 'The corner radius must be 0 or more');
  if (p.radius > 0 && !(p.radius > p.wall)) return bad('radius', 'The corner radius must be 0 (sharp) or more than the wall, or the inside corner collapses', { wall: p.wall });
  if (p.radius > 0 && !(2 * p.radius <= Math.min(p.width, p.depth))) return bad('radiusBig', 'The corner radius is more than half of the width or depth', { max: r3(Math.min(p.width, p.depth) / 2) });
  const base = p.height - p.lidHeight;
  if (!(p.lidHeight > p.wall) || !(base > p.wall)) return bad('lid', 'The lid and the base must each be taller than the wall', { lid: r3(p.lidHeight), base: r3(base), wall: p.wall });
  if (!(p.tongueHeight > 0)) return bad('tongue', 'The tongue height must be more than 0');
  if (!(p.tongueFraction > 0 && p.tongueFraction < 1)) return bad('tongue', 'The tongue width must be a fraction of the wall between 0 and 1');
  if (!(p.clearance >= 0 && p.clearance <= 1)) return bad('clearance', 'The clearance must be between 0 and 1 mm');
  if (!(p.tongueFraction * p.wall + 2 * p.clearance < p.wall)) return bad('tongueFit', 'The tongue and the clearance on both sides do not fit in the wall: a narrower tongue or a smaller clearance', { max: r3(Math.max(0, 1 - 2 * p.clearance / p.wall)) });
  const groove = p.tongueHeight + p.clearance, grooved = p.tongueOn === 'lid' ? base : p.lidHeight;
  if (!(grooved >= groove + p.wall)) return bad('groove', 'The groove would leave less than a wall under it: a lower tongue or a taller half', { half: p.tongueOn === 'lid' ? t('case.base') : t('case.lid'), need: r3(groove + p.wall), have: r3(grooved) });
  const a = p.baseName.trim(), b = p.lidName.trim();
  if (!a || !b || a === b) return bad('names', 'Give the two halves two different names');
  try { caseGeometry(caseOpts(p)); } catch (e) { return bad('kernel', (e as Error).message.replace(/^caseBox\(\): /, '')); }
  return null;
}

/** What the panel shows under the fields: the heights of the halves, where the cut is and the tongue and groove sizes. */
export function caseSummary(p: CaseParams): { base: number; lid: number; cut: number; tongueWidth: number; tongueHeight: number; grooveWidth: number; grooveDepth: number } {
  const w = p.tongueFraction * p.wall;
  return { base: r3(p.height - p.lidHeight), lid: r3(p.lidHeight), cut: r3(p.origin[2] + p.height - p.lidHeight), tongueWidth: r3(w), tongueHeight: r3(p.tongueHeight), grooveWidth: r3(w + 2 * p.clearance), grooveDepth: r3(p.tongueHeight + p.clearance) };
}

type Doc = { features: Array<{ id?: string; group?: unknown }>; seq?: number };
function nextSeq(doc: Doc): number {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return n;
}
/** The ops that append the case to the document (one tree folder named after the wizard, see wizardGroup.ts), numbered from the document's next feature id. Throws with the helper's message. */
export function caseOps(doc: Doc, p: CaseParams): EditOp[] {
  const group = wizardGroupName(doc.features, t('case.title'));
  return groupOps(caseEditOps(caseOpts(p), nextSeq(doc)) as unknown as EditOp[], group);
}

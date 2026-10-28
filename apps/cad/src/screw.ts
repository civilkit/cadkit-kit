// The Screw wizard's rules: the parameter record with its defaults, the checks that need no kernel, and the ops. The ops come from the script's screw()
// helper (packages/script/src/features/screw.ts), so the wizard and the Script tab build the same fastener. Nothing here touches the DOM or the kernel.
import type { EditOp } from '@ck/session';
import { screwEditOps, SCREW_SIZES, type ScrewOpts } from '@kit/script';

export const SCREW_SIZE_LIST = Object.keys(SCREW_SIZES);
export const SCREW_HEADS = ['pan', 'button', 'countersunk', 'cheese', 'hex'] as const;
export const SCREW_DRIVES = ['cross', 'hex', 'slotted', 'torx', 'none'] as const;
/** The way the shank points. */
export const SCREW_AXES = ['nz', 'pz', 'nx', 'px', 'ny', 'py'] as const;
const AXIS_VEC: Record<(typeof SCREW_AXES)[number], [number, number, number]> = { 'nz': [0, 0, -1], 'pz': [0, 0, 1], 'nx': [-1, 0, 0], 'px': [1, 0, 0], 'ny': [0, -1, 0], 'py': [0, 1, 0] };

export interface ScrewParams {
  size: string;
  length: number;
  head: (typeof SCREW_HEADS)[number];
  drive: (typeof SCREW_DRIVES)[number];
  /** a helical thread: refused by the helper for now */
  thread: boolean;
  /** the centre of the bearing face */
  origin: [number, number, number];
  axis: (typeof SCREW_AXES)[number];
}
export const DEFAULT_SCREW: ScrewParams = { size: 'M3', length: 8, head: 'pan', drive: 'cross', thread: false, origin: [0, 0, 0], axis: 'nz' };

/** The drive a head usually has: a hex head is turned from outside and has none. */
export const defaultDrive = (head: ScrewParams['head']): ScrewParams['drive'] => (head === 'hex' ? 'none' : head === 'pan' ? 'cross' : 'hex');

/** The options of the script helper for these parameters. */
export function screwOpts(p: ScrewParams): ScrewOpts {
  return { size: p.size, length: p.length, head: p.head, drive: p.drive, origin: p.origin, axis: AXIS_VEC[p.axis], ...(p.thread ? { thread: true } : {}) };
}

export type ScrewIssueCode = 'length' | 'size' | 'hexDrive' | 'countersunk' | 'kernel';
export interface ScrewIssue { code: ScrewIssueCode; params: Record<string, string | number>; message: string }

/** The first problem with the parameters (none when the ops can be made). */
export function screwIssue(p: ScrewParams): ScrewIssue | null {
  const bad = (code: ScrewIssueCode, message: string, params: Record<string, string | number> = {}): ScrewIssue => ({ code, params, message });
  const row = (SCREW_SIZES as Record<string, { countersunk: { k: number } }>)[p.size];
  if (!row) return bad('size', `Unknown size ${p.size}`);
  if (!(p.length > 0)) return bad('length', 'The length must be more than 0');
  if (p.head === 'hex' && p.drive !== 'none') return bad('hexDrive', 'A hex head takes no drive');
  if (p.head === 'countersunk' && !(p.length > row.countersunk.k)) return bad('countersunk', 'The length of a countersunk screw includes its head', { head: row.countersunk.k });
  try { screwOps({ features: [] }, p); } catch (e) { return bad('kernel', (e as Error).message.replace(/^screw\(\): /, '')); }
  return null;
}

/** The ops that append the screw to the document, numbered from the document's next feature id. Throws with the helper's message. */
export function screwOps(doc: { features: Array<{ id?: string }>; seq?: number }, p: ScrewParams): EditOp[] {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return screwEditOps(screwOpts(p), n) as unknown as EditOp[];
}

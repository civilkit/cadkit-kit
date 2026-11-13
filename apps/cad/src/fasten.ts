// "Fasten this hole": the rules. From a hole read off the part (fastenHole.ts) to the bolt, washers and nut that go in it: the standard size nearest to the bore
// (clearance or tapped), the head type the mouth of the hole asks for, the standard length for the material it goes through, the positions on the hole axis, and the
// edit ops. The ops come from the script helpers screw(), washer() and nut() (packages/script/src/features), so this and the Script tab build the same parts; what is
// added here is that every part is its own named body that no cut or fuse reaches (a bolt head touching the plate must not fuse with it). No DOM, no kernel.
import type { EditOp } from '@ck/session';
import { nutEditOps, NUT_SIZES, screwEditOps, SCREW_SIZES, washerEditOps } from '@kit/script';
import { ISO_TABLE } from './holeData';
import { identicalHoles, type FastenHole, type FastenKind } from './fastenHole';
import { t } from './i18n';
import { groupOps, wizardGroupName } from './wizardGroup';
import { WASHER_SIZES } from './washerSizes';

type V3 = [number, number, number];

// ---------------------------------------------------------------- size from the diameter

/** Metric sizes a bolt can be made in (the screw() table), smallest first. */
export const BOLT_SIZES: string[] = Object.keys(SCREW_SIZES).filter((s) => ISO_TABLE[s]);
export interface SizeMatch {
  size: string;
  /** a bore of about the size's clearance hole (the bolt passes through), or about its tap drill (the bolt threads into it) */
  fit: 'clearance' | 'tap';
  /** the bore diameter looked at, mm */
  diameter: number;
  /** the table diameter it matched (the clearance hole between close and loose, or the tap drill), mm */
  reference: number;
  /** within 0.3 mm of the table; false means "nearest", not "matches" */
  exact: boolean;
}
/** How far from the table a bore may be and still count as that size, mm. */
export const MATCH_TOL = 0.3;
/**
 * The size nearest to a bore: for every size the distance to its clearance range (close to loose fit of the ISO table; 0 inside) and to its tap drill; the least wins,
 * a tap fit before a clearance fit when equal (2.5 mm is the M3 tap drill, not an M2 clearance hole). So 5.5 mm is M5 clearance, 4.2 mm is M5 tapped, 6.6 mm is M6 clearance.
 */
export function matchSize(diameter: number): SizeMatch {
  let best: SizeMatch | null = null, bestD = Infinity;
  for (const size of BOLT_SIZES) {
    const row = ISO_TABLE[size];
    const dc = diameter < row.close ? row.close - diameter : diameter > row.loose ? diameter - row.loose : 0;
    const dt = Math.abs(diameter - row.tap);
    const cand: Array<[number, SizeMatch]> = [
      [dc, { size, fit: 'clearance', diameter, reference: Math.min(Math.max(diameter, row.close), row.loose), exact: dc <= MATCH_TOL }],
      [dt, { size, fit: 'tap', diameter, reference: row.tap, exact: dt <= MATCH_TOL }],
    ];
    for (const [dist, m] of cand) if (dist < bestD - 1e-9 || (best && Math.abs(dist - bestD) <= 1e-9 && m.fit === 'tap' && best.fit === 'clearance')) { best = m; bestD = dist; }
  }
  return best!;
}

// ---------------------------------------------------------------- length from the thickness

/** Standard lengths of metric screws and bolts (ISO 4017 / 4762 series), mm. */
export const STANDARD_LENGTHS = [6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200];
/** The shortest standard length that is not under `mm` (beyond the list: the next multiple of 20). */
export function roundUpLength(mm: number): number {
  const v = STANDARD_LENGTHS.find((l) => l >= mm - 1e-6);
  return v ?? Math.ceil(mm / 20 - 1e-9) * 20;
}
/** The longest standard length that is not over `mm` (the shortest one when nothing is short enough). */
export function roundDownLength(mm: number): number {
  const v = [...STANDARD_LENGTHS].reverse().find((l) => l <= mm + 1e-6);
  return v ?? STANDARD_LENGTHS[0];
}

// ---------------------------------------------------------------- head type from the mouth

/** The bolt types: hex head (ISO 4017), socket cap screw (ISO 4762), button head (ISO 7380), countersunk (ISO 10642). */
export const BOLT_TYPES = ['hex', 'cap', 'button', 'countersunk'] as const;
export type BoltType = (typeof BOLT_TYPES)[number];
const HEAD: Record<BoltType, { head: 'hex' | 'cheese' | 'button' | 'countersunk'; drive: 'none' | 'hex' }> = {
  hex: { head: 'hex', drive: 'none' }, cap: { head: 'cheese', drive: 'hex' }, button: { head: 'button', drive: 'hex' }, countersunk: { head: 'countersunk', drive: 'hex' },
};
/** The bolt a hole asks for: a countersink takes a countersunk screw, a counterbore a socket cap screw, a plain hole a hex bolt. */
export const defaultBoltType = (kind: FastenKind): BoltType => (kind === 'csink' ? 'countersunk' : kind === 'cbore' ? 'cap' : 'hex');
/**
 * The kind of mouth a Hole feature cuts, as the geometry reader names it: a counterbore for `cbore`, a countersink for `countersink` or for `csink` given a
 * `cskDiameter` (the kernel cuts a `csink` without one as a plain hole), else plain.
 */
export function holeKindOf(f: Record<string, unknown>): FastenKind {
  if (f.kind === 'cbore' || f.kind === 'counterbore') return 'cbore';
  if (f.kind === 'countersink' || (f.kind === 'csink' && typeof f.cskDiameter === 'number' && f.cskDiameter > 0)) return 'csink';
  return 'plain';
}

// ---------------------------------------------------------------- the parameters

export type WasherChoice = 'none' | 'head' | 'both';
export interface FastenParams {
  type: BoltType;
  size: string;
  /** null: the standard length worked out from the hole (autoLength); a number: the user's own */
  length: number | null;
  /** none; under the head; under the head and under the nut */
  washer: WasherChoice;
  nut: boolean;
  /** a plain through hole: the head on the other end */
  flip: boolean;
}
/** What the dialog starts with for a hole: type from the mouth, size from the bore, auto length, no washer, no nut. */
export function defaultParams(h: FastenHole): FastenParams {
  const m = matchSize(h.diameter);
  return { type: defaultBoltType(h.kind), size: m.size, length: null, washer: 'none', nut: false, flip: false };
}

const washerRow = (size: string) => WASHER_SIZES.find((w) => w.standard === 'ISO 7089' && w.size === size);
const nutThickness = (size: string): number | null => NUT_SIZES[size]?.m.regular ?? null;
const headOf = (size: string, type: BoltType): { dk: number; k: number } | null => {
  const row = (SCREW_SIZES as unknown as Record<string, Record<string, { dk: number; k: number } | undefined>>)[size];
  return row?.[HEAD[type].head] ?? null;
};

export type FastenIssueCode = 'size' | 'head' | 'length' | 'tapNut' | 'blindNut' | 'csinkWasher' | 'washerRecess' | 'headRecess' | 'kernel';
export interface FastenIssue { code: FastenIssueCode; params: Record<string, string | number>; message: string }
const issue = (code: FastenIssueCode, message: string, params: Record<string, string | number> = {}): FastenIssue => ({ code, params, message });

/** The standard length for these choices: the material from the bearing face to the exit plus what is stacked (washers, nut), rounded up; a blind hole: the longest that fits. */
export function autoLength(h: FastenHole, p: FastenParams): number {
  const w = p.washer !== 'none' ? washerRow(p.size)?.thickness ?? 0 : 0;
  if (!h.through) return roundDownLength(h.grip + w);
  const nutStack = p.nut ? (p.washer === 'both' ? washerRow(p.size)?.thickness ?? 0 : 0) + (nutThickness(p.size) ?? 0) : 0;
  return roundUpLength(h.grip + w + nutStack);
}

export interface FastenPlan {
  /** the length in use, mm */
  length: number;
  match: SizeMatch;
  /** problems that stop the fasteners being made (the dialog disables Add) */
  issues: FastenIssue[];
  /** what the plan makes, in the order of the stack from the head: for the dialog and the checks */
  parts: Array<{ role: 'washerHead' | 'bolt' | 'washerNut' | 'nut'; origin: V3; axis: V3; length: number }>;
}
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const add = (a: number[], b: number[], s: number): V3 => [r3(a[0] + b[0] * s), r3(a[1] + b[1] * s), r3(a[2] + b[2] * s)];
const neg = (a: number[]): V3 => [a[0] === 0 ? 0 : -a[0], a[1] === 0 ? 0 : -a[1], a[2] === 0 ? 0 : -a[2]];

/** The positions and the problems for a hole and the choices. A washer or nut the hole cannot take is reported as an issue, not silently left out. */
export function planHole(h: FastenHole, p: FastenParams): FastenPlan {
  const match = matchSize(h.diameter);
  const issues: FastenIssue[] = [];
  const length = p.length ?? autoLength(h, p);
  const row = SCREW_SIZES as unknown as Record<string, unknown>;
  if (!row[p.size]) issues.push(issue('size', `Unknown size ${p.size}`, { size: p.size }));
  const head = headOf(p.size, p.type);
  if (row[p.size] && !head) issues.push(issue('head', `${p.size} has no ${p.type} head in the table`, { size: p.size }));
  if (!(length > 0)) issues.push(issue('length', 'The length must be more than 0'));
  const wr = washerRow(p.size);
  if (p.washer !== 'none' && !wr) issues.push(issue('size', `There is no ISO 7089 washer for ${p.size}`, { size: p.size }));
  if (p.washer !== 'none') {
    if (h.kind === 'csink') issues.push(issue('csinkWasher', 'A countersunk mouth has no flat face for a washer'));
    else if (h.kind === 'cbore' && wr && h.recessDiameter !== null && wr.outer > h.recessDiameter - 0.2) issues.push(issue('washerRecess', 'The washer does not fit in the counterbore', { outer: wr.outer, bore: h.recessDiameter }));
  }
  if (head && h.recessDiameter !== null && h.kind === 'cbore') {
    const width = p.type === 'hex' ? head.dk * 2 / Math.sqrt(3) : head.dk;
    if (width > h.recessDiameter + 1e-6) issues.push(issue('headRecess', 'The head is wider than the counterbore', { head: r3(width), bore: h.recessDiameter }));
  }
  if (p.nut) {
    if (!h.through) issues.push(issue('blindNut', 'A blind hole has no far side for a nut'));
    else if (match.fit === 'tap') issues.push(issue('tapNut', 'A tapped hole holds the bolt by its thread: no nut'));
    else if (nutThickness(p.size) === null) issues.push(issue('size', `There is no nut for ${p.size}`, { size: p.size }));
  }

  const parts: FastenPlan['parts'] = [];
  const o = h.out, into = neg(o);
  const wt = p.washer !== 'none' && wr ? wr.thickness : 0;
  if (wt) parts.push({ role: 'washerHead', origin: h.seat, axis: o, length: wt });
  parts.push({ role: 'bolt', origin: add(h.seat, o, wt), axis: into, length });
  if (p.nut && h.through && h.exit) {
    const w2 = p.washer === 'both' && wr ? wr.thickness : 0;
    if (w2) parts.push({ role: 'washerNut', origin: h.exit, axis: into, length: w2 });
    parts.push({ role: 'nut', origin: add(h.exit, into, w2), axis: into, length: nutThickness(p.size) ?? 0 });
  }
  return { length, match, issues, parts };
}

// ---------------------------------------------------------------- the edit ops

type Doc = { features: Array<{ id?: string; group?: unknown; name?: unknown; body?: unknown }>; seq?: number };
type Wire = Record<string, unknown>;
const maxId = (ops: EditOp[], from: number): number => {
  let n = from;
  for (const op of ops as Array<{ feature?: { id?: unknown } }>) { const m = /^F(\d+)$/.exec(String(op.feature?.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return n;
};
function nextSeq(doc: Doc): number {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return n;
}
/** The body names the document already uses (named bodies and feature names; a cut by body name must find exactly one). */
function takenNames(doc: Doc): Set<string> {
  const s = new Set<string>();
  for (const f of doc.features) { if (typeof f.body === 'string') s.add(f.body); if (typeof f.name === 'string') s.add(f.name); }
  return s;
}
/** `base` when free, else `base 2`, `base 3` ...; when `many`, always numbered from 1. The chosen names are added to `taken`. */
export function freeName(base: string, taken: Set<string>, many: boolean): string {
  let name = many ? `${base} 1` : base;
  for (let n = 2; taken.has(name) || taken.has(`${name} head`); n++) name = `${base} ${n}`;
  taken.add(name); taken.add(`${name} head`);
  return name;
}

/** The screw as its own body (shank and head), the hex head united into it by name so it never fuses with the part it sits on, and the drive cut reaching this bolt only. */
function boltOps(o: { size: string; length: number; type: BoltType; origin: V3; axis: V3 }, seq: number, body: string): EditOp[] {
  const h = HEAD[o.type];
  const ops = screwEditOps({ size: o.size, length: o.length, head: h.head, drive: h.drive, origin: o.origin, axis: o.axis }, seq) as unknown as Array<{ op: string; feature: Wire }>;
  let hexHead = false;
  for (const op of ops) {
    const f = op.feature;
    if (f.type === 'revolve' && f.op === 'newBody') { f.body = body; f.name = body; }
    else if (f.type === 'extrude' && f.op === 'add') { f.op = 'newBody'; f.body = `${body} head`; hexHead = true; }
    else if ((f.type === 'extrude' || f.type === 'revolve') && f.op === 'cut' && !f.target) f.target = [{ body }];
  }
  const out = ops as unknown as EditOp[];
  if (hexHead) out.push({ op: 'add', feature: { type: 'combine', id: `F${maxId(out, seq)}`, op: 'union', target: { body }, tools: [{ body: `${body} head` }], body } as never });
  return out;
}
function washerBodyOps(inner: number, outer: number, thickness: number, origin: V3, axis: V3, seq: number, body: string): EditOp[] {
  const ops = washerEditOps({ kind: 'flat', inner, outer, thickness, origin, axis, name: body }, seq) as unknown as Array<{ feature: Wire }>;
  for (const op of ops) if (op.feature.type === 'extrude' && op.feature.op === 'newBody') op.feature.body = body;
  return ops as unknown as EditOp[];
}

export interface FastenTarget { hole: FastenHole; params: FastenParams }
/**
 * The ops that add the fasteners of every target hole to the document, in one folder (named like the wizards' results, "Fasteners"). One bolt, and the
 * washers and nut the plan has, per hole; each its own named body ("Bolt", "Washer", "Nut"; "Bolt 1", "Bolt 2" ... with several holes). Throws with the helper's message.
 */
export function fastenOps(doc: Doc, targets: FastenTarget[]): EditOp[] {
  let seq = nextSeq(doc);
  const taken = takenNames(doc);
  const many = targets.length > 1;
  const all: EditOp[] = [];
  const push = (ops: EditOp[]): void => { all.push(...ops); seq = maxId(ops, seq); };
  for (const { hole, params } of targets) {
    const plan = planHole(hole, params);
    const bad = plan.issues[0];
    if (bad) throw new Error(bad.message);
    const wr = washerRow(params.size);
    const base = { bolt: 'fasten.body.bolt', washerHead: 'fasten.body.washer', washerNut: 'fasten.body.washerNut', nut: 'fasten.body.nut' } as const;
    const name = (role: keyof typeof base): string => freeName(t(base[role]), taken, many);
    for (const part of plan.parts) {
      if (part.role === 'bolt') push(boltOps({ size: params.size, length: plan.length, type: params.type, origin: part.origin, axis: part.axis }, seq, name('bolt')));
      else if (part.role === 'nut') push(nutEditOps({ size: params.size, type: 'regular', thread: 'plain', chamfer: true, origin: part.origin, axis: part.axis, name: name('nut') }, seq) as unknown as EditOp[]);
      else push(washerBodyOps(wr!.inner, wr!.outer, part.length, part.origin, part.axis, seq, name(part.role === 'washerHead' ? 'washerHead' : 'washerNut')));
    }
  }
  return groupOps(all, wizardGroupName(doc.features as never, t('fasten.folder')));
}

// ---------------------------------------------------------------- which holes

/** The holes besides the picked one that the dialog offers to fasten too, each group without the ones in an earlier group. */
export interface FastenGroups {
  /** the same diameter, type and depth, opening on the same plane (the ones among the selected or the pattern included) */
  identical: FastenHole[];
  /** other selected holes that are not identical */
  selected: FastenHole[];
  /** other holes of the same pattern that are not identical */
  pattern: FastenHole[];
}
export interface FastenScope { identical: boolean; selected: boolean; pattern: boolean }
/** `selectedHoles`: the holes of the faces selected in the view; `patternHoles`: the holes of the pattern the picked hole belongs to (none when it is in no pattern). */
export function groupsFor(ref: FastenHole, all: FastenHole[], selectedHoles: FastenHole[] = [], patternHoles: FastenHole[] = []): FastenGroups {
  const identical = identicalHoles(all, ref).slice(1);
  const taken = new Set([ref.face, ...identical.map((h) => h.face)]);
  const pick = (list: FastenHole[]): FastenHole[] => {
    const out: FastenHole[] = [];
    for (const h of list) if (!taken.has(h.face)) { out.push(h); taken.add(h.face); }
    return out;
  };
  const selected = pick(selectedHoles);
  return { identical, selected, pattern: pick(patternHoles) };
}
/** What each hole in scope gets: the picked hole and the identical ones the dialog's choices; any other hole its own type, size and length from the hole, with the washer and nut choice where it can have them. */
export function resolveTargets(ref: FastenHole, params: FastenParams, groups: FastenGroups, scope: FastenScope): FastenTarget[] {
  const out: FastenTarget[] = [{ hole: ref, params }];
  if (scope.identical) for (const h of groups.identical) out.push({ hole: h, params });
  const others = [...(scope.selected ? groups.selected : []), ...(scope.pattern ? groups.pattern : [])];
  for (const h of others) {
    const d = defaultParams(h);
    const nut = params.nut && h.through && matchSize(h.diameter).fit === 'clearance';
    out.push({ hole: h, params: { ...d, nut, washer: h.kind === 'csink' ? 'none' : params.washer === 'both' && !nut ? 'head' : params.washer } });
  }
  return out;
}
/** The choices as they apply: a nut only where the hole can take one, a washer under the nut only with a nut, none on a countersunk mouth. */
export function effectiveParams(h: FastenHole, p: FastenParams): FastenParams {
  const nut = p.nut && nutAllowed(h) === null;
  const washer: WasherChoice = h.kind === 'csink' ? 'none' : p.washer === 'both' && !nut ? 'head' : p.washer;
  return { ...p, nut, washer };
}
/** Why a hole takes no nut, or null when it does: a blind hole has no far side, a tapped hole holds the bolt by its thread. */
export function nutAllowed(h: FastenHole): 'blind' | 'tap' | null {
  if (!h.through) return 'blind';
  return matchSize(h.diameter).fit === 'tap' ? 'tap' : null;
}

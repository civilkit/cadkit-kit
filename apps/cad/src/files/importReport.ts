// The import report: what became of each part of an imported file, as the kernel says it (`import.parts` of an importStep /
// importSldprt / importSkp reply, or the `importStepParts` warning of an importStep feature). A part is a valid solid, a
// surface body of the faces that were read (it needs repair before it can be modelled on as a solid), or refused; every
// part that is not a solid carries its reasons (a code, the faces concerned, plain words). Pure: no kernel, no DOM.

export type PartOutcome = 'solid' | 'surface' | 'refused';
export interface PartReason { code: string; faces: string[]; message: string }
export interface ImportPart {
  label: string;
  outcome: PartOutcome;
  /** faces that came in, and the faces the file gives the part */
  faces: number; facesTotal: number;
  /** id of the part's surface body (`<feature>.P<k>`), for a surface */
  surface?: string;
  reasons: PartReason[];
}

const OUTCOMES: readonly PartOutcome[] = ['solid', 'surface', 'refused'];

function partOf(x: unknown): ImportPart | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const outcome = OUTCOMES.includes(o.outcome as PartOutcome) ? (o.outcome as PartOutcome) : null;
  if (!outcome) return null;
  const reasons = Array.isArray(o.reasons) ? o.reasons.flatMap((r) => {
    if (!r || typeof r !== 'object') return [];
    const q = r as Record<string, unknown>;
    return [{ code: String(q.code ?? ''), faces: Array.isArray(q.faces) ? q.faces.map(String) : [], message: String(q.message ?? '') }];
  }) : [];
  return {
    label: String(o.label ?? ''), outcome,
    faces: typeof o.faces === 'number' ? o.faces : 0, facesTotal: typeof o.facesTotal === 'number' ? o.facesTotal : 0,
    ...(typeof o.surface === 'string' ? { surface: o.surface } : {}),
    reasons,
  };
}

/** The parts of a list as the kernel sends it (`import.parts`, `import.parts.list` for SketchUp, or a warning's `params.parts`). */
export function parseParts(raw: unknown): ImportPart[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { list?: unknown }).list) ? (raw as { list: unknown[] }).list : [];
  return list.flatMap((x) => { const p = partOf(x); return p ? [p] : []; });
}

/** How many parts came out each way. */
export function countParts(parts: readonly ImportPart[]): Record<PartOutcome, number> {
  const n = { solid: 0, surface: 0, refused: 0 };
  for (const p of parts) n[p.outcome]++;
  return n;
}

/** A part came in as a surface body: Repair Part can try to make it a solid. */
export const needsRepair = (parts: readonly ImportPart[]): boolean => parts.some((p) => p.outcome === 'surface');
/** Every part is a solid (nothing to report). */
export const allSolid = (parts: readonly ImportPart[]): boolean => parts.every((p) => p.outcome === 'solid');

type Tr = (key: string, params?: Record<string, string | number>) => string;

/** One line for a notice: "2 of 3 parts came in as solids; 1 as a surface body (needs repair)." */
export function importSummary(parts: readonly ImportPart[], tr: Tr): string {
  const n = countParts(parts);
  const bits = [tr('import.summary.solids', { n: n.solid, total: parts.length })];
  if (n.surface) bits.push(tr('import.summary.surfaces', { n: n.surface }));
  if (n.refused) bits.push(tr('import.summary.refused', { n: n.refused }));
  return bits.join(' ');
}

/** The row of a part in the report: its outcome in words and how many faces came in. */
const OUTCOME_KEY: Record<PartOutcome, string> = { solid: 'import.outcome.solid', surface: 'import.outcome.surface', refused: 'import.outcome.refused' };
export function partLine(p: ImportPart, tr: Tr): string {
  return tr(OUTCOME_KEY[p.outcome], { faces: p.faces, total: p.facesTotal });
}

/** The edit that repairs the surface bodies an importStep feature left: one undoable `repairPart` feature after it. */
export function repairOp(target: string, features: ReadonlyArray<{ id: string }>): { op: 'add'; feature: { type: 'repairPart'; id: string; target: string } } {
  const used = new Set(features.map((f) => f.id));
  let n = features.length + 1;
  while (used.has(`F${n}`)) n++;
  return { op: 'add', feature: { type: 'repairPart', id: `F${n}`, target } };
}

/** What a `repairReport` warning says, one line per surface body. */
export interface RepairLine { label: string; valid: boolean; rebuilt: number; sewn: number; patched: number; holesLeft: number; volume: number | null; remaining: PartReason[]; refused?: string }
export function parseRepairReport(params: unknown): RepairLine[] {
  const parts = params && typeof params === 'object' ? (params as { parts?: unknown }).parts : null;
  if (!Array.isArray(parts)) return [];
  return parts.flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const o = x as Record<string, unknown>;
    const holes = Array.isArray(o.holes) ? (o.holes as Array<{ patched?: boolean }>) : [];
    const refused = Array.isArray(o.refused) && o.refused.length ? String((o.refused[0] as { message?: unknown }).message ?? '') : undefined;
    return [{
      label: String(o.label ?? o.surface ?? ''), valid: o.valid === true,
      rebuilt: Array.isArray(o.rebuilt) ? o.rebuilt.length : 0, sewn: typeof o.sewn === 'number' ? o.sewn : 0,
      patched: holes.filter((h) => h.patched).length, holesLeft: holes.filter((h) => !h.patched).length,
      volume: typeof o.volume === 'number' ? o.volume : null,
      remaining: parseParts([{ outcome: 'surface', reasons: o.remaining }])[0]?.reasons ?? [],
      ...(refused !== undefined ? { refused } : {}),
    }];
  });
}

/** One line per repaired surface body for a notice. */
export function repairSummary(lines: readonly RepairLine[], tr: Tr): string[] {
  return lines.map((l) => l.refused !== undefined ? tr('import.repair.refused', { name: l.label, why: l.refused })
    : tr(l.valid ? 'import.repair.solid' : 'import.repair.partial', { name: l.label, rebuilt: l.rebuilt, sewn: l.sewn, patched: l.patched, left: l.holesLeft, why: l.remaining[0]?.message ?? '' }));
}

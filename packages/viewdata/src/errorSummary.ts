// Sorts the errors of one regeneration into the ROOT cause(s) and the CONSEQUENCES that follow from them.
//
// A parametric edit that breaks one feature usually breaks everything built on its result: a cut that finds no body,
// an edge that is gone, a fillet whose neighbours moved. The kernel reports every one of them; the first is the cause
// and the rest only bury it. This module is pure: it takes the error list and the feature list (document order) and
// says which errors stand on their own and which are blocked by an earlier failure.

export interface RegenErr { id: string; code: string; params?: Record<string, unknown>; hint?: string }
export interface DiagFeature { id: string; type?: string; name?: string; [k: string]: unknown }

export interface DiagRoot extends RegenErr {
  /** The feature's own name (or its type), for the summary line. */
  label: string;
  type?: string;
  /** A bearing seat pocket (a cut the Bearing wizard names "<bearing> seat") that now cuts nothing: 'fixed' when it was placed at absolute numbers (made before bearings followed their face, or placed by the numbers), 'face' when it is built from a face. */
  seat?: 'fixed' | 'face';
  /** A cut of a knurl (the Knurl wizard or knurl()) that now finds nothing to cut, the band lying past the end of the part: 'fixed' when it was placed at absolute numbers (a faceted band, or a knurl made before bands followed their end face), 'face' when it is built from an end face. */
  knurl?: 'fixed' | 'face';
  /** Ids of the consequences this root blocks, in document order. */
  blocks: string[];
}
export interface DiagConsequence extends RegenErr {
  label: string;
  type?: string;
  /** The root this error follows from. */
  blockedBy: string;
  /** `ref`: the feature references (directly or through others) a failed feature. `code`: the error itself is of the kind a missing earlier result causes. */
  via: 'ref' | 'code';
}
export interface Diagnosis {
  roots: DiagRoot[];
  consequences: DiagConsequence[];
  /** id -> root id for every consequence. */
  blockedBy: Record<string, string>;
  /** Every error, as given, in document order (the raw list). */
  all: RegenErr[];
}

/** Error codes that, after an earlier failure, are almost always the downstream echo of it: the body, face or edge they work on is no longer there. */
export const CONSEQUENCE_CODES: ReadonlySet<string> = new Set([
  'nothingToCut', 'cutNoEffect', 'missingReference', 'missingEdge', 'missingSketch', 'missingPath',
  'referenceLost', 'referenceChanged', 'noFaces', 'noBodies', 'ribNoContact', 'upToNextNone', 'noSeeds',
  'projectCurveMisses', 'projectCurveNoFaces', 'planeNotTangent',
]);

/** The codes of a cut that finds nothing to cut. */
const CUT_CODES: ReadonlySet<string> = new Set(['cutNoEffect', 'nothingToCut']);

const REF = /^(F\d+)(?:[.~]|$)/;
/** Feature ids a feature mentions anywhere in its fields (`sketch: "F1"`, `faces: ["F13.S.e4"]`, `base: {id: "F3"}`), except its own. */
export function refsOf(f: DiagFeature): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 8) return;
    if (typeof v === 'string') { const m = REF.exec(v); if (m && m[1] !== f.id) out.add(m[1]); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (depth === 0 && (k === 'id' || k === 'name')) continue; walk(x, depth + 1); }
  };
  walk(f, 0);
  return out;
}

/** The seat pocket of a bearing the wizard placed (named "... seat"), and whether its sketch plane comes from a face (built from the face) or from fixed numbers. */
function seatKind(f: DiagFeature | undefined, byId: Map<string, DiagFeature>): 'fixed' | 'face' | undefined {
  if (!f || f.type !== 'extrude' || f.op !== 'cut' || !/\bseat$/i.test(String(f.name ?? ''))) return undefined;
  const sk = byId.get(String(f.sketch));
  const plane = (sk?.plane ?? {}) as { kind?: string; id?: string };
  const pf = plane.kind === 'feature' ? (byId.get(String(plane.id)) as { base?: { kind?: string } } | undefined) : undefined;
  return plane.kind === 'face' || pf?.base?.kind === 'face' ? 'face' : 'fixed';
}

/**
 * The cut of a knurl: a faceted band (always at fixed numbers), or a feature that a knurl marker (`knurl: { ids }`, written by the wizard on its first feature)
 * lists, and whether the knurl is built from an end face (one of its planes is made from a face) or from fixed numbers.
 */
function knurlKind(f: DiagFeature | undefined, features: readonly DiagFeature[]): 'fixed' | 'face' | undefined {
  if (!f) return undefined;
  if (f.type === 'knurlBand') return 'fixed';
  const num = /^F(\d+)$/.exec(f.id)?.[1];
  if (!num) return undefined;
  const owner = features.find((g) => Array.isArray((g.knurl as { ids?: unknown } | undefined)?.ids) && ((g.knurl as { ids: unknown[] }).ids).includes(Number(num)));
  if (!owner) return undefined;
  const ids = new Set(((owner.knurl as { ids: number[] }).ids).map((n) => `F${n}`));
  return features.some((g) => ids.has(g.id) && g.type === 'plane' && (g.base as { kind?: string } | undefined)?.kind === 'face') ? 'face' : 'fixed';
}

export function diagnose(errors: readonly RegenErr[], features: readonly DiagFeature[]): Diagnosis {
  const index = new Map(features.map((f, i) => [f.id, i] as const));
  const byId = new Map(features.map((f) => [f.id, f] as const));
  const direct = new Map<string, Set<string>>();
  const refs = (id: string): Set<string> => {
    let r = direct.get(id);
    if (!r) { const f = byId.get(id); r = f ? refsOf(f) : new Set(); direct.set(id, r); }
    return r;
  };
  /** Everything a feature depends on, through any chain of references. */
  const closure = (id: string): Set<string> => {
    const seen = new Set<string>(); const stack = [id];
    while (stack.length) for (const d of refs(stack.pop()!)) if (!seen.has(d)) { seen.add(d); stack.push(d); }
    return seen;
  };
  const ordered = [...errors].sort((a, b) => (index.get(a.id) ?? Infinity) - (index.get(b.id) ?? Infinity));
  const labelOf = (e: RegenErr): string => { const f = byId.get(e.id); return String(f?.name ?? f?.type ?? e.id); };
  const roots: DiagRoot[] = [];
  const consequences: DiagConsequence[] = [];
  const rootOf = new Map<string, string>();   // failed id -> the root it traces back to
  for (const e of ordered) {
    const f = byId.get(e.id);
    const seat = CUT_CODES.has(e.code) ? seatKind(f, byId) : undefined;
    const knurl = CUT_CODES.has(e.code) && !seat ? knurlKind(f, features) : undefined;
    const base = { ...e, label: labelOf(e), type: f?.type, ...(seat ? { seat } : {}), ...(knurl ? { knurl } : {}) };
    let cause: string | undefined; let via: 'ref' | 'code' = 'ref';
    if (rootOf.size && f) {
      const deps = closure(e.id);
      for (const failed of rootOf.keys()) if (deps.has(failed)) { cause = rootOf.get(failed); break; }
      if (!cause && CONSEQUENCE_CODES.has(e.code)) { cause = roots[roots.length - 1]?.id; via = 'code'; }
    }
    if (cause) {
      consequences.push({ ...base, blockedBy: cause, via });
      rootOf.set(e.id, cause);
      roots.find((r) => r.id === cause)?.blocks.push(e.id);
    } else {
      roots.push({ ...base, blocks: [] });
      rootOf.set(e.id, e.id);
    }
  }
  const blockedBy: Record<string, string> = {};
  for (const c of consequences) blockedBy[c.id] = c.blockedBy;
  return { roots, consequences, blockedBy, all: ordered };
}

/** Errors the candidate has that the committed model did not have: a root whose feature is not already a failing root there. */
export function newBreakage(candidate: Diagnosis, committed: Diagnosis | null): DiagRoot[] {
  const had = new Set((committed?.roots ?? []).map((r) => r.id + ':' + r.code));
  return candidate.roots.filter((r) => !had.has(r.id + ':' + r.code));
}

/** Plain-language form of an error list (the raw text people copy into a bug report). */
export function rawErrorText(d: Diagnosis): string {
  return d.all.map((e) => `${e.id}: ${e.code}${e.params && Object.keys(e.params).length ? ' ' + JSON.stringify(e.params) : ''}${e.hint ? ' - ' + e.hint : ''}`).join('\n');
}

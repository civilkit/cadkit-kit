// Oracle helpers for the FCStd corpus (packages/fcstd/corpus): compare what our importer + kernel build with the numbers FreeCAD
// stored in `<model>.dump.json`, classify the outcome, report it, and gate it against `expected.json`. Pure functions (no kernel, no fs).

export type Cls = 'EXACT' | 'CLOSE' | 'APPROX' | 'MISMATCH' | 'UNSUPPORTED' | 'FAILED';
/** Best first. A model that moves right in this list is worse. An honest refusal (UNSUPPORTED, the importer says which feature) ranks above a build that is silently different (MISMATCH): the aim is exact can / cannot feedback. */
export const CLASSES: Cls[] = ['EXACT', 'CLOSE', 'APPROX', 'UNSUPPORTED', 'MISMATCH', 'FAILED'];
export const rank = (c: Cls) => CLASSES.indexOf(c);
export const worst = (cs: Cls[]): Cls => cs.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'EXACT' as Cls);
export const isGood = (c: Cls) => c === 'EXACT' || c === 'CLOSE';

/** Tolerances per class: relative for volume and area, millimetres (plus a rounding floor) for the centre of mass and the bounding box corners. */
export const TOL: Array<{ cls: Cls; rel: number; mm: number }> = [
  { cls: 'EXACT', rel: 1e-5, mm: 1e-5 },
  { cls: 'CLOSE', rel: 1e-3, mm: 1e-3 },
  { cls: 'APPROX', rel: 1e-2, mm: 1e-2 },
];

export interface Measure { volume: number | null; area: number | null; com: number[] | null; box: { min: number[]; max: number[] } | null; solids: number | null; faces: number | null }

/** A FreeCAD dump object's `shape` record as a Measure. */
export function measureOfDump(sh: any): Measure | null {
  if (!sh || sh.null || sh.datum) return null;
  return { volume: sh.volume ?? null, area: sh.area ?? null, com: sh.centerOfMass ?? null, box: sh.boundBox ?? null, solids: sh.solids ?? null, faces: sh.faces ?? null };
}

export interface Diff { vol: number | null; area: number | null; com: number | null; /** largest corner distance of the two boxes */ box: number | null; /** how far our box sticks out of FreeCAD's (FreeCAD's box of a curved shape is looser than the shape, ours is tight) */ boxOut: number | null; solids: [number, number] | null; faces: [number, number] | null }

const relErr = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

/** Differences of what we built (`got`) against FreeCAD's numbers (`want`). Missing quantities on either side are null (not compared). */
export function diffMeasures(got: Measure, want: Measure): Diff {
  const solid = (want.volume ?? 0) > 0;
  const vol = solid && got.volume != null && want.volume != null ? relErr(got.volume, want.volume) : null;
  const area = got.area != null && want.area != null && want.area > 0 ? relErr(got.area, want.area) : null;
  const com = got.com && want.com ? dist(got.com, want.com) : null;
  const box = got.box && want.box ? Math.max(dist(got.box.min, want.box.min), dist(got.box.max, want.box.max)) : null;
  const boxOut = got.box && want.box ? Math.max(0, ...got.box.min.map((v, i) => want.box!.min[i] - v), ...got.box.max.map((v, i) => v - want.box!.max[i])) : null;
  return {
    vol, area, com, box, boxOut,
    solids: got.solids != null && want.solids != null && got.solids !== want.solids ? [got.solids, want.solids] : null,
    faces: got.faces != null && want.faces != null && got.faces !== want.faces ? [got.faces, want.faces] : null,
  };
}

/**
 * The class of a Diff: the first row of TOL that holds every compared quantity, else MISMATCH. The box counts one-sided (ours must not
 * stick out of FreeCAD's: OCCT boxes of curved shapes are loose, so a tight box inside is no deviation; a wrong shape shows in volume and centre). A different solid count is a MISMATCH
 * whatever the numbers say. The face count is reported but does not change the class (our kernel splits periodic faces differently from OCCT).
 */
export function classify(d: Diff): Cls {
  if (d.solids) return 'MISMATCH';
  for (const t of TOL) {
    const ok = (d.vol ?? 0) <= t.rel && (d.area ?? 0) <= t.rel && (d.com ?? 0) <= t.mm + 1e-9 && (d.boxOut ?? 0) <= t.mm + 1e-9;
    if (ok) return t.cls;
  }
  return 'MISMATCH';
}

export const fmt = (v: number | null | undefined) => (v == null ? '-' : v === 0 ? '0' : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e5 ? v.toExponential(1) : v.toPrecision(3));

/** One-line text of what differs, for the report. */
export function describeDiff(d: Diff): string {
  const p: string[] = [];
  if (d.vol != null && d.vol > 1e-9) p.push(`vol ${fmt(d.vol)}`);
  if (d.area != null && d.area > 1e-9) p.push(`area ${fmt(d.area)}`);
  if (d.com != null && d.com > 1e-7) p.push(`com ${fmt(d.com)}mm`);
  if (d.boxOut != null && d.boxOut > 1e-7) p.push(`box out ${fmt(d.boxOut)}mm`);
  else if (d.box != null && d.box > 1e-4 && d.vol != null && d.vol > 1e-5) p.push(`box ${fmt(d.box)}mm`);
  if (d.solids) p.push(`solids ${d.solids[0]} vs ${d.solids[1]}`);
  if (d.faces) p.push(`faces ${d.faces[0]} vs ${d.faces[1]}`);
  return p.join(', ');
}

// ---- results ----

export interface FeatureRow { fc: string; cls: Cls; diff?: string }
export interface TargetResult {
  /** Body name (or Part object name) */
  name: string;
  kind: 'body' | 'part';
  cls: Cls;
  /** The first thing that is wrong, in words (which feature, which warning, which kernel error). */
  problem: string;
  /** Relative volume difference of the final shape (null when not compared). */
  volDiff: number | null;
  diff?: Diff;
  features?: FeatureRow[];
  /** Warnings the importer gave for this target (code:object). */
  warnings?: string[];
}
export interface VariantResult {
  /** (a) importing the .v1.FCStd directly matches the v1 dump */
  a: Cls | 'NA';
  /** (b) base file with the same parameter changed through the importer's parameters matches the v1 dump */
  b: Cls | 'NA';
  problemA?: string;
  problemB?: string;
  /** what the harness changed for (b) */
  change?: string;
}
export interface ModelResult {
  model: string;
  cls: Cls;
  problem: string;
  volDiff: number | null;
  targets: TargetResult[];
  variant?: VariantResult;
  note?: string;
}

export interface Expected {
  models: Record<string, Cls>;
  targets: Record<string, Cls>;
  variants: Record<string, { a: Cls | 'NA'; b: Cls | 'NA' }>;
  /** Models that must be EXACT or CLOSE; the set grows as fixes land. */
  mustBeGood: string[];
}

const vrank = (c: Cls | 'NA') => (c === 'NA' ? -1 : rank(c));

export interface GateReport { failures: string[]; improved: string[]; missing: string[] }

/** Compare results with expected.json: worse than expected or absent from the file fails, better is only noted. */
export function gate(results: ModelResult[], exp: Expected): GateReport {
  const failures: string[] = [], improved: string[] = [], missing: string[] = [];
  const cmp = (key: string, got: Cls, want: Cls | undefined) => {
    if (want === undefined) { missing.push(key); return; }
    if (rank(got) > rank(want)) failures.push(`${key}: ${got} is worse than expected ${want}`);
    else if (rank(got) < rank(want)) improved.push(`${key}: ${want} -> ${got}`);
  };
  for (const r of results) {
    cmp(r.model, r.cls, exp.models[r.model]);
    for (const t of r.targets) cmp(`${r.model}/${t.name}`, t.cls, exp.targets[`${r.model}/${t.name}`]);
    if (r.variant) {
      const e = exp.variants[r.model];
      for (const k of ['a', 'b'] as const) {
        const got = r.variant[k], want = e?.[k];
        if (want === undefined) { missing.push(`${r.model}.v1${k}`); continue; }
        if (got === 'NA' && want !== 'NA') failures.push(`${r.model}.v1${k}: lost (expected ${want})`);
        else if (got !== 'NA' && want === 'NA') improved.push(`${r.model}.v1${k}: NA -> ${got}`);
        else if (got !== 'NA' && want !== 'NA') cmp(`${r.model}.v1${k}`, got, want);
      }
    }
    if (exp.mustBeGood.includes(r.model) && !isGood(r.cls)) failures.push(`${r.model}: must be EXACT or CLOSE, is ${r.cls}`);
  }
  void vrank;
  return { failures, improved, missing };
}

export function expectedOf(results: ModelResult[], keep: Pick<Expected, 'mustBeGood'>): Expected {
  const exp: Expected = { models: {}, targets: {}, variants: {}, mustBeGood: keep.mustBeGood };
  for (const r of results) {
    exp.models[r.model] = r.cls;
    for (const t of r.targets) exp.targets[`${r.model}/${t.name}`] = t.cls;
    if (r.variant) exp.variants[r.model] = { a: r.variant.a, b: r.variant.b };
  }
  return exp;
}

export function totals(items: Cls[]): Record<Cls, number> {
  const t = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<Cls, number>;
  for (const c of items) t[c]++;
  return t;
}
export const totalsLine = (label: string, items: Cls[]) => {
  const t = totals(items);
  return `${label}: ${items.length} total, ${CLASSES.map((c) => `${t[c]} ${c}`).join(', ')}`;
};

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
export function resultsMarkdown(results: ModelResult[], meta: { freecad: string }): string {
  const L: string[] = [];
  L.push('# Importer oracle results', '');
  L.push(`Generated by \`corpus.kernel.test.ts\` with \`UPDATE_CORPUS=1\`. Oracle: FreeCAD ${meta.freecad} (\`generated/*.dump.json\`). Do not edit by hand.`, '');
  L.push('Class per model = the worst of its targets (every Body Tip; for models without a Body, every Part result object). Tolerances: EXACT = volume/area relative 1e-5 and centre of mass / bounding box 1e-5 mm; CLOSE 1e-3; APPROX 1e-2; MISMATCH = builds but differs (or a different solid count); UNSUPPORTED = the importer says which feature it cannot map; FAILED = importer or kernel error, or a silent drop (no warning names the missing feature). Face counts are shown but do not change the class.', '');
  L.push('- ' + totalsLine('models', results.map((r) => r.cls)));
  L.push('- ' + totalsLine('targets', results.flatMap((r) => r.targets.map((t) => t.cls))));
  const withV = results.filter((r) => r.variant);
  L.push(`- variants (${withV.length}): (a) v1 file direct: ${withV.filter((r) => r.variant!.a !== 'NA' && isGood(r.variant!.a)).length} EXACT/CLOSE; (b) same parameter changed on the base import: ${withV.filter((r) => r.variant!.b !== 'NA' && isGood(r.variant!.b)).length} EXACT/CLOSE, ${withV.filter((r) => r.variant!.b === 'NA').length} not attempted`, '');
  L.push('| model | class | vol diff | targets | v1 (a) | v1 (b) | first problem |', '|---|---|---|---|---|---|---|');
  for (const r of results) {
    const tc = totals(r.targets.map((t) => t.cls));
    const ts = CLASSES.filter((c) => tc[c]).map((c) => `${tc[c]} ${c}`).join(', ');
    L.push(`| ${r.model} | ${r.cls} | ${fmt(r.volDiff)} | ${ts} | ${r.variant?.a ?? '-'} | ${r.variant?.b ?? '-'} | ${esc(r.problem).slice(0, 300)} |`);
  }
  L.push('', '## Targets that are not EXACT', '', '| model / target | class | vol diff | problem |', '|---|---|---|---|');
  for (const r of results) for (const t of r.targets) if (t.cls !== 'EXACT') L.push(`| ${r.model} / ${t.name} | ${t.cls} | ${fmt(t.volDiff)} | ${esc(t.problem).slice(0, 300)} |`);
  return L.join('\n') + '\n';
}

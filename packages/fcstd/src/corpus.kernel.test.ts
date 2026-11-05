// The importer oracle: every model of packages/fcstd/corpus/generated (FreeCAD 1.1.4 documents plus FreeCAD's own measurements in
// `<model>.dump.json`) is imported with our importer, built with the kernel and compared with the stored shape of its Body Tip (or, for
// models without a Body, of each Part result object). The class each model reaches is gated by corpus/expected.json: worse fails, better
// passes with a note, a model missing from the file fails. `UPDATE_CORPUS=1` rewrites RESULTS.md / RESULTS.json / expected.json
// (written next to the corpus; also printed between @@ markers so a remote run can be collected, see tools/extract-results.mjs).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importFcstd, resolveReferences, type FcImport } from './import';
import { fcstdResolvers, type ResolveSession } from './resolve';
import { applyChange, diffDumps } from './corpusVariant';
import {
  type Cls, type Diff, type Expected, type FeatureRow, type Measure, type ModelResult, type TargetResult, type VariantResult,
  CLASSES, classify, describeDiff, diffMeasures, expectedOf, gate, isGood, measureOfDump, rank, resultsMarkdown, totalsLine, worst,
} from './corpusOracle';

const DIR = process.cwd() + '/packages/fcstd/corpus/';
const GEN = DIR + 'generated/';
const UPDATE = process.env.UPDATE_CORPUS === '1' || process.env.UPDATE_CORPUS === 'true';
const ONLY = (process.env.CORPUS_ONLY ?? '').split(',').filter(Boolean);

type Dump = any;
const readDump = (name: string): Dump => JSON.parse(readFileSync(GEN + name + '.dump.json', 'utf8'));
const readBytes = (name: string) => new Uint8Array(readFileSync(GEN + name + '.FCStd'));

// ---- building with the kernel ----

const resolvers = fcstdResolvers(async (part) => Session.open(part as unknown as PartDoc) as unknown as ResolveSession);

interface Built { measure?: Measure; error?: string }
async function build(part: FcImport['part']): Promise<Built> {
  let s: Session | undefined;
  try {
    s = await Session.open(part as unknown as PartDoc);
    const rep = await s.regenReport();
    if (rep.errors.length) {
      const [fid, err] = rep.errors[0] as [string, { code?: string; message?: string }];
      return { error: `kernel error in ${fid}: ${err.code ?? ''} ${err.message ?? ''}`.trim() };
    }
    const f = await s.facts();
    const m = await s.massProps();
    const area = typeof m.area === 'number' ? m.area : null;
    return { measure: { volume: f.volume, area, com: Array.isArray(m.com) ? m.com : null, box: f.box, solids: f.solids, faces: f.faces.length } };
  } catch (e) {
    return { error: `kernel exception: ${(e as Error).message}`.slice(0, 300) };
  } finally { await s?.close().catch(() => {}); }
}

/** The part with the features up to (and including) the last one of step `i`. */
function partUpTo(imp: FcImport, i: number): FcImport['part'] {
  const last = Math.max(...imp.steps[i].features.map((id) => imp.part.features.findIndex((x) => x.id === id)));
  return { ...imp.part, features: imp.part.features.slice(0, last + 1) };
}

const warnText = (imp: FcImport, names?: string[]) => imp.warnings.filter((w) => !names || names.includes(w.object)).map((w) => `${w.code}:${w.object}`);

// ---- targets ----

interface Target { name: string; kind: 'body' | 'part'; shape: Measure; chain: string[]; types: Record<string, string>; placed: boolean }

function targetsOf(dump: Dump): { targets: Target[]; extra: string[] } {
  const objs: any[] = dump.objects;
  const byName = new Map<string, any>(objs.map((o) => [o.name, o]));
  const types = Object.fromEntries(objs.map((o) => [o.name, o.typeId]));
  const out: Target[] = [];
  const bodies: any[] = dump.bodies;
  const inBody = new Set<string>(bodies.flatMap((b) => b.group));
  // what a Part or PartDesign object uses is consumed (groups, links and sketch supports do not consume)
  const consumed = new Set<string>(objs.filter((o) => /^(Part|PartDesign)::/.test(o.typeId)).flatMap((o) => o.outList));
  const roots = objs.filter((o) => o.typeId.startsWith('Part::') && o.shape && !o.shape.null && !consumed.has(o.name) && !inBody.has(o.name));
  for (const b of bodies) {
    const tip = byName.get(b.tip);
    const shape = tip && measureOfDump(tip.shape);
    if (!shape) continue;
    const upto = b.group.indexOf(b.tip);
    const chain: string[] = (upto >= 0 ? b.group.slice(0, upto + 1) : b.group).filter((n: string) => !/^(Sketcher::|PartDesign::(Plane|Line|Point|CoordinateSystem)$)/.test(types[n] ?? ''));
    const p = b.placement;
    const placed = !!p && (p.pos.some((v: number) => Math.abs(v) > 1e-9) || Math.abs(Math.abs(p.rot[3]) - 1) > 1e-9);
    out.push({ name: b.name, kind: 'body', shape, chain, types, placed });
  }
  // models without a Body are the Part workbench models: each result object is a target
  if (!bodies.length) for (const o of roots) out.push({ name: o.name, kind: 'part', shape: measureOfDump(o.shape)!, chain: [o.name], types, placed: false });
  return { targets: out, extra: bodies.length ? roots.map((o) => o.name) : [] };
}

/** Why a skipped feature was skipped, in words. */
const skipWhy = (imp: FcImport, fc: string, types: Record<string, string>) => {
  const w = imp.warnings.filter((x) => x.object === fc).map((x) => `${x.code}: ${x.message}`).join('; ');
  return `${fc} (${(types[fc] ?? '?').replace('PartDesign::', '')}): ${w || 'no reason given'}`;
};

async function evalTarget(bytes: Uint8Array, name: string, t: Target): Promise<TargetResult> {
  const res = (cls: Cls, problem: string, extra: Partial<TargetResult> = {}): TargetResult => ({ name: t.name, kind: t.kind, cls, problem, volDiff: null, ...extra });
  let imp: FcImport;
  try { imp = await resolveReferences(await importFcstd(bytes, name, t.kind === 'body' ? { body: t.name } : { object: t.name }), resolvers); } catch (e) { return res('FAILED', `importer threw: ${(e as Error).message}`.slice(0, 300)); }
  if (t.kind === 'part' && !imp.steps.length && !imp.skipped.includes(t.name)) {
    const named = imp.warnings.filter((w) => w.object === t.name);
    return named.length ? res('UNSUPPORTED', named.map((w) => `${w.code}: ${w.message}`).join('; ')) : res('FAILED', `silent: no importer warning names ${t.name} (${t.types[t.name]}); ${imp.warnings.map((w) => w.code).join(',') || 'no warnings'}`);
  }
  const wl = warnText(imp);
  const skippedInChain = t.chain.filter((n) => imp.skipped.includes(n));
  if (skippedInChain.length) return res('UNSUPPORTED', skippedInChain.map((n) => skipWhy(imp, n, t.types)).join(' | '), { warnings: wl });
  const stepNames = new Set(imp.steps.map((s) => s.fc));
  const silent = t.chain.filter((n) => !stepNames.has(n) && /^Part(Design)?::/.test(t.types[n] ?? ''));
  if (silent.length) return res('FAILED', `silent: ${silent.map((n) => `${n} (${t.types[n]})`).join(', ')} neither imported nor reported`, { warnings: wl });
  if (!imp.steps.length) return res('UNSUPPORTED', imp.warnings.map((w) => `${w.code}: ${w.message}`).join('; ') || 'nothing imported', { warnings: wl });
  const built = await build(imp.part);
  if (built.error || !built.measure) return res('FAILED', built.error ?? 'no result', { warnings: wl });
  const diff = diffMeasures(built.measure, t.shape);
  let cls = classify(diff);
  const extraSteps = imp.steps.filter((s) => !t.chain.includes(s.fc)).map((s) => s.fc);
  let problem = cls === 'EXACT' ? '' : describeDiff(diff);
  if (extraSteps.length) problem = `imports features after the Body Tip (${extraSteps.join(', ')}); ` + problem;
  let features: FeatureRow[] | undefined;
  if (cls !== 'EXACT' && imp.steps.length <= 14) {
    features = [];
    for (let i = 0; i < imp.steps.length; i++) {
      const o = (dumpOf.get(name) as Dump | undefined)?.objects.find((x: any) => x.name === imp.steps[i].fc);
      const want = o && measureOfDump(o.shape);
      if (!want) continue;
      const b = await build(partUpTo(imp, i));
      if (!b.measure) { features.push({ fc: imp.steps[i].fc, cls: 'FAILED', diff: b.error }); continue; }
      const d = diffMeasures(b.measure, want);
      features.push({ fc: imp.steps[i].fc, cls: classify(d), diff: describeDiff(d) });
    }
    const bad = features.find((f) => !isGood(f.cls));
    if (bad) problem = `first deviating feature ${bad.fc} (${bad.cls}: ${bad.diff}); ` + problem;
  }
  const nonExact = imp.warnings.filter((w) => !['unsupportedFeature'].includes(w.code) && t.chain.includes(w.object)).map((w) => `${w.code}: ${w.message}`);
  if (cls !== 'EXACT' && nonExact.length) problem += ` [importer notes: ${nonExact.join('; ').slice(0, 240)}]`;
  if (cls === 'EXACT' && t.placed) problem = '';
  void rank;
  return res(cls, problem.trim(), { volDiff: diff.vol, diff, features, warnings: wl });
}

const dumpOf = new Map<string, Dump>();

async function evalModelFile(bytes: Uint8Array, name: string, dump: Dump): Promise<{ targets: TargetResult[]; cls: Cls; problem: string; volDiff: number | null; extra: string[] }> {
  dumpOf.set(name, dump);
  const { targets, extra } = targetsOf(dump);
  const results: TargetResult[] = [];
  for (const t of targets) results.push(await evalTarget(bytes, name, t));
  if (!results.length) return { targets: results, cls: 'FAILED', problem: 'the dump has no Body Tip or Part result to compare', volDiff: null, extra };
  const cls = worst(results.map((r) => r.cls));
  const firstBad = results.find((r) => r.cls === cls && cls !== 'EXACT');
  const vols = results.map((r) => r.volDiff).filter((v): v is number => v != null);
  return { targets: results, cls, problem: firstBad ? `${firstBad.name}: ${firstBad.problem}` : '', volDiff: vols.length ? Math.max(...vols) : null, extra };
}

// ---- the corpus ----

const models = readdirSync(GEN).filter((f) => f.endsWith('.FCStd') && !f.includes('.v1.')).map((f) => f.slice(0, -6)).sort()
  .filter((m) => !ONLY.length || ONLY.some((o) => m.startsWith(o)));
const results: ModelResult[] = [];
const expPath = DIR + 'expected.json';
const expected: Expected = existsSync(expPath) ? JSON.parse(readFileSync(expPath, 'utf8')) : { models: {}, targets: {}, variants: {}, mustBeGood: [] };

async function evalVariant(name: string, base: ModelResult): Promise<VariantResult | undefined> {
  if (!existsSync(GEN + name + '.v1.FCStd')) return undefined;
  const v1 = readDump(name + '.v1');
  // (a) the v1 file imported directly
  const a = await evalModelFile(readBytes(name + '.v1'), name + '.v1', v1);
  // (b) the base file with the same parameter changed through the importer's parameters
  const ch = diffDumps(readDump(name), v1);
  const out: VariantResult = { a: a.cls, b: 'NA', problemA: a.problem, change: ch.map((c) => `${c.object}.${c.prop}`).join(', ') };
  const applied = await evalVariantB(name, ch, v1);
  out.b = applied.cls; out.problemB = applied.problem;
  void base;
  return out;
}

async function evalVariantB(name: string, ch: ReturnType<typeof diffDumps>, v1: Dump): Promise<{ cls: Cls | 'NA'; problem: string }> {
  if (!ch.length) return { cls: 'NA', problem: 'no parameter change found in the dumps' };
  const bytes = readBytes(name);
  const { targets } = targetsOf(v1);
  const cl: Cls[] = []; const why: string[] = [];
  for (const t of targets) {
    let imp: FcImport;
    try { imp = await resolveReferences(await importFcstd(bytes, name, t.kind === 'body' ? { body: t.name } : { object: t.name }), resolvers); } catch (e) { return { cls: 'FAILED', problem: (e as Error).message }; }
    const skipped = t.chain.filter((n) => imp.skipped.includes(n));
    if (skipped.length) { cl.push('UNSUPPORTED'); why.push(`${t.name}: ${skipped.join(',')} not imported`); continue; }
    // a change belongs to the Body that holds the object; changes to global objects (spreadsheets, VarSets) apply where the Body uses them.
    // A Part result object needs a parameter for the changes to itself and takes the others where it has them.
    const ownerOf = (obj: string): string | undefined => (v1.bodies as any[]).find((b) => b.name === obj || b.group.includes(obj))?.name;
    const mine = t.kind === 'body' ? ch.filter((c) => { const ow = ownerOf(c.object); return !ow || ow === t.name; }) : ch;
    const applied = applyChange(imp, mine, (c) => (t.kind === 'body' ? !ownerOf(c.object) : c.object !== t.name));
    if (!applied.ok) { return { cls: 'NA', problem: applied.why }; }
    const b = await build(imp.part);
    if (!b.measure) { cl.push('FAILED'); why.push(`${t.name}: ${b.error}`); continue; }
    const d = diffMeasures(b.measure, t.shape);
    const c = classify(d); cl.push(c); if (c !== 'EXACT') why.push(`${t.name}: ${describeDiff(d)}`);
  }
  return cl.length ? { cls: worst(cl), problem: why.join(' | ') } : { cls: 'NA', problem: 'no body target' };
}

describe('FCStd corpus oracle', { skip: !process.env.CK_WASM }, () => {
  for (const name of models) {
    it(name, async () => {
      const dump = readDump(name);
      const m = await evalModelFile(readBytes(name), name, dump);
      const r: ModelResult = { model: name, cls: m.cls, problem: m.problem, volDiff: m.volDiff, targets: m.targets, note: m.extra.length ? `Part objects not compared in a Body model: ${m.extra.join(', ')}` : undefined };
      r.variant = await evalVariant(name, r);
      results.push(r);
      console.log(`${name}: ${r.cls}${r.variant ? ` v1 a=${r.variant.a} b=${r.variant.b}` : ''} ${r.problem.slice(0, 160)}`);
      if (!UPDATE) {
        const g = gate([r], expected);
        expect(g.failures, g.failures.join('\n')).toEqual([]);
        expect(g.missing, `not in corpus/expected.json (run with UPDATE_CORPUS=1): ${g.missing.join(', ')}`).toEqual([]);
        if (g.improved.length) console.log('IMPROVED (update expected.json): ' + g.improved.join('; '));
      }
    }, 600000);
  }

  it('summary, gate and report', () => {
    const line = totalsLine('FCStd corpus models', results.map((r) => r.cls));
    console.log('\n' + line + '\n' + totalsLine('FCStd corpus targets', results.flatMap((r) => r.targets.map((t) => t.cls))));
    const v = results.filter((r) => r.variant);
    console.log(`variants: ${v.length}; (a) EXACT/CLOSE ${v.filter((r) => r.variant!.a !== 'NA' && isGood(r.variant!.a)).length}; (b) EXACT/CLOSE ${v.filter((r) => r.variant!.b !== 'NA' && isGood(r.variant!.b)).length}`);
    if (UPDATE) {
      const meta = { freecad: String(readDump(models[0]).freecad?.version ?? '?') };
      const md = resultsMarkdown(results, meta);
      const json = JSON.stringify({ generatedBy: 'corpus.kernel.test.ts', freecad: meta.freecad, totals: Object.fromEntries(CLASSES.map((c) => [c, results.filter((r) => r.cls === c).length])), models: results }, null, 1);
      const exp = expectedOf(results, { mustBeGood: expected.mustBeGood });
      if (!ONLY.length) {
        writeFileSync(DIR + 'RESULTS.md', md); writeFileSync(DIR + 'RESULTS.json', json + '\n'); writeFileSync(expPath, JSON.stringify(exp, null, 1) + '\n');
      }
      console.log('@@RESULTS_MD@@\n' + md + '@@END@@\n@@RESULTS_JSON@@\n' + json + '\n@@END@@\n@@EXPECTED_JSON@@\n' + JSON.stringify(exp, null, 1) + '\n@@END@@');
    } else if (!ONLY.length) {
      const g = gate(results, expected);
      if (g.improved.length) console.log('NOTE: better than expected.json says (run UPDATE_CORPUS=1 to record): ' + g.improved.join('; '));
      expect(g.failures).toEqual([]);
      expect(g.missing).toEqual([]);
      expect(results.length).toBe(models.length);
    }
  }, 60000);
});

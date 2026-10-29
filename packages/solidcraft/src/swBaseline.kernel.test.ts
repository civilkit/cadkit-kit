// Baseline of SolidWorks (.sldprt) routes against a folder of converted files (SW_BASELINE_OUT, written by a conversion script that leaves
// status.tsv (file, route, exit code, seconds), solidcraft/<id>.solidcraft and ckpart/<id>.ckpart, with <id> the path of the source file with
// "/" and " " turned into "_") and the source files (SW_CORPUS, the folder the paths in status.tsv are relative to). Skipped when either is unset.
// Per source file: (a) the kernel's direct .sldprt import, (e) the reference STEP when one sits beside it, (c) the .solidcraft through the
// importer and a regeneration, (d) the .ckpart regenerated as it is, (f) the STEP Dutchman wrote beside the part. One shared kernel.
// Writes SW_BASELINE_JSON (default ~/sw-baseline.json) after every file and a progress line to SW_BASELINE_LOG.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createWorkerKernel } from '@ck/kernel-client/node';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraft, type ScPart } from './import';
import { kernelResolvers, kernelStepTools } from './kernelResolvers';
import { sldprtAsPart } from '../../../apps/cad/src/files/sldprtImport';

const WASM = process.env.CK_WASM!;
const OUT = process.env.SW_BASELINE_OUT ?? '';
const CORPUS = process.env.SW_CORPUS ?? '';
const LOG = process.env.SW_BASELINE_LOG ?? join(tmpdir(), 'sw-baseline-progress.log');
const JSON_OUT = process.env.SW_BASELINE_JSON ?? join(tmpdir(), 'sw-baseline.json');
const LIMIT_MS = 120_000;
const only = process.env.SW_ONLY;   // a substring: run only the files whose path has it
const status = OUT && CORPUS && existsSync(join(OUT, 'status.tsv')) ? readFileSync(join(OUT, 'status.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
const rels = [...new Set(status.map((r) => r[0]))].filter((r) => !only || r.includes(only));
const idOf = (rel: string) => rel.replace(/[/ ]/g, '_');

type Kernel = Awaited<ReturnType<typeof createWorkerKernel>>;
interface Box { min: number[]; max: number[] }
interface Measure { swVolume?: number | null; approx?: number; ok: boolean; errors?: string; faces?: number; volume?: number | null; area?: number | null; box?: Box | null; bodies?: number; seconds?: number; validateIssues?: number | null }
interface Rec {
  file: string; kb: number;
  direct?: Measure; editable?: Measure & { code?: string; fallback?: boolean }; ref?: Measure; companion?: Measure;
  sc?: Measure & { refused?: string; rows?: number; converted?: number; unsupported?: number; skipped?: number; features?: number; reasons?: Record<string, number>; types?: Record<string, string> };
  ck?: Measure & { features?: number; types?: Record<string, number>; placeholders?: number; mapped?: number; importSteps?: number; bodyVolumes?: Array<number | null> };
}
const log = (s: string) => { try { appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${s}\n`); } catch { /* convenience */ } };
const normalise = (type: string, reason: string) => `${type}: ${reason.replace(/"[^"]*"/g, '"_"').replace(/-?\d+(\.\d+)?/g, 'N').slice(0, 120)}`;
const race = <T>(p: Promise<T>, ms: number) => new Promise<T | 'timeout'>((res, rej) => { const t = setTimeout(() => res('timeout'), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Regenerate / import reply -> measures (faces, box) and the mass properties of the tag. */
async function measure(k: Kernel, tag: string, reply: { ok?: boolean; trap?: unknown; error?: unknown; result?: unknown }, seconds: number): Promise<Measure> {
  const res = (reply.result ?? {}) as { errors?: Array<[string, { code?: string }]>; body?: { faces?: unknown[]; box?: Box } | null };
  const m: Measure = { ok: !!reply.ok && !reply.trap, seconds };
  if (reply.trap || !reply.ok) { m.errors = String(reply.trap ?? JSON.stringify(reply.error) ?? 'failed').slice(0, 200); return m; }
  if (res.errors?.length) m.errors = res.errors.slice(0, 3).map(([id, e]) => `${id} ${e.code}`).join(', ') + (res.errors.length > 3 ? ` (+${res.errors.length - 3})` : '');
  m.faces = res.body?.faces?.length ?? 0; m.box = res.body?.box ?? null;
  const mp = await k.request({ type: 'massProps', tag, bodies: true });
  const x = (mp.ok && mp.result ? mp.result : {}) as { volume?: number; area?: number; bodies?: unknown[] };
  m.volume = typeof x.volume === 'number' ? x.volume : null; m.area = typeof x.area === 'number' ? x.area : null; m.bodies = Array.isArray(x.bodies) ? x.bodies.length : 0;
  return m;
}

describe('SolidWorks baseline', { skip: !process.env.CK_WASM || !rels.length, timeout: 3_000_000 }, () => {
  const recs: Rec[] = [];
  let kernel: Kernel | null = null;
  afterAll(async () => { await kernel?.close().catch(() => {}); });

  it('measures every route for every file', async () => {
    writeFileSync(LOG, `${rels.length} files\n`);
    for (const [i, rel] of rels.entries()) {
      const id = idOf(rel);
      const src = join(CORPUS, rel);
      const rec: Rec = { file: rel, kb: Math.round(readFileSync(src).length / 1024) };
      log(`[${i + 1}/${rels.length}] ${rel}`);
      const step = async <T>(f: (k: Kernel) => Promise<T>): Promise<T | undefined> => {
        try { kernel ??= await createWorkerKernel(WASM); const r = await race(f(kernel), LIMIT_MS); if (r === 'timeout') { await kernel.close().catch(() => {}); kernel = null; return undefined; } return r; }
        catch (e) { log(`  crash ${String((e as Error).message).slice(0, 150)}`); await kernel?.close().catch(() => {}); kernel = null; return undefined; }
      };
      // (a) direct import of the .sldprt
      rec.direct = await step(async (k) => {
        const t0 = performance.now();
        const b64 = readFileSync(src).toString('base64');
        const rep = await k.request({ type: 'importSldprt', tag: `d${i}`, name: 'p', data: b64 });
        const m = await measure(k, `d${i}`, rep as never, r3((performance.now() - t0) / 1000));
        const info = ((rep as { result?: { import?: { swMassProps?: { volumeMm3?: number } | null; approximations?: unknown[] } } }).result?.import) ?? {};
        m.swVolume = info.swMassProps?.volumeMm3 ?? null; m.approx = info.approximations?.length ?? 0;
        return m;
      }) ?? { ok: false, errors: 'timeout or crash' };
      // (a2) the app's way: the direct import held by a part as an importStep feature (editable body)
      rec.editable = await step(async (k) => {
        const t0 = performance.now();
        const r = await sldprtAsPart(k as never, new Uint8Array(readFileSync(src)), 'p');
        if (!r.ok) return { ok: false, code: r.code, errors: r.message.slice(0, 120), fallback: !!r.fallback, seconds: r3((performance.now() - t0) / 1000) };
        const rep = await k.request({ type: 'regen', tag: `e${i}`, part: r.part, opts: { noView: true } });
        return measure(k, `e${i}`, rep as never, r3((performance.now() - t0) / 1000));
      }) ?? { ok: false, errors: 'timeout or crash' };
      // (e) reference STEP beside the source
      const sibling = readdirSync(dirname(src)).find((n) => /\.(step|stp)$/i.test(n));
      if (sibling) rec.ref = await step(async (k) => {
        const t0 = performance.now();
        const rep = await k.request({ type: 'importStep', tag: `r${i}`, data: readFileSync(join(dirname(src), sibling), 'utf8') });
        return measure(k, `r${i}`, rep as never, r3((performance.now() - t0) / 1000));
      }) ?? { ok: false, errors: 'timeout or crash' };
      // (c) solidcraft through the importer
      const scPath = join(OUT, 'solidcraft', `${id}.solidcraft`);
      if (existsSync(scPath)) {
        const sc = await step(async (k) => {
          const t0 = performance.now();
          const open = async (part: ScPart) => new Session(part as unknown as PartDoc, k as never, 'import', 'import-scratch');
          const r = await importSolidcraft(new Uint8Array(readFileSync(scPath)), id, { ...kernelResolvers(open), ...(process.env.SW_PLAIN ? {} : kernelStepTools(async () => k as never)) });   // SW_PLAIN=1: the importer as it was, for the before numbers
          if (!r.part) return { ok: false, refused: r.refused, seconds: r3((performance.now() - t0) / 1000) } as NonNullable<Rec['sc']>;
          const reasons: Record<string, number> = {}; const types: Record<string, string> = {};
          for (const x of r.rows) { types[x.type] = types[x.type] === 'unsupported' ? 'unsupported' : x.status; if (x.status === 'unsupported') { const key = normalise(x.type, x.reason ?? '?'); reasons[key] = (reasons[key] ?? 0) + 1; } }
          const rep = await k.request({ type: 'regen', tag: `s${i}`, part: r.part, opts: { noView: true } });
          const m = await measure(k, `s${i}`, rep as never, r3((performance.now() - t0) / 1000));
          if (m.ok && m.bodies) { const v = await race(new Session(r.part as unknown as PartDoc, k as never, 'import', `s${i}`).validate(), 60_000); m.validateIssues = v === 'timeout' ? null : v.issues.length; }
          return { ...m, rows: r.rows.length, converted: r.summary.converted, unsupported: r.summary.unsupported, skipped: r.summary.skipped, features: r.part.features.length, reasons, types };
        });
        rec.sc = sc ?? { ok: false, errors: 'timeout or crash' };
      }
      // (d) the ckpart as it is, (f) the STEP written beside it
      const ckPath = join(OUT, 'ckpart', `${id}.ckpart`);
      if (existsSync(ckPath)) {
        const ck = await step(async (k) => {
          const t0 = performance.now();
          const part = JSON.parse(readFileSync(ckPath, 'utf8')) as ScPart;
          const types: Record<string, number> = {};
          for (const f of part.features) types[String(f.type)] = (types[String(f.type)] ?? 0) + 1;
          const rep = await k.request({ type: 'regen', tag: `c${i}`, part, opts: { noView: true } });
          const m = await measure(k, `c${i}`, rep as never, r3((performance.now() - t0) / 1000));
          const mp = await k.request({ type: 'massProps', tag: `c${i}`, bodies: true });
          const bodies = ((mp.result ?? {}) as { bodies?: Array<{ volume?: number }> }).bodies ?? [];
          const placeholders = types.placeholder ?? 0, planes = types.plane ?? 0;
          return { ...m, features: part.features.length, types, placeholders, importSteps: types.importStep ?? 0, mapped: part.features.length - placeholders - planes - (types.importStep ?? 0), bodyVolumes: bodies.map((b) => (typeof b.volume === 'number' ? b.volume : null)) };
        });
        rec.ck = ck ?? { ok: false, errors: 'timeout or crash' };
      }
      const compPath = join(OUT, 'ckpart', `${id}.step`);
      if (existsSync(compPath)) rec.companion = await step(async (k) => {
        const t0 = performance.now();
        const rep = await k.request({ type: 'importStep', tag: `f${i}`, data: readFileSync(compPath, 'utf8') });
        return measure(k, `f${i}`, rep as never, r3((performance.now() - t0) / 1000));
      }) ?? { ok: false, errors: 'timeout or crash' };
      recs.push(rec);
      writeFileSync(JSON_OUT, JSON.stringify(recs, null, 1));
      log(`  direct ${rec.direct?.ok ? `${rec.direct.faces}f v${rec.direct.volume}` : 'FAIL'} ref ${rec.ref ? rec.ref.volume : '-'} sc ${rec.sc ? (rec.sc.refused ? 'refused' : `v${rec.sc.volume}`) : '-'} ck ${rec.ck ? `v${rec.ck.volume}` : '-'}`);
    }
    log('done');
    expect(recs.length).toBe(rels.length);
  });
});

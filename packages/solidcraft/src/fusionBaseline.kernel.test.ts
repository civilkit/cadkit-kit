// The importer against a folder of real .solidcraft files (FUSION_BASELINE_DIR, default ~/ci-cad/dutchman-baseline-out/solidcraft; skipped when absent):
// each is imported with ONE shared kernel and one scratch tag as the app does it, then the part is regenerated without a view
// (and validated when it has fewer than 300 features: validate is very slow on big parts). Prints a table and the aggregates, appends
// a progress line per file to FUSION_BASELINE_LOG (default ~/fusion-baseline-progress.log) and writes the records as JSON to FUSION_BASELINE_JSON.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createWorkerKernel } from '@ck/kernel-client/node';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraft, type ScPart } from './import';
import { kernelResolvers } from './kernelResolvers';

const WASM = process.env.CK_WASM!;
const DIR = process.env.FUSION_BASELINE_DIR ?? join(homedir(), 'ci-cad', 'dutchman-baseline-out', 'solidcraft');
const LOG = process.env.FUSION_BASELINE_LOG ?? join(homedir(), 'fusion-baseline-progress.log');
const OUT = process.env.FUSION_BASELINE_JSON ?? join(homedir(), 'fusion-baseline.json');
const LIMIT_MS = 120_000, VALIDATE_BELOW = 300;
// names are kept as bytes: a file name that is not valid UTF-8 (a Latin-1 accent) cannot be opened through a string
const names = existsSync(DIR) ? readdirSync(DIR, { encoding: 'buffer' }).filter((b) => b.toString('latin1').endsWith('.solidcraft')).sort(Buffer.compare) : [];
const files = names.map((b) => b.toString('latin1'));
const pathOf = (i: number) => Buffer.concat([Buffer.from(`${DIR}/`), names[i]]);

type Kernel = Awaited<ReturnType<typeof createWorkerKernel>>;
interface Rec {
  file: string; kb: number; status: 'refused' | 'imported' | 'crash' | 'timeout'; detail?: string;
  sourceFeatures?: number; features?: number; converted?: number; unsupported?: number; skipped?: number; reasons?: Record<string, number>;
  kernelErrors?: number; errorSample?: string; volume?: number | null; bodies?: number; validateIssues?: number | null; seconds: number; regenSeconds?: number;
}
const log = (s: string) => { try { appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${s}\n`); } catch { /* the log is a convenience */ } };
/** The reason with the names, numbers and ids of this particular file taken out, so equal causes count together. */
const normalise = (type: string, reason: string) => `${type}: ${reason.replace(/"[^"]*"/g, '"_"').replace(/\b[A-Z]\d+(\.\d+)?\b/g, 'ID').replace(/-?\d+(\.\d+)?/g, 'N').slice(0, 110)}`;
const race = <T>(p: Promise<T>, ms: number) => new Promise<T | 'timeout'>((res, rej) => { const t = setTimeout(() => res('timeout'), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });

describe('Fusion 360 baseline', { skip: !process.env.CK_WASM || !files.length, timeout: 3_000_000 }, () => {
  const recs: Rec[] = [];
  let kernel: Kernel | null = null;
  afterAll(async () => { await kernel?.close().catch(() => {}); });

  it('imports every file and regenerates the part', async () => {
    writeFileSync(LOG, `${files.length} files in ${DIR}\n`);
    for (const [i, f] of files.entries()) {
      const t0 = performance.now();
      const rec: Rec = { file: f.replace(/\.f3[dz]\.solidcraft$/, ''), kb: Math.round(statSync(pathOf(i)).size / 1024), status: 'imported', seconds: 0 };
      log(`[${i + 1}/${files.length}] start ${rec.file} ${rec.kb} KB`);
      try {
        kernel ??= await createWorkerKernel(WASM);
        const k = kernel;
        const tag = `fusion-${i}`;
        const open = async (part: ScPart) => new Session(part as unknown as PartDoc, k as never, 'import', 'import-scratch');
        const ctl = new AbortController();
        const bytes = new Uint8Array(readFileSync(pathOf(i)));
        const r = await race(importSolidcraft(bytes, rec.file, { ...kernelResolvers(open), signal: ctl.signal }), LIMIT_MS);
        if (r === 'timeout') {
          ctl.abort();
          rec.status = 'timeout'; rec.detail = `import over ${LIMIT_MS / 1000} s`;
          await kernel.close().catch(() => {}); kernel = null;   // the abort is only seen between features: a call stuck in the kernel needs a new one
        } else if (!r.part) {
          rec.status = 'refused'; rec.detail = r.refused;
        } else {
          rec.sourceFeatures = r.rows.length; rec.features = r.part.features.length;
          rec.converted = r.summary.converted; rec.unsupported = r.summary.unsupported; rec.skipped = r.summary.skipped;
          rec.reasons = {};
          for (const x of r.rows) if (x.status === 'unsupported') { const key = normalise(x.type, x.reason ?? '?'); rec.reasons[key] = (rec.reasons[key] ?? 0) + 1; }
          const t1 = performance.now();
          const regen = await race(k.request({ type: 'regen', tag, part: r.part, opts: { noView: true } }), LIMIT_MS);
          if (regen === 'timeout') { rec.status = 'timeout'; rec.detail = `regen over ${LIMIT_MS / 1000} s`; await kernel.close().catch(() => {}); kernel = null; }
          else {
            const res = (regen.result ?? {}) as { errors?: Array<[string, { code?: string }]> };
            if (regen.trap || !regen.ok) { rec.kernelErrors = 1; rec.errorSample = String(regen.trap ?? regen.error ?? 'regen failed').slice(0, 120); }
            else { rec.kernelErrors = res.errors?.length ?? 0; if (res.errors?.length) rec.errorSample = res.errors.slice(0, 2).map(([id, e]) => `${id} ${e.code}`).join(', '); }
            const mp = await k.request({ type: 'massProps', tag, bodies: true });
            const m = (mp.ok && mp.result ? mp.result : {}) as { volume?: number; bodies?: unknown[] };
            rec.volume = typeof m.volume === 'number' ? m.volume : null; rec.bodies = Array.isArray(m.bodies) ? m.bodies.length : 0;
            if (rec.features! < VALIDATE_BELOW && rec.bodies) {
              const v = await race(new Session(r.part as unknown as PartDoc, k as never, 'import', tag).validate(), LIMIT_MS);
              rec.validateIssues = v === 'timeout' ? null : v.issues.length;
            }
            rec.regenSeconds = Math.round((performance.now() - t1) / 100) / 10;
          }
        }
      } catch (e) {
        rec.status = 'crash'; rec.detail = String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ').slice(0, 300);
        await kernel?.close().catch(() => {}); kernel = null;
      }
      rec.seconds = Math.round((performance.now() - t0) / 100) / 10;
      recs.push(rec);
      writeFileSync(OUT, JSON.stringify(recs, null, 1));
      log(`[${i + 1}/${files.length}] ${rec.status} ${rec.file} conv ${rec.converted ?? '-'} unsup ${rec.unsupported ?? '-'} kerr ${rec.kernelErrors ?? '-'} vol ${rec.volume ?? '-'} ${rec.seconds}s ${rec.detail ?? ''}`);
    }
    const imp = recs.filter((r) => r.status === 'imported');
    const clean = imp.filter((r) => !r.unsupported && !r.kernelErrors);
    const reasons = new Map<string, number>();
    for (const r of imp) for (const [k2, n] of Object.entries(r.reasons ?? {})) reasons.set(k2, (reasons.get(k2) ?? 0) + n);
    const table = recs.map((r) => `${r.file.slice(0, 60).padEnd(60)} ${String(r.kb).padStart(5)}KB ${r.status.padEnd(8)} feat ${String(r.features ?? '-').padStart(4)} conv ${String(r.converted ?? '-').padStart(4)} unsup ${String(r.unsupported ?? '-').padStart(4)} kerr ${String(r.kernelErrors ?? '-').padStart(3)} vol ${r.volume == null ? '-' : r.volume.toFixed(1)} bodies ${r.bodies ?? '-'} ${r.seconds}s ${r.detail ?? ''}`);
    const out = [...table, '',
      `files ${recs.length}: imported ${imp.length}, refused ${recs.filter((r) => r.status === 'refused').length}, crash ${recs.filter((r) => r.status === 'crash').length}, timeout ${recs.filter((r) => r.status === 'timeout').length}`,
      `imported with no unsupported row: ${imp.filter((r) => !r.unsupported).length}; regenerating with no kernel errors: ${imp.filter((r) => !r.kernelErrors).length}; both: ${clean.length}`,
      `rows converted ${imp.reduce((a, r) => a + (r.converted ?? 0), 0)}, unsupported ${imp.reduce((a, r) => a + (r.unsupported ?? 0), 0)}`,
      'top reasons:', ...[...reasons].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k2, n]) => `  ${n}  ${k2}`)];
    log('done');
    console.log('\nFUSION BASELINE\n' + out.join('\n'));
    expect(recs.filter((r) => r.status === 'crash')).toEqual([]);
  });
});

// Where the time of a big SolidCraft import goes: the importer's questions to the kernel (each regenerates the part built so far) against
// the importer's own work, and the cost of the questions as the part grows. Reads PROFILE_INPUT (default .prof/input.solidcraft) and prints a table.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { zipFile } from '@kit/fcstd';
import { createWorkerKernel } from '@ck/kernel-client/node';
import { importSolidcraftDocument, type ScPart } from './import';
import { kernelResolvers } from './kernelResolvers';

const FILE = process.env.PROFILE_INPUT ?? join(process.cwd(), '.prof', 'input.solidcraft');
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('import profile', { skip: !process.env.CK_WASM || !existsSync(FILE), timeout: 3_000_000 }, () => {
  // The first N features of the file, for growing N, each with a time limit: how the cost of an import grows with its size, and
  // how far a slice gets when it runs out of time (the whole file may take longer than any single run is allowed).
  it('prints the time split for growing slices', async () => {
    // a .solidcraft file is a zip holding document.json (older ones are the JSON itself)
    const bytes = new Uint8Array(readFileSync(FILE));
    const raw = bytes[0] === 0x50 && bytes[1] === 0x4b ? await zipFile(bytes, 'document.json') : bytes;
    const doc = JSON.parse(new TextDecoder().decode(raw ?? new Uint8Array())) as { features: unknown[] };
    const total = doc.features.length;
    const out: string[] = [`file features ${total}`, 'slice | features done | seconds | kernel questions | kernel s | mean ms per question (last quarter)'];
    const slices = process.env.PROFILE_SLICES === 'all' ? [total] : [200, 800, 1800, 2800, 4000].filter((x) => x < total).concat([total]);
    for (const n of slices) {
      const calls: Array<{ n: number; ms: number }> = [];
      // PROFILE_MODE=fresh opens a new kernel for every question (cold, nothing cached); the default does what the app does: one kernel,
      // one tag, `regen` without a view, so the kernel's regen cache keeps the states of the part built so far.
      const fresh = process.env.PROFILE_MODE === 'fresh';
      const shared = fresh ? null : await createWorkerKernel(process.env.CK_WASM);
      const open = async (part: ScPart) => {
        const t = performance.now();
        let s: Session;
        if (fresh) s = await Session.open(part as unknown as PartDoc);
        else {
          const r = (await shared!.request({ type: 'regen', tag: 'solidcraft-import', part, opts: { noView: true } })) as { ok?: boolean };
          if (!r.ok) throw new Error('regen failed');
          s = new Session(part as unknown as PartDoc, shared as never, 'import', 'solidcraft-import');
        }
        calls.push({ n: part.features.length, ms: performance.now() - t });
        try { appendFileSync(process.env.PROFILE_LOG ?? '/tmp/importprof.log', `${fresh ? 'fresh' : 'shared'} slice ${n} question ${calls.length} part ${part.features.length} features ${(performance.now() - t).toFixed(0)} ms\n`); } catch { /* the log is only for watching a long run */ }
        if (fresh) sessions.push(s);
        return s;
      };
      const k = kernelResolvers(open);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 600_000);
      let done = 0;
      const t0 = performance.now();
      const r = await importSolidcraftDocument({ ...doc, features: doc.features.slice(0, n) } as never, 'profile', { ...k, signal: ctl.signal, onProgress: (d) => { done = d; } });
      clearTimeout(timer);
      const secs = (performance.now() - t0) / 1000;
      const kms = calls.reduce((a, c) => a + c.ms, 0) / 1000;
      const last = calls.slice(Math.floor(calls.length * 0.75));
      const mean = last.length ? last.reduce((a, c) => a + c.ms, 0) / last.length : 0;
      out.push(`${String(n).padStart(5)} | ${String(r.refused === 'cancelled' ? done : r.rows.length).padStart(5)}${r.refused === 'cancelled' ? ' (timed out)' : ''} | ${secs.toFixed(1)} | ${calls.length} | ${kms.toFixed(1)} | ${mean.toFixed(0)}`);
      await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {})));
      if (r.part && n === total && shared) {
        // what the app does after the import: load the finished part (a regeneration with the view) and validate it
        const t1 = performance.now();
        const reg = (await shared.request({ type: 'regen', tag: 'load', part: r.part })) as { ok?: boolean };
        const t2 = performance.now();
        const val = (await shared.request({ type: 'validate', tag: 'load' })) as { ok?: boolean };
        const t3 = performance.now();
        out.push(`load of the finished part (${r.part.features.length} features): regen with view ${((t2 - t1) / 1000).toFixed(1)} s (ok ${String(reg.ok)}), validate ${((t3 - t2) / 1000).toFixed(1)} s (ok ${String(val.ok)})`);
      }
      if (shared) await shared.close();
      if (r.refused === 'cancelled') break;   // a larger slice will only take longer
    }
    process.stdout.write('\nIMPORT PROFILE\n' + out.join('\n') + '\n');
  });
});

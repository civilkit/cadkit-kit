// Where the time of a big SolidCraft import goes: the importer's questions to the kernel (each regenerates the part built so far) against
// the importer's own work, and the cost of the questions as the part grows. Reads PROFILE_INPUT (default .prof/input.solidcraft) and prints a table.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraftDocument, type ScPart } from './import';
import { kernelResolvers } from './kernelResolvers';

const FILE = process.env.PROFILE_INPUT ?? join(process.cwd(), '.prof', 'input.solidcraft');
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('import profile', { skip: !process.env.CK_WASM || !existsSync(FILE), timeout: 3_000_000 }, () => {
  // The first N features of the file, for growing N, each with a time limit: how the cost of an import grows with its size, and
  // how far a slice gets when it runs out of time (the whole file may take longer than any single run is allowed).
  it('prints the time split for growing slices', async () => {
    const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { features: unknown[] };
    const total = doc.features.length;
    const out: string[] = [`file features ${total}`, 'slice | features done | seconds | kernel questions | kernel s | mean ms per question (last quarter)'];
    for (const n of [25, 50, 100, 200].filter((x) => x < total).concat([total])) {
      const calls: Array<{ n: number; ms: number }> = [];
      const open = async (part: ScPart) => {
        const t = performance.now();
        const s = await Session.open(part as unknown as PartDoc);
        calls.push({ n: part.features.length, ms: performance.now() - t });
        sessions.push(s);
        return s;
      };
      const k = kernelResolvers(open);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 240_000);
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
      if (r.refused === 'cancelled') break;   // a larger slice will only take longer
    }
    process.stdout.write('\nIMPORT PROFILE\n' + out.join('\n') + '\n');
  });
});

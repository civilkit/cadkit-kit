// What happens after a big import, as the app does it: the finished part is loaded (regenerated with the display mesh) and validated.
// Each step is logged with its start and end so that a very long one can be seen while it runs (PROFILE_LOG, default /tmp/importload.log).
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { zipFile } from '@kit/fcstd';
import { createWorkerKernel } from '@ck/kernel-client/node';
import { importSolidcraftDocument, type ScPart } from './import';
import { kernelResolvers } from './kernelResolvers';

const FILE = process.env.PROFILE_INPUT ?? join(process.cwd(), '.prof', 'input.solidcraft');
const LOG = process.env.PROFILE_LOG ?? '/tmp/importload.log';
const log = (s: string): void => { try { appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${s}\n`); } catch { /* only for watching */ } };

describe('import load phase', { skip: !process.env.CK_WASM || !existsSync(FILE), timeout: 3_600_000 }, () => {
  it('times the load of a finished import step by step', async () => {
    const bytes = new Uint8Array(readFileSync(FILE));
    const raw = bytes[0] === 0x50 && bytes[1] === 0x4b ? await zipFile(bytes, 'document.json') : bytes;
    const doc = JSON.parse(new TextDecoder().decode(raw ?? new Uint8Array())) as { features: unknown[] };
    const kernel = await createWorkerKernel(process.env.CK_WASM);
    const open = async (part: ScPart) => {
      const r = (await kernel.request({ type: 'regen', tag: 'solidcraft-import', part, opts: { noView: true } })) as { ok?: boolean };
      if (!r.ok) throw new Error('regen failed');
      return new Session(part as unknown as PartDoc, kernel as never, 'import', 'solidcraft-import');
    };
    const k = kernelResolvers(open);
    log(`import start (${doc.features.length} features in the file)`);
    const t0 = performance.now();
    const r = await importSolidcraftDocument(doc as never, 'profile', k);
    log(`import done in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${r.part?.features.length ?? 0} part features`);
    if (!r.part) throw new Error('refused: ' + r.refused);
    const timed = async (name: string, f: () => Promise<unknown>): Promise<void> => {
      log(`${name} start`);
      const t = performance.now();
      const res = (await f()) as { ok?: boolean; result?: { errors?: unknown[] } } | undefined;
      log(`${name} done in ${((performance.now() - t) / 1000).toFixed(1)} s (ok ${String(res?.ok)}, errors ${res?.result?.errors?.length ?? '-'})`);
    };
    await timed('A regen without view (new tag)', () => kernel.request({ type: 'regen', tag: 'loadA', part: r.part, opts: { noView: true } }));
    await timed('B regen with view', () => kernel.request({ type: 'regen', tag: 'loadB', part: r.part }));
    await timed('C validate', () => kernel.request({ type: 'validate', tag: 'loadB' }));
    await kernel.close();
  });
});

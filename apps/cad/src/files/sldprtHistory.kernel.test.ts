import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createWorkerKernel } from '@ck/kernel-client/node';
import { base64Of } from './stepImport';
import { sldprtAsPart, type SldprtKernel } from './sldprtImport';
import { folderToggleOps, HISTORY_FOLDER } from '../historyFolder';

const WASM = process.env.CK_WASM!;
// SolidWorks part files are not shipped with the kit: the samples are a local directory (one folder per part, holding model.SLDPRT)
const SAMPLES = process.env.SW_SAMPLES ?? resolve(process.cwd(), '../wt-kernel-loft/corpus-local/samples');
const sample = (dir: string) => { const d = resolve(SAMPLES, dir); const f = existsSync(d) ? readdirSync(d).find((n) => /\.sldprt$/i.test(n)) : undefined; return resolve(d, f ?? 'model.SLDPRT'); };
const HAVE = (dir: string) => !!WASM && existsSync(sample(dir));
type Kernel = Awaited<ReturnType<typeof createWorkerKernel>>;
let kernel: Kernel | null = null;
afterAll(async () => { await kernel?.close().catch(() => {}); });

const volume = async (k: SldprtKernel, tag: string) => ((await k.request({ type: 'massProps', tag })).result as { volume: number }).volume;

describe('a SolidWorks part opens with its feature history, on the real kernel', () => {
  for (const dir of ['dump_SW2022_C03_cube_fillet_1mm', 'dump_SW2022_C10_cube_shell_1mm', 'dump_SW2022_C21_cylinder_fillet']) {
    it.skipIf(!HAVE(dir))(`${dir}: more than one feature, the volume of the plain import`, async () => {
      kernel ??= await createWorkerKernel(WASM);
      const bytes = new Uint8Array(readFileSync(sample(dir)));
      const r = await sldprtAsPart(kernel, bytes, 'P');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.history).toBe(true);
      expect(r.part.features.length).toBeGreaterThan(1);
      expect(r.part.features.map((f) => f.type)).not.toContain('importStep');
      // the document, saved and opened again, gives the body the plain import reads
      const reg = await kernel.request({ type: 'regen', tag: `${dir}-hist`, part: JSON.parse(JSON.stringify(r.part)) });
      expect((reg.result as { errors: unknown[] }).errors).toEqual([]);
      const plain = await kernel.request({ type: 'importSldprt', tag: `${dir}-plain`, name: 'P', data: base64Of(bytes) });
      expect(plain.ok).toBe(true);
      const [vh, vp] = [await volume(kernel, `${dir}-hist`), await volume(kernel, `${dir}-plain`)];
      expect(Math.abs(vh - vp)).toBeLessThanOrEqual(1e-6 * Math.abs(vp));
    }, 120_000);
  }

  it.skipIf(!HAVE('dump_SW2022_C03_cube_fillet_1mm'))('falls back to the one imported body when the kernel has no history message', async () => {
    kernel ??= await createWorkerKernel(WASM);
    const k = kernel;
    const old: SldprtKernel = { request: async (m) => (m.type === 'sldprtHistory' ? ({ ok: false, error: 'unknown request' } as never) : (k.request(m) as never)) };
    const r = await sldprtAsPart(old, new Uint8Array(readFileSync(sample('dump_SW2022_C03_cube_fillet_1mm'))), 'P');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.history).toBeUndefined();
    expect(r.part.features.map((f) => f.type)).toEqual(['importStep']);
  }, 120_000);
});

// The history is one folder that switches off as a whole: on, the rebuilt features (and the imported remainder of a partial history);
// off, the file's own body. Complete (the body comes from the features) and partial (an imported remainder ends the history) files alike.
describe('the history folder: on and off give the body of the plain import, on the real kernel', () => {
  const volumes = async (k: Kernel, dir: string) => {
    const bytes = new Uint8Array(readFileSync(sample(dir)));
    const plain = await k.request({ type: 'importSldprt', tag: `${dir}-p`, name: 'P', data: base64Of(bytes) });
    expect(plain.ok).toBe(true);
    const r = await sldprtAsPart(k, bytes, 'P');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('not ok');
    const feats = r.part.features as unknown as Array<{ id: string; type: string; group?: string; suppressed?: boolean }>;
    const ids = feats.filter((f) => f.group === HISTORY_FOLDER).map((f) => f.id);
    // the folder switched off exactly as the tree does it (the same ops), through a save and open (JSON)
    const ops = folderToggleOps(feats, ids, HISTORY_FOLDER);
    const off = { ...r.part, features: feats.map((f) => { const o = ops.find((x) => (x as { id: string }).id === f.id) as { value: boolean } | undefined; return o ? { ...f, suppressed: o.value } : f; }) };
    const regen = async (tag: string, part: unknown) => {
      const reg = await k.request({ type: 'regen', tag, part: JSON.parse(JSON.stringify(part)) });
      expect((reg.result as { errors: unknown[] }).errors).toEqual([]);
      return volume(k, tag);
    };
    return { r, feats, ids, plain: await volume(k, `${dir}-p`), on: await regen(`${dir}-on`, r.part), off: await regen(`${dir}-off`, off), ops };
  };
  const same = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-6 * Math.abs(b));

  for (const dir of ['dump_SW2022_C03_cube_fillet_1mm', 'pend_bearing_holder', 'pend_spoked_wheel_12T', 'pend_table_mount', 'pend_mount_table_sharft_holder']) {
    it.skipIf(!HAVE(dir))(`${dir} (complete): folder of every rebuilt feature, a suppressed Imported body after it; on == off == plain`, async () => {
      kernel ??= await createWorkerKernel(WASM);
      const v = await volumes(kernel, dir);
      expect(v.r.history).toBe(true);
      expect(v.r.historyInfo?.complete).toBe(true);
      const last = v.feats.at(-1)!;
      expect(last).toMatchObject({ type: 'importBody', suppressed: true });
      expect(last.group).toBeUndefined();
      expect(v.ids.length).toBe(v.feats.length - 1);
      expect(v.ids.length).toBeGreaterThan(1);
      // a close rebuild (not exact) agrees with the file's body to 1e-5 (holder: 3e-6); every other file here agrees to 1e-6
      if (dir === 'pend_mount_table_sharft_holder') expect(Math.abs(v.on - v.plain)).toBeLessThanOrEqual(1e-5 * Math.abs(v.plain)); else same(v.on, v.plain);
      same(v.off, v.plain);
    }, 180_000);
  }
});

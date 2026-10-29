import { afterAll, describe, expect, it } from 'vitest';
import { createWorkerKernel } from '@ck/kernel-client/node';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { sldprtAsPart, type SldprtKernel } from './sldprtImport';

const WASM = process.env.CK_WASM!;
type Kernel = Awaited<ReturnType<typeof createWorkerKernel>>;

const box = (w: number, d: number, h: number): PartDoc => ({
  ...emptyPart('Box'),
  features: [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: w, y: 0 }, { id: 'p3', x: w, y: d }, { id: 'p4', x: 0, y: d }],
      entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: h },
  ],
  seq: 3,
}) as unknown as PartDoc;

let kernel: Kernel | null = null;
afterAll(async () => { await kernel?.close().catch(() => {}); });

/**
 * The kernel with one change: a SolidWorks file cannot be written in a test (no fixture of that kind may be shipped), so `importSldprt`
 * answers with the regeneration of a box under the tag it was given, as the real message leaves its body under that tag. Every
 * other message goes to the real kernel, so the STEP, the part's regeneration and the measures are the real ones.
 */
async function kernelWithBox(w: number, d: number, h: number): Promise<SldprtKernel> {
  kernel ??= await createWorkerKernel(WASM);
  const k = kernel;
  return { request: async (m) => (m.type === 'importSldprt' ? k.request({ type: 'regen', tag: m.tag, part: box(w, d, h) }) : k.request(m)) as never };
}

describe('a SolidWorks solid as an editable part, on the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('holds the solid as one imported body with the volume and size of the solid that was read', async () => {
    const k = await kernelWithBox(30, 20, 10);
    const r = await sldprtAsPart(k, new Uint8Array([1]), 'Box');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.volume).toBeCloseTo(6000, 3);
    expect(r.faces).toBe(6);
    expect(r.part.features.map((f) => f.type)).toEqual(['importStep']);
    // saved and opened again: the same document gives the same body
    const again = JSON.parse(JSON.stringify(r.part)) as PartDoc;
    const rep = await k.request({ type: 'regen', tag: 'reopened', part: again });
    const res = rep.result as { errors: unknown[]; body: { faces: unknown[]; box: { min: number[]; max: number[] } } };
    expect(res.errors).toEqual([]);
    expect(res.body.faces.length).toBe(6);
    const size = res.body.box.max.map((v, i) => +(v - res.body.box.min[i]).toFixed(3)).sort((a, b) => a - b);
    expect(size).toEqual([10, 20, 30]);
    const mass = (await k.request({ type: 'massProps', tag: 'reopened' })).result as { volume: number };
    expect(mass.volume).toBeCloseTo(6000, 3);
  });
  it('can be cut after import: a feature that works on the imported body', async () => {
    const k = await kernelWithBox(30, 20, 10);
    const r = await sldprtAsPart(k, new Uint8Array([1]), 'Box');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cut = {
      ...r.part,
      features: [...r.part.features,
        { type: 'sketch', id: 'F2', plane: { kind: 'std', id: 'front' },
          points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 15, y: 10 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 2 }], constraints: [] },
        { type: 'extrude', id: 'F3', op: 'cut', sketch: 'F2', end: 'throughBoth' }],
      seq: 4,
    } as unknown as PartDoc;
    const rep = await k.request({ type: 'regen', tag: 'cut', part: cut });
    expect((rep.result as { errors: unknown[] }).errors).toEqual([]);
    const mass = (await k.request({ type: 'massProps', tag: 'cut' })).result as { volume: number };
    expect(mass.volume).toBeCloseTo(6000 - Math.PI * 4 * 10, 0);
  });
  it('falls back to the view-only body when the part would not match the solid', async () => {
    // the part's volume is read back wrong: nothing is replaced, the solid of the file stays available to show
    const k = await kernelWithBox(30, 20, 10);
    let n = 0;
    const lying: SldprtKernel = { request: async (m) => { const r = await k.request(m); if (m.type === 'massProps' && ++n === 2) return { ...r, result: { ...(r.result as object), volume: 1 } } as never; return r; } };
    const r = await sldprtAsPart(lying, new Uint8Array([1]), 'Box');
    expect(r).toMatchObject({ ok: false, code: 'volumeDiffers' });
    expect((r as { fallback?: { faces: number } }).fallback?.faces).toBe(6);
  });
});

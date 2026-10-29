// The original solid of a converted file is turned from their Z-up frame to our Y-up frame by the same rotation as every point of the file
// (a -90 degree turn about X, written as a moveBody). A body built from the file's own operations and the original must therefore lie on one
// another after the import, and they would not if the original were turned alone or not at all. Measured as the volume of their intersection.
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createWorkerKernel } from '@ck/kernel-client/node';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraftDocument, type ScPart } from './import';

const WASM = process.env.CK_WASM!;
type Kernel = Awaited<ReturnType<typeof createWorkerKernel>>;
let kernel: Kernel | null = null;
const k = async () => (kernel ??= await createWorkerKernel(WASM));
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
afterAll(async () => { await kernel?.close().catch(() => {}); });
const open = async (part: ScPart) => { const s = await Session.open(part as unknown as PartDoc); sessions.push(s); return s; };
const doc = (features: unknown[]) => ({ format: 'solidcraft/30', units: 'mm', params: [], features });
// off the origin and off every axis, so a wrong turn cannot coincide by symmetry
const box = (over: Record<string, unknown> = {}) => ({ id: 1, name: 'Box', type: 'box', suppressed: false, corner: [3, -7, 11], length: 10, width: 20, height: 30, operation: 'new_body', ...over });

async function stepInTheirFrame(): Promise<string> {
  const made = await importSolidcraftDocument(doc([box()]), 'src');
  const part = made.part!;
  part.features.push({ type: 'moveBody', id: 'F99', rotate: { axis: 'x', origin: [0, 0, 0], angle: 90 } });
  return (await open(part)).step('src');
}

async function overlap(part: ScPart): Promise<{ volumes: number[]; common: number | string }> {
  const kk = await k();
  const bodies = async (p: ScPart) => {
    const rep = await kk.request({ type: 'regen', tag: 'frame', part: p, opts: { noView: true } });
    expect((rep.result as { errors: unknown[] }).errors).toEqual([]);
    return ((await kk.request({ type: 'massProps', tag: 'frame', bodies: true })).result as { bodies: Array<{ volume: number }> }).bodies.map((b) => b.volume);
  };
  const volumes = await bodies(part);
  const withCommon = { ...part, features: [...part.features, { type: 'combine', id: 'FZ', op: 'intersect', target: { lump: 0 }, tools: [{ lump: 1 }] }], seq: part.seq + 1 } as ScPart;
  const rep = await kk.request({ type: 'regen', tag: 'frame2', part: withCommon, opts: { noView: true } });
  const errors = (rep.result as { errors: Array<[string, { code?: string }]> }).errors;
  if (errors.length) return { volumes, common: errors[0][1].code ?? 'error' };
  return { volumes, common: ((await kk.request({ type: 'massProps', tag: 'frame2' })).result as { volume: number }).volume };
}

describe('the frame of the original solid against the file\'s own operations', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  it('the operations and the original lie on one another after the import', async () => {
    const step = await stepInTheirFrame();
    const r = await importSolidcraftDocument(doc([box({ id: 1 }), { id: 2, name: 'Original', type: 'import', suppressed: false, step }]), 'p');
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted']);
    const o = await overlap(r.part!);
    expect(o.volumes.map((v) => Math.round(v))).toEqual([6000, 6000]);
    expect(o.common).toBeCloseTo(6000, 3);
  });
  it('turned alone, or not at all, they would not: the measure can tell', async () => {
    const step = await stepInTheirFrame();
    const r = await importSolidcraftDocument(doc([box({ id: 1 }), { id: 2, name: 'Original', type: 'import', suppressed: false, step }]), 'p');
    const part = r.part!;
    const withoutTurn = { ...part, features: part.features.filter((f) => f.type !== 'moveBody' || (f.name && !String(f.name).includes('Y up'))) } as ScPart;
    expect(withoutTurn.features.length).toBeLessThan(part.features.length);
    const o = await overlap(withoutTurn);
    expect(o.common).not.toBeCloseTo(6000, 0);
  });
});

async function boxOf(part: ScPart): Promise<{ min: number[]; max: number[] }> {
  const kk = await k();
  const rep = await kk.request({ type: 'regen', tag: 'frame-box', part });
  expect((rep.result as { errors: unknown[] }).errors).toEqual([]);
  return (rep.result as { body: { box: { min: number[]; max: number[] } } }).body.box;
}
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

describe('a file converted from SolidWorks is already Y up', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  // an asymmetric solid off the origin: corner (3, -7, 11), 10 along x, 20 along y, 30 along z
  const source = (file: string, step: string, suppressed: boolean) => doc([box({ id: 1 }), { id: 2, name: 'Original', type: 'import', suppressed, step, file }]);

  it('keeps its coordinates and turns nothing: the solid stands where SolidWorks has it', async () => {
    const step = await stepInTheirFrame();
    const r = await importSolidcraftDocument(source('model.SLDPRT', step, false), 'p');
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'converted']);
    expect(r.part!.features.some((f) => f.type === 'moveBody')).toBe(false);
    const o = await overlap(r.part!);
    expect(o.volumes.map((v) => Math.round(v))).toEqual([6000, 6000]);
    expect(o.common).toBeCloseTo(6000, 3);
    // the box of the history is the box of the file: x 3..13, y -7..13, z 11..41, with no turn
    const history = await boxOf({ ...r.part!, features: r.part!.features.filter((f) => f.type !== 'importStep') } as ScPart);
    expect(near(history.min, [3, -7, 11]) && near(history.max, [13, 13, 41])).toBe(true);
  });
  it('a file from another program is still turned from Z up, as before', async () => {
    const step = await stepInTheirFrame();
    const r = await importSolidcraftDocument(source('model.f3d', step, false), 'p');
    expect(r.part!.features.some((f) => f.type === 'moveBody')).toBe(true);
    const history = await boxOf({ ...r.part!, features: r.part!.features.filter((f) => f.type !== 'importStep' && f.type !== 'moveBody') } as ScPart);
    // (x, y, z) -> (x, z, -y): y -7..13 becomes z -13..7, z 11..41 becomes y 11..41
    expect(near(history.min, [3, 11, -13]) && near(history.max, [13, 41, 7])).toBe(true);
  });
  it('imports that run side by side each keep their own convention', async () => {
    const step = await stepInTheirFrame();
    const sw = source('model.SLDPRT', step, false), other = source('model.f3d', step, false);
    // several of each at once: they interleave at every await (the hash of the solid, the kernel's answers)
    const made = await Promise.all([sw, other, sw, other, other, sw].map((d) => importSolidcraftDocument(JSON.parse(JSON.stringify(d)), 'p')));
    for (const [i, r] of made.entries()) {
      const expected = [0, 2, 5].includes(i);
      const turned = r.part!.features.some((f) => f.type === 'moveBody');
      expect(turned, `import ${i}`).toBe(!expected);
      const history = await boxOf({ ...r.part!, features: r.part!.features.filter((f) => f.type !== 'importStep' && f.type !== 'moveBody') } as ScPart);
      const want = expected ? { min: [3, -7, 11], max: [13, 13, 41] } : { min: [3, 11, -13], max: [13, 41, 7] };
      expect(near(history.min, want.min) && near(history.max, want.max), `import ${i} box ${JSON.stringify(history)}`).toBe(true);
    }
  });
  it('the original alone sits where the history would, whichever of the two the file keeps', async () => {
    const step = await stepInTheirFrame();
    const r = await importSolidcraftDocument(doc([{ id: 1, name: 'Original', type: 'import', suppressed: false, step, file: 'part.sldprt' }]), 'p');
    const b = await boxOf(r.part!);
    expect(near(b.min, [3, -7, 11]) && near(b.max, [13, 13, 41])).toBe(true);
  });
});

// Converted files named in SW_SC_FILES (comma separated paths; local data, nothing in a repository): the box of the imported body is printed,
// to be compared with the box of the same part opened directly. Skipped without the variable.
const FILES = (process.env.SW_SC_FILES ?? '').split(',').filter(Boolean);
describe('converted files: where the imported body lies', { skip: !process.env.CK_WASM || !FILES.length, timeout: 300_000 }, () => {
  it('prints the box of the imported body', async () => {
    const { importSolidcraft } = await import('./import');
    const kk = await k();
    for (const f of FILES) {
      const r = await importSolidcraft(new Uint8Array(readFileSync(f)), 'p', { placeholders: false });
      if (!r.part) { console.log('FRAMECHECK', f.split('/').pop(), r.refused); continue; }
      const rep = await kk.request({ type: 'regen', tag: 'frame3', part: r.part });
      const box = (rep.result as { body?: { box?: { min: number[]; max: number[] } } }).body?.box;
      console.log('FRAMECHECK', f.split('/').pop(), JSON.stringify(box));
    }
  });
});

// The original solid of a converted file is a STEP text. Some converters restate the geometry with a few faces turned: the kernel's importStep
// message repairs that (healing), the importStep feature does not, so the same text gave a different volume in a part. The importer asks the
// kernel to normalise the text, and checks that the operations of the file rebuild the original before it hides the original behind them.
// The STEP texts are made by the kernel from a box; "turned" flips the sense of one face.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createWorkerKernel } from '@ck/kernel-client/node';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraftDocument, type ScPart } from './import';
import { kernelStepTools } from './kernelResolvers';

const WASM = process.env.CK_WASM!;
type Kernel = Awaited<ReturnType<typeof createWorkerKernel>>;
let kernel: Kernel | null = null;
const k = async () => (kernel ??= await createWorkerKernel(WASM));
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
afterAll(async () => { await kernel?.close().catch(() => {}); });
const open = async (part: ScPart) => { const s = await Session.open(part as unknown as PartDoc); sessions.push(s); return s; };
const doc = (features: unknown[]) => ({ format: 'solidcraft/30', units: 'mm', params: [], features });
const box = (over: Record<string, unknown> = {}) => ({ id: 1, name: 'Box', type: 'box', suppressed: false, corner: [0, 0, 0], length: 10, width: 20, height: 30, operation: 'new_body', ...over });

/** STEP text of the box standing in THEIR frame (Z up). */
async function boxStep(): Promise<string> {
  const made = await importSolidcraftDocument(doc([box()]), 'src');
  const part = made.part!;
  part.features.push({ type: 'moveBody', id: 'F99', rotate: { axis: 'x', origin: [0, 0, 0], angle: 90 } });
  return (await open(part)).step('src');
}
/** The same text with the sense of the first face turned: a restatement the importStep feature reads as a wrong body. */
const turned = (step: string): string => {
  const m = /ADVANCED_FACE\('[^']*',\([^)]*\),#\d+,\.T\.\)/.exec(step);
  if (!m) throw new Error('no face to turn');
  return step.slice(0, m.index) + m[0].slice(0, -3) + 'F.)' + step.slice(m.index + m[0].length);
};
const volumeOfPart = async (part: ScPart) => {
  const kk = await k();
  const rep = await kk.request({ type: 'regen', tag: 'test-volume', part, opts: { noView: true } });
  expect((rep.result as { errors: unknown[] }).errors).toEqual([]);
  return ((await kk.request({ type: 'massProps', tag: 'test-volume' })).result as { volume: number }).volume;
};

describe('the original solid of a converted file', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  it('reads wrong as it is and right once the kernel has normalised it', async () => {
    const bad = turned(await boxStep());
    const plain = await importSolidcraftDocument(doc([{ id: 1, name: 'Original', type: 'import', suppressed: false, step: bad }]), 'p');
    expect(await volumeOfPart(plain.part!)).toBeCloseTo(4000, 3);   // the problem: 6000 mm3 solid read as 4000
    const tools = kernelStepTools(k);
    const fixed = await importSolidcraftDocument(doc([{ id: 1, name: 'Original', type: 'import', suppressed: false, step: bad }]), 'p', { normalizeStep: tools.normalizeStep });
    expect(fixed.geometryComplete, JSON.stringify(fixed.rows)).toBe(true);
    expect(await volumeOfPart(fixed.part!)).toBeCloseTo(6000, 3);
  });
  it('leaves a text that already reads right untouched', async () => {
    const good = await boxStep();
    const n = await kernelStepTools(k).normalizeStep(good);
    expect(n).toMatchObject({ ok: true, step: good });
    expect(n.ok && n.volume).toBeCloseTo(6000, 3);
  });
  it('says why a text the kernel cannot read is refused, and the row keeps the sketches and operations', async () => {
    const tools = kernelStepTools(k);
    const n = await tools.normalizeStep('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');
    expect(n.ok).toBe(false);
    const r = await importSolidcraftDocument(doc([{ id: 1, name: 'Original', type: 'import', suppressed: false, step: 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n' }, box({ id: 2, name: 'Pad', corner: [0, 0, 0], length: 4, width: 4, height: 4, operation: 'new_body' })]), 'p', { normalizeStep: tools.normalizeStep });
    expect(r.rows.find((x) => x.type === 'import')?.status).toBe('unsupported');
    expect(r.rows.find((x) => x.type === 'import')?.reason).toContain('kernel cannot read');
  });
  it('keeps the operations of the file when they rebuild the stored solid', async () => {
    const step = await boxStep();
    const tools = kernelStepTools(k);
    const r = await importSolidcraftDocument(doc([box(), { id: 2, name: 'Original', type: 'import', suppressed: true, step }]), 'p', tools);
    expect(r.part!.features.some((f) => f.type === 'importStep')).toBe(false);
    expect(r.rows.map((x) => x.status)).toEqual(['converted', 'skipped']);
    expect(await volumeOfPart(r.part!)).toBeCloseTo(6000, 3);
  });
  it('uses the stored solid when the operations do not rebuild it, and says so', async () => {
    const step = await boxStep();
    const tools = kernelStepTools(k);
    const wrong = [box({ height: 25 }), { id: 2, name: 'Original', type: 'import', suppressed: true, step }];
    const without = await importSolidcraftDocument(doc(wrong), 'p');
    expect(await volumeOfPart(without.part!)).toBeCloseTo(5000, 3);   // what the operations alone give
    const r = await importSolidcraftDocument(doc(wrong), 'p', tools);
    expect(r.part!.features.some((f) => f.type === 'importStep')).toBe(true);
    expect(r.rows.map((x) => x.status)).toEqual(['skipped', 'converted']);
    expect(r.rows[0].reason).toContain('do not rebuild its original solid');
    expect(r.rows[0].reason).toContain('5000');
    expect(await volumeOfPart(r.part!)).toBeCloseTo(6000, 3);
  });
  it('falls back to the stored solid when a sketch of the file has its corners in the wrong order, and keeps the sketch', async () => {
    const step = await boxStep();
    // four lines whose corners are taken in the order 1, 3, 2, 4: two triangles that cross, not a rectangle
    const bowtie = { id: 1, name: 'Sketch1', type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XY' },
      sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [10, 20] }, { id: 'p3', pos: [10, 0] }, { id: 'p4', pos: [0, 20] }],
        curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }], constraints: [] } };
    const pad = { id: 2, name: 'Boss-Extrude1', type: 'extrude', suppressed: false, sketch: 1, profiles: { type: 'all' }, operation: 'new_body', extent: { convention: 'total_distance', direction: 'positive', distance: '30' } };
    const orig = { id: 3, name: 'Original', type: 'import', suppressed: true, step };
    const r = await importSolidcraftDocument(doc([bowtie, pad, orig]), 'p', kernelStepTools(k));
    expect(r.rows.map((x) => `${x.type}:${x.status}`)).toEqual(['sketch:converted', 'extrude:skipped', 'import:converted']);
    expect(r.part!.features.some((f) => f.type === 'sketch')).toBe(true);
    expect(await volumeOfPart(r.part!)).toBeCloseTo(6000, 3);
  });
});

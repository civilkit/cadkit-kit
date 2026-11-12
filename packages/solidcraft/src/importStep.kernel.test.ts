// A SolidCraft file that holds its original solid as a STEP body opens as that solid (the kernel's importStep feature), with the
// operations of the file acting on it. The STEP text of the synthetic case is made by the kernel itself from a box.
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraft, importSolidcraftDocument, type ScPart } from './import';
import { kernelResolvers } from './kernelResolvers';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (part: ScPart) => { const s = await Session.open(part as unknown as PartDoc); sessions.push(s); return s; };
const box = (over: Record<string, unknown> = {}) => ({ id: 1, name: 'Box', type: 'box', suppressed: false, corner: [0, 0, 0], length: 10, width: 20, height: 30, operation: 'new_body', ...over });
/** STEP text of a box that stands in THEIR frame (Z up): the importer's Y-up box turned back by the inverse rotation. */
async function stepInTheirFrame(): Promise<string> {
  const made = await importSolidcraftDocument(doc([box()]), 'src');
  const part = made.part!;
  part.features.push({ type: 'moveBody', id: 'F99', rotate: { axis: 'x', origin: [0, 0, 0], angle: 90 } });
  return (await open(part)).step('src');
}
const doc = (features: unknown[]) => ({ format: 'solidcraft/30', units: 'mm', params: [], features });

describe('importStep from a SolidCraft file', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  it('the imported solid is the body, in their coordinates: a cut of the file acts on it', async () => {
    const step = await stepInTheirFrame();
    expect(step).toContain('ISO-10303-21');
    // the same solid as imported geometry, then a box cut 3 x 3 x 5 at the corner (inside the solid in their frame)
    const r = await importSolidcraftDocument(doc([
      { id: 1, name: 'Original', type: 'import', suppressed: false, step },
      box({ id: 2, name: 'Pocket', corner: [2, 2, 0], length: 3, width: 3, height: 5, operation: 'cut' }),
    ]), 'imp');
    expect(r.geometryComplete, JSON.stringify(r.rows)).toBe(true);
    const s = await open(r.part!);
    const rep = await s.verify();
    expect(rep.regen.errors).toEqual([]);
    const f = await s.facts();
    expect(f.volume!).toBeCloseTo(6000 - 45, 3);
  });
  it('the part keeps working after it is saved and opened again', async () => {
    const step = await stepInTheirFrame();
    const r = await importSolidcraftDocument(doc([{ id: 1, name: 'Original', type: 'import', suppressed: false, step }]), 'imp');
    const again = JSON.parse(JSON.stringify(r.part)) as ScPart;
    const s = await open(again);
    expect((await s.verify()).regen.errors).toEqual([]);
    expect((await s.facts()).volume!).toBeCloseTo(6000, 3);
  });
});

// Local test data only (not in any repository): a .solidcraft file converted from Fusion 360, named by FUSION_SOLIDCRAFT_SAMPLE.
const SAMPLE = process.env.FUSION_SOLIDCRAFT_SAMPLE && existsSync(process.env.FUSION_SOLIDCRAFT_SAMPLE) ? process.env.FUSION_SOLIDCRAFT_SAMPLE : '';
describe('a converted Fusion 360 file', { skip: !process.env.CK_WASM || !SAMPLE, timeout: 300_000 }, () => {
  it('regenerates to a solid with a volume', async () => {
    const r = await importSolidcraft(new Uint8Array(readFileSync(SAMPLE)), 'case', kernelResolvers(open));
    // the importer wraps the part in an insertPart, so the STEP blobs sit on that feature's own part
    const ins = r.part?.features[0] as unknown as { part?: { blobs?: unknown } } | undefined;
    expect(ins?.part?.blobs).toBeTruthy();
    const s = await open(r.part!);
    await s.verify();
    expect((await s.facts()).volume!).toBeGreaterThan(0);
  });
});

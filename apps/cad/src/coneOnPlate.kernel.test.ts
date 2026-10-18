import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import loft2217 from './fixtures/coneOnPlate/loft_r22_17.json';
import loft2520 from './fixtures/coneOnPlate/loft_r25_20.json';
import loft2211 from './fixtures/coneOnPlate/loft_r22_11.json';
import thickenCone from './fixtures/coneOnPlate/thicken_cone.json';
import filletRim from './fixtures/coneOnPlate/fillet_rim.json';
import filletFoot from './fixtures/coneOnPlate/fillet_foot.json';
import thickenA21 from './fixtures/coneOnPlate/thicken_a21.json';

// A cone standing on a 55 x 55 x 3 plate (hand testing, 2026-10-18; kernel brief "Task 7" in docs/mimo-briefs-5-6.md).
// The fuses (solid lofts and thickened sheets, narrow and wide base) all pass: the wide-base failures were a
// boolean classification bug — a plate cap far outside the tool was read as In because one spline ray crossing
// (the inner cone wall's second hit) was missed, so the cap was dropped and the result left open edges. The two
// fillets remain `it.fails`: the original kernel does them but its foot fillet is wrong (it rounds the concave
// corner over and removes material), so the foot test asks for MORE material.
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function build(doc: unknown): Promise<{ errors: string[]; volume: number }> {
  const s = await Session.open(doc as PartDoc);
  sessions.push(s);
  const errors = (await s.regenReport()).errors.map((e) => String((e as unknown as unknown[])[1] && ((e as unknown as [string, { code: string }])[1].code)));
  const volume = errors.length ? 0 : ((await s.massProps()) as { volume: number }).volume;
  return { errors, volume };
}
const PLATE = 8982.292;   // 55 x 55 x 3 with R6 corners

describe('cone on a plate', { skip: !process.env.CK_WASM }, () => {
  it('a steep solid loft (R22 to R11.5) fuses onto the plate', async () => {
    const r = await build(loft2211);
    expect(r.errors).toEqual([]);
    expect(r.volume).toBeGreaterThan(PLATE + 8000);
  });
  it('a gently tapered solid loft (R22 to R17, 10 high) fuses onto the plate', async () => {
    const r = await build(loft2217);
    expect(r.errors).toEqual([]);
    expect(r.volume).toBeGreaterThan(PLATE + 8000);
  });
  it('a gently tapered solid loft (R25 to R20, 10 high) fuses onto the plate', async () => {
    const r = await build(loft2520);
    expect(r.errors).toEqual([]);
    expect(r.volume).toBeGreaterThan(PLATE + 8000);
  });
  it('a thickened cone sheet (R18.5 to R11.5, 20 high, 2 thick) fuses onto the plate', async () => {
    const r = await build(thickenCone);
    expect(r.errors).toEqual([]);
    expect(r.volume).toBeGreaterThan(PLATE + 3000);
  });
  // tools/sweep.mjs --templates coneThicken --n 60 --seed 3: 0 of 60 fail now (was 24; the classification fix)
  it('a thickened cone with a wide base (R21.5 to R13.5, 27 high, 1 thick) fuses onto the plate', async () => {
    const r = await build(thickenA21);
    expect(r.errors).toEqual([]);
    expect(r.volume).toBeGreaterThan(PLATE + 3000);
  });
  it('R1 fillet on the top rim of the thickened cone (convex: removes material)', async () => {
    const base = (await build(thickenCone)).volume;
    const r = await build(filletRim);
    expect(r.errors).toEqual([]);
    expect(r.volume).toBeLessThan(base);
    expect(r.volume).toBeGreaterThan(base - 100);
  });
  it('R3 fillet where the cone meets the plate (concave: adds material)', async () => {
    const base = (await build(thickenCone)).volume;
    const r = await build(filletFoot);
    expect(r.errors).toEqual([]);
    expect(r.volume).toBeGreaterThan(base);
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraft, type EdgeResolver, type FaceResolver, type ScPart } from './import';

// Sample files are read from the corpus folder next to the kit (cadkit/corpus/solidcraft); they are not part of this repository.
const CORPUS = join(process.cwd(), '..', 'corpus', 'solidcraft');
const have = existsSync(CORPUS);
const FILES: Record<string, string> = { 'slot-fillet-no-fillet': 'from-app/slot-fillet-no-fillet', 'sample-plate': 'from-app/Sample Plate', 'old-format-box-fillet-hole': 'm0-box-fillet-hole' };
const fixture = (n: string) => new Uint8Array(readFileSync(join(CORPUS, `${FILES[n] ?? n}.solidcraft`)));
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (part: ScPart) => { const s = await Session.open(part as unknown as PartDoc); sessions.push(s); return s; };

/** The kernel as the fillet's edge resolver, as the FreeCAD importer's tests do it. */
const resolver: EdgeResolver = async (part, points) => {
  const s = await open(part);
  const out: Array<Record<string, unknown> | null> = [];
  for (const p of points) {
    const m = await s.resolve([{ kind: 'edge', near: p, within: 1e-3 }]);
    out.push((m as unknown as Array<{ matches?: Array<{ ref?: Record<string, unknown> }> }>)[0]?.matches?.[0]?.ref ?? null);
  }
  return out;
};

/** The kernel as the face resolver (shell, offset face): the face nearest each position, if it is clearly the nearest. */
const faceResolver: FaceResolver = async (part, points) => {
  const s = await open(part);
  const res = (await s.resolve(points.map((p) => ({ kind: 'face', near: p })))) as unknown as Array<{ matches?: Array<{ ref?: { id?: string } }> }>;
  return points.map((_, i) => (res[i]?.matches?.length === 1 ? res[i].matches![0].ref?.id ?? null : null));
};

describe('SolidCraft files against the kernel', { skip: !process.env.CK_WASM || !have }, () => {
  it('slot: a stadium extruded 14, cut by a 6 x 12 x 20 box; volume by hand 9624.109', async () => {
    const r = await importSolidcraft(fixture('slot-fillet-no-fillet'), 'slot');
    const f = await (await open(r.part!)).facts();
    // stadium area 25 * 19 + pi 9.5^2, times 14, minus the box's share (a half stadium end: 9.5 * 10 + pi 9.5^2 / 4) * 6
    expect(f.volume).toBeCloseTo((25 * 19 + Math.PI * 9.5 ** 2) * 14 - (9.5 * 10 + Math.PI * 9.5 ** 2 / 4) * 6, 6);
  });
  it('sample plate: 80 x 50 x 8, R6 corners, two d8 holes, a d24 boss 14 high with a d12 bore through all; volume by hand 34793.84', async () => {
    const r = await importSolidcraft(fixture('sample-plate'), 'plate', { resolver, faceResolver });
    expect(r.geometryComplete).toBe(true);
    expect(r.summary).toMatchObject({ converted: 9, unsupported: 0 });
    const f = await (await open(r.part!)).facts();
    const plate = 80 * 50 - 4 * (1 - Math.PI / 4) * 36, holes = 2 * Math.PI * 16;
    const hand = (plate - holes) * 8 - Math.PI * 36 * 8 + Math.PI * (144 - 36) * 14;
    expect(f.volume).toBeCloseTo(hand, 4);
    // SolidCraft is Z-up and the kit is Y-up: the 80 x 50 plate lies in the XZ ground plane (their y runs along our -Z) and its 22 mm of
    // boss and bore stand up along Y
    expect(f.box?.min.map((v) => +v.toFixed(6))).toEqual([0, 0, -50]);
    expect(f.box?.max.map((v) => +v.toFixed(6))).toEqual([80, 22, 0]);
  });
  it('an older file (format solidcraft/1, bare JSON, extent without a convention): 40 x 30 x 20 box, R3 on one 20 mm edge, d10 hole through; volume by hand 22390.58', async () => {
    const r = await importSolidcraft(fixture('old-format-box-fillet-hole'), 'old', { resolver, faceResolver });
    expect(r.geometryComplete).toBe(true);
    expect(r.summary).toMatchObject({ converted: 5, unsupported: 0 });
    const f = await (await open(r.part!)).facts();
    expect(f.volume).toBeCloseTo(40 * 30 * 20 - (1 - Math.PI / 4) * 9 * 20 - Math.PI * 25 * 20, 4);
  });
  it('sample plate without a resolver: the plate, holes, boss and bore build, the fillet is a suppressed placeholder, no kernel error', async () => {
    const r = await importSolidcraft(fixture('sample-plate'), 'plate');
    const s = await open(r.part!);
    const rep = await s.verify();
    expect(rep.regen.errors).toEqual([]);
    expect(rep.validate?.ok).toBe(true);
    const f = await s.facts();
    expect(f.volume).toBeGreaterThan(34793.84);   // square corners: more material than the filleted plate
  });
});

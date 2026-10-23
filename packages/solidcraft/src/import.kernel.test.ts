import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraft, importSolidcraftDocument, type ScPart } from './import';
import { kernelResolvers } from './kernelResolvers';

// Sample files are read from the corpus folder next to the kit (cadkit/corpus/solidcraft); they are not part of this repository.
const CORPUS = join(process.cwd(), '..', 'corpus', 'solidcraft');
const have = existsSync(CORPUS);
const FILES: Record<string, string> = { 'slot-fillet-no-fillet': 'from-app/slot-fillet-no-fillet', 'sample-plate': 'from-app/Sample Plate', 'old-format-box-fillet-hole': 'm0-box-fillet-hole' };
const fixture = (n: string) => new Uint8Array(readFileSync(join(CORPUS, `${FILES[n] ?? n}.solidcraft`)));
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (part: ScPart) => { const s = await Session.open(part as unknown as PartDoc); sessions.push(s); return s; };
const { resolver, faceResolver, rimResolver, axisFaceResolver } = kernelResolvers(open);

/** A plate (their box, corner at the origin) with plastic features standing on its top face (z = height), as their own tests build them. */
const plateDoc = (feats: unknown[], plate = [60, 60, 3]) => ({
  format: 'solidcraft/30', units: 'mm', params: [],
  features: [{ id: 1, name: 'Plate', type: 'box', suppressed: false, corner: [0, 0, 0], length: plate[0], width: plate[1], height: plate[2], operation: 'new_body' }, ...feats],
});
const volumeOf = async (doc: Parameters<typeof importSolidcraftDocument>[0], opts: Parameters<typeof importSolidcraftDocument>[2] = {}) => {
  const r = await importSolidcraftDocument(doc, 'p', opts);
  const s = await open(r.part!);
  const rep = await s.verify();
  return { r, errors: rep.regen.errors, volume: (await s.facts()).volume! };
};

describe('lettering', { skip: !process.env.CK_WASM || !have, timeout: 120_000 }, () => {
  it('pi-case-0.8: the "Pi 4" engraving becomes a text entity cut 0.6 deep, and the whole file imports', async () => {
    const r = await importSolidcraft(fixture('pi-case-0.8'), 'pi', { resolver, faceResolver, rimResolver });
    expect(r.geometryComplete, JSON.stringify(r.rows.filter((x) => x.status !== 'converted'))).toBe(true);
    const s = await open(r.part!);
    const rep = await s.verify();
    expect(rep.regen.errors).toEqual([]);
    // the body without the engraving is 28862.47 mm3; the ink of 16.3 x 6.25 mm lettering at 0.6 deep takes a small part of 61 mm3
    const v = (await s.facts()).volume!;
    expect(v).toBeLessThan(28862.47 - 5); expect(v).toBeGreaterThan(28862.47 - 61);
  });
});

describe('lip and groove on a shelled box (the numbers of their own test)', { skip: !process.env.CK_WASM, timeout: 60_000 }, () => {
  // 80 x 50 x 30 box, the top face opened and the walls 2 thick: the rim is a 2 mm frame round a 76 x 46 opening
  const shelled = (extra: unknown[]) => ({
    format: 'solidcraft/30', units: 'mm', params: [],
    features: [
      { id: 1, name: 'Box', type: 'box', suppressed: false, corner: [0, 0, 0], length: 80, width: 50, height: 30, operation: 'new_body' },
      { id: 2, name: 'Shell', type: 'shell', suppressed: false, faces: [[40, 25, 30]], thickness: '2' },
      ...extra,
    ],
  });
  const lip = (over: Record<string, unknown>) => ({ id: 3, name: 'Lip', type: 'lip', suppressed: false, face: [1, 25, 30], width: '1', height: '2', ...over });
  const vol = async (extra: unknown[]) => {
    const r = await importSolidcraftDocument(shelled(extra), 'p', { faceResolver, rimResolver });
    const s = await open(r.part!);
    const rep = await s.verify();
    return { r, errors: rep.regen.errors, v: (await s.facts()).volume! };
  };
  it('a lip along the inner edge stands 2 high over a band 1 wide: (76 + 2)(46 + 2) - 76 * 46 = 248 square mm', async () => {
    const base = (await vol([])).v;
    const { r, errors, v } = await vol([lip({})]);
    expect(r.rows.map((x) => x.status), JSON.stringify(r.rows)).toEqual(['converted', 'converted', 'converted']); expect(errors).toEqual([]);
    expect(Math.abs((v - base) - 248 * 2) / (248 * 2)).toBeLessThan(1e-6);
  });
  it('a groove along the outer edge goes 2 deep over a band 1 wide: 80 * 50 - 78 * 48 = 256 square mm', async () => {
    const base = (await vol([])).v;
    const { errors, v } = await vol([lip({ groove: true, outside: true })]);
    expect(errors).toEqual([]);
    expect(Math.abs((base - v) - 256 * 2) / (256 * 2)).toBeLessThan(1e-6);
  });
  it('a face without an inner edge, a clearance gap and curved rims are reported', async () => {
    expect((await vol([lip({ face: [40, 25, 0] })])).r.rows[2].reason).toMatch(/no inner edge/);
    expect((await vol([lip({ gap: '0.1' })])).r.rows[2].reason).toMatch(/clearance/);
    expect((await importSolidcraftDocument(shelled([lip({})]), 'p')).rows[2].reason).toMatch(/needs the kernel/);
  });
});

describe('plastic features against the kernel (the volumes of their own tests)', { skip: !process.env.CK_WASM, timeout: 60_000 }, () => {
  const up = [0, 0, 1];
  const feat = (type: string, over: Record<string, unknown>) => ({ id: 2, name: type, type, suppressed: false, position: [30, 30, 3], direction: up, ...over });
  const close = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b) / b).toBeLessThan(rel);
  it('boss: a cylinder with a hole of the same height', async () => {
    const { r, errors, volume } = await volumeOf(plateDoc([feat('boss', { diameter: 10, height: 12, hole_diameter: 4 })]));
    expect(r.geometryComplete, JSON.stringify(r.rows)).toBe(true); expect(errors).toEqual([]);
    close(volume, 10800 + Math.PI * 25 * 12 - Math.PI * 4 * 12, 1e-6);
    // a hole depth shorter than the boss, and a draft that narrows it
    const shallow = await volumeOf(plateDoc([feat('boss', { diameter: 10, height: 12, hole_diameter: 4, hole_depth: 5 })]));
    close(shallow.volume, 10800 + Math.PI * 25 * 12 - Math.PI * 4 * 5, 1e-6);
    const drafted = await volumeOf(plateDoc([feat('boss', { diameter: 10, height: 12, draft: '1 deg' })]));
    expect(drafted.volume).toBeGreaterThan(10800 + Math.PI * 25 * 10); expect(drafted.volume).toBeLessThan(10800 + Math.PI * 25 * 12);
    // fillet and ribs are reported, not guessed
    expect((await importSolidcraftDocument(plateDoc([feat('boss', { diameter: 10, height: 12, fillet: '2' })]), 'p')).rows[1].status).toBe('unsupported');
  });
  it('rest: rectangle, round, hollow and drafted pads', async () => {
    const rest = (over: Record<string, unknown>) => volumeOf(plateDoc([feat('rest', { height: 4, ...over })]));
    close((await rest({ width: 10, length: 20, along: [1, 0, 0] })).volume - 10800, 800);
    close((await rest({ width: 10 })).volume - 10800, Math.PI * 25 * 4, 1e-3);
    close((await rest({ width: 10, length: 20, thickness: 1 })).volume - 10800, 224);
    const a = Math.tan((2 * Math.PI) / 180);
    close((await rest({ width: 10, length: 20, draft: '2 deg' })).volume - 10800, 800 - a * 30 * 16 + (4 / 3) * a * a * 64);
    expect((await importSolidcraftDocument(plateDoc([feat('rest', { width: 4, height: 4, length: 4, thickness: 2 })]), 'p')).rows[1].status).toBe('unsupported');
  });
  it('snap fit: a rectangular arm and a triangular catch', async () => {
    const { r, errors, volume } = await volumeOf(plateDoc([feat('snap_fit', { position: [20, 20, 4], hook: [1, 0, 0], length: 15, thickness: 1.5, width: 6, catch_depth: 1, catch_length: 3 })], [40, 40, 4]));
    expect(r.geometryComplete, JSON.stringify(r.rows)).toBe(true); expect(errors).toEqual([]);
    close(volume - 6400, 1.5 * 15 * 6 + 0.5 * 1 * 3 * 6);
  });
});

describe('SolidCraft files against the kernel', { skip: !process.env.CK_WASM || !have }, () => {
  it('slot: a stadium extruded 14, cut by a 6 x 12 x 20 box; volume by hand 9768.816', async () => {
    const r = await importSolidcraft(fixture('slot-fillet-no-fillet'), 'slot');
    const f = await (await open(r.part!)).facts();
    // their YZ plane is x = +Y, y = +Z (their geometry source). Stadium area 25 * 19 + pi 9.5^2 along x, 14 deep. The box (x 3.5 to 9.5,
    // y -12 to 0, z -10 to 10, centred on the stadium's centre line) removes the half of the end cap with y < 0: pi 9.5^2 / 2, times 6
    expect(f.volume).toBeCloseTo((25 * 19 + Math.PI * 9.5 ** 2) * 14 - (Math.PI * 9.5 ** 2 / 2) * 6, 6);
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

describe('joints', { skip: !process.env.CK_WASM || !have, timeout: 120_000 }, () => {
  it('joints-hinge: the revolute joint becomes a hinge mate between the two pin cylinders and the saved pose is kept', async () => {
    const r = await importSolidcraft(fixture('joints-hinge'), 'hinge', { axisFaceResolver });
    const mates = r.part!.features.filter((f) => f.type === 'mate');
    expect(mates).toHaveLength(1);
    expect(mates[0]).toMatchObject({ kind: 'hinge' });
    expect(r.rows.find((x) => x.type === 'revolute joint')?.status).toBe('converted');
    const s = await open(r.part!);
    const rep = await s.verify();
    expect(rep.regen.errors).toEqual([]);
    const f = await s.facts();
    expect(f.volume!).toBeCloseTo(11221.24, 1);
    expect(f.box!.min[2]).toBeCloseTo(-37, 3); expect(f.box!.max[0]).toBeCloseTo(40, 3);
  });
});

describe('sheet metal', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  it('a contour flange is a bent sheet: 2.5 thick, inner bend radius 2.5, to the right of the path, as wide as its distance', async () => {
    const pts = [{ id: 'origin', pos: [0, 0], fixed: true }, { id: 'l1.start', pos: [0, 0] }, { id: 'l1.end', pos: [40, 0] }, { id: 'l2.end', pos: [40, -30] }, { id: 'l3.end', pos: [70, -30] }];
    const doc = {
      format: 'solidcraft/1', units: 'mm', params: [],
      features: [
        { id: 1, name: 'Contour', type: 'sketch', suppressed: false, plane: { type: 'custom', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 0, -1] } },
          sketch: { points: pts, constraints: [], curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }] } },
        { id: 2, name: 'ContourFlange', type: 'sheet_contour', suppressed: false, sketch: 1, curves: ['l1', 'l2', 'l3'], distance: '50' },
      ],
    };
    const { r, errors, volume } = await volumeOf(doc);
    expect(r.geometryComplete).toBe(true);
    expect(errors).toEqual([]);
    expect(volume).toBeCloseTo(12097.62, 1);   // their evaluator saved 12097.48 for the sample (1e-5 apart)
  });
});

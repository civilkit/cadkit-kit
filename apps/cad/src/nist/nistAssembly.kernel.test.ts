import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../controller';
import { sessionQuery } from '../inspect/kernel';
import { displayBody, componentCentres, type ShowBody } from '../assembly/display';
import { insertIds, readExplode, NO_EXPLODE } from '../assembly/model';
import { NIST_EXPLODE, NIST_MATES, NIST_PARTS } from './nistAssembly';

// The NIST test assembly sample (FTC 7 base, FTC 8 lid, FTC 9 plate, FTC 10 component; see assemblies.md). Needs the kernel (CK_WASM).
const FILE = 'apps/cad/public/samples/assembly-nist-ftc-7-8-9-10.ckpart';
const WASM = process.env.CK_WASM!;
const sample = (): PartDoc => JSON.parse(readFileSync(FILE, 'utf8')) as PartDoc;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (doc: PartDoc) => { const s = await Session.open(doc, { wasmPath: WASM }); sessions.push(s); return s; };
const bodies: unknown[] = [];
async function load(doc: PartDoc) {
  const kernel: KernelFactory = { async open(d) { return open(d); } };
  const c = new Controller({ store: createStore(), view: { setBody(b: unknown) { bodies.push(b); }, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc);
  return c;
}
type Dist = { distance: number; intersects: boolean };
const dist = (s: Session, a: unknown, b: unknown) => sessionQuery<Dist>(s, { type: 'distance', a, b }) as Promise<Dist>;
const comp = (faces: string[], k: number) => faces.filter((f) => f.endsWith(`@F${k}.1`));

describe('NIST test assembly sample, on the real kernel', () => {
  it('holds the four parts, every mate solves, nothing is left to move', async () => {
    const c = await load(sample());
    const d = c.document()!;
    expect(d.features.filter((f) => f.type === 'insertPart').map((f) => f.name)).toEqual(NIST_PARTS.map((p) => p.title));
    expect(d.features.filter((f) => f.type === 'mate').length).toBe(NIST_MATES.length);
    expect(c.components().map((x) => [x.id, x.dof])).toEqual([['F1', 0], ['F2', 0], ['F3', 0], ['F4', 0]]);
    const extra = c.assemblyExtra();
    expect([...extra.errors.keys()]).toEqual([]);
    expect(extra.report?.conflicts).toEqual([]);
    // each part keeps its SolidWorks history folder next to the imported remainder
    for (const f of d.features.filter((x) => x.type === 'insertPart')) {
      const types = ((f as unknown as { part: { features: Array<{ type: string; group?: string }> } }).part.features);
      expect(types.some((t) => t.group === 'SolidWorks history')).toBe(true);
      expect(types.at(-1)!.type).toBe('importBody');
    }
  }, 300_000);

  it('the volumes are those of the four single parts (nothing lost in the placement)', async () => {
    const s = await open(sample());
    const m = await s.massProps({ bodies: true });
    const vols = (m as unknown as { bodies?: Array<{ volume: number }> }).bodies?.map((b) => b.volume).sort((a, b) => a - b);
    // FTC 7 (the base): the file's stored volume is about 1 726 000 mm3; since the B-spline seam reader the import reads it (1 726 408.4; it was 1 728 449.7 with four faces left out)
    const single = [136445.10482, 188320.07554, 503633.02056, 1726408.39086];
    expect(vols).toBeDefined();
    vols!.forEach((v, i) => expect(Math.abs(v - single[i])).toBeLessThan(1e-4 * single[i]));
  }, 300_000);

  it('contacts: lid on rim, plate on standoffs, component on plate touch (distance 0); no other pair is near', async () => {
    const s = await open(sample());
    const faces = (await s.facts()).faces;
    const [b, lid, plate, part] = [1, 2, 3, 4].map((k) => comp(faces, k));
    expect([b.length, lid.length, plate.length, part.length].every((n) => n > 50)).toBe(true);
    for (const [x, y] of [[b, lid], [b, plate], [plate, part]]) {
      const r = await dist(s, x, y);
      expect(r.distance).toBeLessThan(1e-6);
      expect(r.intersects).toBe(true);
    }
    const far = await dist(s, b, part);
    expect(far.intersects).toBe(false);
    expect(far.distance).toBeGreaterThan(5); expect(far.distance).toBeLessThan(7); // measured 6.02 mm
    expect((await dist(s, lid, plate)).distance).toBeGreaterThan(100);
    expect((await dist(s, lid, part)).distance).toBeGreaterThan(80);
  }, 300_000);

  it('the bolt and screw holes not used by a mate line up too (rim 4, standoffs 4, plate 4): edge circles of the two holes differ by the radius difference', async () => {
    const s = await open(sample());
    // [lid / plate / component hole, base / plate hole it meets, radius difference]
    const pairs: Array<[string, string, number]> = [
      ['F49.I1F18@F2.1', 'F4.I1F108@F1.1', 3.17500 - 3.01625], ['F49.I1F19@F2.1', 'F4.I1F102@F1.1', 3.17500 - 3.01625],
      ['F49.I1F20@F2.1', 'F4.I1F106@F1.1', 3.17500 - 3.01625], ['F49.I1F21@F2.1', 'F4.I1F104@F1.1', 3.17500 - 3.01625],
      ['F5.S.e1@F6.2@F3.1', 'F4.I1F94@F1.1', 3.175 - 2.9718], ['F5.S.e1@F6.3@F3.1', 'F4.I1F100@F1.1', 3.175 - 2.9718],
      ['F5.S.e1@F6.1@F3.1', 'F4.I1F98@F1.1', 3.175 - 2.9718], ['F5.S.e1@F3.1', 'F4.I1F96@F1.1', 3.175 - 2.9718],
      ['F21.I1F71@F4.1', 'F14.S.h1@F15.3@F3.1', 3.175 - 3], ['F21.I1F74@F4.1', 'F14.S.h1@F15.2@F3.1', 3.175 - 3],
      ['F21.I1F77@F4.1', 'F14.S.h1@F3.1', 3.175 - 3], ['F21.I1F80@F4.1', 'F14.S.h1@F15.1@F3.1', 3.175 - 3],
    ];
    for (const [a, b, dr] of pairs) {
      const r = await dist(s, a, b);
      expect(Math.abs(r.distance - dr), `${a} / ${b}: ${r.distance}`).toBeLessThan(0.01);
    }
  }, 300_000);

  it('no interference: with the contacts opened by 0.02 mm no pair intersects and each is that far apart within 0.01 mm', async () => {
    const c = await load(sample());
    const doc = JSON.parse(JSON.stringify(c.document())) as { features: Array<Record<string, unknown>> };
    // the same components at the solved poses, raised along Y (the stacking axis) by 0, 0.06, 0.02, 0.04 mm; mates left out. The plate meets a 5 degree face of the base
    // within 0.006 mm of its corner (measured: 0.0139 apart at 0.02 opened), so the check is penetration under 0.01 mm, not exact gaps
    const lift: Record<string, number> = { F1: 0, F2: 0.06, F3: 0.02, F4: 0.04 };
    const place = Object.fromEntries(c.components().map((x) => [x.id, x.place!]));
    doc.features = doc.features.filter((f) => f.type === 'insertPart').map((f) => {
      const { dx, dy, dz, axis, angle, ...rest } = f as Record<string, unknown>; void dx; void dy; void dz; void axis; void angle;
      const p = place[f.id as string];
      return { ...rest, place: { o: [p.o[0], p.o[1] + lift[f.id as string], p.o[2]], x: p.x, y: p.y, z: p.z } };
    });
    const s = await open(doc as unknown as PartDoc);
    const faces = (await s.facts()).faces;
    const k = (n: number) => comp(faces, n);
    const pair = async (i: number, j: number) => dist(s, k(i), k(j));
    for (const [i, j, gap] of [[1, 2, 0.06], [1, 3, 0.02], [3, 4, 0.02]] as const) {
      const r = await pair(i, j);
      expect(r.intersects).toBe(false);
      expect(Math.abs(r.distance - gap)).toBeLessThan(0.01);
    }
    for (const [i, j] of [[1, 4], [2, 3], [2, 4]] as const) expect((await pair(i, j)).intersects).toBe(false);
  }, 300_000);

  describe('exploded view', () => {
    const E = NIST_EXPLODE.manual;
    const explode = readExplode(NIST_EXPLODE);
    const boxOf = (b: ShowBody, ins: Set<string>) => {
      const { positions, triFace, faceIds } = b.mesh;
      const owner = faceIds.map((n) => [...ins].find((k) => n.endsWith(`@${k}.1`)) ?? null);
      const out = new Map<string, { min: number[]; max: number[] }>();
      for (let t = 0; t < triFace.length; t++) {
        const k = owner[triFace[t]]; if (!k) continue;
        const bx = out.get(k) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; out.set(k, bx);
        for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) { const x = positions[t * 9 + v * 3 + a]; bx.min[a] = Math.min(bx.min[a], x); bx.max[a] = Math.max(bx.max[a], x); }
      }
      return out;
    };

    it('the sample is saved exploded: base fixed, plate, component and lid lifted along +Y in that order', () => {
      expect(explode).toEqual(NIST_EXPLODE);
      expect(sample()).toHaveProperty('explode', JSON.parse(JSON.stringify(NIST_EXPLODE)));
      expect((E as Record<string, unknown>).F1).toBeUndefined();
      expect(E.F3[1]).toBeLessThan(E.F4[1]);
      expect(E.F2[1]).toBeGreaterThan(0);
      for (const v of Object.values(E)) { expect(v[0]).toBe(0); expect(v[2]).toBe(0); expect(Math.abs(v[1])).toBeLessThanOrEqual(150); }
    });

    it('the shown body: each part moves by exactly its offset along Y, the base stays, the lifted parts are apart, and collapsing restores the assembled body', async () => {
      const c = await load(sample());
      const body = bodies.at(-1) as ShowBody;
      const ins = insertIds(c.document() as never);
      const home = boxOf(body, ins);
      const shown = displayBody(body, { inserts: ins, hidden: new Set(), explode }) as ShowBody;
      const away = boxOf(shown, ins);
      for (const k of ['F1', 'F2', 'F3', 'F4']) {
        const want = (E as Record<string, readonly number[]>)[k] ?? [0, 0, 0];
        for (let a = 0; a < 3; a++) {
          expect(away.get(k)!.min[a] - home.get(k)!.min[a], `${k} min ${a}`).toBeCloseTo(want[a], 3);
          expect(away.get(k)!.max[a] - home.get(k)!.max[a], `${k} max ${a}`).toBeCloseTo(want[a], 3);
        }
      }
      // the parts stacked on each other are now separated along Y (lid above component above plate), by the stage gaps
      const gap = (up: string, down: string) => away.get(up)!.min[1] - away.get(down)!.max[1];
      expect(gap('F4', 'F3')).toBeCloseTo(50, 1);
      expect(gap('F2', 'F4')).toBeGreaterThan(50);
      expect(gap('F2', 'F4')).toBeLessThan(55);
      // were assembled: lid sat on the rim, component on the plate
      expect(Math.abs(home.get('F4')!.min[1] - home.get('F3')!.max[1])).toBeLessThan(1e-3);
      // the base is not moved and the centres the panel uses move by the offsets
      const c0 = componentCentres(body, ins).centres, c1 = componentCentres(shown, ins).centres;
      expect(c1.get('F1')).toEqual(c0.get('F1'));
      expect(c1.get('F2')![1] - c0.get('F2')![1]).toBeCloseTo(E.F2[1], 3);
      // collapse: no state, or a state with no offsets, hands back the very same body; zero offsets over an exploded one give the same positions bit for bit
      expect(displayBody(body, { inserts: ins, hidden: new Set(), explode: NO_EXPLODE })).toBe(body);
      expect(displayBody(body, { inserts: ins, hidden: new Set(), explode: readExplode({ spread: 0, manual: { F2: [0, 0, 0] } }) })).toBe(body);
      const back = displayBody(body, { inserts: ins, hidden: new Set(['F9']), explode: { spread: 0, dir: 'auto', manual: { F2: [0, 0, 0] } } }) as ShowBody;
      expect(Array.from(back.mesh.positions)).toEqual(Array.from(body.mesh.positions));
    }, 300_000);

    it('on the solids: at the exploded poses no pair intersects and every lifted part is apart from the others by its stage gap; at zero offset the contacts are the assembled ones', async () => {
      const c = await load(sample());
      const doc = JSON.parse(JSON.stringify(c.document())) as { features: Array<Record<string, unknown>> };
      const place = Object.fromEntries(c.components().map((x) => [x.id, x.place!]));
      const variant = (off: Record<string, readonly number[]>) => ({
        ...doc,
        features: doc.features.filter((f) => f.type === 'insertPart').map((f) => {
          const { dx, dy, dz, axis, angle, ...rest } = f as Record<string, unknown>; void dx; void dy; void dz; void axis; void angle;
          const p = place[f.id as string], d = off[f.id as string] ?? [0, 0, 0];
          return { ...rest, place: { o: [p.o[0] + d[0], p.o[1] + d[1], p.o[2] + d[2]], x: p.x, y: p.y, z: p.z } };
        }),
      }) as unknown as PartDoc;
      // collapsed: the same solved poses, the contacts of the assembly
      const s0 = await open(variant({}));
      const f0 = (await s0.facts()).faces;
      for (const [i, j] of [[1, 2], [1, 3], [3, 4]] as const) expect((await dist(s0, comp(f0, i), comp(f0, j))).distance).toBeLessThan(1e-6);
      // exploded
      const s1 = await open(variant(E));
      const f1 = (await s1.facts()).faces;
      const d = async (i: number, j: number) => dist(s1, comp(f1, i), comp(f1, j));
      for (const [i, j] of [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]] as const) expect((await d(i, j)).intersects, `F${i} / F${j}`).toBe(false);
      expect((await d(3, 4)).distance).toBeCloseTo(E.F4[1] - E.F3[1], 2);          // component lifted off the plate by the difference of the stages
      const pb = (await d(1, 3)).distance;                                           // plate off the standoffs; the nearest base face is now the drafted wall (2.4 mm measured), not the standoffs
      expect(pb).toBeGreaterThan(1); expect(pb).toBeLessThan(E.F3[1]);
      expect((await d(1, 2)).distance).toBeCloseTo(E.F2[1], 2);                      // lid off the rim
      expect((await d(2, 4)).distance).toBeGreaterThan(50);
    }, 300_000);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

// The petaloid base of the PET bottle sample: two lofts through round sections (outer solid and cavity) and a rounded push-up centre, no fillet anywhere.
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const script = () => readFileSync(resolve(process.cwd(), 'docs/examples/pet-bottle-shell.script.ts'), 'utf8');
async function run(code: string) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  const r = await runScript(code, h);
  return { r, s: sessions.at(-1)! };
}

/** The sharpest angle (degrees) between the normals of two triangles that share an edge, among the triangles of the lower `zMax` mm; slivers (under 0.01 mm2) are ignored. */
function sharpest(positions: ArrayLike<number>, zMax: number): { angle: number; triangles: number } {
  const key = (i: number) => `${Math.round(positions[i] * 1000)},${Math.round(positions[i + 1] * 1000)},${Math.round(positions[i + 2] * 1000)}`;
  const ids = new Map<string, number>();
  const normals: Array<[number, number, number] | null> = [];
  const edges = new Map<string, number[]>();
  for (let t = 0; t < positions.length; t += 9) {
    if ((positions[t + 2] + positions[t + 5] + positions[t + 8]) / 3 >= zMax) continue;
    const ux = positions[t + 3] - positions[t], uy = positions[t + 4] - positions[t + 1], uz = positions[t + 5] - positions[t + 2];
    const vx = positions[t + 6] - positions[t], vy = positions[t + 7] - positions[t + 1], vz = positions[t + 8] - positions[t + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
    const id = normals.length;
    normals.push(len / 2 < 0.01 ? null : [nx / len, ny / len, nz / len]);
    const vs = [0, 3, 6].map((o) => { const k = key(t + o); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k)!; });
    for (let e = 0; e < 3; e++) { const a = vs[e], b = vs[(e + 1) % 3]; const ek = a < b ? `${a}_${b}` : `${b}_${a}`; (edges.get(ek) ?? edges.set(ek, []).get(ek)!).push(id); }
  }
  let worst = 0;
  for (const l of edges.values()) {
    if (l.length !== 2) continue;
    const a = normals[l[0]], b = normals[l[1]];
    if (!a || !b) continue;
    worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI);
  }
  return { angle: worst, triangles: normals.length };
}

describe('PET bottle: petaloid base', () => {
  it('is a valid shelled solid, stands on z = 0, has the 500 ml size and no sharp edge in the base', async () => {
    const { r, s } = await run(script().replace('CAP: 1', 'CAP: 0').replace('THREAD: 1', 'THREAD: 0') + `\nP.expectValid().expectBBox({ min: [-33, -33, 0], max: [33, 33, 205] }, { tol: 0.05 });\n`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
    const m = await s.massProps({ bodies: true });
    expect(m.bodies).toHaveLength(1);                                   // the cavity body is used up by the cut
    expect(m.volume!).toBeGreaterThan(14000); expect(m.volume!).toBeLessThan(15000);   // a 0.35 mm wall: the old grooved base was 15317
    const em = await s.exportMesh({ quality: 'fine' });
    expect(em.failed).toEqual([]);
    let zMin = Infinity;
    for (let i = 2; i < em.mesh.positions.length; i += 3) zMin = Math.min(zMin, em.mesh.positions[i]);
    expect(zMin).toBeGreaterThan(-0.05);
    const w = sharpest(em.mesh.positions, 34);                          // feet, valley ribs, push-up and the join with the cylinder: every edge a smooth blend
    expect(w.triangles).toBeGreaterThan(20000);
    expect(w.angle).toBeLessThan(30);
    expect((await s.verify()).regen.errors).toEqual([]);
  }, 300_000);

  it('builds with 3, 4, 6 and 7 feet and with a 0.5 mm wall', async () => {
    for (const [from, to] of [['FEET: 5', 'FEET: 3'], ['FEET: 5', 'FEET: 4'], ['FEET: 5', 'FEET: 6'], ['FEET: 5', 'FEET: 7'], ['WALL: 0.35', 'WALL: 0.5']]) {
      const { r } = await run(script().replace(from, to).replace('CAP: 1', 'CAP: 0') + `\nP.expectValid();\n`);
      expect(r.errors.map((e) => e.message), to).toEqual([]);
    }
  }, 900_000);
});

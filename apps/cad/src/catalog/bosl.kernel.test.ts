// The BOSL2 catalog entries against the real kernel AND against OpenSCAD: bosl_reference.json holds, for every entry and
// parameter set, the volume and bounding box of the BOSL2 shape as OpenSCAD built it (tools/bosl_reference.mjs regenerates it;
// OpenSCAD is not needed to run this test). Each entry is built from its script text through the Script runner.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { runScript, type ScriptHost } from '@kit/script';
import { Controller, type KernelFactory } from '../controller';
import { boslEntry, type Params, type Place } from './bosl/entries';

interface Ref { name: string; params: Params; scad: string; volume: number; area: number; bbox: { min: number[]; max: number[] } }
import reference from './bosl_reference.json';
const REF = reference as unknown as { openscad: string; bosl2: { commit: string }; fn: number; entries: Record<string, Ref[]> };

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  const host: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
  };
  return { host, controller };
}
const GROUND: Place = { plane: "'front'", ground: true, at: [0, 0], prefix: null };

/** Curved shapes are compared at 0.3 percent (OpenSCAD facets at $fn), flat ones to 1e-6. */
const FLAT = new Set(['prismoid', 'wedge', 'rect_tube']);
const isFlat = (id: string, p: Params): boolean => FLAT.has(id) || (id === 'cuboid' && !(Number(p.rounding) > 0)) || (id === 'regular_prism' && !(Number(p.rounding) > 0));

export const report: string[] = [];
describe(`BOSL2 entries vs OpenSCAD (${REF.openscad}, BOSL2 ${REF.bosl2.commit.slice(0, 8)}, $fn=${REF.fn})`, { skip: !process.env.CK_WASM, timeout: 180000 }, () => {
  for (const [id, cases] of Object.entries(REF.entries)) {
    const entry = boslEntry(id)!;
    for (const c of cases) {
      it(`${id} ${c.name}`, async () => {
        expect(entry.check(c.params), 'parameters are valid').toBeNull();
        const w = await world();
        const code = entry.script(c.params, GROUND);
        const r = await runScript(code, w.host);
        expect(r.errors, code).toEqual([]);
        const s = sessions.at(-1)!;
        const volume = ((await s.massProps()) as { volume: number }).volume;
        const valid = ((await s.validate()) as { ok: boolean }).ok;
        // The kernel's own bounding box (check) is exact for planes, cylinders and extrusions but misses the extent of a revolved
        // face (kernel gap, see docs/catalog-bosl.md); the display mesh is complete but faceted. The union of the two is right
        // for every entry within the tessellation tolerance.
        const m = ((await s.check({ volume: 1 })) as unknown as { measured: { bbox: { min: number[]; max: number[] }; solids: number } }).measured;
        const mesh = w.controller.bodyBox()!;
        const box = { min: [0, 1, 2].map((i) => Math.min(m.bbox.min[i], mesh.min[i])), max: [0, 1, 2].map((i) => Math.max(m.bbox.max[i], mesh.max[i])) };
        expect(m.solids, 'one solid').toBe(1);
        const flat = isFlat(id, c.params);
        const err = Math.abs(volume - c.volume) / c.volume;
        const bboxErr = Math.max(...[0, 1, 2].flatMap((i) => [Math.abs(box.min[i] - c.bbox.min[i]), Math.abs(box.max[i] - c.bbox.max[i])]));
        console.log(`ORACLE ${id} ${c.name} vol_err=${err.toExponential(2)} bbox_err=${bboxErr.toFixed(4)} ours=${volume.toFixed(3)} ref=${c.volume.toFixed(3)}`);
        expect(valid, 'valid solid').toBe(true);
        expect(err, `volume ${volume} vs ${c.volume}`).toBeLessThan(flat ? 1e-6 : 0.003);
        expect(bboxErr, `bbox ${JSON.stringify(box)} vs ${JSON.stringify(c.bbox)}`).toBeLessThan(flat ? 0.01 : 0.004 * Math.max(...c.bbox.max.map((v, i) => v - c.bbox.min[i])));
      });
    }
  }
});

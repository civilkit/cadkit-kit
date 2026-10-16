// Repro for docs/matx-corner-bug.md (run through tools/repro_union_corner.mjs): a hole drilled in a plate, a pad fused under it
// (which closes the hole from below), the same hole drilled again through pad and plate. The kernel reports a valid solid, but the
// hole's wall faces get NO triangles in the display mesh, so the hole rims are open mesh edges (a black patch in the viewport).
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../apps/cad/src/controller';
import { runScript, type ScriptHost } from '@kit/script';

function meshStats(m: { positions: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }) {
  const P = m.positions, key = (i: number) => [0, 1, 2].map((k) => Math.round(P[3 * i + k] / 1e-4)).join(',');
  const uses = new Map<string, number>();
  for (let t = 0; t < m.triFace.length; t++) {
    const v = [3 * t, 3 * t + 1, 3 * t + 2].map(key);
    for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3]; if (a === b) continue; const k = a < b ? a + '|' + b : b + '|' + a; uses.set(k, (uses.get(k) ?? 0) + 1); }
  }
  const open = [...uses.values()].filter((n) => n === 1).length;
  const seen = new Set<number>(); for (let t = 0; t < m.triFace.length; t++) seen.add(m.triFace[t]);
  return { open, noTri: m.faceIds.filter((_, i) => !seen.has(i)) };
}
const sessions: Session[] = [];
async function run(name: string, src: string) {
  const store = createStore();
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
  };
  const r = await runScript(src, h);
  const s = sessions.at(-1)!;
  const v = await s.validate(), mp = (await s.massProps()) as { volume: number };
  const m = controller.bodyFaces();
  const st = m ? meshStats(m) : { open: -1, noTri: [] as string[] };
  console.log(`${name}: errors=${JSON.stringify(r.errors.map((e) => e.message))} valid=${v.ok} issues=${v.issues.length} volume=${mp.volume.toFixed(2)} openMeshEdges=${st.open} facesWithoutTriangles=${JSON.stringify(st.noTri)}`);
}
const HEAD = `const P = part('x');
const CUT = (d) => P.cut(d, { flip: true });
const run = (op, d) => (op === 'cut' ? CUT(d) : P.extrude(d));
const bx = (x, y, z, l, w, h, op) => { P.sketch(at('front', x), (s) => s.rect(w, h, [y + w / 2, z + h / 2])); run(op, l); };
const cylZ = (list, z, r, l, op) => { P.sketch(at('top', z), (s) => { list.forEach((c) => s.circle(r, [c[1], -c[0]])); }); run(op, l); };
`;
const PLATE = `bx(-168, -75.5, -180, 336, 151, 4);`, HOLE = `cylZ([[-154, 51]], -181, 3.15, 6, 'cut');`, PAD = `bx(-170, 40, -183, 25.2, 40, 3);`, DRILL = `cylZ([[-154, 51]], -186, 3.15, 10, 'cut');`;
const variants: Array<[string, string]> = [
  ['A plate, hole, pad under it, drill again (the case)', HEAD + PLATE + HOLE + PAD + DRILL],
  ['B plate, pad, one drill (control)', HEAD + PLATE + PAD + DRILL],
  ['C plate, hole, pad, no second drill (control)', HEAD + PLATE + HOLE + PAD],
  ['D as A, second drill r=3.1', HEAD + PLATE + HOLE + PAD + DRILL.replace('3.15', '3.1')],
  // second defect (why the corner blocks have no rounded ends): the whole closed top edge chain of a rounded rectangle (lines + tangent arcs) cannot be filleted
  ['E rounded rectangle, fillet r=1 on the whole top chain (blendFailed expected, volume stays 11450.62)', `const P = part('x'); P.sketch(at('front', 0), (s) => s.rrect(40, 30, 8, [0, 0])).extrude(10); P.fillet(edges('>Z'), 1);`],
  ['F same, only the four straight top edges (works, 11431.70)', `const P = part('x'); P.sketch(at('front', 0), (s) => s.rrect(40, 30, 8, [0, 0])).extrude(10); P.fillet(edges({ intersect: [edges('>Z'), edges({ not: edges({ onFace: faces({ kind: 'cylinder' }) }) })] }), 1);`],
];
try { for (const [n, s] of variants) await run(n, s); } finally { await Promise.all(sessions.map((s) => s.close().catch(() => {}))); }
process.exit(0);

import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function host() {
  const store = createStore();
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
  };
  const mp = async () => (await sessions.at(-1)!.massProps()) as { volume: number };
  return { h, mp, controller };
}
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { matxScript } from './matx';

const FC_FILE = '/path/to/work/scratch-matx/fc/vols2.json';   // scratch reference volumes: the tests below skip when it is absent
const FC = (existsSync(FC_FILE) ? JSON.parse(readFileSync(FC_FILE, 'utf8')) : {}) as Record<string, number>;
const sum = (re: RegExp) => Object.entries(FC).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0);
const GROUPS: Record<string, RegExp> = {
  hoops: /^HOOP/, strips: /^STRIP/, rear: /^PANEL_rear/, base: /^BASE/, top: /^PANEL_top/, front: /^PANEL_front/,
  blocks: /^BLOCK/, refs: /^(PSU|BOARD|FAN)/, rivets: /^RIVET/, slats: /^SLAT/, tray: /^TRAY/, straps: /^STRAP/,
};
const only = (process.env.MATX_ONLY ?? '').split(',').filter(Boolean);
// edges (welded to 1e-4 mm) used by exactly one triangle: holes in the display mesh; faces without triangles
function meshStats(m: { positions: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] }) {
  const P = m.positions, key = (i: number) => [0, 1, 2].map((k) => Math.round(P[3 * i + k] / 1e-4)).join(',');
  const uses = new Map<string, { n: number; face: number; a: number }>();
  const nt = m.triFace.length;
  for (let t = 0; t < nt; t++) {
    const v = [3 * t, 3 * t + 1, 3 * t + 2].map(key);
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      if (a === b) continue;
      const k = a < b ? a + '|' + b : b + '|' + a, u = uses.get(k);
      if (u) u.n++; else uses.set(k, { n: 1, face: m.triFace[t], a: 3 * t + e });
    }
  }
  const open = [...uses.entries()].filter(([, u]) => u.n === 1).map(([k, u]) => ({ k, face: m.faceIds[u.face], p: [P[3 * u.a], P[3 * u.a + 1], P[3 * u.a + 2]] }));
  const seen = new Set<number>(); for (let t = 0; t < nt; t++) seen.add(m.triFace[t]);
  const noTri = m.faceIds.filter((_, i) => !seen.has(i));
  return { open, noTri };
}
describe('matx components', { skip: !existsSync(FC_FILE) }, () => {
  for (const g of Object.keys(GROUPS)) {
    it.skipIf(only.length > 0 && !only.includes(g))('component ' + g, async () => {
      const { h, mp, controller } = await host();
      const t0 = Date.now();
      const r = await runScript(matxScript([g]), h);
      const v = (await mp()).volume, ref = sum(GROUPS[g]);
      const row = `${g}\t${ref.toFixed(1)}\t${v.toFixed(1)}\t${((v - ref) / ref * 100).toFixed(3)}%\t${Date.now() - t0}ms\terrors=${JSON.stringify(r.errors).slice(0, 300)}`;
      console.log('ROW ' + row);
      writeFileSync('/path/to/work/scratch-matxfix/rows.txt', row + '\n', { flag: 'a' });
      expect(r.errors).toEqual([]);
    }, 300000);
  }
});
describe('matx debug', () => {
  it.skipIf(!process.env.MATX_DEBUG)('block notch', async () => {
    const { h, mp } = await host();
    const r = await runScript(matxScript([]) + process.env.MATX_DEBUG, h);
    console.log('DBG', JSON.stringify(r.errors), (await mp()).volume);
  }, 600000);
});
describe('matx whole case', () => {
  it.skipIf(!process.env.MATX_ALL)('all components as one part', async () => {
    const { h, mp, controller } = await host();
    const t0 = Date.now();
    const r = await runScript(matxScript(), h);
    const v = (await mp()).volume, ref = Object.values(FC).reduce((a, b) => a + b, 0);
    console.log('ALL', JSON.stringify(r.errors).slice(0, 600), 'steps', (r.document as { features: unknown[] }).features.length, 'vol', v.toFixed(1), 'fc', ref.toFixed(1), ((v - ref) / ref * 100).toFixed(3) + '%', Date.now() - t0, 'ms', JSON.stringify(controller.bodyBox()));
    writeFileSync(process.env.MATX_OUT ?? '/path/to/work/scratch-matxfix/case.json', JSON.stringify(r.document));
    expect(r.errors).toEqual([]);
    const m = controller.bodyFaces()!, st = meshStats(m);
    const val = await sessions.at(-1)!.validate();
    console.log('MESH', JSON.stringify({ tris: m.triFace.length, openEdges: st.open.length, noTri: st.noTri, valid: val.ok, issues: val.issues.length }));
    writeFileSync('/path/to/work/scratch-matxfix/mesh.json', JSON.stringify({ positions: Array.from(m.positions), triFace: Array.from(m.triFace), faceIds: m.faceIds, open: st.open, issues: val.issues }));
    expect(val.issues).toEqual([]);
    expect(st.open).toEqual([]);
  }, 900000);
});

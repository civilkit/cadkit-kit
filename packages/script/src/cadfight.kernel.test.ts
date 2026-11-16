import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const opened: Session[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((s) => s.close().catch(() => {}))); });

async function rig() {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); opened.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('start'));
  const host: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: async (ops, why) => (await controller.edit(ops, why)) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d: Record<string, unknown>, v: boolean) => controller.scratchBuild(d as never, v) as never,
    release: () => controller.scratchRelease(),
    facts: (n: { mass?: boolean; validate?: boolean; describe?: string[] }) => controller.scratchFacts(n),
  };
  const volume = async () => ((await (opened.at(-1) as Session).massProps()) as { volume: number }).volume;
  return { host, volume, controller };
}

// One octant (corner sphere + three half edge rods + the diagonal), three whole-body mirrors, the centre ball, then the 32 collars.
const OCT = (fillet: boolean) => `
const A = 25, L = 26, D = Math.sqrt(3) * A - 9;
const p = part('CADFight').feature({ type: 'sphere', center: [A, A, A], radius: 7.5 });
const ball = p.handle();
p.sketch(at({ origin: [A, A, A], normal: [-1, 0, 0], xdir: [0, 1, 0] }), (s) => s.circle(2)).extrude(L);
const rx = p.handle();
p.sketch(at({ origin: [A, A, A], normal: [0, -1, 0], xdir: [1, 0, 0] }), (s) => s.circle(2)).extrude(L);
const ry = p.handle();
p.sketch(at({ origin: [A, A, A], normal: [0, 0, -1], xdir: [1, 0, 0] }), (s) => s.circle(2)).extrude(L);
const rz = p.handle();
p.sketch(at({ origin: [A, A, A], normal: [-1, -1, -1] }), (s) => s.circle(2)).extrude(D);
const rd = p.handle();
p.mirror('right', { body: true }).mirror('top', { body: true }).mirror('front', { body: true });
p.feature({ type: 'sphere', center: [0, 0, 0], radius: 10 });
const hub = p.handle();
for (const h of [ball, hub]) p.appearance({ face: h, colour: '#f2c230', finish: 'plastic' });
for (const h of [rx, ry, rz, rd]) p.appearance({ face: h, colour: '#1a1a1a', finish: 'plastic' });
${fillet ? `p.fillet(edges({ lengthGreater: 11, lengthLess: 14, outside: [[-18, -18, -18], [18, 18, 18]] }), 2);
p.appearance({ face: p.handle(), colour: '#e8791a', finish: 'plastic' });
p.fillet(edges({ lengthGreater: 11, lengthLess: 14, inside: [[-12, -12, -12], [12, 12, 12]] }), 2);
p.appearance({ face: p.handle(), colour: '#e8791a', finish: 'plastic' });` : ''}
p.expectValid();
`;

describe('CAD Fight lattice', () => {
  for (const fillet of [false, true]) {
    it(`builds ${fillet ? 'with' : 'without'} the collars`, async () => {
      const r = await rig();
      const res = await runScript(OCT(fillet), r.host);
      console.log('CADFIGHT', fillet, JSON.stringify(res.errors), JSON.stringify(res.warnings ?? []).slice(0, 600));
      const doc = (r.controller as unknown as { doc?: { features?: unknown[] } }).doc;
      console.log('CADFIGHT features', doc?.features?.length, 'volume', await r.volume().catch((e) => String(e)));
      const fi = ((r.controller as any).bodyFaces()?.faceIds ?? []) as string[];
      const cnt: Record<string, number> = {}; for (const f of fi) { const k = f.split('.').slice(0, 2).join('.'); cnt[k] = (cnt[k] ?? 0) + 1; }
      console.log('CADFIGHT faces', fi.length, JSON.stringify(cnt).slice(0, 1500));
      console.log('CADFIGHT faceAppearance', JSON.stringify((r.controller as any).docExtra?.faceAppearance ?? null));
      expect(res.errors).toEqual([]);
    }, 300000);
  }
});

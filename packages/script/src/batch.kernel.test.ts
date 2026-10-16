import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type RunOptions, type ScriptHost } from './index';
import { matxScript } from './matx';

// The app opens every part on ONE shared kernel (so its regen cache outlives a load); the test does the same.
const opened: Session[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((s) => s.close().catch(() => {}))); });

interface Counts { regens: number; viewRegens: number; headless: number; kernelMs: number }
async function rig() {
  const base = await Session.open(emptyPart('base'));
  opened.push(base);
  const raw = (base as unknown as { kernel: { request(m: Record<string, unknown>): Promise<unknown> } }).kernel;
  const counts: Counts = { regens: 0, viewRegens: 0, headless: 0, kernelMs: 0 };
  const transport = {
    request: async (m: Record<string, unknown>) => {
      const t = performance.now();
      try { return await raw.request(m); } finally {
        if (m.type === 'regen') {
          counts.regens++; counts.kernelMs += performance.now() - t;
          if ((m.opts as { noView?: boolean } | undefined)?.noView) counts.headless++; else counts.viewRegens++;
        }
      }
    },
  };
  let last: Session | null = null;
  const kernel: KernelFactory = { async open(d) { last = new Session(d, transport as never, 'user'); return last; } };
  let setBody = 0;
  const controller = new Controller({ store: createStore(), view: { setBody() { setBody++; }, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('start'));   // the app always has a part open
  counts.regens = counts.viewRegens = counts.headless = 0; counts.kernelMs = 0;
  const host = (build: boolean): ScriptHost => ({
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: async (ops, why) => (await controller.edit(ops, why)) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    ...(build ? { build: (d: Record<string, unknown>, v: boolean) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease() } : {}),
  });
  setBody = 0;
  return { controller, host, counts, setBody: () => setBody, history: () => last!.history().length, mass: async () => ((await last!.massProps()) as { volume: number }).volume };
}

const FRAME = matxScript(['blocks', 'strips', 'hoops']);
async function run(batched: boolean, opts: RunOptions = {}, code = FRAME) {
  const r = await rig();
  const t0 = performance.now();
  const res = await runScript(code, r.host(batched), {}, { batched, ...opts });
  const ms = performance.now() - t0;
  return { r, res, ms };
}

describe('batched script run', () => {
  it('builds the frame in one undo entry and fewer regenerations than the per-step path', async () => {
    const old = await run(false);
    const neu = await run(true);
    const feats = (neu.res.document as { features: unknown[] }).features.length;
    console.log('BATCH', JSON.stringify({ feats, old: { ms: Math.round(old.ms), ...old.r.counts, setBody: old.r.setBody(), hist: old.r.history() }, neu: { ms: Math.round(neu.ms), ...neu.r.counts, setBody: neu.r.setBody(), hist: neu.r.history(), stats: neu.res.stats } }));
    expect(old.res.errors).toEqual([]);
    expect(neu.res.errors).toEqual([]);
    expect(neu.r.history()).toBe(1);
    expect(neu.r.counts.viewRegens).toBeLessThanOrEqual(2);
    expect(neu.r.setBody()).toBeLessThanOrEqual(2);
    expect(old.r.history()).toBeGreaterThan(50);
    expect(neu.ms).toBeLessThan(old.ms);
    // same part
    expect(Math.abs((await neu.r.mass()) - (await old.r.mass()))).toBeLessThan(1e-6 * Math.abs(await old.r.mass()));
    expect(neu.r.controller.document()!.features.length).toBe(feats);
  }, 300000);

  it('one headless build for the whole list: two regenerations besides the empty part', async () => {
    const { r, res } = await run(true, { flushEvery: Infinity });
    expect(res.errors).toEqual([]);
    expect(res.stats!.builds).toBe(1);
    expect(res.stats!.viewBuilds).toBe(0);
    expect(r.counts.viewRegens).toBeLessThanOrEqual(2);   // the empty part and the finished list
    expect(r.counts.headless).toBeLessThanOrEqual(2);     // the build, and the release of the scratch state
  }, 300000);

  it('a selector gets its body from a view build; steps without one never do', async () => {
    const code = `const p = part('b'); p.sketch('front', (s) => s.rect(60, 40)).extrude(12); p.hole(face('>Z'), [-15, 0], { diameter: 8 }); p.fillet(edges('|Z'), 4);`;
    const { r, res } = await run(true, {}, code);
    expect(res.errors).toEqual([]);
    expect(res.stats!.viewBuilds).toBeGreaterThanOrEqual(1);
    expect(res.stats!.viewBuilds).toBeLessThanOrEqual(2);
    expect(r.history()).toBe(1);
    expect(r.controller.document()!.features.length).toBeGreaterThanOrEqual(4);
  }, 120000);

  it('a step the kernel refuses stops the run with its line and opens the part up to the step before', async () => {
    const code = `const p = part('b');\np.sketch('front', (s) => s.rect(40, 30)).extrude(20);\np.fillet(edges('|Z'), 500);\np.sketch('front', (s) => s.rect(5, 5)).extrude(5);`;
    const { r, res } = await run(true, { flushEvery: 1 }, code);
    const legacy = await run(false, {}, code);
    console.log('REFUSE', JSON.stringify({ neu: res.errors, old: legacy.res.errors, nNew: r.controller.document()!.features.length, nOld: legacy.r.controller.document()!.features.length }));
    expect(res.errors.length).toBe(legacy.res.errors.length);
    expect(res.errors.length).toBeGreaterThan(0);
    if (res.errors.length) expect(res.errors[0].line).toBe(legacy.res.errors[0].line);
    expect(r.controller.document()!.features.length).toBe(legacy.r.controller.document()!.features.length);
  }, 120000);

  it('cancel leaves the open document untouched and loads nothing', async () => {
    const r = await rig();
    await r.controller.load(emptyPart('keep'));
    const before = r.controller.document();
    const signal = { aborted: false };
    let seen = 0;
    const res = await runScript(FRAME, r.host(true), {}, { flushEvery: 10, signal, onProgress: (p) => { seen = p.done; if (p.done >= 20) signal.aborted = true; } });
    expect(res.cancelled).toBe(true);
    expect(seen).toBeGreaterThanOrEqual(20);
    expect(r.controller.document()).toEqual(before);
    expect(r.history()).toBe(0);
  }, 120000);
});

describe('whole mATX case (MATX_FULL=1)', () => {
  it.skipIf(!process.env.MATX_FULL)('batched', async () => {
    const { r, res, ms } = await run(true, {}, matxScript());
    console.log('FULLNEW', JSON.stringify({ ms: Math.round(ms), errors: res.errors.length, feats: r.controller.document()!.features.length, ...r.counts, setBody: r.setBody(), hist: r.history(), stats: res.stats, vol: await r.mass() }));
    expect(res.errors).toEqual([]);
  }, 900000);
});

// Teardrop holes against the real kernel: the wedge cut as deep as the hole adds exactly the teardrop's area beyond the round hole, goes into the
// part (not out of it), and points where it was told. Skipped without a kernel (CK_WASM).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { runScript, type ScriptHost } from '@kit/script';
import { Controller, type KernelFactory } from './controller';
import { planTeardrop, teardropArea, teardropScript } from './teardrop';
import './locales/en';

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
    build: (d: Record<string, unknown>, v: boolean) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(),
    facts: (n: { mass?: boolean; validate?: boolean }) => controller.scratchFacts(n as never) as never,
  } as ScriptHost;
  const volume = async () => ((await (opened.at(-1) as Session).massProps()) as { volume: number }).volume;
  return { host, volume };
}

/** A block 40 wide (x from x0 to x1) and 40 deep, 10 tall along Y, with a round hole of the given diameter at the origin, then the teardrop wedge. */
function script(x0: number, x1: number, d: number, depth: number | 'through', toward: [number, number, number], extra: Partial<Parameters<typeof planTeardrop>[1]> = {}): string {
  const through = depth === 'through';
  const plan = planTeardrop({ mouth: [0, 10, 0], out: [0, 1, 0], diameter: d, thickness: through ? 10 : depth, through }, { toward, ...extra });
  if (!plan.ok) throw new Error(plan.issue);
  const hole = `p.sketch(at({ origin: [0, 10, 0], normal: [0, 1, 0], xdir: [1, 0, 0] }), (s) => s.circle(${d / 2})).cut(${through ? 'through()' : depth});`;
  const wedge = teardropScript(plan.plan).split('\n').slice(1).join('\n');
  return `const p = part('T'); p.sketch('top', (s) => s.polygon([[${x0}, -20], [${x1}, -20], [${x1}, 20], [${x0}, 20]])).extrude(10);\n${hole}\n${wedge}`;
}

describe('teardrop holes on the kernel', () => {
  it('a through hole: the round hole plus the wedge removes the teardrop\'s area over the whole height', async () => {
    const { host, volume } = await rig();
    const r = await runScript(script(-20, 20, 8, 'through', [1, 0, 0]), host);
    expect(r.errors).toEqual([]);
    expect(await volume()).toBeCloseTo(40 * 40 * 10 - teardropArea(8) * 10, 1);
  });
  it('a blind hole: the wedge is only as deep as the hole', async () => {
    const { host, volume } = await rig();
    const r = await runScript(script(-20, 20, 8, 6, [0, 0, 1]), host);
    expect(r.errors).toEqual([]);
    expect(await volume()).toBeCloseTo(40 * 40 * 10 - teardropArea(8) * 6, 1);
  });
  it('a flat top removes the flat teardrop\'s area', async () => {
    const { host, volume } = await rig();
    const r = await runScript(script(-20, 20, 8, 'through', [1, 0, 0], { flat: true }), host);
    expect(r.errors).toEqual([]);
    expect(await volume()).toBeCloseTo(40 * 40 * 10 - teardropArea(8, 45, true) * 10, 1);
  });
  it('the peak points where it is told: toward a thin wall it breaks through, away from it it does not', async () => {
    const wall = async (toward: [number, number, number]) => {
      const { host, volume } = await rig();
      // the block ends 5 mm from the hole's centre on the +X side; the peak reaches 5.66 mm
      const r = await runScript(script(-20, 5, 8, 'through', toward), host);
      expect(r.errors).toEqual([]);
      return volume();
    };
    const toward = await wall([1, 0, 0]);   // the tip goes beyond the block: less is removed than the whole teardrop
    const away = await wall([-1, 0, 0]);    // the tip stays inside the block: the whole teardrop is removed
    expect(away).toBeCloseTo(25 * 40 * 10 - teardropArea(8) * 10, 1);
    expect(toward).toBeGreaterThan(away + 1);
  });
});

describe('applyTeardrop on the open part', () => {
  it('adds the plane, the sketch and the cut to a part with a hole, in one folder and one undo step', async () => {
    const { applyTeardrop } = await import('./teardropApply');
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); opened.push(s); return s; } };
    const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await controller.load(emptyPart('start'));
    const host: ScriptHost = {
      load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
      edit: async (ops, why) => (await controller.edit(ops, why)) as never,
      geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
      build: (d: Record<string, unknown>, v: boolean) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(),
      facts: (n: { mass?: boolean; validate?: boolean }) => controller.scratchFacts(n as never) as never,
    } as ScriptHost;
    const base = script(-20, 20, 8, 'through', [1, 0, 0]).split('\n').slice(0, 2).join('\n');   // the block and the round hole
    expect((await runScript(base, host)).errors).toEqual([]);
    const before = (controller.document() as unknown as { features: unknown[] }).features.length;
    const plan = planTeardrop({ mouth: [0, 10, 0], out: [0, 1, 0], diameter: 8, thickness: 10, through: true }, { toward: [1, 0, 0] });
    if (!plan.ok) throw new Error(plan.issue);
    const r = await applyTeardrop(controller, teardropScript(plan.plan), 'Teardrop');
    expect(r.ok).toBe(true);
    const feats = (controller.document() as unknown as { features: Array<{ type: string; group?: string }> }).features;
    const added = feats.slice(before);
    expect(added.length).toBeGreaterThanOrEqual(2);
    expect(added.every((f) => f.group === 'Teardrop')).toBe(true);
    expect(await (async () => ((await (opened.at(-1) as Session).massProps()) as { volume: number }).volume)()).toBeCloseTo(40 * 40 * 10 - teardropArea(8) * 10, 1);
    await controller.undo();   // one step takes the whole folder away
    expect((controller.document() as unknown as { features: unknown[] }).features.length).toBe(before);
  });

  it('two holes in one script both get their peak', async () => {
    const { host, volume } = await rig();
    const holeAt = (x: number) => ({ mouth: [x, 10, 0] as [number, number, number], out: [0, 1, 0] as [number, number, number], diameter: 8, thickness: 10, through: true });
    const plans = [-10, 10].map((x) => { const r = planTeardrop(holeAt(x), { toward: [0, 0, 1] }); if (!r.ok) throw new Error(r.issue); return r.plan; });
    const round = [-10, 10].map((x) => `p.sketch(at({ origin: [${x}, 10, 0], normal: [0, 1, 0], xdir: [1, 0, 0] }), (s) => s.circle(4)).cut(through());`).join('\n');
    const code = `const p = part('T'); p.sketch('top', (s) => s.polygon([[-20, -20], [20, -20], [20, 20], [-20, 20]])).extrude(10);\n${round}\n${teardropScript(plans).split('\n').slice(1).join('\n')}`;
    expect((await runScript(code, host)).errors).toEqual([]);
    expect(await volume()).toBeCloseTo(40 * 40 * 10 - 2 * teardropArea(8) * 10, 1);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { applyConfig, readConfigs, readVars } from './variables';

const sample = (): PartDoc => JSON.parse(readFileSync(resolve(process.cwd(), 'apps/cad/public/samples/parametric-bracket.ckpart'), 'utf8')) as PartDoc;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view, kernel });
  await controller.load(sample());
  const size = () => { const b = controller.bodyBox()!; return b.max.map((m, i) => +(m - b.min[i]).toFixed(3)).sort((a, c) => a - c); };
  const volume = async () => (await controller.massProps())?.volume as number;
  return { controller, size, volume };
}

describe('parametric-bracket sample', { skip: !process.env.CK_WASM }, () => {
  it('builds from its four variables; every configuration rebuilds a valid, smaller or larger part', async () => {
    const w = await world();
    expect(w.size()).toEqual([6, 40, 60]);
    const v0 = await w.volume();
    // two 8 mm holes through a 60 x 40 x 6 plate
    expect(v0).toBeCloseTo(60 * 40 * 6 - 2 * Math.PI * 16 * 6, 0);
    const doc = () => w.controller.document()!;
    const cfg = (n: string) => readConfigs(doc()).find((c) => c.name === n)!;
    for (const [name, dims] of [['Small', [4, 30, 40]], ['Large', [10, 60, 100]], ['Standard', [6, 40, 60]]] as const) {
      const r = await w.controller.applyDocPatch({ variables: applyConfig(readVars(doc()), cfg(name)), activeConfig: name }, 'vars.step.config');
      expect(r.ok, name).toBe(true);
      expect(w.size(), name).toEqual([...dims]);
    }
    const hole = readVars(doc()).map((v) => (v.name === 'hole' ? { ...v, expr: 'width/10' } : v));
    expect((await w.controller.applyDocPatch({ variables: hole }, 'vars.step.set')).ok).toBe(true);
    expect(await w.volume()).toBeCloseTo(60 * 40 * 6 - 2 * Math.PI * 9 * 6, 0);
  });
});

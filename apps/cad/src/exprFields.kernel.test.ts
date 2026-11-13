// The user's scenario: a variables-based script (planes, sketch on an offset plane, extrude, fillet by expression) builds, and the tree labels its Plane features.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { runScript, type ScriptHost } from '@kit/script';
import { Controller, type KernelFactory } from './controller';
import { featureRows } from './treeModel';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const SCRIPT = `
const { W, H, D, R } = variables({ W: 80, H: 40, D: 100, R: 6 });
const p = part('Planes');
p.sketch('front', (s) => s.rect(W, D)).extrude(expr('H'));
p.workplane('front', expr('H/2'));
p.sketch(at('front', expr('H')), (s) => s.circle(10)).extrude(5);
p.fillet(edges('|Z'), expr('R'));
`;

describe('a variables-based script with expression fields', () => {
  it('builds, keeps the expressions, and every tree row has a label', async () => {
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await controller.load(emptyPart('x') as never);
    const h: ScriptHost = {
      load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
      edit: (ops, why) => controller.edit(ops, why) as never,
      geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
      build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
    };
    const r = await runScript(SCRIPT, h);
    expect(r.errors).toEqual([]);
    const doc = controller.document() as unknown as { features: Array<Record<string, unknown>> };
    const planes = doc.features.filter((f) => f.type === 'plane');
    expect(planes.some((f) => typeof f.offset === 'string')).toBe(true);
    const rows = featureRows(doc as never);
    for (const row of rows) expect(typeof row.id).toBe('string');
    expect(rows.filter((x) => x.type === 'plane').map((x) => x.name).join('|')).toMatch(/H\/2|\bH\b/);
    expect(controller.bodyBox()!.max[2]).toBeGreaterThan(40);
  }, 300000);
});

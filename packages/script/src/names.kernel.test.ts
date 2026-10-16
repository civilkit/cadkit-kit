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
  return { h, controller };
}
type F = { id: string; type: string; name?: string; group?: string };

describe('script feature names and groups', () => {
  it('names solids after their sketch, takes name options, groups features, and the kernel keeps both', async () => {
    const { h, controller } = await host();
    const r = await runScript(`
      const p = part('Named');
      p.sketch('front', (s) => s.rect(60, 40), 'Base');
      p.extrude(10);
      group('Boss', () => {
        p.sketch(face('>Z'), (s) => s.circle(8), 'Pin').extrude(5, { name: 'Pin body' });
        p.sketch(face('>Z'), (s) => s.circle(3), 'Bore').cut(2);
      });
      p.holes.points(face('>Z', { of: 'F2' }), [[20, 10]], { diameter: 3, name: 'Mount hole' });
    `, h);
    expect(r.errors).toEqual([]);
    const f = (controller.document()!.features as unknown as F[]);
    const by = (id: string) => f.find((x) => x.id === id)!;
    expect(by('F1').name).toBe('Base');
    expect(by('F2').name).toBe('Extrude Base');
    expect(by('F2').group).toBeUndefined();
    const boss = f.filter((x) => x.group === 'Boss').map((x) => x.name ?? x.type);
    expect(boss).toEqual(expect.arrayContaining(['Pin', 'Pin body', 'Bore', 'Cut Bore']));
    expect(f.find((x) => x.type === 'hole')!.name).toBe('Mount hole');
    expect(f.find((x) => x.type === 'hole')!.group).toBeUndefined();
  }, 120000);
});

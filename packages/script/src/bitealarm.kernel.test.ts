import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('bite alarm example (docs/examples/bite-alarm.script.ts)', () => {
  it('builds a valid body', async () => {
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await controller.load(emptyPart('x') as never);
    const h: ScriptHost = {
      load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
      edit: (ops, why) => controller.edit(ops, why) as never,
      geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
      build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
    };
    const code = readFileSync(resolve(process.cwd(), 'docs/examples/bite-alarm.script.ts'), 'utf8') + `
throw new Error('BA' + JSON.stringify({ vol: await body.volume(), ok: await body.isValid(), faces: (await body.faces()).length }));
`;
    const r = await runScript(code, h);
    console.log('BITEALARM', JSON.stringify(r.errors.map((e) => e.message)));
    expect(r.errors[0].message.startsWith('BA')).toBe(true);
    const m = JSON.parse(r.errors[0].message.slice(2));
    expect(m.ok).toBe(true);
  }, 600_000);
});

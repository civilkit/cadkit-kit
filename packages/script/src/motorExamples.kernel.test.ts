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

describe('motor example scripts (docs/examples/motor-*.script.ts)', () => {
  for (const file of ['motor-outrunner', 'motor-inrunner-2430', 'motor-gimbal-2804']) {
    it(`${file} runs with no script errors and builds a solid`, async () => {
      const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
      const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
      await controller.load(emptyPart('x') as never);
        const h: ScriptHost = {
        load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
        edit: (ops, why) => controller.edit(ops, why) as never,
        geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
        build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
    };
      const r = await runScript(readFileSync(resolve(process.cwd(), `docs/examples/${file}.script.ts`), 'utf8'), h);
      expect(r.errors.map((e) => e.message)).toEqual([]);
      expect(controller.bodyBox()).toBeTruthy();
    }, 600_000);
  }
});

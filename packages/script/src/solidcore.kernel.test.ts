import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function run(code: string) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  const r = await runScript(code, h);
  const s = sessions.at(-1)!;
  return { r, volume: async () => ((await s.massProps()) as { volume: number }).volume, validate: async () => (await (s as unknown as { validate(): Promise<{ ok?: boolean }> }).validate()) };
}

// Scripts under fixtures/solidcore each carry `// EXPECT {volume, tolRel, valid, refused}`; values are closed-form (see the README there).
// KNOWN lists the cases the kernel does not yet meet; `it.fails` makes the entry fail when one starts to pass, so it gets removed.
const KNOWN: Record<string, string> = {};

const dir = resolve(__dirname, 'fixtures/solidcore');
const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
describe('solidcore regression scripts', () => {
  for (const f of files) {
    const code = readFileSync(resolve(dir, f), 'utf8');
    const exp = JSON.parse((code.match(/^\/\/ EXPECT (.*)$/m) ?? [, '{}'])[1]!) as { volume?: number; tolRel?: number; valid?: boolean; refused?: boolean };
    if (exp.volume === undefined && !exp.refused) continue;
    const t = KNOWN[f] ? it.fails : it;
    t(`${f}${KNOWN[f] ? ` (known: ${KNOWN[f]})` : ''}`, async () => {
      const { r, volume, validate } = await run(code);
      if (exp.refused) {
        expect(r.errors.length).toBeGreaterThan(0);
        return;
      }
      expect(r.errors).toEqual([]);
      const v = await volume();
      expect(Math.abs(v - exp.volume!) / exp.volume!).toBeLessThanOrEqual(exp.tolRel ?? 1e-6);
      if (exp.valid) expect((await validate()).ok).not.toBe(false);
    }, 120000);
  }
});

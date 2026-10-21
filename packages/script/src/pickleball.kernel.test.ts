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

// The example is run as a user would paste it, then read back (appended) through the script's own readbacks.
describe('pickleball example (docs/examples/pickleball.script.ts)', () => {
  it('builds a hollow ball with 40 radial holes, valid, volume = shell minus the holes', async () => {
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await controller.load(emptyPart('x') as never);
    const h: ScriptHost = {
      load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
      edit: (ops, why) => controller.edit(ops, why) as never,
      geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
      build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
    };
    const code = readFileSync(resolve(process.cwd(), 'docs/examples/pickleball.script.ts'), 'utf8') + `
const vol = await ball.volume();
const ok = await ball.isValid();
const fs = await ball.faces();
const holes = fs.filter((f) => f.kind === 'cylinder' && Math.abs(f.radius - holeD / 2) < 1e-3).length;
throw new Error('PB' + JSON.stringify({ vol, ok, faces: fs.length, holes, holesCount: dirs.length, closest }));
`;
    const r = await runScript(code, h);
    // the sandbox has no globals, so the readbacks come back as a thrown message
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].message.startsWith('PB')).toBe(true);
    const m = JSON.parse(r.errors[0].message.slice(2)) as { vol: number; ok: boolean; faces: number; holes: number; holesCount: number; closest: number };
    console.log('PICKLEBALL', JSON.stringify(m));
    expect(m.ok).toBe(true);
    expect(m.holesCount).toBe(40);
    expect(m.holes).toBe(40);   // one cylindrical wall per hole
    const shell = (4 / 3) * Math.PI * (37 ** 3 - 35 ** 3);
    const perHole = (shell - m.vol) / 40;
    expect(perHole).toBeGreaterThan(150);   // a 5 mm radius cylinder through a 2 mm wall: about pi*25*2, a little more on the curve
    expect(perHole).toBeLessThan(200);
  }, 600_000);
});

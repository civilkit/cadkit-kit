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
  const mp = async () => (await sessions.at(-1)!.massProps()) as { volume: number };
  return { h, mp, controller };
}
import { readFileSync, writeFileSync } from 'node:fs';
import { matxScript } from './matx';

const FC = JSON.parse(readFileSync('/path/to/work/scratch-matx/fc/vols2.json', 'utf8')) as Record<string, number>;
const sum = (re: RegExp) => Object.entries(FC).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0);
const GROUPS: Record<string, RegExp> = {
  hoops: /^HOOP/, strips: /^STRIP/, rear: /^PANEL_rear/, base: /^BASE/, top: /^PANEL_top/, front: /^PANEL_front/,
  blocks: /^BLOCK/, refs: /^(PSU|BOARD|FAN)/, rivets: /^RIVET/, slats: /^SLAT/, tray: /^TRAY/, straps: /^STRAP/,
};
const only = (process.env.MATX_ONLY ?? '').split(',').filter(Boolean);
describe('matx components', () => {
  for (const g of Object.keys(GROUPS)) {
    it.skipIf(only.length > 0 && !only.includes(g))('component ' + g, async () => {
      const { h, mp, controller } = await host();
      const t0 = Date.now();
      const r = await runScript(matxScript([g]), h);
      const v = (await mp()).volume, ref = sum(GROUPS[g]);
      const row = `${g}\t${ref.toFixed(1)}\t${v.toFixed(1)}\t${((v - ref) / ref * 100).toFixed(3)}%\t${Date.now() - t0}ms\terrors=${JSON.stringify(r.errors).slice(0, 300)}`;
      console.log('ROW ' + row);
      writeFileSync('/path/to/work/scratch-matx/rows.txt', row + '\n', { flag: 'a' });
      expect(r.errors).toEqual([]);
    }, 300000);
  }
});
describe('matx debug', () => {
  it.skipIf(!process.env.MATX_DEBUG)('block notch', async () => {
    const { h, mp } = await host();
    const r = await runScript(matxScript([]) + process.env.MATX_DEBUG, h);
    console.log('DBG', JSON.stringify(r.errors), (await mp()).volume);
  }, 60000);
});

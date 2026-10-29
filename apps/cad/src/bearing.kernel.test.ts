import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import './i18n';
import { bearingOps, DEFAULT_BEARING } from './bearing';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world() {
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(emptyPart('Bearings') as never);
  return c;
}
const bodyNames = (c: Controller) => ((c.document()?.features ?? []) as unknown as Array<Record<string, unknown>>).map((f) => f.body).filter((b): b is string => typeof b === 'string');

describe('the Bearing wizard inserts a second bearing', () => {
  it('two bearings of one size and a third of another all commit: no body name conflict, every body has its own name', async () => {
    const c = await world();
    const at = (x: number, p = {}) => ({ ...DEFAULT_BEARING, origin: [x, 0, 0] as [number, number, number], ...p });
    for (const p of [at(0), at(30), at(60, { designation: '', bore: 5, od: 16, width: 5 })]) {
      const r = await c.commit(bearingOps(c.document() as never, p), 'bearing');
      expect(r.ok, JSON.stringify((r as { errors?: unknown }).errors)).toBe(true);
    }
    const names = bodyNames(c);
    expect(names).toEqual(expect.arrayContaining(['Bearing 608 inner ring', 'Bearing 608 outer ring', 'Bearing 608 2 inner ring', 'Bearing 608 2 outer ring']));
    expect(new Set(names).size).toBe(names.length);
  }, 120000);

  for (const seal of ['open', '2Z', '2RS'] as const) {
    it(`${seal}: with the ball groove both rings regenerate valid, and a second bearing of the same size still commits without a name conflict`, async () => {
      const c = await world();
      for (const x of [0, 30]) {
        const r = await c.commit(bearingOps(c.document() as never, { ...DEFAULT_BEARING, seal, origin: [x, 0, 0] }), 'bearing');
        expect(r.ok, JSON.stringify((r as { errors?: unknown }).errors)).toBe(true);
      }
      const names = bodyNames(c);
      expect(names).toEqual(expect.arrayContaining(['Bearing 608 inner ring', 'Bearing 608 outer ring', 'Bearing 608 2 inner ring', 'Bearing 608 2 outer ring']));
      expect(new Set(names).size).toBe(names.length);
      // the ring sketches carry the groove as an arc
      expect(JSON.stringify(c.document()?.features)).toMatch(/"type":"arc"/);
    }, 180000);
  }
});

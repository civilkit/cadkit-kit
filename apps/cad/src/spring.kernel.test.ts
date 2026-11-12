import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import './i18n';
import { springOps, DEFAULT_SPRING } from './spring';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function world() {
  const kernel: KernelFactory = { async open(x) { const s = await Session.open(x); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(emptyPart('Springs') as never);
  return c;
}
const sweeps = (c: Controller) => ((c.document()?.features ?? []) as unknown as Array<{ type: string; op?: string }>).filter((f) => f.type === 'sweep' && f.op === 'newBody');

describe('the Spring wizard adds springs', () => {
  it('two springs side by side and a left-hand one along x all commit, each a body of its own', async () => {
    const c = await world();
    const at = (x: number, p = {}) => ({ ...DEFAULT_SPRING, origin: [x, 0, 0] as [number, number, number], ...p });
    for (const p of [at(0), at(30), at(60, { hand: 'left', axis: 'px' })]) {
      const r = await c.commit(springOps(c.document() as never, p), 'spring');
      expect(r.ok, JSON.stringify((r as { errors?: unknown; hints?: unknown }).errors ?? (r as { hints?: unknown }).hints)).toBe(true);
    }
    expect(sweeps(c).length).toBe(3);
    const groups = new Set(((c.document()?.features ?? []) as unknown as Array<{ group?: string }>).map((f) => f.group));
    expect(groups).toEqual(new Set(['Spring', 'Spring 2', 'Spring 3']));
  }, 180000);
});

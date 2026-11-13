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

  it('two ground springs and a closed one commit side by side, each keeps its own body (the end cuts reach only their spring)', async () => {
    const c = await world();
    const at = (x: number, p = {}) => ({ ...DEFAULT_SPRING, ends: 'ground' as const, origin: [x, 0, 0] as [number, number, number], ...p });
    for (const p of [at(0), at(10), at(40, { ends: 'closed' })]) {   // 10 mm apart: the 20 mm coils overlap, so a cut that reached the neighbour would show as a failure or a volume change
      const r = await c.commit(springOps(c.document() as never, p), 'spring');
      expect(r.ok, JSON.stringify((r as { errors?: unknown; hints?: unknown }).errors ?? (r as { hints?: unknown }).hints)).toBe(true);
    }
    expect(sweeps(c).length).toBe(3);
    const bodies = ((c.document()?.features ?? []) as unknown as Array<{ body?: string }>).map((f) => f.body).filter((b): b is string => !!b);
    expect(new Set(bodies)).toEqual(new Set(['Spring', 'Spring 2']));   // only a ground spring is named: its cuts need the name; plain and closed bodies are unnamed
  }, 300000);

  it('an extension spring commits next to a compression spring, and a left-hand one along y does too', async () => {
    const c = await world();
    const ext = (x: number, p = {}) => ({ ...DEFAULT_SPRING, kind: 'extension' as const, outer: 12, wire: 1, coils: 10, origin: [x, 0, 0] as [number, number, number], ...p });
    for (const p of [{ ...DEFAULT_SPRING, origin: [0, 0, 0] as [number, number, number] }, ext(30), ext(60, { hand: 'left', axis: 'py' })]) {
      const r = await c.commit(springOps(c.document() as never, p), 'spring');
      expect(r.ok, JSON.stringify((r as { errors?: unknown; hints?: unknown }).errors ?? (r as { hints?: unknown }).hints)).toBe(true);
    }
    expect(sweeps(c).length).toBe(3);
  }, 300000);

  it('a torsion spring and a conical progressive one commit with the rest', async () => {
    const c = await world();
    const tor = { ...DEFAULT_SPRING, kind: 'torsion' as const, outer: 14, wire: 1.2, coils: 5.25, leg1: 21, leg2: 21, origin: [0, 0, 0] as [number, number, number] };
    const cone = { ...DEFAULT_SPRING, outer: 30, topOuter: 16, progression: 0.6, length: 60, coils: 9, origin: [60, 0, 0] as [number, number, number] };
    for (const p of [tor, cone]) {
      const r = await c.commit(springOps(c.document() as never, p), 'spring');
      expect(r.ok, JSON.stringify((r as { errors?: unknown; hints?: unknown }).errors ?? (r as { hints?: unknown }).hints)).toBe(true);
    }
    expect(sweeps(c).length).toBe(2);
  }, 300000);
});

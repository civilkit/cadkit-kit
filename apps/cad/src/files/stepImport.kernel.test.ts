import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { importStepView } from './stepImport';

const box = (w: number, d: number, h: number): PartDoc => ({
  ...emptyPart('Box'),
  features: [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: w, y: 0 }, { id: 'p3', x: w, y: d }, { id: 'p4', x: 0, y: d }],
      entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: h },
  ],
  seq: 3,
}) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

function volume(p: ArrayLike<number>): number {
  let v = 0;
  for (let t = 0; t + 8 < p.length; t += 9) v += (p[t] * (p[t + 4] * p[t + 8] - p[t + 5] * p[t + 7]) - p[t + 1] * (p[t + 3] * p[t + 8] - p[t + 5] * p[t + 6]) + p[t + 2] * (p[t + 3] * p[t + 7] - p[t + 4] * p[t + 6])) / 6;
  return v;
}

describe('STEP round trip against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a box exported to STEP and imported again has the same volume and size', async () => {
    const s = await Session.open(box(30, 20, 10)); sessions.push(s);
    const text = await s.step();
    const r = await importStepView(s, text, 'Box');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.faces).toBe(6);
    expect(volume(r.view.mesh.positions)).toBeCloseTo(6000, 0);
    const size = r.view.box.max.map((v, i) => +(v - r.view.box.min[i]).toFixed(3)).sort((a, b) => a - b);
    expect(size).toEqual([10, 20, 30]);
  });
  it('refuses text that is not STEP with an error, not a blank body', async () => {
    const s = await Session.open(box(10, 10, 10)); sessions.push(s);
    const r = await importStepView(s, 'this is not a step file', 'Junk');
    expect(r.ok).toBe(false);
  });
});

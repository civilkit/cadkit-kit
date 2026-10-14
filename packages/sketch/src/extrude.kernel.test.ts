import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { defaultFlip } from './extrude';

const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b })),
  constraints: [],
});

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function build(flip: boolean) {
  const doc = {
    ...emptyPart('Box'),
    features: [
      rect('F1', 0, 0, 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
      rect('F3', 10, 8, 20, 16), { type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', end: 'blind', depth: 10, ...(flip ? { flip: true } : {}) },
    ],
    seq: 5,
  } as unknown as PartDoc;
  const s = await Session.open(doc);
  sessions.push(s);
  const report = await s.verify();
  const mass = await s.massProps();
  return { errors: report.regen.errors.map(([id, e]) => `${id}:${e.code}`), volume: (mass as { volume: number }).volume };
}

describe('a cut made with the default direction removes material', { skip: !process.env.CK_WASM }, () => {
  it('the direction defaultFlip picks makes the cut remove the inner rectangle; the opposite cuts nothing', async () => {
    // the box lies on the +z side of the front plane, where the sketch normal points
    const flip = defaultFlip('cut', { o: [0, 0, 0], z: [0, 0, 1] }, { min: [0, 0, 0], max: [40, 25, 10] });
    expect(flip).toBe(true);
    const good = await build(flip);
    expect(good.errors).toEqual([]);
    expect(good.volume).toBeCloseTo(40 * 25 * 10 - 10 * 8 * 10, 3);
    const bad = await build(!flip);
    expect(bad.errors).toEqual(['F4:cutNoEffect']);
  });
});

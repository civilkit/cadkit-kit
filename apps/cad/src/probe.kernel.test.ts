import { describe, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [],
});
const run = async (extra: object[]) => {
  const doc = { ...emptyPart('B'), features: [rect('F1', 0, 0, 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }, rect('F3', 5, 5, 15, 15), ...extra], seq: 9 } as unknown as PartDoc;
  const s = await Session.open(doc);
  const r = await s.verify(); const m = (await s.massProps()) as { volume: number };
  await s.close();
  return JSON.stringify({ e: r.regen.errors, v: m.volume });
};
describe('probe', () => {
  it('x', async () => {
    const out: string[] = [];
    for (const [n, f] of Object.entries({
      base: {}, blind: { end: 'blind', depth: 4 }, blindFlip: { end: 'blind', depth: 4, flip: true }, through: { end: 'through' }, throughFlip: { end: 'through', flip: true },
      both: { end: 'throughBoth' }, next: { end: 'upToNext' }, nextFlip: { end: 'upToNext', flip: true }, mid: { end: 'mid', depth: 4 }, draft: { end: 'blind', depth: 4, flip: true, draft: 5 }, draftOut: { end: 'blind', depth: 4, flip: true, draft: 5, draftOut: true },
      face: { end: 'upToFace', face: 'x' }, d2: { end: 'blind', depth: 4, flip: true, depth2: 3 },
    })) out.push(n + ' ' + await run([{ type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', ...f }]));
    console.log(out.join('\n'));
  }, 120000);
});

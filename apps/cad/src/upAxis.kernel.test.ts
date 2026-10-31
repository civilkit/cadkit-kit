import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('upAxis document field against the real kernel', () => {
  it('is ignored by the kernel (no error, no warning) and kept in the document', async () => {
    const doc = {
      ...emptyPart('Z part'), upAxis: 'z', seq: 3,
      features: [
        { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [{ id: 'c', type: 'circle', c: 'O', r: 5 }], constraints: [] },
        { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
      ],
    } as unknown as PartDoc;
    const s = await Session.open(doc); sessions.push(s);
    const report = await s.verify();
    expect(report.regen.errors).toEqual([]);
    expect((report.regen as { warnings?: unknown[] }).warnings ?? []).toEqual([]);
    expect(((await s.massProps()) as { volume: number }).volume).toBeCloseTo(Math.PI * 25 * 10, 3);
    expect((s.document as unknown as { upAxis?: string }).upAxis).toBe('z');
  });
});

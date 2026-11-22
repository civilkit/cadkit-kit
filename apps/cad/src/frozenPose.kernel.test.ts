import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { detachDeleteOps, reattachPatch } from './frozenPose';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

function rect(id: string, plane: Record<string, unknown>, size: number) {
  return {
    type: 'sketch', id, plane,
    points: [
      { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: size, y: 0 },
      { id: 'p3', x: size, y: size }, { id: 'p4', x: 0, y: size },
    ],
    entities: [
      { type: 'line', id: 'e1', p1: 'p1', p2: 'p2' },
      { type: 'line', id: 'e2', p1: 'p2', p2: 'p3' },
      { type: 'line', id: 'e3', p1: 'p3', p2: 'p4' },
      { type: 'line', id: 'e4', p1: 'p4', p2: 'p1' },
    ],
    constraints: [],
  };
}

describe('broken-reference survival (frozen pose) against the real kernel', () => {
  it('deleting a parent extrude with detach keeps the child sketch and downstream extrude alive, then reattaching clears the warning', async () => {
    const doc = {
      ...emptyPart('Frozen pose test'), seq: 5,
      features: [
        rect('F1', { kind: 'std', id: 'top' }, 20),
        { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
        rect('F3', { kind: 'face', id: 'F2.C1' }, 10),
        { type: 'extrude', id: 'F4', op: 'add', sketch: 'F3', end: 'blind', depth: 5 },
      ],
    } as unknown as PartDoc;

    const s = await Session.open(doc); sessions.push(s);
    const view = await s.bodyForView();
    const f3Frame = view?.sketches.find((sk) => sk.id === 'F3')?.frame;
    expect(f3Frame).toBeTruthy();

    // Detach and delete F2 in one atomic edit
    const ops = detachDeleteOps(s.document.features as unknown as Array<{ id: string }>, ['F2'], (id) => (id === 'F3' ? f3Frame : null));
    const r = await s.edit(ops, 'detach and delete F2');
    expect(r.ok).toBe(true);
    expect(s.document.features.map((f) => f.id)).toEqual(['F1', 'F3', 'F4']);

    const report = await s.regenReport();
    expect(report.errors).toEqual([]);
    const warnings = (report.warnings ?? []) as Array<[string, { code: string }]>;
    expect(warnings.some(([id, w]) => id === 'F3' && w.code === 'detachedReference')).toBe(true);
    expect(((await s.massProps()) as { volume: number }).volume).toBeCloseTo(10 * 10 * 5, 2);

    // Reattach F3 to Top plane and clear frozenFrame
    const patch = reattachPatch('plane', { kind: 'std', id: 'top' });
    const reattach = await s.edit(
      Object.entries(patch).map(([path, value]) => ({ op: 'set' as const, id: 'F3', path, value })),
      'reattach F3',
    );
    expect(reattach.ok).toBe(true);
    const after = await s.regenReport();
    expect(after.errors).toEqual([]);
    expect(after.warnings ?? []).toEqual([]);
    expect(((await s.massProps()) as { volume: number }).volume).toBeCloseTo(10 * 10 * 5, 2);
  });
});

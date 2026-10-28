import { describe, expect, it } from 'vitest';
import { followSketches, moveTransform, planeFrame } from './follow';
import { importSolidcraftDocument } from './import';

type R = Record<string, any>;
const sk = (id: string, plane: R = { kind: 'std', id: 'front' }): R => ({ type: 'sketch', id, name: `Sk${id}`, plane,
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 40, y: 0 }, { id: 'p3', x: 40, y: 20 }, { id: 'p4', x: 0, y: 20 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] });
const ext = (id: string, sketch: string, body: string): R => ({ type: 'extrude', id, op: 'newBody', body, sketch, end: 'blind', depth: 10 });
const ids = () => { let n = 100; return () => `F${++n}`; };
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
const frameOf = (out: R[], name: string) => out.find((f) => f.type === 'plane' && f.name === `${name} frame`)!;

describe('moveTransform', () => {
  it('rotates first (right-handed, about an axis through the origin given), then translates', () => {
    const m = moveTransform({ rotate: { axis: [0, 1, 0], origin: [0, 0, 0], angle: 90 }, translate: [0, 0, 10] }, [])!;
    const out = followSketches([sk('F1'), ext('F2', 'F1', 'A'), { type: 'moveBody', id: 'F3', bodies: [{ body: 'A' }], rotate: { axis: [0, 1, 0], angle: 90 }, translate: [0, 0, 10] }], ids());
    expect(m).toBeTruthy();
    const fr = frameOf(out, 'SkF1 (A)');
    close(fr.origin, [0, 0, 10]); close(fr.xDir, [0, 0, -1]); close(fr.yDir, [0, 1, 0]);
  });
  it('reads a named axis, an axis object and an origin off the world origin', () => {
    const m = moveTransform({ rotate: { axis: 'z', origin: [10, 0, 0], angle: 180 } }, [])!;
    close(m.r[0], [-1, 0, 0]); close(m.t, [20, 0, 0]);
    expect(moveTransform({ rotate: { axis: { kind: 'axis', axis: 'x' }, angle: 90 } }, [])).toBeTruthy();
  });
  it('refuses what it cannot read', () => {
    expect(moveTransform({ translate: [1, 2] }, [])).toBeNull();
    expect(moveTransform({ rotate: { axis: [0, 0, 0], angle: 10 } }, [])).toBeNull();
    expect(moveTransform({ mirror: { kind: 'face', id: 'F1.C0' } }, [])).toBeNull();
  });
});

describe('planeFrame', () => {
  it('resolves std, offset and frame planes', () => {
    const feats = [{ type: 'plane', id: 'P1', mode: 'offset', base: { kind: 'std', id: 'top' }, offset: 5 }, { type: 'plane', id: 'P2', mode: 'frame', origin: [1, 2, 3], xDir: [0, 1, 0], yDir: [0, 0, 1] }];
    close(planeFrame({ kind: 'feature', id: 'P1' }, feats)!.o, [0, 5, 0]);
    expect(planeFrame({ kind: 'feature', id: 'P2' }, feats)).toMatchObject({ o: [1, 2, 3], z: [1, 0, 0] });
    expect(planeFrame({ kind: 'feature', id: 'nope' }, feats)).toBeNull();
  });
});

describe('followSketches', () => {
  it('a 40 x 20 plate moved 100 mm along x: the copy of its sketch frame is at x = 100, the original stays and nothing else changes', () => {
    const feats = [sk('F1'), ext('F2', 'F1', 'Plate'), { type: 'moveBody', id: 'F3', bodies: [{ body: 'Plate' }], translate: [100, 0, 0] }];
    const out = followSketches(feats, ids());
    expect(out.map((f) => f.type)).toEqual(['plane', 'sketch']);
    close(frameOf(out, 'SkF1 (Plate)').origin, [100, 0, 0]);
    expect(out[1]).toMatchObject({ name: 'SkF1 (Plate)', plane: { kind: 'feature', id: 'F101' }, visible: false, points: feats[0].points, entities: feats[0].entities });
    expect(feats).toHaveLength(3);
  });
  it('moves accumulate; no move or a move back to the start gives no copy', () => {
    const base = [sk('F1'), ext('F2', 'F1', 'A')];
    expect(followSketches(base, ids())).toEqual([]);
    const mv = (id: string, t: number[]) => ({ type: 'moveBody', id, bodies: [{ body: 'A' }], translate: t });
    close(frameOf(followSketches([...base, mv('F3', [10, 0, 0]), mv('F4', [0, 5, 0])], ids()), 'SkF1 (A)').origin, [10, 5, 0]);
    expect(followSketches([...base, mv('F3', [10, 0, 0]), mv('F4', [-10, 0, 0])], ids())).toEqual([]);
  });
  it('a move without `bodies` moves every body; a copy leaves the source alone and carries its own copy', () => {
    const feats = [sk('F1'), ext('F2', 'F1', 'A'), sk('F3'), ext('F4', 'F3', 'B'), { type: 'moveBody', id: 'F5', translate: [0, 0, 7] },
      { type: 'moveBody', id: 'F6', copy: true, body: 'A2', bodies: [{ body: 'A' }], translate: [0, 30, 0] }];
    const out = followSketches(feats, ids());
    expect(out.filter((f) => f.type === 'sketch').map((f) => f.name)).toEqual(['SkF1 (A)', 'SkF3 (B)', 'SkF1 (A2)']);
    close(frameOf(out, 'SkF1 (A)').origin, [0, 0, 7]); close(frameOf(out, 'SkF1 (A2)').origin, [0, 30, 7]);
  });
  it('a mirror copy reflects the frame about the plane (the sketch points keep their numbers, so they land on the mirror image)', () => {
    const out = followSketches([sk('F1'), ext('F2', 'F1', 'A'), { type: 'moveBody', id: 'F3', copy: true, body: 'M', bodies: [{ body: 'A' }], mirror: { kind: 'std', id: 'right' } }], ids());
    const fr = frameOf(out, 'SkF1 (M)');
    close(fr.origin, [0, 0, 0]); close(fr.xDir, [-1, 0, 0]); close(fr.yDir, [0, 1, 0]);
    const off = followSketches([{ type: 'plane', id: 'P', mode: 'frame', origin: [5, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1] }, sk('F1', { kind: 'feature', id: 'P' }), ext('F2', 'F1', 'A'),
      { type: 'moveBody', id: 'F3', copy: true, body: 'M', bodies: [{ body: 'A' }], mirror: { kind: 'std', id: 'right' } }], ids());
    close(frameOf(off, 'SkF1 (M)').origin, [-5, 0, 0]);
  });
  it('a combined tool hands its sketches to the target; a deleted body drops them; unreadable moves are left out', () => {
    const feats = [sk('F1'), ext('F2', 'F1', 'Block'), sk('F3'), ext('F4', 'F3', 'Peg'), { type: 'combine', id: 'F5', op: 'union', target: { body: 'Block' }, tools: [{ body: 'Peg' }], keepTools: false },
      { type: 'moveBody', id: 'F6', bodies: [{ body: 'Block' }], translate: [1, 0, 0] }, { type: 'moveBody', id: 'F7', bodies: [{ face: 'F2.C0' }], translate: [9, 0, 0] }];
    expect(followSketches(feats, ids()).filter((f) => f.type === 'sketch').map((f) => f.name)).toEqual(['SkF1 (Block)', 'SkF3 (Block)']);
    expect(followSketches([...feats, { type: 'deleteBody', id: 'F8', mode: 'delete', bodies: [{ body: 'Block' }] }], ids())).toEqual([]);
  });
});

describe('the importer', () => {
  const sketch = (id: number) => ({ id, name: `S${id}`, type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XY' },
    sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [40, 0] }, { id: 'p3', pos: [40, 20] }, { id: 'p4', pos: [0, 20] }],
      curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }], constraints: [] } });
  const extrude = (id: number, sk: number) => ({ id, name: `E${id}`, type: 'extrude', suppressed: false, sketch: sk, profiles: { type: 'all' }, operation: 'new_body', body_names: ['Plate'], extent: { convention: 'total_distance', direction: 'positive', distance: '10' } });
  it('a Move leaves a hidden copy of the sketch at the pose of the moved body (their z is our y)', async () => {
    const r = await importSolidcraftDocument({ format: 'solidcraft/30', units: 'mm', params: [], features: [sketch(1), extrude(2, 1), { id: 3, name: 'Move1', type: 'move', suppressed: false, bodies: ['Plate'], translate: ['100', '0', '30'] }] }, 'x');
    expect(r.rows.every((x) => x.status === 'converted'), JSON.stringify(r.rows)).toBe(true);
    const f = r.part!.features as R[];
    const moved = f.find((x) => x.type === 'sketch' && x.name === 'S1 (Plate)')!;
    expect(moved).toMatchObject({ visible: false, plane: { kind: 'feature' } });
    const fr = f.find((x) => x.type === 'plane' && x.id === moved.plane.id)!;
    expect(fr).toMatchObject({ mode: 'frame', origin: [100, 30, 0], visible: false });
    expect(f.find((x) => x.type === 'sketch' && x.name === 'S1')!.plane).toEqual({ kind: 'std', id: 'top' });   // the sketch the extrude reads is untouched
  });
  it('a part that moves nothing gains nothing', async () => {
    const r = await importSolidcraftDocument({ format: 'solidcraft/30', units: 'mm', params: [], features: [sketch(1), extrude(2, 1)] }, 'x');
    expect((r.part!.features as R[]).map((x) => x.type)).toEqual(['sketch', 'extrude']);
  });
});

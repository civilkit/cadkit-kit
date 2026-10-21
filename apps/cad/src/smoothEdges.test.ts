// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { markSmoothEdges } from './smoothEdges';
import { chainSelection } from './roundChain';
import { chainedEdgeRefs } from './featureCommands';

/** Two quads (two triangles each) as a mesh: face `a` in the z = 0 plane, face `b` either continuing it (a flat strip) or standing up. */
function twoFaces(b: 'flat' | 'wall' | 'round'): Parameters<typeof markSmoothEdges>[0] {
  const tri = (p: number[][], n: number[][]) => ({ p: p.flat(), n: n.flat() });
  const up = [0, 0, 1];
  const bp = b === 'wall' ? [[0, 0, 0], [0, 0, 1], [1, 0, 1], [0, 0, 0], [1, 0, 1], [1, 0, 0]] : [[0, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0], [1, 1, 0], [1, 0, 0]];
  const bn = b === 'wall' ? Array(6).fill([0, 1, 0]) : b === 'round' ? [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]] : Array(6).fill(up);
  const ap = [[0, 0, 0], [1, 0, 0], [1, -1, 0], [0, 0, 0], [1, -1, 0], [0, -1, 0]];
  const t = [tri(ap.slice(0, 3), Array(3).fill(up)), tri(ap.slice(3), Array(3).fill(up)), tri(bp.slice(0, 3), bn.slice(0, 3)), tri(bp.slice(3), bn.slice(3))];
  return {
    positions: Float32Array.from(t.flatMap((x) => x.p)), normals: Float32Array.from(t.flatMap((x) => x.n)),
    triFace: Int32Array.from([0, 0, 1, 1]), faceIds: ['a', 'b'],
  };
}
const edge = { key: 'a|b', faces: ['a', 'b'], pts: [[0, 0, 0], [0.5, 0, 0], [1, 0, 0]] };

describe('markSmoothEdges (mesh from synthetic faces)', () => {
  it('a crease (faces 90 degrees apart) is not smooth', () => {
    expect(markSmoothEdges(twoFaces('wall'), [edge])[0].smooth).toBeUndefined();
  });
  it('faces with the same normal along the edge are smooth', () => {
    expect(markSmoothEdges(twoFaces('flat'), [edge])[0].smooth).toBe(true);
    expect(markSmoothEdges(twoFaces('round'), [edge])[0].smooth).toBe(true);
  });
  it('leaves edges it cannot judge alone (one face, unknown face, no points)', () => {
    const m = twoFaces('flat');
    for (const e of [{ ...edge, faces: ['a'] }, { ...edge, faces: ['a', 'zz'] }, { ...edge, pts: [] }]) expect(markSmoothEdges(m, [e])[0].smooth).toBeUndefined();
  });
});

// The hand-test part: a stadium extrude with a slot cut through its flat side. The slot's top edge continues, in the same line, as the two
// seams where the flat top runs into the round ends; those have no crease. Tangent chain used to add them and the fillet was refused.
const slotDoc = {
  format: 'ck-part', version: 1, name: 'slot-fillet', seq: 5,
  features: [
    { type: 'sketch', id: 'F1', name: 'Stadium', plane: { kind: 'std', id: 'right' }, points: [{ id: 'a', x: 9.5, y: 0 }, { id: 'b', x: 9.5, y: 25 }, { id: 'c1', x: 0, y: 25 }, { id: 'd', x: -9.5, y: 25 }, { id: 'e', x: -9.5, y: 0 }, { id: 'c2', x: 0, y: 0 }],
      entities: [{ id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'a1', type: 'arc', c: 'c1', p1: 'b', p2: 'd' }, { id: 'l2', type: 'line', p1: 'd', p2: 'e' }, { id: 'a2', type: 'arc', c: 'c2', p1: 'e', p2: 'a' }], constraints: [] },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 14 },
    { type: 'sketch', id: 'F3', name: 'Slot', plane: { kind: 'std', id: 'front' }, points: [{ id: 's1', x: 3.5, y: -12 }, { id: 's2', x: 9.5, y: -12 }, { id: 's3', x: 9.5, y: 0 }, { id: 's4', x: 3.5, y: 0 }],
      entities: [{ id: 'm1', type: 'line', p1: 's1', p2: 's2' }, { id: 'm2', type: 'line', p1: 's2', p2: 's3' }, { id: 'm3', type: 'line', p1: 's3', p2: 's4' }, { id: 'm4', type: 'line', p1: 's4', p2: 's1' }], constraints: [] },
    { type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', end: 'throughBoth', depth: 10 },
  ],
} as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('Tangent chain on the slot part', { skip: !process.env.CK_WASM }, () => {
  it('picking the slot edge does not add the two smooth seams, so the fillet builds', async () => {
    const s = await Session.open(slotDoc); sessions.push(s);
    const body = (await s.bodyForView())!;
    const edges = markSmoothEdges(body.mesh as never, body.edges as never[]) as Array<{ key: string; faces: string[]; smooth?: boolean }>;
    const slotTop = edges.find((e) => e.faces.includes('F2.S.l2') && e.faces.includes('F4.S.m3'))!;
    const seams = edges.filter((e) => e.faces.includes('F2.S.l2') && e.faces.some((f) => f.startsWith('F2.S.a2')));
    expect(seams).toHaveLength(2);
    expect(seams.every((e) => e.smooth)).toBe(true);
    expect(slotTop.smooth).toBeUndefined();
    expect(chainSelection([slotTop.key], edges).extras).toEqual([]);

    const refs = chainedEdgeRefs([slotTop.key], edges as never, true);
    expect(refs).toHaveLength(1);
    const withFillet = { ...slotDoc, features: [...slotDoc.features, { type: 'fillet', id: 'F5', radius: 0.8, edges: refs }] } as unknown as PartDoc;
    const s2 = await Session.open(withFillet); sessions.push(s2);
    expect((await s2.bodyForView())).not.toBeNull();
  });
});

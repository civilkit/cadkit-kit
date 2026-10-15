import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';

// An open C-shaped sketch -> Extruded surface -> Thicken: the faces Thicken makes (the offset wall and the two
// half-ring end caps) must tessellate to clean strips of the right area, not thousands of sliver triangles.
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('thicken of an extruded arc', { skip: !process.env.CK_WASM }, () => {
  it('displays the offset wall and caps without slivers', async () => {
    const sketch = {
      type: 'sketch', id: 'S', plane: { kind: 'std', id: 'top' },
      points: [{ id: 'c', x: 0, y: 0, fixed: true }, { id: 'p1', x: 30, y: 0 }, { id: 'p2', x: -30, y: 0 }],
      entities: [{ id: 'a', type: 'arc', c: 'c', p1: 'p1', p2: 'p2' }], constraints: [],
    };
    const doc = {
      ...emptyPart('T'),
      features: [sketch, { type: 'surfaceExtrude', id: 'W', sketch: 'S', end: 'blind', depth: 20 }, { type: 'thicken', id: 'T', surface: 'W', thickness: 3 }],
      seq: 4,
    } as unknown as PartDoc;
    const s = await Session.open(doc);
    sessions.push(s);
    expect((await s.regenReport()).errors).toEqual([]);
    const m = (await s.bodyForView())!.mesh;
    const area = new Map<string, number>(), tris = new Map<string, number>();
    for (let t = 0; t < m.triFace.length; t++) {
      const p = m.positions.subarray(t * 9, t * 9 + 9);
      const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
      const a = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      const id = m.faceIds[m.triFace[t]];
      area.set(id, (area.get(id) ?? 0) + a); tris.set(id, (tris.get(id) ?? 0) + 1);
    }
    const pi = Math.PI;
    expect(area.get('W.S.a~1')!).toBeCloseTo(pi * 30 * 20, -1);
    expect(area.get('W.S.a~2')!).toBeCloseTo(pi * 33 * 20, -1); // offset wall: on the r=33 cylinder
    expect(area.get('T.W0')!).toBeCloseTo(pi * (33 * 33 - 30 * 30) / 2, -1); // half-ring end caps
    expect(area.get('T.W2')!).toBeCloseTo(pi * (33 * 33 - 30 * 30) / 2, -1);
    for (const n of tris.values()) expect(n).toBeLessThan(500);
    const mass = (await s.massProps()) as { volume: number };
    expect(mass.volume).toBeCloseTo(pi * (33 * 33 - 30 * 30) / 2 * 20, -1);
  });
});

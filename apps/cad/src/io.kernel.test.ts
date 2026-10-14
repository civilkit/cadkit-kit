import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { checkMesh, parseDxf, parseStl, type DxfEntity } from '@kit/io';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { exportObj, exportSketchDxf, exportStep, exportStl, exportViewsDxf } from './exportFiles';

const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [],
});
/** A 40 x 25 x 10 box with a 12 mm hole through it. */
const part = (): PartDoc => ({
  ...emptyPart('Box'),
  features: [
    rect('F1', 0, 0, 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
    { type: 'sketch', id: 'F3', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 20, y: 12 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 6 }], constraints: [] },
    { type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', end: 'throughBoth' },
  ],
  seq: 5,
}) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const load = async (doc: PartDoc) => {
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view, kernel });
  await c.load(doc);
  return { c, session: sessions.at(-1)! };
};

/** Volume from the signed tetrahedra of a triangle soup. */
function volume(p: ArrayLike<number>): number {
  let v = 0;
  for (let t = 0; t + 8 < p.length; t += 9) {
    v += (p[t] * (p[t + 4] * p[t + 8] - p[t + 5] * p[t + 7]) - p[t + 1] * (p[t + 3] * p[t + 8] - p[t + 5] * p[t + 6]) + p[t + 2] * (p[t + 3] * p[t + 7] - p[t + 4] * p[t + 6])) / 6;
  }
  return v;
}

describe('mesh and STEP export against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('STL of a box with a hole is watertight, in mm, and has the kernel volume (binary and ASCII)', async () => {
    const { c, session } = await load(part());
    const mesh = c.bodyMesh()!;
    expect(mesh).not.toBeNull();
    const mass = (await session.massProps()) as { volume: number };
    for (const binary of [true, false]) {
      const r = exportStl(mesh, 'Box', binary);
      expect(r.file!.name).toBe('Box.stl');
      expect(r.notices.map((n) => n.key)).toEqual(['io.done']);   // no watertight warning
      const back = parseStl(r.file!.data);
      expect(checkMesh({ positions: back.positions }).watertight).toBe(true);
      let max = [-Infinity, -Infinity, -Infinity], min = [Infinity, Infinity, Infinity];
      for (let i = 0; i < back.positions.length; i++) { max[i % 3] = Math.max(max[i % 3], back.positions[i]); min[i % 3] = Math.min(min[i % 3], back.positions[i]); }
      expect(max.map((v, k) => +(v - min[k]).toFixed(3))).toEqual([40, 25, 10]);
      // the tessellated hole is a polygon inside the true circle, so allow a little under the exact volume
      expect(volume(back.positions)).toBeGreaterThan(mass.volume * 0.995);
      expect(volume(back.positions)).toBeLessThan(mass.volume * 1.005);
    }
  });
  it('OBJ of the same part is welded and watertight', async () => {
    const { c } = await load(part());
    const r = exportObj(c.bodyMesh(), 'Box');
    expect(r.notices.map((n) => n.key)).toEqual(['io.done']);
    expect((r.file!.data as string).split('\n').filter((l) => l.startsWith('f ')).length).toBeGreaterThan(12);
  });
  it('STEP comes from the kernel', async () => {
    const { c } = await load(part());
    const r = exportStep(await c.exportStep(), 'Box');
    expect(r.file!.data as string).toMatch(/ISO-10303-21/);
    expect(r.file!.data as string).toMatch(/END-ISO-10303-21/);
  });
  it('an empty document has no mesh to export', async () => {
    const { c } = await load(emptyPart('Empty') as unknown as PartDoc);
    expect(c.bodyMesh()).toBeNull();
    expect(exportStl(c.bodyMesh(), 'Empty').file).toBeUndefined();
  });
  it('DXF of the hole sketch and of the three views of the real body', async () => {
    const { c } = await load(part());
    const sk = c.document()!.features.find((f) => f.id === 'F3') as unknown as Parameters<typeof exportSketchDxf>[0];
    const s = exportSketchDxf(sk, 'Box');
    expect(s.file!.name).toBe('Box-F3.dxf');
    expect(parseDxf(s.file!.data as string).entities).toEqual([{ type: 'CIRCLE', layer: '0', c: { x: 20, y: 12 }, r: 6 }]);
    const v = exportViewsDxf(c.bodyEdges() as Array<{ pts: number[][] }>, c.bodyBox(), 'Box');
    const ents = parseDxf(v.file!.data as string).entities;
    const extent = (es: DxfEntity[]) => {
      const xs: number[] = [], ys: number[] = [];
      for (const e of es) {
        if (e.type === 'LINE') { xs.push(e.a.x, e.b.x); ys.push(e.a.y, e.b.y); } else if (e.type === 'POLYLINE') for (const p of e.verts) { xs.push(p.x); ys.push(p.y); }
      }
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), x0: Math.min(...xs), y0: Math.min(...ys) };
    };
    // the front view is the 40 x 25 outline with the 12 mm hole in it (drawn as a polyline)
    const front = ents.filter((e) => e.type === 'POLYLINE' ? e.verts.every((p) => p.y < 26) : e.type === 'LINE' && e.a.y < 26 && e.b.y < 26 && e.a.x < 41 && e.b.x < 41);
    expect(extent(front)).toMatchObject({ w: 40, h: 25, x0: 0, y0: 0 });
    const hole = ents.find((e) => e.type === 'POLYLINE' && e.verts.length > 8 && e.verts.every((p) => p.y < 26 && p.x < 41)) as Extract<DxfEntity, { type: 'POLYLINE' }>;
    expect(hole).toBeDefined();
    expect(Math.max(...hole.verts.map((p) => p.x)) - Math.min(...hole.verts.map((p) => p.x))).toBeCloseTo(12, 1);   // sampled edge, so a chord short of the true diameter
    // the hole is not visible from the side, so those views hold the outline lines of the box only
    expect(ents.length).toBeGreaterThan(12);
  });
});

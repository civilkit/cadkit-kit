// The defaults the audit fixes now give, built against the real kernel: a lip joint on a solid body, a surface of revolution from an open profile, a pipe with a wall.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import type { Ctx } from './featureCommands';
import { lipJointOps, surfaceRevolveOps } from './featureCreators';

type Wire = Record<string, unknown>;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const lines = (ids: string[][]) => ids.map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b }));
const rect = (id: string, x0: number, y0: number, x1: number, y1: number): Wire => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: lines([['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']]), constraints: [],
});
const part = (features: Wire[]): PartDoc => ({ ...emptyPart('P'), upAxis: 'z', features, seq: features.length + 1 }) as unknown as PartDoc;
async function errorsOf(features: Wire[]) {
  const s = await Session.open(part(features)); sessions.push(s);
  const rep = await s.regenReport();
  return { s, errors: (rep.errors as unknown as Array<[string, { code: string }]>).map((e) => `${e[0]}:${e[1].code}`) };
}
const feature = (ops: unknown): Wire => ((ops as Array<{ feature: Wire }>)[0]).feature;
const BOX = [rect('F1', 0, 0, 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }];
const ctxOf = (features: Wire[]): Ctx => ({ doc: { features } as never, selection: [], mode: 'body', box: { min: [0, 0, 0], max: [40, 25, 10] }, edges: [] });

describe('audit fix defaults against the kernel', () => {
  it('the lip joint the Lip joint button makes on a solid box builds (width in mm and an inset, not a share of a wall)', async () => {
    const lj = { ...feature(lipJointOps(ctxOf(BOX))), id: 'F3' };
    expect(lj).toMatchObject({ width: 1, inset: 0.5 });
    expect((await errorsOf([...BOX, lj])).errors).toEqual([]);
  });
  it('a surface of revolution turns an open profile about a construction axis', async () => {
    const sk: Wire = { type: 'sketch', id: 'S1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'a', x: 5, y: 0 }, { id: 'b', x: 8, y: 10 }, { id: 'c', x: 0, y: 0 }, { id: 'd', x: 0, y: 10 }], entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'ax', type: 'line', p1: 'c', p2: 'd', construction: true }], constraints: [] };
    const sr = { ...feature(surfaceRevolveOps(ctxOf([sk]))), id: 'F2' };
    expect(sr).toMatchObject({ type: 'surfaceRevolve', sketch: 'S1', axis: 'ax' });
    expect((await errorsOf([sk, sr])).errors).toEqual([]);
  });
  it('a pipe with a wall builds hollow: less volume than the solid pipe', async () => {
    const path: Wire = { type: 'sketch', id: 'S1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 30, y: 0 }], entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }], constraints: [] };
    const pipe = (extra: Wire): Wire => ({ type: 'pipe', id: 'F2', op: 'add', path: { kind: 'sketch', id: 'S1' }, radius: 2, ...extra });
    const solid = await errorsOf([path, pipe({})]);
    const hollow = await errorsOf([path, pipe({ wall: 0.5 })]);
    expect(solid.errors).toEqual([]);
    expect(hollow.errors).toEqual([]);
    const vs = (await solid.s.massProps()).volume as number, vh = (await hollow.s.massProps()).volume as number;
    expect(vh).toBeLessThan(vs * 0.8);
  });
  it('a surface trimmed by a standard plane (Trim with Tool = Plane) has its plane resolved', async () => {
    const trim = { type: 'trimSurface', id: 'F4', surface: 'F3', mutual: false, flip: false, plane: { kind: 'std', id: 'top' } };
    const ex = { type: 'surfaceExtrude', id: 'F3', sketch: 'F1', end: 'blind', depth: 10 };
    const line: Wire = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'a', x: 0, y: -10 }, { id: 'b', x: 0, y: 10 }], entities: lines([['e1', 'a', 'b']]), constraints: [] };
    // the plane is read (no missingReference); building the cut piece of a sheet is the kernel's (trimPieceLoop on a plain planar sheet, reported to the kernel agent)
    expect((await errorsOf([line, ex, trim])).errors.filter((e) => e.endsWith(':missingReference'))).toEqual([]);
  });
});

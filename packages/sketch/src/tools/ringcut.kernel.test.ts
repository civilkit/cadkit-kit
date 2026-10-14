import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { toFeature, type SketchDraft } from '../index';
import { sketchShapes, defaultCutRegions } from '../shapes';
import { fitCurve } from './splineMath';
import { DEFAULT_SETTINGS, type ToolEnv } from './types';
import { OFFSET_FACE_KEY, offsetTool } from './offset';
import { withExactEdges } from './exactEdges';
import { closeSessions, sessions } from './kernel-fixtures';

afterEach(closeSessions);
const kidney = [[0, 0], [30, -6], [60, 0], [75, 22], [55, 40], [30, 30], [10, 42], [-10, 22]];
const base = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], constraints: [],
  points: kidney.map((p, i) => ({ id: `p${i + 1}`, x: p[0], y: p[1] })), entities: [{ id: 'e1', type: 'spline', pts: kidney.map((_, i) => `p${i + 1}`), closed: true }] });

/** The GUI flow: kidney spline, extruded 4 mm, sketch on the top face, Offset of the face outline 1 mm inward. */
async function wallSketch(depth = 4, exact = false) {
  const doc = (extra: Record<string, unknown>[]) => ({ ...emptyPart('Kidney'), features: [toFeature(base()), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth, id: 'F2' }, ...extra], seq: 9 }) as unknown as PartDoc;
  const s0 = await Session.open(doc([]));
  sessions.push(s0);
  const b0 = (await s0.bodyForView())!;
  const topFace = b0.mesh.faceIds.filter((f) => /\.C\d$/.test(f)).find((f) => b0.edges.filter((e) => (e as { faces?: string[] }).faces?.includes(f)).every((e) => e.pts.every((p) => Math.abs(p[2] - depth) < 1e-6)))!;
  const sk = { type: 'sketch', id: 'F3', name: 'On top', plane: { kind: 'face', id: topFace }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [] };
  const s1 = await Session.open(doc([sk]));
  sessions.push(s1);
  const view = (await s1.bodyForView())!;
  const env: ToolEnv = { body: { frame: view.sketches.find((x) => x.id === 'F3')!.frame, edges: (() => { const plain = view.edges.map((e) => ({ key: e.key, faces: (e as { faces?: string[] }).faces, pts: e.pts })); if (exact) console.log('EDGES', JSON.stringify(plain.map((e) => [e.faces, e.pts.length, e.pts[0]])), JSON.stringify(view.sketches.map((x) => [x.id, x.frame]))); return exact ? withExactEdges(plain, doc([]).features as never, (id) => (view.sketches.find((x) => x.id === id)?.frame as never) ?? null) : plain; })() }, tol: 1, selection: [topFace] };
  const d0: SketchDraft = { id: 'F3', plane: { kind: 'face', id: topFace }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [], temp: [] };
  let out = offsetTool.step(offsetTool.start(), { type: 'key', key: OFFSET_FACE_KEY }, d0, DEFAULT_SETTINGS, env);
  out = offsetTool.step(out.state, { type: 'key', key: 'Enter' }, out.draft, DEFAULT_SETTINGS, env);
  return { doc, feature: toFeature(out.draft) as Record<string, unknown>, draft: out.draft };
}

const area = (pts: Array<{ x: number; y: number }>) => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;

describe('cut from the offset sketch on a free-form top face (the GUI flow)', { skip: !process.env.CK_WASM }, () => {
  it('the projected outline of a spline wall is the sketch spline itself; every cut choice works and removes the right volume', async () => {
    const { doc, feature, draft } = await wallSketch(4, true);
    const shapes = sketchShapes(feature as never);
    expect(shapes.map((x) => [x.reference, x.inside])).toEqual([[true, undefined], [false, 'e1']]);
    // the outer loop is the 8 fit points of the original kidney, not a 48 point fit through the tessellation
    expect(draft.entities.find((e) => e.id === 'e1')!.pts).toHaveLength(8);
    expect(defaultCutRegions(feature as never)).toEqual(['e2']);
    const pt = (id: string) => draft.points.find((p) => p.id === id)!;
    const aOuter = area(fitCurve(kidney.map(([x, y]) => ({ x, y })) as never, true, 16));
    const aInner = area(fitCurve(((draft.entities.find((e) => e.id === 'e2') as unknown as { pts: string[] }).pts).map(pt) as never, true, 16));
    const cut = async (extra: Record<string, unknown>) => {
      const s = await Session.open(doc([feature, { type: 'extrude', op: 'cut', sketch: 'F3', end: 'blind', depth: 3, id: 'F4', ...extra }]));
      sessions.push(s);
      const r = await s.preview([], { sketchStatus: true, solveSketches: true });
      expect(r.errors).toEqual([]);
      return (await s.facts()).volume!;
    };
    const v0 = aOuter * 4;
    const near = (got: number, want: number) => expect(Math.abs(got - want) / want).toBeLessThan(0.01);
    near(await cut({ regions: ['e2'] }), v0 - aInner * 3);                    // pocket: what the default picks
    near(await cut({ regions: ['e1'] }), v0 - (aOuter - aInner) * 3);         // the wall ring (outer coincides with the body wall)
    near(await cut({}), v0 - (aOuter - aInner) * 3);                           // every region = the ring
  }, 240000);

  it('without the exact curve the tessellation fit only nearly coincides with the wall: the pocket still cuts', async () => {
    const { doc, feature } = await wallSketch(4, false);
    const s = await Session.open(doc([feature, { type: 'extrude', op: 'cut', sketch: 'F3', end: 'blind', depth: 3, id: 'F4', regions: defaultCutRegions(feature as never) }]));
    sessions.push(s);
    const r = await s.preview([], { sketchStatus: true, solveSketches: true });
    expect(r.errors).toEqual([]);
  }, 240000);
});

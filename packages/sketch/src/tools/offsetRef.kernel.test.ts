import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { toFeature, type SketchDraft } from '../index';
import { sketchShapes } from '../shapes';
import { DEFAULT_SETTINGS, type ToolEnv } from './types';
import { OFFSET_FACE_KEY, offsetTool } from './offset';
import { fitCurve } from './splineMath';
import { closeSessions, sessions } from './kernel-fixtures';

afterEach(closeSessions);
const kidney = [[0, 0], [30, -6], [60, 0], [75, 22], [55, 40], [30, 30], [10, 42], [-10, 22]];
const base = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], constraints: [],
  points: kidney.map((p, i) => ({ id: `p${i + 1}`, x: p[0], y: p[1] })), entities: [{ id: 'e1', type: 'spline', pts: kidney.map((_, i) => `p${i + 1}`), closed: true }] });
const area = (pts: Array<{ x: number; y: number }>) => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;

describe('offsetting the outline of a free-form part, in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('sketch on the top face, Offset with nothing picked: 1 mm inward ring that extrudes to the wall', async () => {
    const doc = (extra: Record<string, unknown>[]) => ({ ...emptyPart('Kidney'), features: [toFeature(base()), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth: 4, id: 'F2' }, ...extra], seq: 9 }) as unknown as PartDoc;
    const s0 = await Session.open(doc([]));
    sessions.push(s0);
    // the cap at z = 4 (the other cap is the sketch plane)
    const b0 = (await s0.bodyForView())!;
    const topFace = b0.mesh.faceIds.filter((f) => /\.C\d$/.test(f)).find((f) => b0.edges.filter((e) => (e as { faces?: string[] }).faces?.includes(f)).every((e) => e.pts.every((p) => Math.abs(p[2] - 4) < 1e-6)))!;
    expect(topFace).toBeDefined();
    const sk = { type: 'sketch', id: 'F3', name: 'On top', plane: { kind: 'face', id: topFace }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [] };
    const s1 = await Session.open(doc([sk]));
    sessions.push(s1);
    const view = (await s1.bodyForView())!;
    const env: ToolEnv = { body: { frame: view.sketches.find((x) => x.id === 'F3')!.frame, edges: view.edges.map((e) => ({ key: e.key, faces: (e as { faces?: string[] }).faces, pts: e.pts })) }, tol: 1, selection: [topFace] };
    const d0: SketchDraft = { id: 'F3', plane: { kind: 'face', id: topFace }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [], temp: [] };
    let out = offsetTool.step(offsetTool.start(), { type: 'key', key: OFFSET_FACE_KEY }, d0, DEFAULT_SETTINGS, env);
    expect(out.hint).toBe('app.sketch.hint.offsetFaceOutline');
    out = offsetTool.step(out.state, { type: 'key', key: 'Enter' }, out.draft, DEFAULT_SETTINGS, env);
    const d = out.draft;
    const splines = d.entities.filter((e) => e.type === 'spline');
    expect(splines).toHaveLength(2);
    const loops = sketchShapes(toFeature(d) as never);
    expect(loops).toHaveLength(2);
    // the offset sketch is valid for the kernel and its two loops extrude to a ring (on its own plane, no body to merge with)
    const pt = (id: string) => d.points.find((p) => p.id === id)!;
    const aOuter = area(fitCurve((splines[0].pts as string[]).map(pt) as never, true, 16));
    const aInner = area(fitCurve((splines[1].pts as string[]).map(pt) as never, true, 16));
    expect(aInner).toBeLessThan(aOuter);
    expect(aOuter - aInner).toBeGreaterThan(0.5 * 1 * 150);          // a ~1 mm wall around a ~230 mm perimeter
    const flat: SketchDraft = { ...d, id: 'F1', plane: { kind: 'std', id: 'front' } };
    const ringDoc = { ...emptyPart('Ring'), features: [toFeature(flat), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth: 3, id: 'F2' }], seq: 3 } as unknown as PartDoc;
    const s2 = await Session.open(ringDoc);
    sessions.push(s2);
    const r = await s2.preview([], { sketchStatus: true, solveSketches: true });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const facts = await s2.facts();
    expect(facts.volume!).toBeCloseTo((aOuter - aInner) * 3, 0);
  }, 120000);
});

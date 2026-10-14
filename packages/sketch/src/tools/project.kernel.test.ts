import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { toFeature, type SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type ToolEnv, type ToolEvent } from './types';
import { projectTool } from './project';
import { circleTool } from './circle';
import { filletTool } from './fillet';
import { projectEdges } from './project';
import { rectDraft } from './edit-fixtures';
import { closeSessions, sessions } from './kernel-fixtures';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });

/** A 40 x 20 x 5 plate with a hole r=4 at (20,10): sketch F1 (rectangle + circle) extruded by F2. */
const plateDoc = (extra: Record<string, unknown>[] = []): PartDoc => {
  const base: SketchDraft = { ...rectDraft(40, 20), points: [...rectDraft(40, 20).points, { id: 'p5', x: 20, y: 10 }], entities: [...rectDraft(40, 20).entities, { id: 'e5', type: 'circle', c: 'p5', r: 4 }] };
  return { ...emptyPart('Plate'), features: [toFeature(base), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth: 5, id: 'F2' }, ...extra], seq: 10 } as unknown as PartDoc;
};

describe('projected body edges in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('projects the top face of a plate onto a sketch on it: reference geometry that is solved, fixed and not extruded', async () => {
    const s0 = await Session.open(plateDoc());
    sessions.push(s0);
    const body = (await s0.bodyForView())!;
    // the top face: the cap whose edges lie at z = 5
    const top = body.mesh.faceIds.filter((f) => /\.C\d$/.test(f)).find((f) => body.edges.filter((e) => (e as { faces?: string[] }).faces?.includes(f)).every((e) => e.pts.every((p) => Math.abs(p[2] - 5) < 1e-9)));
    expect(top).toBeDefined();

    // a new sketch on that face, with a small user circle of its own
    const sketch = { type: 'sketch', id: 'F3', name: 'On top', plane: { kind: 'face', id: top }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [] };
    const doc1 = plateDoc([sketch]);
    const s1 = await Session.open(doc1);
    sessions.push(s1);
    const view = (await s1.bodyForView())!;
    const frame = view.sketches.find((x) => x.id === 'F3')!.frame;
    const edges = view.edges.map((e) => ({ key: e.key, faces: (e as { faces?: string[] }).faces, pts: e.pts }));

    const env: ToolEnv = { body: { frame, edges }, tol: 1, selection: [top!] };
    const draft0: SketchDraft = { id: 'F3', plane: { kind: 'face', id: top }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [], temp: [] };
    let out = projectTool.step({}, { type: 'key', key: 'Enter' }, draft0, DEFAULT_SETTINGS, env);
    const proj = out.draft;
    expect(proj.entities.filter((e) => e.type === 'line')).toHaveLength(4);
    expect(proj.entities.filter((e) => e.type === 'circle')).toHaveLength(1);
    expect(proj.entities.every((e) => e.construction === true && e.ext === true)).toBe(true);
    expect(proj.points.every((p) => p.fixed === true)).toBe(true);

    // add a user circle r=3 centred on the projected hole's centre by drawing it, then extrude only that
    const hole = proj.entities.find((e) => e.type === 'circle')!;
    const hc = proj.points.find((p) => p.id === hole.c)!;
    let o = circleTool.step(circleTool.start(), click(hc.x, hc.y), proj, DEFAULT_SETTINGS);
    o = circleTool.step(o.state, click(hc.x + 3, hc.y), o.draft, DEFAULT_SETTINGS);
    const final = o.draft;
    const doc2 = { ...plateDoc([toFeature(final), { type: 'extrude', op: 'add', sketch: 'F3', end: 'blind', depth: 2, id: 'F4' }]) } as PartDoc;
    const s2 = await Session.open(doc2);
    sessions.push(s2);
    const r = await s2.preview([], { sketchStatus: true, solveSketches: true });
    expect(r.errors).toEqual([]);
    const sk = r.body!.sketches.find((x) => x.id === 'F3')!;
    const st = sk.status!;
    expect(st.conflicts).toEqual([]);
    expect(st.solved).toBe(true);
    // everything projected is a constant; only the user's circle (centre x,y + radius) is free
    expect(st.dof).toBe(3);
    // the projected corners are where the plate's corners are, in the sketch's own coordinates
    const xs = sk.sketch.points.filter((p) => (p as { fixed?: boolean }).fixed).map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 5);
    expect(Math.max(...xs)).toBeCloseTo(40, 5);
    // the user circle (and nothing projected) was extruded: the plate (minus its hole) grows by a disc r=3 sitting in the hole's footprint? No: the hole is empty, so it adds a 2-high boss
    const facts = await s2.facts();
    expect(facts.volume!).toBeCloseTo(5 * (800 - Math.PI * 16) + 2 * Math.PI * 9, 2);
  });

  it('a click projects one edge; the kernel regenerates the sketch with it', async () => {
    const s = await Session.open(plateDoc([{ type: 'sketch', id: 'F3', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [] }]));
    sessions.push(s);
    const view = (await s.bodyForView())!;
    const frame = view.sketches.find((x) => x.id === 'F3')!.frame;
    const edges = view.edges.map((e) => ({ key: e.key, faces: (e as { faces?: string[] }).faces, pts: e.pts }));
    const env: ToolEnv = { body: { frame, edges }, tol: 0.5 };
    // find where the long bottom edge of the plate lands in this plane: scan the projected polylines for a 40 long one
    const draft0: SketchDraft = { id: 'F3', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [], temp: [] };
    const u = (p: number[]) => (p[0] - frame.o[0]) * frame.x[0] + (p[1] - frame.o[1]) * frame.x[1] + (p[2] - frame.o[2]) * frame.x[2];
    const v = (p: number[]) => (p[0] - frame.o[0]) * frame.y[0] + (p[1] - frame.o[1]) * frame.y[1] + (p[2] - frame.o[2]) * frame.y[2];
    const long = edges.find((e) => e.pts.length === 2 && Math.hypot(u(e.pts[0]) - u(e.pts[1]), v(e.pts[0]) - v(e.pts[1])) > 39)!;
    const mid = { x: (u(long.pts[0]) + u(long.pts[1])) / 2, y: (v(long.pts[0]) + v(long.pts[1])) / 2 };
    const out = projectTool.step({}, click(mid.x, mid.y), draft0, DEFAULT_SETTINGS, env);
    expect(out.draft.entities).toHaveLength(1);
    expect(out.draft.entities[0]).toMatchObject({ type: 'line', construction: true, ext: true });
    // a circle edge becomes a circle with a driven radius that the kernel accepts
    const circ = edges.find((e) => e.pts.length > 10 && e.pts.every((p) => Math.abs(p[2] - 5) < 1e-9))!;
    const cx = u(circ.pts[0]);
    const out2 = projectTool.step({}, click(cx, v(circ.pts[0])), out.draft, DEFAULT_SETTINGS, env);
    expect(out2.draft.entities.map((e) => e.type)).toContain('circle');
    const s2 = await Session.open(plateDoc([toFeature(out2.draft)]));
    sessions.push(s2);
    const r = await s2.preview([], { sketchStatus: true, solveSketches: true });
    expect(r.errors).toEqual([]);
    const st = r.body!.sketches.find((x) => x.id === 'F3')!.status!;
    expect(st.conflicts).toEqual([]);
    expect(st.dof).toBe(0);
  });

  it('arcs of a filleted outline project as counter-clockwise arcs; a tilted circle projects as a closed spline; both solve with no conflict and no freedom', async () => {
    // a rounded plate: fillet two corners of a 30 x 20 rectangle, extrude it, read its edges back
    let d = rectDraft(30, 20);
    for (const [a, b] of [['e1', 'e2'], ['e3', 'e4']]) {
      const ev = (id: string): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, entityId: id }, mods: M });
      let st = filletTool.start(); let cur = d;
      for (const e of [{ type: 'field', id: 'r', value: 5, commit: true } as ToolEvent, ev(a), ev(b)]) { const o = filletTool.step(st, e, cur, DEFAULT_SETTINGS); st = o.state; cur = o.draft; }
      d = cur;
    }
    const s0 = await Session.open({ ...emptyPart('Rounded'), features: [toFeature(d), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth: 4, id: 'F2' }], seq: 3 } as unknown as PartDoc);
    sessions.push(s0);
    const body = (await s0.bodyForView())!;
    const frame = { o: [0, 0, 4], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    const edges = body.edges.map((e) => ({ key: e.key, faces: (e as { faces?: string[] }).faces, pts: e.pts }));
    const tilted = Array.from({ length: 49 }, (_, i) => [15 + 8 * Math.cos((i / 48) * Math.PI * 2), 10 + 4 * Math.sin((i / 48) * Math.PI * 2), 9 + 6 * Math.sin((i / 48) * Math.PI * 2)]);
    const res = projectEdges({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] }, frame, [...edges, { key: 'tilt', pts: tilted }]);
    const types = res.draft.entities.map((e) => e.type);
    expect(types.filter((t) => t === 'arc')).toHaveLength(2);
    expect(types).toContain('spline');
    // a sketch of reference geometry alone has no profile to extrude, so read its status from the sketch-only regen
    const s1 = await Session.open({ ...emptyPart('Ref'), features: [toFeature(res.draft)], seq: 2 } as unknown as PartDoc);
    sessions.push(s1);
    const r = await s1.preview([], { upTo: 1, sketchStatus: true, solveSketches: true });
    expect(r.errors).toEqual([]);
    const status = r.sketches![0].status!;
    expect(status.conflicts).toEqual([]);
    expect(status.dof).toBe(0);
    expect(status!.solved).toBe(true);
  });
});

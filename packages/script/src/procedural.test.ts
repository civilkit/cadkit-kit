// The script wrappers of the procedural curve and surface features (features/procedural.ts): the feature JSON each emits, and the
// mistakes they stop before the kernel sees them. No kernel: a fake host with a small geometry (procedural.kernel.test.ts builds them).
import { describe, expect, it } from 'vitest';
import { runScript, type ScriptHost } from './index';

// a 2 x 2 x 2 box as two named faces (top F2.C1, one side F2.S.e1) and the edge between them, and apart (openEdges) the four open edges
// of a sheet rim at z = 2 (one face each), so face(), edges() and the open-edge loop of fillNSided all resolve
const rim = [[[0, 0, 2], [2, 0, 2]], [[2, 0, 2], [2, 2, 2]], [[0, 2, 2], [2, 2, 2]], [[0, 0, 2], [0, 2, 2]]];
const geo = () => ({
  mesh: {
    positions: [0, 0, 2, 2, 0, 2, 2, 2, 2, 0, 0, 2, 2, 2, 2, 0, 2, 2, 0, 0, 0, 2, 0, 0, 2, 0, 2, 0, 0, 0, 2, 0, 2, 0, 0, 2],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0],
    triFace: [0, 0, 1, 1], faceIds: ['F2.C1', 'F2.S.e1'],
  },
  edges: [
    { key: 'a', faces: ['F2.C1', 'F2.S.e1'], mid: [1, 0, 2], pts: [[0, 0, 2], [2, 0, 2]] },
  ],
  // the rim, listed out of chain order (the wrapper chains it), and one open edge lower down that '>Z' leaves out
  openEdges: [
    ...[0, 2, 1, 3].map((i) => ({ key: 'r' + i, faces: ['W' + i], mid: rim[i][0].map((x, k) => (x + rim[i][1][k]) / 2), pts: rim[i] })),
    { key: 'low', faces: ['W9'], mid: [1, 0, 0], pts: [[0, 0, 0], [2, 0, 0]] },
  ],
  box: { min: [0, 0, 0], max: [2, 2, 2] },
});
const host: ScriptHost = {
  load: async () => {}, edit: async () => ({ ok: true }), geometry: geo as never,
  build: async () => ({ errors: [], geometry: geo() as never }), release: async () => {},
};
const BASE = `const p = part('B').sketch('front', (s) => s.rect(2, 2)).extrude(2);\n`;
type F = Record<string, any>;
async function feats(code: string): Promise<F[]> {
  const r = await runScript(BASE + code, host, {}, { yieldToUi: async () => {} });
  if (r.errors.length) throw new Error(r.errors.map((e) => e.message).join(' | '));
  return (r.document!.features as F[]).slice(2);
}
const fail = async (code: string): Promise<string> => (await runScript(BASE + code, host, {}, { yieldToUi: async () => {} })).errors.map((e) => e.message).join(' | ');
const ARC = `(s) => s.arc([0, 0], [6, 0], [0, 6])`;

describe('procedural curve and surface wrappers: the emitted feature JSON', () => {
  it('projectCurve: the last sketch, fitted (degree 3, both ways) by default', async () => {
    const all = await feats(`p.sketch(at('front', 5), (s) => s.circle(0.5, [1, 1])).projectCurve(face('F2.C1'));`);
    const sk = all.find((x) => x.type === 'sketch')!, f = all.at(-1)!;
    expect(f).toEqual({ type: 'projectCurve', id: f.id, sketch: sk.id, faces: ['F2.C1'], degree: 3, direction: 'both', tolerance: 0.001 });
  });
  it('projectCurve, keepExact: procedural on one face, along, and a list of curves in chain order', async () => {
    const f = (await feats(`p.sketch(at('front', 5), (s) => s.circle(0.5, [1, 1])).projectCurve(face('F2.C1'), { keepExact: true, along: 'normal', gapTolerance: 0.01 });`)).at(-1)!;
    expect(f).toMatchObject({ type: 'projectCurve', procedural: true, faces: ['F2.C1'], along: 'normal', gapTolerance: 0.01, tolerance: 0.001 });
    expect(f.degree).toBeUndefined();
    expect(f.direction).toBeUndefined();
    const list = await feats(`p.offsetCurve(1, { curve: { on: 'front', draw: ${ARC} } });
const o = p.handle();
p.projectCurve(face('F2.C1'), { keepExact: true, curve: [o, { on: at('front', 5), draw: (s) => s.polyline([[0, 6], [0, 9], [3, 9]]) }] });`);
    const proj = list.at(-1)!;
    const sk = list.at(-2)!;
    expect(proj.sketch).toBeUndefined();
    expect(proj.curves).toEqual([{ kind: 'curve', id: list[1].id }, ...sk.entities.map((e: F) => ({ kind: 'sketchCurve', sketch: sk.id, entity: e.id }))]);
    expect(proj.curves).toHaveLength(3);
  });
  it('projectCurve: the refusals before the kernel', async () => {
    const S = `p.sketch(at('front', 5), (s) => s.circle(0.5, [1, 1]))`;
    expect(await fail(`${S}.projectCurve(faces({ planar: true }), { keepExact: true });`)).toMatch(/exactly one face/);
    expect(await fail(`${S}.projectCurve(face('F2.C1'), { along: 'normal' });`)).toMatch(/need keepExact/);
    expect(await fail(`${S}.projectCurve(face('F2.C1'), { keepExact: true, degree: 5 });`)).toMatch(/fitted projection/);
    expect(await fail(`p.projectCurve(face('F2.C1'), { curve: [{ on: 'front', draw: ${ARC} }] });`)).toMatch(/needs keepExact/);
    expect(await fail(`${S}.projectCurve(face('F2.C1'), { keepExact: true, along: [0, 0] });`)).toMatch(/\[x, y, z\]/);
    expect(await fail(`p.projectCurve(face('F2.C1'));`)).toMatch(/draw a sketch before it/);
  });
  it('offsetCurve: the last sketch or a given curve, where it runs, and its refusals', async () => {
    const [sk, f] = await feats(`p.sketch('front', ${ARC}).offsetCurve(-1);`);
    expect(f).toEqual({ type: 'offsetCurve', id: f.id, sketch: sk.id, distance: -1, tolerance: 0.001 });
    const [, g] = await feats(`p.sketch('front', ${ARC}).offsetCurve(2, { plane: 'top', gapTolerance: 0.001 });`);
    expect(g).toMatchObject({ plane: { kind: 'std', id: 'top' }, gapTolerance: 0.001 });
    expect((await feats(`p.offsetCurve(2, { curve: edges('all'), face: face('F2.C1') });`))[0]).toMatchObject({ curves: [{ kind: 'edge', faces: ['F2.C1', 'F2.S.e1'], at: [1, 0, 2] }], face: 'F2.C1' });
    expect((await feats(`p.offsetCurve(2, { curve: { on: 'front', draw: ${ARC} }, normal: [0, 0, 1] });`))[1]).toMatchObject({ normal: [0, 0, 1] });
    expect(await fail(`p.sketch('front', ${ARC}).offsetCurve(0);`)).toMatch(/not 0/);
    expect(await fail(`p.sketch('front', ${ARC}).offsetCurve(1, { plane: 'top', normal: [0, 0, 1] });`)).toMatch(/one of plane, face and normal/);
  });
  it('compositeCurve: the last sketch, or a list of curves in chain order', async () => {
    const [sk, f] = await feats(`p.sketch('front', (s) => s.polyline([[0, 0], [2, 0], [2, 1]])).compositeCurve({ gapTolerance: 0.01 });`);
    expect(f).toEqual({ type: 'compositeCurve', id: f.id, sketch: sk.id, tolerance: 0.001, gapTolerance: 0.01 });
    const l = await feats(`p.helix({ radius: 1, pitch: 1, revolutions: 2 });
const h = p.handle();
p.compositeCurve({ curves: [h, 'F2'] });`);
    expect(l.at(-1)).toMatchObject({ type: 'compositeCurve', curves: [{ kind: 'curve', id: l[1].id }, { kind: 'curve', id: 'F2' }] });
    expect(await fail(`p.compositeCurve({ curves: [] });`)).toMatch(/list is empty/);
    expect(await fail(`p.compositeCurve({ curves: 'F2' });`)).toMatch(/curves is a list/);
  });
  it('sweepSurface: sketch ids, a curve handle or references; frame, up, caps; a surface knit() takes', async () => {
    const fs = await feats(`p.sweepSurface({ on: 'front', draw: (s) => s.circle(0.5) }, { on: 'right', draw: (s) => s.line([0, 0], [5, 0]) }, { caps: true }).knit({ solid: true });`);
    const [prof, path, sw, knit] = fs;
    expect(sw).toEqual({ type: 'sweepSurface', id: sw.id, profile: prof.id, path: path.id, frame: 'tangent', tolerance: 0.001, caps: true });
    expect(knit).toMatchObject({ type: 'knit', surfaces: [sw.id], solid: true });
    const viaCurve = await feats(`p.sketch('front', ${ARC}).offsetCurve(-1);
const rail = p.handle();
p.sweepSurface({ on: 'right', draw: (s) => s.circle(0.5, [0, 5]) }, rail, { frame: 'translate', up: [0, 0, 1] });`);
    expect(viaCurve.at(-1)).toMatchObject({ type: 'sweepSurface', path: viaCurve[1].id, frame: 'translate', up: [0, 0, 1] });
    expect((await feats(`p.sweepSurface({ on: 'front', draw: (s) => s.circle(0.5) }, edges('all'));`))[1]).toMatchObject({ path: [{ kind: 'edge', faces: ['F2.C1', 'F2.S.e1'], at: [1, 0, 2] }] });
    expect(await fail(`p.sweepSurface({ on: 'front', draw: (s) => s.circle(0.5) });`)).toMatch(/give both/);
    expect(await fail(`p.sweepSurface({ on: 'front', draw: (s) => s.circle(0.5) }, 'F2', { frame: 'frenet' });`)).toMatch(/'tangent'/);
  });
  it('blendSurface: two faces, a radius or a varying one, sides and a two-point span', async () => {
    const [f] = await feats(`p.blendSurface([face('F2.C1'), face('F2.S.e1')], 0.5);`);
    expect(f).toEqual({ type: 'blendSurface', id: f.id, faces: ['F2.C1', 'F2.S.e1'], radius: 0.5, tolerance: 0.001 });
    const [g] = await feats(`p.blendSurface([face('F2.C1'), face('F2.S.e1')], [0.5, 0.8], { sides: [-1, -1], from: [0, 0, 2], to: [2, 0, 2] });`);
    expect(g).toMatchObject({ radius: [0.5, 0.8], sides: [-1, -1], from: [0, 0, 2], to: [2, 0, 2] });
    expect((await feats(`p.blendSurface(faces({ planar: true }), 0.5, { at: [1, 0, 2] });`))[0]).toMatchObject({ faces: ['F2.C1', 'F2.S.e1'], at: [1, 0, 2] });
    expect(await fail(`p.blendSurface([face('F2.C1'), face('F2.C1')], 0.5);`)).toMatch(/two different faces/);
    expect(await fail(`p.blendSurface([face('F2.C1'), face('F2.S.e1')], 0);`)).toMatch(/above 0/);
    expect(await fail(`p.blendSurface([face('F2.C1'), face('F2.S.e1')], 1, { from: [0, 0, 0] });`)).toMatch(/both from and to/);
    expect(await fail(`p.blendSurface([face('F2.C1'), face('F2.S.e1')], 1, { sides: [1, 0] });`)).toMatch(/sides is/);
  });
  it('fillNSided: the open edges of the top plane, chained into one loop; or edge references', async () => {
    const [f] = await feats(`p.fillNSided('>Z', { continuity: 'G1' });`);
    expect(f).toMatchObject({ type: 'fill', merge: true, continuity: 'G1', fairing: 'meowNURBS', patch: 'nSided', patchTolerance: 1e-4 });
    expect(f.edges.map((e: F) => e.faces[0])).toEqual(['W0', 'W1', 'W2', 'W3']);
    const [g] = await feats(`p.fillNSided([{ faces: ['W0'], at: [1, 0, 2] }, { faces: ['W1'], at: [2, 1, 2] }], { tolerance: 0.001 });`);
    expect(g).toMatchObject({ continuity: 'G0', patchTolerance: 0.001, edges: [{ faces: ['W0'], at: [1, 0, 2] }, { faces: ['W1'], at: [2, 1, 2] }] });
    expect(await fail(`p.fillNSided('all');`)).toMatch(/more than one loop/);
    expect(await fail(`p.fillNSided('>Z', { continuity: 'G2' });`)).toMatch(/'G0' or 'G1'/);
    expect(await fail(`p.fillNSided('top');`)).toMatch(/open edges of the sheet/);
  });
  it('checkIntersection: no feature, and a host without the check says so', async () => {
    const r = await runScript(BASE + `const c = await p.checkIntersection(face('F2.C1'));`, host, {}, { yieldToUi: async () => {} });
    expect((r.document!.features as F[]).length).toBe(2);
    expect(r.errors.map((e) => e.message).join(' ')).toMatch(/cannot check intersections/);
    const seen: unknown[] = [];
    const withCheck: ScriptHost = { ...host, facts: async (need) => { seen.push(need); return { intersection: { pairs: 1, curves: 1, marched: 0, spans: 0, proved: 0, repaired: 0, unresolved: 0, issues: [] } }; } };
    const ok = await runScript(BASE + `const c = await p.checkIntersection(face('F2.C1'));\nif (c.pairs !== 1) throw new Error('bad');`, withCheck, {}, { yieldToUi: async () => {} });
    expect(ok.errors).toEqual([]);
    expect(seen).toContainEqual({ intersection: { faces: ['F2.C1'] } });
  });
});

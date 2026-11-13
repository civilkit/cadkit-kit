import { describe, expect, it } from 'vitest';
import { PSEUDO, setLocale } from '@kit/i18n';
import { buildCommands, type Actions } from './commands';
import { chainedEdgeRefs, canFillet, faceEdgeRefs, filletOps, filletWhy, chamferOps, featureCommands, roundTargets, canHole, canPattern, canRevolve, canShell, edgeRefs, niceSize, pickValue, type Ctx } from './featureCommands';
import { en } from './locales/en';
import './i18n';

const box = { min: [0, 0, 0], max: [40, 25, 10] };
const edges = [{ key: 'A|B#0', faces: ['A', 'B'], mid: [1, 2, 3] }, { key: 'A|C#1', faces: ['A', 'C'], mid: [4, 5, 6] }];
const sketch = (entities: unknown[], extra = {}) => ({ type: 'sketch', id: 'F1', entities, ...extra });
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ doc: { features: [] } as never, selection: [], mode: 'face', box, edges, ...over });
const docOf = (...features: unknown[]) => ({ features }) as never;

describe('niceSize', () => {
  it('is about 5% of the smallest dimension, rounded to a nice number', () => {
    expect(niceSize(box)).toBe(0.5);
    expect(niceSize({ min: [0, 0, 0], max: [100, 80, 40] })).toBe(2);
    expect(niceSize({ min: [0, 0, 0], max: [100, 80, 50] })).toBe(2.5);
    expect(niceSize({ min: [0, 0, 0], max: [500, 400, 300] })).toBe(15);
    expect(niceSize(null)).toBe(1);
  });
});

describe('enabled rules', () => {
  it('fillet and chamfer need a selected edge in edge mode', () => {
    expect(canFillet(ctx())).toBe(false);
    expect(canFillet(ctx({ mode: 'edge', selection: ['A|B#0'] }))).toBe(true);
    expect(canFillet(ctx({ mode: 'face', selection: ['A|B#0'] }))).toBe(false);
    expect(canFillet(ctx({ mode: 'edge', selection: ['X|Y#9'] }))).toBe(false);
  });
  it('shell needs a selected face', () => {
    expect(canShell(ctx())).toBe(false);
    expect(canShell(ctx({ selection: ['A'] }))).toBe(true);
    expect(canShell(ctx({ mode: 'edge', selection: ['A|B#0'] }))).toBe(false);
  });
  it('hole needs a face, or a sketch made of points', () => {
    expect(canHole(ctx())).toBe(false);
    expect(canHole(ctx({ selection: ['A'] }))).toBe(true);
    expect(canHole(ctx({ doc: docOf(sketch([{ type: 'point', p: 'p1' }])) }))).toBe(true);
    expect(canHole(ctx({ doc: docOf(sketch([{ type: 'line' }])) }))).toBe(false);
    expect(canHole(ctx({ doc: docOf(sketch([{ type: 'point', p: 'p1' }])), box: null }))).toBe(false);
  });
  it('revolve needs a sketch; patterns need a feature that is not a sketch', () => {
    expect(canRevolve(ctx())).toBe(false);
    expect(canRevolve(ctx({ doc: docOf(sketch([])) }))).toBe(true);
    expect(canPattern(ctx({ doc: docOf(sketch([])) }))).toBe(false);
    expect(canPattern(ctx({ doc: docOf(sketch([]), { type: 'extrude', id: 'F2' }) }))).toBe(true);
  });
});

describe('selection to references', () => {
  it('edges become two faces and a point; unknown names are dropped', () => {
    expect(edgeRefs(['A|C#1', 'nope', 'A'], edges)).toEqual([{ faces: ['A', 'C'], at: [4, 5, 6] }]);
    expect(pickValue('edges', ['A|B#0'], edges)).toEqual([{ faces: ['A', 'B'], at: [1, 2, 3] }]);
    expect(pickValue('edges', ['A'], edges)).toBeNull();
    expect(pickValue('faces', ['A', 'A|B#0', 'C'], edges)).toEqual(['A', 'C']);
    expect(pickValue('sketch', ['F1'], edges)).toBe('F1');
    expect(pickValue('sketch', [], edges)).toBeNull();
  });
  it('To object / From object: a face, a body or a corner becomes a reference object', () => {
    expect(pickValue('endRef', ['A'], edges)).toEqual({ kind: 'face', id: 'A' });
    expect(pickValue('endRef', ['@body:Lid'], edges)).toEqual({ kind: 'body', name: 'Lid' });
    expect(pickValue('startRef', ['@body:Lid'], edges)).toBeNull();   // a start cannot be a body
    // a corner: the faces of the edges that end there, so it follows the faces
    const box = [
      { key: 'A|B#0', faces: ['A', 'B'], pts: [[0, 0, 0], [10, 0, 0]] },
      { key: 'A|C#0', faces: ['A', 'C'], pts: [[0, 0, 0], [0, 10, 0]] },
      { key: 'B|C#0', faces: ['B', 'C'], pts: [[0, 0, 5], [0, 0, 0]] },
      { key: 'A|D#0', faces: ['A', 'D'], pts: [[10, 0, 0], [10, 10, 0]] },
    ];
    expect(pickValue('endRef', ['v:0,0,0'], box)).toEqual({ kind: 'vertex', faces: ['A', 'B', 'C'], at: [0, 0, 0] });
    expect(pickValue('endRef', ['v:50,50,50'], box)).toEqual({ kind: 'point', at: [50, 50, 50] });   // no edge ends there: a fixed point
    expect(pickValue('endRef', ['A|B#0'], box)).toBeNull();
    expect(pickValue('endRef', [], box)).toBeNull();
  });
});

describe('text', () => {
  const a = { open() {}, save() {}, samples() {}, undo() {}, redo() {}, palette() {}, toggleDrawer() {}, settings() {}, hasDocument: () => true, newPart() {}, sketchOnFace() {}, hasFaceSelection: () => false, addExtrude() {}, newSketch() {}, setView() {}, fit() {}, setMode() {}, mode: () => 'face', toggleLayer() {}, layer: () => false,
    features: { context: () => ctx(), create() {}, holeOnFace() {}, holeFlip: () => false, notify() {} } } as unknown as Actions;
  it('every feature command has a translated label, and the pseudo-locale marks them', () => {
    const ids = ['add-fillet', 'add-chamfer', 'add-shell', 'add-hole', 'add-revolve', 'add-lpattern', 'add-cpattern'];
    for (const id of ids) expect(en).toHaveProperty('cmd.' + id);
    expect(en).toHaveProperty('app.noAxis');
    expect(en).toHaveProperty('app.hole.hint');
    const cmds = buildCommands(a).filter((c) => ids.includes(c.id));
    expect(cmds.map((c) => c.id)).toEqual(ids);
    expect(cmds.every((c) => c.tab === 'Home' && c.enabled)).toBe(true);
    setLocale(PSEUDO);
    expect(buildCommands(a).filter((c) => ids.includes(c.id)).every((c) => c.label.startsWith('[!! '))).toBe(true);
    setLocale('en');
  });
});

import { edgeRefs as edgeRefsForVertex } from './featureCommands';
describe('edgeRefs: a corner stands for its edges', () => {
  const e = (key: string, a: number[], b: number[]) => ({ key, faces: [key + 'a', key + 'b'], mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], pts: [a, b] });
  const edges = [e('x', [0, 0, 0], [10, 0, 0]), e('y', [0, 0, 0], [0, 10, 0]), e('z', [0, 0, 0], [0, 0, 10]), e('far', [10, 10, 10], [10, 10, 0])];
  it('takes every edge that ends at the corner, once, and ignores edges elsewhere', () => {
    const refs = edgeRefsForVertex(['v:0,0,0'], edges);
    expect(refs.length).toBe(3);
    expect(edgeRefsForVertex(['v:0,0,0', 'x'], edges).length).toBe(3);        // the edge picked as well is not doubled
    expect(edgeRefsForVertex(['v:5,5,5'], edges)).toEqual([]);
  });
});

describe('fillet and chamfer from faces', () => {
  const fe = [
    { key: 'F10.W0|F9.S.e1~1#49', faces: ['F10.W0', 'F9.S.e1~1'], mid: [1, 0, 0] },
    { key: 'F10.W0|F9.S.e1~1#50', faces: ['F10.W0', 'F9.S.e1~1'], mid: [-1, 0, 0] },   // a ring split in two arcs: both are shared
    { key: 'F10.W0|F11#51', faces: ['F10.W0', 'F11'], mid: [0, 1, 0] },
    { key: 'F9.S.e1~1|F11#52', faces: ['F9.S.e1~1', 'F11'], mid: [0, 0, 1] },
  ];
  const fctx = (selection: string[], over: Partial<Ctx> = {}) => ctx({ mode: 'face', selection, edges: fe, ...over });
  it('two faces: every edge they share', () => {
    expect(faceEdgeRefs(['F10.W0', 'F9.S.e1~1'], fe)).toEqual([{ faces: ['F10.W0', 'F9.S.e1~1'], at: [1, 0, 0] }, { faces: ['F10.W0', 'F9.S.e1~1'], at: [-1, 0, 0] }]);
  });
  it('three faces: all shared edges between selected pairs', () => {
    expect(faceEdgeRefs(['F10.W0', 'F9.S.e1~1', 'F11'], fe)).toHaveLength(4);
  });
  it('is enabled for two or more faces and builds the same edges shape as the edge route', () => {
    const c = fctx(['F10.W0', 'F11']);
    expect(canFillet(c)).toBe(true);
    expect(filletOps(c)).toEqual([{ op: 'add', feature: { type: 'fillet', radius: 0.5, edges: [{ faces: ['F10.W0', 'F11'], at: [0, 1, 0] }] } }]);
    expect(chamferOps(c)![0]).toMatchObject({ feature: { type: 'chamfer', edges: [{ faces: ['F10.W0', 'F11'], at: [0, 1, 0] }] } });
    expect(pickValue('edges', ['F10.W0', 'F11'], fe)).toEqual([{ faces: ['F10.W0', 'F11'], at: [0, 1, 0] }]);
  });
  it('one face stays disabled with a reason; no selection says what to select', () => {
    expect(canFillet(fctx(['F11']))).toBe(false);
    expect(filletWhy(fctx(['F11']))).toMatch(/second face/);
    expect(filletWhy(fctx([]))).toMatch(/two or more faces/);
    expect(filletWhy(fctx(['F10.W0', 'F11']))).toBeUndefined();
    expect(filletWhy(ctx({ doc: null }))).toMatch(/part/);
    expect(filletWhy(fctx(['F10.W0|F11#51']))).toMatch(/edge selection/);
  });
  it('faces that share no edge: the button is enabled and running it shows a notice instead of a feature', () => {
    const lone = [{ key: 'A|B#0', faces: ['A', 'B'], mid: [0, 0, 0] }];
    const c = fctx(['X', 'Y'], { edges: lone });
    expect(canFillet(c)).toBe(true);
    expect(roundTargets(c)).toEqual({ edges: [], viaFaces: true });
    const notices: string[] = [];
    const created: unknown[] = [];
    const cmds = featureCommands({ context: () => c, create: (o) => created.push(o), holeOnFace() {}, holeFlip: () => false, addThread() {}, notify: (m) => notices.push(m) });
    const fillet = cmds.find((x) => x.id === 'add-fillet')!;
    expect(fillet.enabled!()).toBe(true);
    fillet.run();
    expect(created).toEqual([]);
    expect(notices).toEqual(['These faces do not share an edge']);
  });
  it('every disabled feature command carries a reason', () => {
    const c = ctx({ doc: { features: [] } as never, selection: [], box: null });
    const cmds = featureCommands({ context: () => c, create() {}, holeOnFace() {}, holeFlip: () => false, addThread() {}, notify() {} });
    for (const id of ['add-fillet', 'add-chamfer', 'add-shell']) { const x = cmds.find((k) => k.id === id)!; expect(x.enabled!()).toBe(false); expect(x.why!()).toBeTruthy(); }
  });
});

describe('tangent chain in the commands', () => {
  // an L of two collinear edges on faces T/A and T/B, plus one at a right angle on T/C
  const e = (key: string, faces: string[], a: number[], b: number[]) => ({ key, faces, mid: a.map((x, i) => (x + b[i]) / 2), pts: [a, b] });
  const el = [e('T|A#1', ['T', 'A'], [0, 0, 0], [10, 0, 0]), e('T|B#2', ['T', 'B'], [10, 0, 0], [20, 0, 0]), e('T|C#3', ['T', 'C'], [20, 0, 0], [20, 10, 0])];
  const cctx = (over: Partial<Ctx>) => ctx({ mode: 'edge', selection: ['T|A#1'], edges: el, ...over });
  it('off: only the picked edge; on: the edge that continues it, not the one at a corner', () => {
    expect(edgeRefs(['T|A#1'], el)).toHaveLength(1);
    const off = filletOps(cctx({ tangentChain: false }))![0] as unknown as { feature: { edges: unknown[] } };
    expect(off.feature.edges).toHaveLength(1);
    const on = filletOps(cctx({ tangentChain: true }))![0] as unknown as { feature: { edges: Array<{ faces: string[] }> } };
    expect(on.feature.edges.map((x) => x.faces[1])).toEqual(['A', 'B']);
    expect(chamferOps(cctx({ tangentChain: true }))![0]).toMatchObject({ feature: { type: 'chamfer' } });
  });
  it('the Editor\'s edge field follows the same rule', () => {
    expect(pickValue('edges', ['T|A#1'], el, true)).toHaveLength(2);
    expect(pickValue('edges', ['T|A#1'], el)).toHaveLength(1);
  });
  it('picking a middle edge also finds both neighbours', () => {
    expect(chainedEdgeRefs(['T|B#2'], el, true)).toHaveLength(2);   // B continues A; C is a corner
  });
});

describe('pickValue for a pattern direction or axis', () => {
  const edges = [{ key: 'F2.S.e1|F2.S.e2#0', faces: ['F2.S.e1', 'F2.S.e2'], mid: [100, 0, 5], pts: [[100, 0, 0], [100, 0, 10]] }] as never;
  it('an edge becomes its two faces and a point on it; a face becomes a face reference', () => {
    for (const path of ['axis', 'dir', 'dir2']) {
      expect(pickValue(path, ['F2.S.e1|F2.S.e2#0'], edges)).toEqual({ kind: 'edge', faces: ['F2.S.e1', 'F2.S.e2'], at: [100, 0, 5] });
      expect(pickValue(path, ['F5.S.e1'], edges)).toEqual({ kind: 'face', id: 'F5.S.e1' });
      expect(pickValue(path, [], edges)).toBeNull();
    }
  });
});

// A circle sketched on a face of an imported 10 mm cube, then extruded: Cut through all, Cut blind, Add blind, New body. The cube is
// held as an imported body (the kernel's own STEP, as a SolidWorks file is kept), alone, or next to a body of the same shape that its
// history builds (a converted part carrying its original solid); both must edit as a cube built from sketches does.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { partOfStep } from './sldprtImport';

type Wire = Record<string, unknown>;
const cubeFeatures = (id: string, op: string, body?: string): Wire[] => [
  { type: 'sketch', id: `S${id}`, plane: { kind: 'std', id: 'top' },
    points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -5, y: -5 }, { id: 'p2', x: 5, y: -5 }, { id: 'p3', x: 5, y: 5 }, { id: 'p4', x: -5, y: 5 }],
    entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] },
  { type: 'extrude', id, op, sketch: `S${id}`, end: 'blind', depth: 10, ...(body ? { body } : {}) },
];
const scratch = (): PartDoc => ({ ...emptyPart('Cube'), features: cubeFeatures('F2', 'add'), seq: 3 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (d: PartDoc) => { const s = await Session.open(d); sessions.push(s); return s; };
const importedStep = async (): Promise<PartDoc> => partOfStep(await (await open(scratch())).step(), 'Cube');
/** A converted part: the original solid first, then the body its history builds on the same spot. */
async function converted(): Promise<PartDoc> {
  const imp = await importedStep();
  const f = imp.features[0] as unknown as Wire;
  return { ...imp, features: [{ ...f, id: 'F9', name: 'Original (STEP)', body: 'Original (STEP)' }, ...cubeFeatures('F2', 'newBody', 'History')], seq: 10 } as unknown as PartDoc;
}

const HOLE = Math.PI * 2.5 * 2.5;
const VARIANTS: Array<[string, Wire, (v: number[]) => void]> = [
  ['cut through all', { op: 'cut', end: 'through' }, (v) => expect(v.sort((a, b) => a - b)[0]).toBeCloseTo(1000 - HOLE * 10, 2)],
  ['cut blind', { op: 'cut', end: 'blind', depth: 10 }, (v) => expect(v.sort((a, b) => a - b)[0]).toBeCloseTo(1000 - HOLE * 10, 2)],
  ['add blind', { op: 'add', end: 'blind', depth: 5 }, (v) => expect(Math.max(...v)).toBeCloseTo(1000 + HOLE * 5, 2)],
  ['new body blind', { op: 'newBody', end: 'blind', depth: 10, body: 'Boss' }, (v) => expect(v.some((x) => Math.abs(x - HOLE * 10) < 1e-2)).toBe(true)],
];

async function onTopFace(base: PartDoc, faceOf: (names: string[], normals: Record<string, unknown>) => string) {
  const s0 = await open(base);
  const faces = (await s0.facts()).faces;
  const d = await s0.describe(faces);
  const face = faceOf(faces, Object.fromEntries(d.map((x) => [x.name as string, x.normal])));
  const centre = (d.find((x) => x.name === face)!.centroid) as number[];
  const p = await s0.preview([{ op: 'add', feature: { type: 'sketch', id: 'S9', plane: { kind: 'face', id: face }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 2.5 }], constraints: [] } as never }]);
  const fr = p.body!.sketches.find((q) => q.id === 'S9')!.frame;
  const rel = centre.map((v, i) => v - fr.o[i]);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sketch = { type: 'sketch', id: 'S9', plane: { kind: 'face', id: face }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: dot(rel, fr.x), y: dot(rel, fr.y) }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 2.5 }], constraints: [] };
  return { sketch, face, outward: fr.z };
}

for (const [label, make, topOf] of [
  ['a cube built from sketches', async () => scratch(), (n: string[], nm: Record<string, unknown>) => n.find((x) => nm[x] === '+y')!],
  ['an imported cube (a SolidWorks file kept as its STEP)', importedStep, (n: string[], nm: Record<string, unknown>) => n.find((x) => nm[x] === '+y')!],
  ['a converted part: the original solid and the body its history builds', converted, (n: string[], nm: Record<string, unknown>) => n.find((x) => nm[x] === '+y' && x.startsWith('F2.'))!],
  ['a converted part, face of the original solid picked', converted, (n: string[], nm: Record<string, unknown>) => n.find((x) => nm[x] === '+y' && x.startsWith('F9.'))!],
] as const) {
  describe(`a circle on the top face of ${label}`, { skip: !process.env.CK_WASM }, () => {
    for (const [vn, ex, check] of VARIANTS) {
      it(`${vn}: builds, is valid and has the volumes of the cube`, async () => {
        const base = await make();
        const { sketch, outward } = await onTopFace(base, topOf);
        expect(outward[1]).toBeCloseTo(1, 6);   // the sketch looks along the outward normal of the face
        const s = await open(base);
        const r = await s.edit([{ op: 'add', feature: sketch as never }, { op: 'add', feature: { type: 'extrude', id: 'X1', sketch: 'S9', ...ex } as never }]);
        expect(r.ok, JSON.stringify((r as { errors?: unknown }).errors ?? '')).toBe(true);
        const mp = await s.massProps({ bodies: true });
        check((mp.bodies ?? []).map((b) => b.volume));
        expect((await s.validate()).ok).toBe(true);
      }, 60000);
    }
  });
}

describe('a converted part opened in the app: which solid is shown', { skip: !process.env.CK_WASM }, () => {
  const hiddenOnOpen = async (doc: PartDoc): Promise<string[] | undefined> => {
    const store = createStore();
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const c = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} } as ViewSink, kernel });
    await c.load(doc);
    return (c.document() as unknown as { view?: { hiddenBodies?: string[] } }).view?.hiddenBodies;
  };
  const withHistory = async (edit: (f: Wire[]) => Wire[]): Promise<PartDoc> => {
    const d = await converted();
    return { ...d, features: [d.features[0], ...edit(d.features.slice(1) as unknown as Wire[])] } as unknown as PartDoc;
  };
  it('history rebuilt with the original\'s volume: the original is hidden', async () => {
    expect(await hiddenOnOpen(await converted())).toEqual(['F9']);
  }, 60000);
  it('history suppressed: the original stays visible', async () => {
    expect(await hiddenOnOpen(await withHistory((f) => f.map((x) => (x.type === 'extrude' ? { ...x, suppressed: true } : x))))).toBeUndefined();
  }, 60000);
  it('history a placeholder (greyed): the original stays visible', async () => {
    expect(await hiddenOnOpen(await withHistory((f) => f.map((x) => (x.type === 'extrude' ? { type: 'placeholder', id: x.id, name: 'Boss-Extrude1', suppressed: true } : x))))).toBeUndefined();
  }, 60000);
  it('history that fails (no profile): the original stays visible', async () => {
    expect(await hiddenOnOpen(await withHistory((f) => f.map((x) => (x.type === 'extrude' ? { ...x, sketch: 'F404' } : x))))).toBeUndefined();
  }, 60000);
  it('history of another size (oversized, or without the original\'s hole): the original stays visible', async () => {
    expect(await hiddenOnOpen(await withHistory((f) => f.map((x) => (x.type === 'extrude' ? { ...x, depth: 20 } : x))))).toBeUndefined();
    // the original has a through hole that the history (its cut is a placeholder) does not
    const holed = { ...scratch(), features: [...cubeFeatures('F2', 'add'),
      { type: 'sketch', id: 'S5', plane: { kind: 'std', id: 'top' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 2.5 }], constraints: [] },
      { type: 'extrude', id: 'F6', op: 'cut', sketch: 'S5', end: 'throughBoth' }], seq: 8 } as unknown as PartDoc;
    const imp = await partOfStep(await (await open(holed)).step(), 'Cube');
    const f = imp.features[0] as unknown as Wire;
    const part = { ...imp, features: [{ ...f, id: 'F9', name: 'Original (STEP)', body: 'Original (STEP)' }, ...cubeFeatures('F2', 'newBody', 'History'), { type: 'placeholder', id: 'F7', name: 'Cut-Extrude1', suppressed: true }], seq: 10 } as unknown as PartDoc;
    expect(await hiddenOnOpen(part)).toBeUndefined();
  }, 60000);
  it('no original solid: nothing is hidden; the original alone: nothing is hidden', async () => {
    expect(await hiddenOnOpen(scratch())).toBeUndefined();
    expect(await hiddenOnOpen(await importedStep())).toBeUndefined();
  }, 60000);
});

describe('an Add or Cut aimed at a body', { skip: !process.env.CK_WASM }, () => {
  it('acts on the target body alone: the circle sits on the history body, the cut goes to the original solid', async () => {
    const base = await converted();
    const { sketch } = await onTopFace(base, (n, nm) => n.find((x) => nm[x] === '+y' && x.startsWith('F2.'))!);
    const s = await open(base);
    const r = await s.edit([{ op: 'add', feature: sketch as never }, { op: 'add', feature: { type: 'extrude', id: 'X1', sketch: 'S9', op: 'cut', end: 'blind', depth: 10, target: { body: 'Original (STEP)' } } as never }]);
    expect(r.ok, JSON.stringify((r as { errors?: unknown }).errors ?? '')).toBe(true);
    const v = (await s.massProps({ bodies: true })).bodies!.map((b) => b.volume).sort((a, b) => a - b);
    expect(v[0]).toBeCloseTo(1000 - HOLE * 10, 2);
    expect(v[1]).toBeCloseTo(1000, 6);
  }, 60000);
  it('a target that names no body is refused', async () => {
    const base = await converted();
    const { sketch } = await onTopFace(base, (n, nm) => n.find((x) => nm[x] === '+y' && x.startsWith('F2.'))!);
    const s = await open(base);
    const r = await s.edit([{ op: 'add', feature: sketch as never }, { op: 'add', feature: { type: 'extrude', id: 'X1', sketch: 'S9', op: 'cut', end: 'blind', depth: 10, target: { body: 'Nope' } } as never }]);
    expect(r.ok).toBe(false);
  }, 60000);
});

// the cube with a hole whose history is only the plain cube (the cut is a placeholder): the original has the hole, the history body has not
describe('edits of a part whose two bodies are not copies of each other', { skip: !process.env.CK_WASM }, () => {
  async function holedOriginal(): Promise<PartDoc> {
    const holed = { ...scratch(), features: [...cubeFeatures('F2', 'add'),
      { type: 'sketch', id: 'S5', plane: { kind: 'std', id: 'top' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 2.5 }], constraints: [] },
      { type: 'extrude', id: 'F6', op: 'cut', sketch: 'S5', end: 'throughBoth' }], seq: 8 } as unknown as PartDoc;
    const imp = await partOfStep(await (await open(holed)).step(), 'Cube');
    const f = imp.features[0] as unknown as Wire;
    return { ...imp, features: [{ ...f, id: 'F9', name: 'Original (STEP)', body: 'Original (STEP)' }, ...cubeFeatures('F2', 'newBody', 'History')], seq: 10 } as unknown as PartDoc;
  }
  const cutOn = async (prefix: string, target: unknown, end: Wire = { end: 'blind', depth: 10 }) => {
    const base = await holedOriginal();
    const { sketch } = await onTopFace(base, (n, nm) => n.find((x) => nm[x] === '+y' && x.startsWith(prefix))!);
    const s = await open(base);
    const r = await s.edit([{ op: 'add', feature: sketch as never }, { op: 'add', feature: { type: 'extrude', id: 'X1', sketch: 'S9', op: 'cut', ...end, ...(target ? { target } : {}) } as never }]);
    const bodies = r.ok ? (await s.massProps({ bodies: true })).bodies! : null;
    const vols = bodies ? bodies.map((b) => +b.volume.toFixed(2)) : null;
    return { ok: r.ok, vols, names: bodies?.map((b) => (b as { name?: string }).name).sort(), errors: JSON.stringify((r as { errors?: unknown }).errors ?? '') };
  };
  const WITH_HOLE = 1000 - HOLE * 10;
  it('Automatic, face of the original (it has the hole already): the history body is cut, no volume mismatch', async () => {
    const r = await cutOn('F9.', null);
    expect(r.ok, r.errors).toBe(true);
    expect(r.vols!.sort((a, b) => a - b)).toEqual([+WITH_HOLE.toFixed(2), +WITH_HOLE.toFixed(2)]);
  }, 60000);
  it('Automatic, face of the history body: both bodies end with the hole', async () => {
    const r = await cutOn('F2.', null);
    expect(r.ok, r.errors).toBe(true);
    expect(r.vols!.every((x) => Math.abs(x - WITH_HOLE) < 0.01)).toBe(true);
  }, 60000);
  it('Target the history body: only it is cut; target the original: nothing to cut there, an error', async () => {
    const h = await cutOn('F2.', { body: 'History' });
    expect(h.ok, h.errors).toBe(true);
    expect(h.vols!.every((x) => Math.abs(x - WITH_HOLE) < 0.01)).toBe(true);
    expect(h.names).toEqual(['History', 'Original (STEP)']);   // the bodies keep their names through the edit
    const o = await cutOn('F9.', { body: 'Original (STEP)' });
    expect(o.ok).toBe(false);
    expect(o.errors).toContain('cutNoEffect');
  }, 60000);
  it('Automatic keeps the names of both bodies', async () => {
    const r = await cutOn('F9.', null);
    expect(r.names).toEqual(['History', 'Original (STEP)']);
  }, 60000);
  it('Cut through all, Automatic, face of the original: the history body is cut', async () => {
    const r = await cutOn('F9.', null, { end: 'through' });
    expect(r.ok, r.errors).toBe(true);
    expect(r.vols!.every((x) => Math.abs(x - WITH_HOLE) < 0.01)).toBe(true);
  }, 60000);
});

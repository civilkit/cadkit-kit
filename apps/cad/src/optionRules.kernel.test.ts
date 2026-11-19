// The option forms against the real kernel: each end condition, draft, chamfer type, fillet profile / variable radius,
// shell and revolve option regenerates with the volume it should. The patches are the ones the forms make (optionRules.ts).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { edgeRefs } from './featureCommands';
import {
  objectRefPatch, patchBothWays, patchChamferType, patchDraft, patchEnd, patchFilletProfile, patchFilletVariable, patchRadii, patchStart,
} from './optionRules';
import { pickValue } from './featureCommands';

type Wire = Record<string, unknown>;
const rect = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
  type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [],
});
/** A 40 x 25 x 10 box (volume 10000) and a 10 x 10 square sketch F3 in its start plane. */
const boxDoc = (extra: Wire[] = []): PartDoc => ({
  ...emptyPart('Box'),
  features: [rect('F1', 0, 0, 40, 25), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }, rect('F3', 5, 5, 15, 15), ...extra],
  seq: 9,
}) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function measure(doc: PartDoc) {
  const s = await Session.open(doc);
  sessions.push(s);
  const report = await s.verify();
  const mass = (await s.massProps()) as { volume: number };
  const params = Object.fromEntries(report.regen.errors.map(([id, e]) => [id, (e as { params?: Record<string, unknown> }).params ?? {}]));
  return { errors: report.regen.errors.map(([id, e]) => `${id}:${e.code}`), params, volume: mass.volume };
}
/** The cut of the square F3 with the option patch applied (a cut goes against the sketch normal, so the cases flip into the body). */
const cut = (patch: Wire) => measure(boxDoc([{ type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', end: 'blind', depth: 4, flip: true, ...patch }]));
const near = (a: number, b: number, tol = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('extrude end conditions against the kernel', { skip: !process.env.CK_WASM }, () => {
  it('blind and mid take the depth (cut 10 x 10)', async () => {
    const blind = await cut({ ...patchEnd({ depth: 4 }, 'blind') });
    expect(blind.errors).toEqual([]);
    near(blind.volume, 10000 - 400);
    const mid = await cut({ ...patchEnd({ depth: 4 }, 'mid'), flip: undefined });
    expect(mid.errors).toEqual([]);
    near(mid.volume, 10000 - 400 / 2);   // symmetric about the sketch plane: only half the depth is inside the body
  });
  it('through, throughBoth and upToNext take their length from the body', async () => {
    for (const end of ['through', 'throughBoth', 'upToNext'] as const) {
      const r = await cut({ ...patchEnd({ depth: 4 }, end), depth: undefined, flip: end === 'throughBoth' ? undefined : true });
      expect(r.errors, end).toEqual([]);
      near(r.volume, 10000 - 1000);
    }
  });
  it('draft tapers a blind cut inward, or outward with draftOut', async () => {
    const frustum = (s2: number) => (4 / 3) * (100 + s2 * s2 + 10 * s2);
    const t = Math.tan((5 * Math.PI) / 180);
    const inward = await cut({ ...patchDraft({}, 5) });
    expect(inward.errors).toEqual([]);
    near(inward.volume, 10000 - frustum(10 - 8 * t), 0.05);
    const outward = await cut({ ...patchDraft({}, 5), draftOut: true });
    expect(outward.errors).toEqual([]);
    near(outward.volume, 10000 - frustum(10 + 8 * t), 0.05);
  });
  it('add: through all of an empty body is 1000 long, mid is symmetric', async () => {
    const mid = await measure({ ...boxDoc(), features: [rect('F1', 0, 0, 10, 10), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', ...patchEnd({}, 'mid'), depth: 6 }] } as unknown as PartDoc);
    expect(mid.errors).toEqual([]);
    near(mid.volume, 600);
  });
  it('a second depth is ignored (no two-direction extrude): depth2 changes nothing', async () => {
    const one = await cut({});
    const two = await cut({ depth2: 3, end2: 'blind' });
    near(one.volume, two.volume);
  });
});

describe('Through all, both directions, against the kernel', { skip: !process.env.CK_WASM }, () => {
  const circle = (id: string, plane: Wire) => ({ type: 'sketch', id, plane, points: [{ id: 'o', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'k1', c: 'o', r: 10 }], constraints: [] });
  /** A 60 x 60 boss on the Front plane, mid-plane 40 deep (z -20..20, volume 144000), and a 20 mm circle on the plane `at`. */
  const boss = (at: Wire, extra: Wire[] = []): Wire[] => [
    rect('F1', -30, -30, 30, 30), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'mid', depth: 40 }, ...extra, circle('F3', at),
  ];
  /** A patch's nulls mean 'remove the field' (the app drops them before the kernel sees the feature). */
  const clean = (f: Wire): Wire => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined));
  const run = (features: Wire[]) => measure({ ...emptyPart('Boss'), features: features.map(clean), seq: 20 } as unknown as PartDoc);
  const hole = Math.PI * 100;
  it('a 20 mm hole sketched on the mid plane: Through all removes one side, Both directions both', async () => {
    const one = await run([...boss({ kind: 'std', id: 'front' }), { type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', ...patchEnd({ depth: 4 }, 'through') }]);
    expect(one.errors).toEqual([]);
    near(one.volume, 144000 - hole * 20, 0.5);
    const both = await run([...boss({ kind: 'std', id: 'front' }), { type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', flip: true, ...patchBothWays({ end: 'through', flip: true }, true) }]);
    expect(both.errors).toEqual([]);
    near(both.volume, 144000 - hole * 40, 0.5);
  });
  it('a sketch outside the body on the wrong side: Through all misses, Flip or Both directions cut right through', async () => {
    const plane = { type: 'plane', id: 'P1', mode: 'offset', base: { kind: 'std', id: 'front' }, offset: -30 };
    const at = { kind: 'feature', id: 'P1' };
    const miss = await run([...boss(at, [plane]), { type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', end: 'through' }]);
    expect(miss.errors).toEqual(['F4:cutNoEffect']);
    const flipped = await run([...boss(at, [plane]), { type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', end: 'through', flip: true }]);
    expect(flipped.errors).toEqual([]);
    near(flipped.volume, 144000 - hole * 40, 0.5);
    const both = await run([...boss(at, [plane]), { type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', end: 'through', ...patchBothWays({ end: 'through' }, true) }]);
    expect(both.errors).toEqual([]);
    near(both.volume, 144000 - hole * 40, 0.5);
  });
});

describe('To object and From object against the kernel', { skip: !process.env.CK_WASM }, () => {
  /** A Plane feature parallel to the front plane at z = `z` (the box runs z 0..10). */
  const plane = (z: number | string) => ({ type: 'plane', id: 'P1', mode: 'offset', base: { kind: 'std', id: 'front' }, offset: z });
  const cutWith = (patch: Wire, extra: Wire[] = []) => measure(boxDoc([...extra, { type: 'extrude', id: 'F4', op: 'cut', sketch: 'F3', flip: true, ...patch }]));
  it('a cut to a Plane feature (chosen from the list) ends on it, and follows it when it moves', async () => {
    for (const z of [6, 3]) {
      const r = await cutWith({ ...patchEnd({ depth: 4 }, 'toObject'), depth: undefined, endRef: objectRefPatch('feature:P1') }, [plane(z)]);
      expect(r.errors, String(z)).toEqual([]);
      near(r.volume, 10000 - 100 * z);
    }
  });
  it('a cut to a picked face, with an offset along the cut', async () => {
    const endRef = pickValue('endRef', ['F2.C1'], []);
    const r = await cutWith({ ...patchEnd({ depth: 4 }, 'toObject'), depth: undefined, endRef, endOffset: -3 });
    expect(r.errors).toEqual([]);
    near(r.volume, 10000 - 700);
  });
  it('an extrude from the box top (From object), blind 5', async () => {
    const r = await measure(boxDoc([{ type: 'extrude', id: 'F4', op: 'add', sketch: 'F3', end: 'blind', depth: 5, ...patchStart('fromObject'), startRef: { kind: 'face', id: 'F2.C1' } }]));
    expect(r.errors).toEqual([]);
    near(r.volume, 10000 + 500);
  });
  it('a lost reference is refused with a hint, not guessed', async () => {
    const r = await cutWith({ end: 'toObject', endRef: { kind: 'face', id: 'F9.C1', at: [10, 10, 10] } });
    expect(r.errors).toEqual(['F4:missingReference']);
    expect(String(r.params.F4?.hint ?? '')).toContain('F9.C1');
    near(r.volume, 10000);
  });
});

describe('revolve options against the kernel', { skip: !process.env.CK_WASM }, () => {
  const sk = {
    ...rect('F1', 5, 0, 15, 10),
    points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 5, y: 0 }, { id: 'p2', x: 15, y: 0 }, { id: 'p3', x: 15, y: 10 }, { id: 'p4', x: 5, y: 10 }, { id: 'a1', x: 0, y: 0 }, { id: 'a2', x: 0, y: 10 }],
    entities: [...rect('F1', 5, 0, 15, 10).entities, { id: 'ax', type: 'line', p1: 'a1', p2: 'a2', construction: true }],
  };
  const rev = (patch: Wire) => measure({ ...emptyPart('R'), features: [sk, { type: 'revolve', id: 'F2', op: 'add', sketch: 'F1', axis: 'ax', ...patch }], seq: 3 } as unknown as PartDoc);
  it('full, partial and mid-plane angles', async () => {
    const full = await rev({ end: 'blind', angle: 360 });
    expect(full.errors).toEqual([]);
    near(full.volume, 2000 * Math.PI, 0.05);
    const half = await rev({ end: 'blind', angle: 180 });
    near(half.volume, 1000 * Math.PI, 0.05);
    const mid = await rev({ ...patchEnd({}, 'mid'), angle: 180 });
    expect(mid.errors).toEqual([]);
    near(mid.volume, 1000 * Math.PI, 0.05);
    const flipped = await rev({ end: 'blind', angle: 180, flip: true });
    near(flipped.volume, 1000 * Math.PI, 0.05);
  });
});

describe('chamfer, fillet and shell options against the kernel', { skip: !process.env.CK_WASM }, () => {
  async function edited(featureType: 'chamfer' | 'fillet' | 'shell', make: (base: Wire) => Wire) {
    const store = createStore();
    const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const controller = new Controller({ store, view, kernel });
    await controller.load(boxDoc());
    const long = controller.bodyEdges().find((e) => e.faces?.includes('F2.C1') && e.faces?.includes('F2.S.e1'))!;   // the 40 mm edge
    const refs = edgeRefs([long.key!], controller.bodyEdges());
    const feature: Wire = featureType === 'shell' ? { type: 'shell', id: 'F9', faces: ['F2.C1'], thickness: 1 } : { type: featureType, id: 'F9', edges: refs };
    const r = await controller.edit([{ op: 'add', feature: make(feature) } as never]);
    const s = sessions.at(-1)!;
    const report = await s.verify();
    const mass = (await s.massProps()) as { volume: number };
    return { ok: r.ok, errors: report.regen.errors.map(([id, e]) => `${id}:${e.code}`), removed: 10000 - mass.volume };
  }
  const chamfer = (patch: Wire) => edited('chamfer', (f) => ({ ...f, chamferType: 'equal', distance: 2, ...patch }));

  it('chamfer equal, two distances, distance and angle remove the expected prism', async () => {
    const eq = await chamfer({});
    expect(eq.errors).toEqual([]);
    near(eq.removed, 2 * 2 / 2 * 40, 0.01);
    const two = await chamfer({ ...patchChamferType({ distance: 2 }, 'distances'), distance2: 3 });
    expect(two.errors).toEqual([]);
    near(two.removed, 2 * 3 / 2 * 40, 0.01);
    const ang = await chamfer({ ...patchChamferType({ distance: 2 }, 'angle'), angle: 30 });
    expect(ang.errors).toEqual([]);
    near(ang.removed, 0.5 * 2 * 2 * Math.tan(Math.PI / 6) * 40, 0.01);
  });

  it('fillet: constant radius, profiles and variable radius', async () => {
    const fil = (patch: Wire) => edited('fillet', (f) => ({ ...f, radius: 2, ...patch }));
    const circ = await fil({});
    expect(circ.errors).toEqual([]);
    near(circ.removed, (1 - Math.PI / 4) * 4 * 40, 0.05);
    for (const profile of ['conic', 'chord', 'curvature'] as const) {
      const r = await fil(patchFilletProfile({}, profile));
      expect(r.errors, profile).toEqual([]);
      expect(r.removed, profile).toBeGreaterThan(1);
    }
    const chordal = await fil(patchFilletProfile({}, 'chord'));
    expect(Math.abs(chordal.removed - circ.removed)).toBeGreaterThan(0.1);   // the profile changes the cut
    const v = { ...patchFilletVariable({ radius: 2 }, true), ...patchRadii({ radii: [1, 3] }, 1, 3) };
    const variable = await fil(v);
    expect(variable.errors).toEqual([]);
    const lo = (1 - Math.PI / 4) * 1 * 40, hi = (1 - Math.PI / 4) * 9 * 40;
    expect(variable.removed).toBeGreaterThan(lo);
    expect(variable.removed).toBeLessThan(hi);
  }, 240000);

  it('shell: inward and outward walls', async () => {
    const inward = await edited('shell', (f) => f);
    expect(inward.errors).toEqual([]);
    near(inward.removed, 38 * 23 * 9, 0.05);
    const outward = await edited('shell', (f) => ({ ...f, outward: true }));
    expect(outward.errors).toEqual([]);
    expect(Math.abs(outward.removed - inward.removed)).toBeGreaterThan(1);
  });
});

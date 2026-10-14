// The option forms against the real kernel: each end condition, draft, chamfer type, fillet profile / variable radius,
// shell and revolve option regenerates with the volume it should. The patches are the ones the forms make (optionRules.ts).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { edgeRefs } from './featureCommands';
import {
  KERNEL_END_REFERENCES, patchChamferType, patchDraft, patchEnd, patchFilletProfile, patchFilletVariable, patchRadii,
} from './optionRules';

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
  return { errors: report.regen.errors.map(([id, e]) => `${id}:${e.code}`), volume: mass.volume };
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
  it('the reference ends are not cut yet: the form keeps them off until the kernel does', async () => {
    const r = await cut({ end: 'upToFace', endFace: 'F2.C1' });
    expect(r.errors.length).toBeGreaterThan(0);          // when this fails the kernel cuts it: set KERNEL_END_REFERENCES
    expect(KERNEL_END_REFERENCES).toBe(false);
    // a second depth is ignored too (no two-direction extrude): depth2 changes nothing
    const one = await cut({});
    const two = await cut({ depth2: 3, end2: 'blind' });
    near(one.volume, two.volume);
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

// Press Pull Straight through the panel's own path (Add Press Pull keeping Offset is checked in featureCreators.kernel.test.ts): Offset converted to Straight (the ops the editor sends), the volumes of a scale and a draft taper, faceRun's
// reach for the angle readout, and the sentences a refusal leaves in the preview line. Needs a wasm with pressPull and faceRun (CK_WASM).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { opsFromDraftFor } from './pressPullDraft';
import { patchContinue, patchTaperAngle, patchTaperScale, scaleTaperAngle } from './optionRules';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const near = (v: number, want: number, tol = 0.002) => { expect(v).toBeGreaterThan(want * (1 - tol)); expect(v).toBeLessThan(want * (1 + tol)); };
const TAN3 = Math.tan(3 * Math.PI / 180);
const grown = (h: number, t: number) => (h / 6) * (800 + (40 + 2 * t) * (20 + 2 * t) + 4 * (40 + t) * (20 + t));

function rectSketch(w: number, h: number) {
  return { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
    points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -w / 2, y: -h / 2 }, { id: 'p2', x: w / 2, y: -h / 2 }, { id: 'p3', x: w / 2, y: h / 2 }, { id: 'p4', x: -w / 2, y: h / 2 }],
    entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, p1, p2]) => ({ id, type: 'line', p1, p2 })), constraints: [] };
}
const rodSketch = (r: number) => ({ type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r }], constraints: [] });

async function open(sketch: Record<string, unknown>, depth = 10): Promise<Controller> {
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {}, setThreads() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view, kernel });
  await c.load({ ...emptyPart('x'), features: [sketch, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth }] } as unknown as PartDoc);
  return c;
}
/** The cap of the extrude that faces +Z (its name depends on the build, so the kernel is asked). */
async function topFace(c: Controller): Promise<string> {
  const items = await c.faceRun(['F2.C0', 'F2.C1']);
  const top = items?.find((i) => i.found && (i.normal?.[2] ?? 0) > 0.5);
  if (!top) throw new Error('no top face: ' + JSON.stringify(items));
  return top.face;
}
const volume = async (c: Controller) => (await c.massProps())!.volume as number;

describe('Press Pull Straight in the app', { skip: !process.env.CK_WASM }, () => {
  it('faceRun gives the reach of a flat face: half the diagonal of 40 x 20', async () => {
    const c = await open(rectSketch(40, 20));
    const [item] = (await c.faceRun([await topFace(c)]))!;
    expect(item.flat).toBe(true);
    near(item.reach!, Math.hypot(20, 10));
    near(item.area!, 800);
  }, 120000);

  it('Offset -> Straight keeps the faces and the distance; no taper adds area x distance', async () => {
    const c = await open(rectSketch(40, 20));
    const face = await topFace(c);
    const added = await c.edit([{ op: 'add', feature: { type: 'moveFace', id: 'F3', faces: [face], mode: 'offset', distance: 10 } }] as never);
    expect(added.ok).toBe(true);
    near(await volume(c), 8000 + 800 * 10);
    const f3 = c.document()!.features.find((f) => f.id === 'F3') as unknown as Record<string, unknown>;
    const r = await c.edit(opsFromDraftFor(f3, 'F3', patchContinue(f3, 'straight')!));
    expect(r.ok).toBe(true);
    expect(c.document()!.features.find((f) => f.id === 'F3')).toEqual({ type: 'pressPull', id: 'F3', faces: [face], continue: 'straight', distance: 10 });
    near(await volume(c), 8000 + 800 * 10);
  }, 120000);

  it('a scale taper builds the frustum, and the readout matches the wall the kernel made', async () => {
    const c = await open(rectSketch(40, 20));
    const face = await topFace(c);
    const feat = { type: 'pressPull', id: 'F3', faces: [face], continue: 'straight', distance: 10, ...patchTaperScale(1.5) };
    expect((await c.edit([{ op: 'add', feature: feat }] as never)).ok).toBe(true);
    near(await volume(c), 8000 + (10 / 3) * (800 + 1800 + Math.sqrt(800 * 1800)));
    // the reach read before the feature is the plain face's; the readout is the angle of the wall at the corner
    const [item] = (await c.faceRun([face], 'F3'))!;
    near(item.reach!, Math.hypot(20, 10));
    near(scaleTaperAngle(item.reach, 1.5, 10)!, (Math.atan(Math.hypot(20, 10) * 0.5 / 10) * 180) / Math.PI);
  }, 120000);

  it('draft 3 degrees outward grows, draft -3 shrinks, and the sign is the opposite of extrude', async () => {
    const c = await open(rectSketch(40, 20));
    const face = await topFace(c);
    expect((await c.edit([{ op: 'add', feature: { type: 'pressPull', id: 'F3', faces: [face], continue: 'straight', distance: 10, ...patchTaperAngle(3) } }] as never)).ok).toBe(true);
    const out = await volume(c);
    near(out, 8000 + grown(10, 10 * TAN3));
    const f3 = c.document()!.features.find((f) => f.id === 'F3') as unknown as Record<string, unknown>;
    expect((await c.edit(opsFromDraftFor(f3, 'F3', patchTaperAngle(-3)))).ok).toBe(true);
    const inward = await volume(c);
    near(inward, 8000 + grown(10, -10 * TAN3));
    expect(out).toBeGreaterThan(inward);
  }, 120000);

  it('a cut with a negative distance removes the prism', async () => {
    const c = await open(rectSketch(40, 20));
    const face = await topFace(c);
    expect((await c.edit([{ op: 'add', feature: { type: 'pressPull', id: 'F3', faces: [face], continue: 'straight', distance: -4 } }] as never)).ok).toBe(true);
    near(await volume(c), 8000 - 800 * 4);
  }, 120000);

  it('refusals leave the kernel detail and its hint in the preview line, the body unchanged', async () => {
    const c = await open(rectSketch(40, 20));
    const face = await topFace(c);
    const before = await volume(c);
    const add = (extra: Record<string, unknown>, faces = [face]) => c.preview([{ op: 'add', feature: { type: 'pressPull', id: 'F3', faces, continue: 'straight', distance: 10, ...extra } }] as never, 0);
    const zero = await add({ distance: 0 });
    expect(zero.ok).toBe(false); expect(zero.hint).toMatch(/distance/i);
    const bad = await add({ taper: { type: 'scale', endScale: 0 } });
    expect(bad.ok).toBe(false); expect(bad.hint).toMatch(/end scale/); expect(bad.hint).toMatch(/above 0|positive/i);
    const along = await add({ continue: 'along' });
    expect(along.ok).toBe(false); expect(along.hint).toMatch(/continue/i);
    const throughBody = await add({ distance: -30 });
    expect(throughBody.ok).toBe(false);
    expect(throughBody.hint).toBeTruthy();
    near(await volume(c), before);
  }, 120000);

  it('a taper that closes to a point on a round face names the longest run in words', async () => {
    const c = await open(rodSketch(5), 10);
    const face = await topFace(c);
    const r = await c.preview([{ op: 'add', feature: { type: 'pressPull', id: 'F3', faces: [face], continue: 'straight', distance: 40, taper: { type: 'draft', angle: -10 } } }] as never, 0);
    expect(r.ok).toBe(false);
    expect(r.hint).toMatch(/taper closes to a point after 28\.\d+ mm/);
    expect(r.diagnosis!.roots[0].code).toBe('draftTooLarge');
    // a curved wall is not flat: the kernel's detail reaches the line and the advice sends the user to Offset
    const wall = (await c.faceRun(['F2.S.e1']))![0];
    expect(wall.found).toBe(true); expect(wall.flat).toBe(false);
    const curved = await c.preview([{ op: 'add', feature: { type: 'pressPull', id: 'F3', faces: ['F2.S.e1'], continue: 'straight', distance: 3 } }] as never, 0);
    expect(curved.ok).toBe(false);
    expect(curved.hint).toMatch(/The picked face is a cylinder face: .*needs a flat face \(move a curved face with move face\)/);
    expect(curved.diagnosis!.roots[0].code).toBe('pressPullUnsupported');
  }, 120000);
});

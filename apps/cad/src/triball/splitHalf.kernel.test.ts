import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from '../controller';
import { splitFaceOps } from '../featureCreators';
import { shapeSelection } from '../handles/sizeBox';
import { faceMoveOps, resolveTarget } from './ops';

// A 70 mm disc, 10 thick, its top face split in two by Split face.
const disc = (): PartDoc => ({ ...emptyPart('Disc'), features: [
  { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'top' }, points: [{ id: 'c', x: 0, y: 0 }], entities: [{ id: 'c1', type: 'circle', c: 'c', r: 35 }], constraints: [] },
  { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
], seq: 10 }) as unknown as PartDoc;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('one half of a split face against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('picking a half is a face pick (no size box that moves the whole extrude); the ball moves just that half as a step with a wall, a move through the body is refused and leaves no feature behind', async () => {
    const store = createStore();
    const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const controller = new Controller({ store, view, kernel });
    await controller.load(disc());
    const split = splitFaceOps({ selection: ['F2.C1'], mode: 'face', box: controller.bodyBox(), doc: controller.document() } as never);
    expect((await controller.commit(split!)).ok).toBe(true);
    const faces = controller.bodyFaces()!.faceIds;
    const half = faces.find((f) => f.startsWith('F2.C1~'))!;
    expect(faces.filter((f) => f.startsWith('F2.C1~'))).toHaveLength(2);
    // the selection is the half alone: no shape, so no size box with its move pad
    expect(shapeSelection(controller.document(), [half], 'face', null)).toBeNull();
    // the positioning ball targets just that half, and moves it by name
    const r = resolveTarget({ doc: controller.document(), selection: [half], mode: 'face', selectedFeature: null, mesh: controller.bodyFaces(), box: controller.bodyBox() });
    expect(r.ok && r.target.faces).toEqual([half]);
    if (!r.ok) return;
    const move = (d: number) => faceMoveOps(controller.document(), r.target.faces!, !!r.target.planar, r.target.frame.axes[2], d)!;
    expect(move(3)[0]).toMatchObject({ op: 'add', feature: { type: 'moveFace', faces: [half] } });
    // a move too deep for the body is refused with the reason; nothing is added to the tree
    const nFeatures = controller.document()!.features.length;
    const deep = await controller.preview(move(-12), 0);
    expect(deep.ok).toBe(false);
    expect(JSON.stringify(deep.errors)).toMatch(/moveFaceFailed[\s\S]*(far side|not that thick)/);
    const refused = await controller.commit(move(-12));
    expect(refused.ok).toBe(false);
    expect(controller.document()!.features).toHaveLength(nFeatures);
    expect(controller.buildErrors()).toHaveLength(0);
    expect(store.notices.value.at(-1)?.level).toBe('error');
    // up by 3: the half rises, the other half stays, a wall appears
    const up = await controller.commit(move(3));
    expect(up.ok).toBe(true);
    const after = controller.bodyFaces()!.faceIds;
    expect(after).toContain(half);
    expect(after.length).toBe(faces.length + 1);
    expect(controller.bodyBox()!.max[1]).toBeCloseTo(13, 6);
    // the whole top, named by the face it was split from, still moves as one
    const all = await controller.preview([{ op: 'add', feature: { type: 'moveFace', faces: ['F2.C1'], mode: 'offset', distance: 3 } }] as never, 0);
    expect(all.ok).toBe(true);
  }, 90000);
});

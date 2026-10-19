import { describe, expect, it } from 'vitest';
import type { EditOp } from '@ck/session';
import '../i18n';
import { depthArrowKey, depthArrowSession, extrudeSign, type DepthArrowCtx } from './depthArrow';
import { planHandles, type PlanCtx } from './plan';

const frame = { o: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], y: [0, 1, 0] as [number, number, number], z: [0, 0, 1] as [number, number, number] };
const ctx = (over: Partial<DepthArrowCtx> = {}): DepthArrowCtx => ({
  id: 'F2', op: 'add', end: 'blind', depth: 10, flip: false, frame, centre: { u: 5, v: 3, hu: 20 },
  ops: (patch) => [{ op: 'set', id: 'F2', path: 'draft', value: patch } as unknown as EditOp], ...over,
});
const patchOf = (ops: EditOp[] | null) => (ops?.[0] as unknown as { value: unknown } | undefined)?.value;

describe('extrudeSign', () => {
  it('a boss goes along the normal, a cut against it, flip reverses either', () => {
    expect(extrudeSign('add', false)).toBe(1);
    expect(extrudeSign('add', true)).toBe(-1);
    expect(extrudeSign('cut', false)).toBe(-1);
    expect(extrudeSign('cut', true)).toBe(1);
  });
});

describe('depthArrowSession', () => {
  it('one red arrow at the profile centre on the end cap, along the extrusion, base = the depth', () => {
    const s = depthArrowSession(ctx())!;
    expect(s.kind).toBe('extrude-depth');
    const a = s.specs.find((x) => x.kind === 'arrow')!;
    expect(s.specs.filter((x) => x.kind === 'arrow')).toHaveLength(1);
    expect(a).toMatchObject({ id: 'depth', origin: [5, 3, 10], axis: [0, 0, 1], base: 10, scale: 1, color: '#e5484d' });
  });
  it('a cut points into the material (against the normal); flip reverses', () => {
    const cut = depthArrowSession(ctx({ op: 'cut' }))!.specs[0];
    expect(cut.axis).toEqual([0, 0, -1]);
    expect(cut.origin).toEqual([5, 3, -10]);
    expect(depthArrowSession(ctx({ op: 'cut', flip: true }))!.specs[0].axis).toEqual([0, 0, 1]);
    expect(depthArrowSession(ctx({ flip: true }))!.specs[0].axis).toEqual([0, 0, -1]);
  });
  it('a mid-plane extrude: arrow on the far face, the total moves twice as fast', () => {
    const a = depthArrowSession(ctx({ end: 'mid', depth: 20 }))!.specs[0];
    expect(a).toMatchObject({ origin: [5, 3, 10], axis: [0, 0, 1], base: 20, scale: 2 });
    const s = depthArrowSession(ctx({ end: 'mid', depth: 20 }))!;
    expect(patchOf(s.preview('depth', -8, [0, 0, 0]))).toEqual({ depth: 8 });   // through the plane: same total, no flip
  });
  it('no arrow for through / up-to ends or without a depth', () => {
    for (const end of ['throughAll', 'throughBoth', 'upToFace', 'offsetFromFace', 'upToPoint']) expect(depthArrowSession(ctx({ end }))).toBeNull();
    expect(depthArrowSession(ctx({ depth: null }))).toBeNull();
    expect(depthArrowSession(ctx({ depth: 0 }))).toBeNull();
  });
  it('the drag previews the card draft (depth), rounding to 0.01; nothing at zero', () => {
    const s = depthArrowSession(ctx())!;
    expect(patchOf(s.preview('depth', 12.3456, [0, 0, 0]))).toEqual({ depth: 12.35 });
    expect(s.preview('depth', 0, [0, 0, 0])).toBeNull();
  });
  it('dragged back through the sketch plane: the same extrude the other way round', () => {
    const s = depthArrowSession(ctx())!;
    expect(patchOf(s.preview('depth', -6, [0, 0, 0]))).toEqual({ depth: 6, flip: true });
    const f = depthArrowSession(ctx({ flip: true }))!;
    expect(patchOf(f.preview('depth', -6, [0, 0, 0]))).toEqual({ depth: 6, flip: null });
  });
  it('release edits no document: it hands the patch to the card as a draft', () => {
    const s = depthArrowSession(ctx())!;
    expect(s.commit('depth', 25, [0, 0, 0])).toEqual({ ops: [], create: false, draft: { depth: 25 } });
    expect(s.commit('depth', 0, [0, 0, 0])).toBeNull();
  });
  it('past the tip of a taper the depth stays at the tip and says so', () => {
    const s = depthArrowSession(ctx({ tipLimit: 15 }))!;
    expect(patchOf(s.preview('depth', 40, [0, 0, 0]))).toEqual({ depth: 15 });
    const c = s.commit('depth', 40, [0, 0, 0])!;
    expect(c.draft).toEqual({ depth: 15 });
    expect(c.notice).toContain('15');
  });
  it('the label follows the drag and shows the value; clicking it types the depth', () => {
    const s = depthArrowSession(ctx())!;
    const l = s.specs.find((x) => x.kind === 'label')!;
    expect(l).toMatchObject({ forId: 'depth', text: 'Depth 10 mm', origin: [25, 3, 10] });
    expect(s.live!('depth', 18, [0, 0, 0])![0]).toMatchObject({ id: 'depthLabel', text: 'Depth 18 mm', origin: [25, 3, 18] });
    expect(s.format!('depth', 7)).toBe('Depth 7 mm');
  });
  it('the Ctrl step follows the size of the depth', () => {
    expect(depthArrowSession(ctx({ depth: 10 }))!.step!('depth')).toBe(1);
    expect(depthArrowSession(ctx({ depth: 60 }))!.step!('depth')).toBe(5);
  });
  it('the key changes with the value and the direction, not with the ops closure', () => {
    expect(depthArrowKey(ctx())).toBe(depthArrowKey(ctx()));
    expect(depthArrowKey(ctx())).not.toBe(depthArrowKey(ctx({ depth: 11 })));
    expect(depthArrowKey(ctx())).not.toBe(depthArrowKey(ctx({ flip: true })));
    expect(depthArrowKey(null)).toBe('');
  });
});

describe('planHandles with the card open', () => {
  const base: PlanCtx = { doc: null, selection: [], mode: 'face', edges: [], mesh: null, box: null, editingId: 'F2', sketching: false, enabled: true };
  it('gives the depth arrow while the extrude card is open, and nothing for another feature or with handles off', () => {
    expect(planHandles({ ...base, depthArrow: ctx() })!.kind).toBe('extrude-depth');
    expect(planHandles({ ...base, editingId: 'F9', depthArrow: ctx() })).toBeNull();
    expect(planHandles({ ...base, enabled: false, depthArrow: ctx() })).toBeNull();
    expect(planHandles({ ...base, depthArrow: null })).toBeNull();
  });
});

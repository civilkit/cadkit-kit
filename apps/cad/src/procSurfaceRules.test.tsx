import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { FeatureEditor } from '@kit/ui';
import { makesSurface } from '@kit/viewdata';
import type { PartDoc } from '@ck/part-model';
import { optionsFor, type ThinActions } from './FeatureOptions';
import { managedPaths } from './optionRules';
import { SLOTS, RIBBON_LAYOUT } from './toolbarModel';
import {
  atOn, autoSidesPatch, blendNeedsTwoFaces, blendSameFace, capsOffered, capsPatch, flipSide, inputChoices, inputIsCustom, inputMissing, inputSummary, procSurfaceManaged, radiusInvalid, radiusVaries, sameInput,
  sidesInForce, sidesOf, spanIsPoint, spanOf, spanPatch, sweepFrameOf, sweepFramePatch, toleranceInvalid, upChoiceOf, upIsZero, upPatch, varyPatch, radiusEndPatch, radiusStartPatch, vecPatch,
  sweepPathChoices, sweepPathPatch, sweepPathValue, blendSpanFromFaces,
} from './procSurfaceRules';
import { CREATORS, blendSurfaceOps, isSurfaceFeature, sweepOps, sweepSurfaceOps } from './featureCreators';
import { sketchInfos } from './surfaceRules';
import { FEATURE_TYPES } from '@ck/part-model';
import type { Ctx } from './featureCommands';
import './i18n';

afterEach(cleanup);
type Wire = Record<string, unknown>;

const circle: Wire = { type: 'sketch', id: 'C1', name: 'Ring', points: [{ id: 'c' }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 2 }] };
const path: Wire = { type: 'sketch', id: 'L1', name: 'Rail', points: [{ id: 'a' }, { id: 'b' }], entities: [{ id: 'l1', type: 'line', p1: 'a', p2: 'b' }] };
const off: Wire = { type: 'offsetCurve', id: 'O1', sketch: 'L1', distance: 5 };
const DOC = { features: [circle, path, off, { type: 'sweepSurface', id: 'W1', profile: 'C1', path: 'L1' }] } as unknown as PartDoc;
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ doc: DOC, selection: [], mode: 'face', box: { min: [0, 0, 0], max: [40, 25, 10] }, edges: [], selectedId: null, ...over });
const added = (ops: unknown): Wire => ((ops as Array<{ feature: Wire }>)[0]).feature;

describe('procedural surface forms: which fields they own', () => {
  it('each feature type hides exactly the fields its form draws', () => {
    expect([...managedPaths('sweepSurface')].sort()).toEqual(['caps', 'frame', 'gapTolerance', 'path', 'profile', 'tolerance', 'up']);
    expect([...managedPaths('blendSurface')].sort()).toEqual(['at', 'faces', 'from', 'radius', 'sides', 'to', 'tolerance']);
    expect(procSurfaceManaged('extrude').size).toBe(0);
  });
  it('both types are known to the part model and leave a sheet in the view', () => {
    // the part-model package lists the procedural types itself (no registration shim any more)
    for (const t of ['offsetCurve', 'compositeCurve', 'sweepSurface', 'blendSurface']) expect(FEATURE_TYPES as readonly string[]).toContain(t);
    expect(makesSurface({ type: 'sweepSurface' })).toBe(true);
    expect(makesSurface({ type: 'blendSurface' })).toBe(true);
    expect(isSurfaceFeature({ id: 'W1', type: 'sweepSurface' })).toBe(true);
  });
});

describe('sweep surface rules', () => {
  it('the choices are the sketches with a curve and the earlier curve features; a value that no longer fits is kept', () => {
    expect(inputChoices(DOC, 'W1', 'C1', 'profile').map(([v]) => v)).toEqual(['C1', 'L1', 'O1']);
    expect(inputChoices(DOC, 'W1', 'gone', 'path').map(([v]) => v)[0]).toBe('gone');
    expect(inputChoices(DOC, 'W1', 'L1', 'path').map(([v]) => v)).not.toContain('W1');
  });
  it('a reference or a list is a custom input; nothing is missing', () => {
    expect(inputIsCustom({ kind: 'curve', id: 'O1' })).toBe(true);
    expect(inputIsCustom([{ kind: 'edge', faces: ['A'], at: [0, 0, 0] }])).toBe(true);
    expect(inputIsCustom('L1')).toBe(false);
    expect([undefined, '', [], null].map(inputMissing)).toEqual([true, true, true, true]);
    expect(inputMissing('L1')).toBe(false);
    expect(inputMissing({ kind: 'curve', id: 'O1' })).toBe(false);
    expect(inputSummary(DOC, [{ kind: 'sketchCurve', sketch: 'L1', entity: 'l1' }, { kind: 'curve', id: 'O1' }])).toContain('Rail');
  });
  it('the same curve as profile and path is flagged', () => {
    expect(sameInput({ profile: 'L1', path: 'L1' })).toBe(true);
    expect(sameInput({ profile: 'C1', path: 'L1' })).toBe(false);
    expect(sameInput({ profile: '', path: '' })).toBe(false);
  });
  it('keeping the orientation drops the up direction; following the path clears the frame field', () => {
    expect(sweepFrameOf({})).toBe('tangent');
    expect(sweepFrameOf({ frame: 'translate' })).toBe('translate');
    expect(sweepFramePatch('translate')).toEqual({ frame: 'translate', up: null });
    expect(sweepFramePatch('tangent')).toEqual({ frame: null });
  });
  it('the up direction is automatic, a world axis or a vector', () => {
    expect(upChoiceOf({})).toBe('auto');
    expect(upChoiceOf({ up: [0, 0, 1] })).toBe('z');
    expect(upChoiceOf({ up: [0, -1, 0] })).toBe('-y');
    expect(upChoiceOf({ up: [1, 1, 0] })).toBe('vector');
    expect(upPatch({}, 'auto')).toEqual({ up: null });
    expect(upPatch({}, '-x')).toEqual({ up: [-1, 0, 0] });
    expect(upPatch({ up: [1, 1, 0] }, 'vector')).toEqual({ up: [1, 1, 0] });
    expect(upPatch({}, 'vector')).toEqual({ up: [0, 0, 1] });
    expect(upIsZero({ up: [0, 0, 0] })).toBe(true);
    expect(upIsZero({ up: [0, 0, 1] })).toBe(false);
  });
  it('caps are offered for a closed sketch as the profile (and stay offered while on)', () => {
    expect(capsOffered(DOC, { profile: 'C1' })).toBe(true);
    expect(capsOffered(DOC, { profile: 'L1' })).toBe(false);
    expect(capsOffered(DOC, { profile: 'O1' })).toBe(false);
    expect(capsOffered(DOC, { profile: 'L1', caps: true })).toBe(true);
    expect(capsPatch(true)).toEqual({ caps: true });
    expect(capsPatch(false)).toEqual({ caps: null });
  });
  it('a tolerance of 0 or below is flagged; expressions are left to the kernel', () => {
    expect([0, -1, 0.001, 'w'].map(toleranceInvalid)).toEqual([true, true, false, false]);
  });
});

describe('blend surface rules', () => {
  it('a radius is one number, or two (start, end) when it varies; each patch keeps the other', () => {
    expect(radiusVaries({ radius: 3 })).toBe(false);
    expect(radiusVaries({ radius: [3, 5] })).toBe(true);
    expect(varyPatch({ radius: 3 }, true)).toEqual({ radius: [3, 3] });
    expect(varyPatch({ radius: [3, 5] }, false)).toEqual({ radius: 3 });
    expect(radiusStartPatch({ radius: [3, 5] }, 4)).toEqual({ radius: [4, 5] });
    expect(radiusStartPatch({ radius: 3 }, 4)).toEqual({ radius: 4 });
    expect(radiusEndPatch({ radius: [3, 5] }, 6)).toEqual({ radius: [3, 6] });
    expect([{ radius: 0 }, { radius: [3, -1] }, { radius: 3 }, { radius: 'r' }].map(radiusInvalid)).toEqual([true, true, false, false]);
  });
  it('two different faces are needed', () => {
    expect(blendNeedsTwoFaces({ faces: ['A'] })).toBe(true);
    expect(blendNeedsTwoFaces({ faces: [] })).toBe(true);
    expect(blendNeedsTwoFaces({ faces: ['A', 'B'] })).toBe(false);
    expect(blendNeedsTwoFaces({ faces: ['A', 'B', 'C'] })).toBe(true);
    expect(blendSameFace({ faces: ['A', 'A'] })).toBe(true);
    expect(blendSameFace({ faces: ['A', 'B'] })).toBe(false);
  });
  it('the span is the shared edge, or two points; each choice drops the other\'s fields', () => {
    expect(spanOf({})).toBe('edge');
    expect(spanOf({ from: [0, 0, 0], to: [1, 0, 0] })).toBe('points');
    expect(spanPatch({}, 'points')).toEqual({ at: null, from: [0, 0, 0], to: [10, 0, 0] });
    expect(spanPatch({ from: [1, 2, 3], to: [4, 5, 6] }, 'points')).toMatchObject({ from: [1, 2, 3], to: [4, 5, 6] });
    expect(spanPatch({ from: [1, 2, 3], to: [4, 5, 6] }, 'edge')).toEqual({ from: null, to: null });
    expect(vecPatch({ from: [1, 2, 3] }, 'from', 1, 9)).toEqual({ from: [1, 9, 3] });
    expect(atOn({ at: [0, 0, 0] })).toBe(true);
    expect(spanIsPoint({ from: [1, 1, 1], to: [1, 1, 1] })).toBe(true);
    expect(spanIsPoint({ from: [1, 1, 1], to: [1, 1, 2] })).toBe(false);
  });
  it('sides: the ones written, else the kernel\'s choice; Flip writes both, starting from what is in force', () => {
    expect(sidesOf({})).toBeNull();
    expect(sidesOf({ sides: [1, -1] })).toEqual([1, -1]);
    expect(sidesOf({ sides: [1, 0] })).toBeNull();
    expect(sidesInForce({}, [-1, -1])).toEqual([-1, -1]);
    expect(sidesInForce({ sides: [1, 1] }, [-1, -1])).toEqual([1, 1]);
    expect(sidesInForce({}, null)).toBeNull();
    expect(flipSide({}, 0, [-1, -1])).toEqual({ sides: [1, -1] });
    expect(flipSide({}, 1, [1, 1])).toEqual({ sides: [1, -1] });
    expect(flipSide({}, 0)).toEqual({ sides: [1, -1] });
    expect(flipSide({ sides: [1, -1] }, 0, [-1, -1])).toEqual({ sides: [-1, -1] });
    expect(autoSidesPatch()).toEqual({ sides: null });
  });
});

describe('sweep (solid) path: an open sketch or a curve feature', () => {
  const doc = { features: [circle, path, off, { type: 'helix', id: 'H1', sketch: 'C1' }, { type: 'sweep', id: 'S9', op: 'add', sketch: 'C1', path: { kind: 'sketch', id: 'L1' } }, { type: 'compositeCurve', id: 'K9', sketch: 'L1' }] } as unknown as PartDoc;
  const open = sketchInfos(doc).filter((s) => s.open);
  it('the value is the sketch id, or curve:<id> for a curve feature', () => {
    expect(sweepPathValue({ path: { kind: 'sketch', id: 'L1' } })).toBe('L1');
    expect(sweepPathValue({ path: { kind: 'curve', id: 'O1' } })).toBe('curve:O1');
    expect(sweepPathValue({})).toBe('');
  });
  it('the choices are the open sketches, then the curve features before the sweep (offset, composite, project, edit curve, helix)', () => {
    expect(sweepPathChoices(doc, 'S9', {}, open)).toEqual([['L1', 'Rail (L1)'], ['curve:O1', 'Offset curve: O1'], ['curve:H1', 'Helix: H1']]);
    // a curve the sweep no longer may take (made after it) is kept as it is
    expect(sweepPathChoices(doc, 'S9', { path: { kind: 'curve', id: 'K9' } }, open)[0]).toEqual(['curve:K9', 'K9']);
  });
  it('a curve choice writes the kernel\'s curve route, a sketch choice the sketch reference', () => {
    expect(sweepPathPatch('curve:O1')).toEqual({ path: { kind: 'curve', id: 'O1' } });
    expect(sweepPathPatch('L1')).toEqual({ path: { kind: 'sketch', id: 'L1' } });
  });
  it('the Sweep command takes a curve feature selected in the tree as the path', () => {
    const d = { features: [circle, path, off] } as unknown as PartDoc;
    expect(added(sweepOps(ctx({ doc: d, selectedId: 'O1' })))).toEqual({ type: 'sweep', op: 'add', sketch: 'C1', path: { kind: 'curve', id: 'O1' } });
    // an unused open sketch comes first; one the offset curve is made from counts as used, so the curve is the path
    expect(added(sweepOps(ctx({ doc: { features: [circle, path] } as never })))).toMatchObject({ path: { kind: 'sketch', id: 'L1' } });
    expect(added(sweepOps(ctx({ doc: d })))).toMatchObject({ path: { kind: 'curve', id: 'O1' } });
    // a curve feature alone (no open sketch left) is the path too
    expect(added(sweepOps(ctx({ doc: { features: [circle, off] } as never })))).toMatchObject({ sketch: 'C1', path: { kind: 'curve', id: 'O1' } });
    // one a sweep already runs along is not taken again, unless it is selected
    const swept = { features: [circle, off, { type: 'sweep', id: 'S1', op: 'add', sketch: 'X', path: { kind: 'curve', id: 'O1' } }] } as never;
    expect(sweepOps(ctx({ doc: swept }))).toBeNull();
    expect(added(sweepOps(ctx({ doc: swept, selectedId: 'O1' })))).toMatchObject({ path: { kind: 'curve', id: 'O1' } });
  });
  it('the form lists the curve features in the path drop-down and writes the curve reference', () => {
    const m = mount({ type: 'sweep', id: 'S9', op: 'add', sketch: 'C1', path: { kind: 'sketch', id: 'L1' } }, doc);
    const sel = m.q('[data-path="path"] select') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'L1', 'curve:O1', 'curve:H1']);
    expect(sel.value).toBe('L1');
    change(sel, 'curve:O1');
    expect(m.drafts.at(-1)).toMatchObject({ path: { kind: 'curve', id: 'O1' } });
    const c = mount({ type: 'sweep', id: 'S9', op: 'add', sketch: 'C1', path: { kind: 'curve', id: 'H1' } }, doc);
    expect((c.q('[data-path="path"] select') as HTMLSelectElement).value).toBe('curve:H1');
    change(c.q('[data-path="path"] select')!, 'L1');
    expect(c.drafts.at(-1)).toMatchObject({ path: { kind: 'sketch', id: 'L1' } });
  });
});

describe('blend surface: the two-point span from the picked faces', () => {
  type Mesh = { positions: number[]; triFace: number[]; faceIds: string[] };
  /** A flat quad as two triangles (non-indexed, as the view mesh is). */
  const quad = (m: Mesh, name: string, a: number[], b: number[], c: number[], d: number[]) => {
    let f = m.faceIds.indexOf(name);
    if (f < 0) { f = m.faceIds.length; m.faceIds.push(name); }
    m.positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    m.triFace.push(f, f);
  };
  // the 40 x 25 x 10 plate: top F2.C1 at z = 10 and front F2.S.e1 at y = 0 share the edge from (0, 0, 10) to (40, 0, 10)
  const plate = (): Mesh => {
    const m: Mesh = { positions: [], triFace: [], faceIds: [] };
    quad(m, 'F2.C1', [0, 0, 10], [40, 0, 10], [40, 25, 10], [0, 25, 10]);
    quad(m, 'F2.S.e1', [0, 0, 0], [40, 0, 0], [40, 0, 10], [0, 0, 10]);
    quad(m, 'F2.S.e2', [40, 0, 0], [40, 25, 0], [40, 25, 10], [40, 0, 10]);
    return m;
  };
  it('two faces that share an edge: the span is that edge, from its lower end', () => {
    expect(blendSpanFromFaces([plate()], 'F2.C1', 'F2.S.e1')).toEqual({ from: [0, 0, 10], to: [40, 0, 10] });
    expect(blendSpanFromFaces([plate()], 'F2.S.e2', 'F2.C1')).toEqual({ from: [40, 0, 10], to: [40, 25, 10] });
  });
  it('does not depend on the order the faces were picked in, nor on how finely they are meshed', () => {
    expect(blendSpanFromFaces([plate()], 'F2.S.e1', 'F2.C1')).toEqual(blendSpanFromFaces([plate()], 'F2.C1', 'F2.S.e1'));
    const fine = plate();
    quad(fine, 'F2.C1', [0, 0, 10], [20, 0, 10], [20, 5, 10], [0, 5, 10]);   // more triangles along the edge
    expect(blendSpanFromFaces([fine], 'F2.C1', 'F2.S.e1')).toEqual({ from: [0, 0, 10], to: [40, 0, 10] });
  });
  it('two faces apart: the span runs along the middle of the gap between their nearest edges', () => {
    const m: Mesh = { positions: [], triFace: [], faceIds: [] };
    quad(m, 'A', [0, 0, 0], [30, 0, 0], [30, 10, 0], [0, 10, 0]);    // a floor
    quad(m, 'B', [0, 12, 2], [30, 12, 2], [30, 12, 20], [0, 12, 20]); // a wall 2 off its back edge and 2 above
    expect(blendSpanFromFaces([m], 'A', 'B')).toEqual({ from: [0, 11, 1], to: [30, 11, 1] });
  });
  it('faces in a second mesh (a sheet) are found too; a missing face, one face twice or a single touching point gives nothing', () => {
    const sheet: Mesh = { positions: [], triFace: [], faceIds: [] };
    quad(sheet, 'W1.F', [0, 0, 10], [40, 0, 10], [40, -8, 18], [0, -8, 18]);
    expect(blendSpanFromFaces([plate(), sheet], 'F2.C1', 'W1.F')).toEqual({ from: [0, 0, 10], to: [40, 0, 10] });
    expect(blendSpanFromFaces([plate()], 'F2.C1', 'nope')).toBeNull();
    expect(blendSpanFromFaces([plate()], 'F2.C1', 'F2.C1')).toBeNull();
    const corner: Mesh = { positions: [], triFace: [], faceIds: [] };
    quad(corner, 'P', [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]);
    quad(corner, 'Q', [1, 1, 0], [2, 1, 5], [2, 2, 5], [1, 2, 5]);
    expect(blendSpanFromFaces([corner], 'P', 'Q')).toBeNull();
    expect(blendSpanFromFaces([null], 'P', 'Q')).toBeNull();
  });
  it('switching to two points starts from the derived span, else from a line of 10 along x', () => {
    expect(spanPatch({}, 'points', { from: [0, 0, 10], to: [40, 0, 10] })).toEqual({ at: null, from: [0, 0, 10], to: [40, 0, 10] });
    expect(spanPatch({}, 'points', null)).toEqual({ at: null, from: [0, 0, 0], to: [10, 0, 0] });
    expect(spanPatch({ from: [1, 2, 3], to: [4, 5, 6] }, 'points', { from: [0, 0, 10], to: [40, 0, 10] })).toEqual({ at: null, from: [1, 2, 3], to: [4, 5, 6] });
  });
});

describe('creators', () => {
  const edgesDoc = { features: [circle, path] } as unknown as PartDoc;
  it('Sweep surface: the selected or last open sketch is the path, the closed sketch is the profile', () => {
    expect(added(sweepSurfaceOps(ctx({ doc: edgesDoc })))).toEqual({ type: 'sweepSurface', profile: 'C1', path: 'L1', frame: 'tangent', tolerance: 0.001 });
    expect(added(sweepSurfaceOps(ctx({ selectedId: 'O1' })))).toMatchObject({ profile: 'C1', path: 'O1' });
    expect(sweepSurfaceOps(ctx({ doc: { features: [path] } as never }))).toBeNull();   // no profile
    expect(sweepSurfaceOps(ctx({ doc: { features: [circle] } as never }))).toBeNull();  // no path
    expect(sweepSurfaceOps(ctx({ doc: { features: [] } as never }))).toBeNull();
  });
  it('Blend surface: needs two picked faces, takes the first two, and starts with a tenth of the part as radius', () => {
    expect(blendSurfaceOps(ctx())).toBeNull();
    expect(blendSurfaceOps(ctx({ selection: ['F2.C1'] }))).toBeNull();
    expect(added(blendSurfaceOps(ctx({ selection: ['F2.C1', 'F2.S.e1', 'F2.S.e2'] })))).toEqual({ type: 'blendSurface', faces: ['F2.C1', 'F2.S.e1'], radius: 1, tolerance: 0.001 });
    expect(blendSurfaceOps(ctx({ selection: ['F2.C1', 'F2.S.e1'], mode: 'edge' }))).toBeNull();
  });
  it('the commands sit on the Surfaces tab and the palette, with their own entries', () => {
    const en = (id: string, c: Ctx) => CREATORS.find((k) => k.id === id)!.enabled(c);
    expect(en('add-sweep-surface', ctx())).toBe(true);
    expect(en('add-sweep-surface', ctx({ doc: { features: [] } as never }))).toBe(false);
    expect(en('add-blend-surface', ctx())).toBe(false);
    expect(en('add-blend-surface', ctx({ selection: ['A', 'B'] }))).toBe(true);
    for (const id of ['add-sweep-surface', 'add-blend-surface']) {
      expect(CREATORS.find((k) => k.id === id)).toMatchObject({ tab: 'Surfaces', group: 'Create', tip: true });
      expect(SLOTS['surface-new']).toContain(id);
      expect(JSON.stringify(RIBBON_LAYOUT.Surfaces)).toContain(id);
    }
  });
});

function mount(feature: Wire, doc: PartDoc = DOC, actions?: Partial<ThinActions>) {
  const drafts: Wire[] = [];
  const picks: string[] = [];
  const r = render(<FeatureEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} onPickRequest={(p) => picks.push(p)} options={(a) => optionsFor(a, doc, actions as ThinActions | undefined)} />);
  const q = (s: string) => r.container.querySelector(s) as HTMLElement | null;
  return { ...r, drafts, picks, q };
}
const change = (el: Element, value: string) => { fireEvent.input(el, { target: { value } }); fireEvent.change(el, { target: { value } }); fireEvent.blur(el); };

describe('Sweep surface form', () => {
  const feat = { type: 'sweepSurface', id: 'W9', profile: 'C1', path: 'L1', frame: 'tangent', tolerance: 0.001 };
  it('draws the profile and path pickers, the frame and up direction, caps for a closed profile, and tolerances under Advanced', () => {
    const m = mount(feat);
    for (const p of ['profile', 'path', 'frame', 'upChoice', 'caps']) expect(m.q(`[data-path="${p}"]`), p).not.toBeNull();
    expect(m.q('[data-section="sweepSurfaceAdvanced"]')?.className).toContain('closed');
    expect(m.q('[data-path="tolerance"]')).toBeNull();   // collapsed
    for (const p of ['profile', 'path']) expect(m.q(`[data-note="${p}Missing"]`)).toBeNull();
    expect([...(m.q('[data-path="profile"] select') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['C1', 'L1', 'O1']);
    change(m.q('[data-path="path"] select')!, 'O1');
    expect(m.drafts.at(-1)).toMatchObject({ path: 'O1' });
    fireEvent.click(m.q('[data-path="caps"] input')!);
    expect(m.drafts.at(-1)).toMatchObject({ caps: true });
  });
  it('Keep orientation hides the up direction and clears it; Follow the path shows it again', () => {
    const m = mount({ ...feat, up: [0, 0, 1] });
    expect(m.q('[data-path="upChoice"]')).not.toBeNull();
    change(m.q('[data-path="frame"] select')!, 'translate');
    expect(m.drafts.at(-1)).toMatchObject({ frame: 'translate', up: null });
    const t = mount({ ...feat, frame: 'translate' });
    expect(t.q('[data-path="upChoice"]')).toBeNull();
    expect(t.q('[data-note="translateNote"]')).not.toBeNull();
    change(t.q('[data-path="frame"] select')!, 'tangent');
    expect(t.drafts.at(-1)).toMatchObject({ frame: null });
  });
  it('the up direction takes a world axis or a vector', () => {
    const m = mount(feat);
    change(m.q('[data-path="upChoice"] select')!, 'vector');
    expect(m.drafts.at(-1)).toMatchObject({ up: [0, 0, 1] });
    const v = mount({ ...feat, up: [1, 1, 0] });
    for (const i of [0, 1, 2]) expect(v.q(`[data-path="up.${i}"]`)).not.toBeNull();
    expect(mount({ ...feat, up: [0, 0, 0] }).q('[data-note="upZero"]')).not.toBeNull();
  });
  it('caps are not offered for an open profile, and stay while on', () => {
    expect(mount({ ...feat, profile: 'L1', path: 'O1' }).q('[data-path="caps"]')).toBeNull();
    expect(mount({ ...feat, profile: 'L1', path: 'O1', caps: true }).q('[data-path="caps"]')).not.toBeNull();
  });
  it('warns with no profile, no path, the same curve twice, and a bad tolerance', () => {
    const none = mount({ type: 'sweepSurface', id: 'W9' });
    expect(none.q('[data-note="profileMissing"]')).not.toBeNull();
    expect(none.q('[data-note="pathMissing"]')).not.toBeNull();
    expect(mount({ ...feat, path: 'C1' }).q('[data-note="same"]')).not.toBeNull();
    expect(mount(feat).q('[data-note="same"]')).toBeNull();
    const bad = mount({ ...feat, tolerance: 0 });
    expect(bad.q('[data-note="tolerance"]')).not.toBeNull();
  });
  it('references written by a script are shown as they are, with a way back to a plain choice', () => {
    const refs = [{ kind: 'sketchCurve', sketch: 'L1', entity: 'l1' }];
    const m = mount({ ...feat, path: refs });
    expect(m.q('[data-custom="path"]')?.textContent).toContain('Rail');
    expect(m.q('[data-note="pathMissing"]')).toBeNull();
    fireEvent.click(m.q('[data-path="path"] [data-act="clear"]')!);
    expect(m.drafts.at(-1)).toMatchObject({ path: null });
  });
});

describe('Blend surface form', () => {
  const feat = { type: 'blendSurface', id: 'B9', faces: ['F2.C1', 'F2.S.e1'], radius: 3, tolerance: 0.001 };
  it('draws the faces with a Use selection button, the radius, a side row per face, the span, and the tolerance under Advanced', () => {
    const m = mount(feat);
    for (const p of ['faces', 'radius', 'vary', 'sides', 'sides.0', 'sides.1', 'span']) expect(m.q(`[data-path="${p}"]`), p).not.toBeNull();
    expect((m.q('[data-path="faces"] input') as HTMLInputElement).value).toBe('F2.C1, F2.S.e1');
    fireEvent.click(m.q('[data-path="faces"] button.fedit-pick')!);
    expect(m.picks).toEqual(['faces']);
    expect(m.q('[data-path="radiusEnd"]')).toBeNull();
    expect(m.q('[data-section="blendSurfaceAdvanced"]')?.className).toContain('closed');
    for (const n of ['twoFaces', 'sameFace', 'radius']) expect(m.q(`[data-note="${n}"]`), n).toBeNull();
  });
  it('an end radius turns the blend into a varying one, and switching it off keeps the start radius', () => {
    const m = mount(feat);
    fireEvent.click(m.q('[data-path="vary"] input')!);
    expect(m.drafts.at(-1)).toMatchObject({ radius: [3, 3] });
    const v = mount({ ...feat, radius: [3, 5] });
    expect(v.q('[data-path="radiusEnd"]')).not.toBeNull();
    expect(v.q('[data-note="varyNote"]')).not.toBeNull();
    fireEvent.click(v.q('[data-path="vary"] input')!);
    expect(v.drafts.at(-1)).toMatchObject({ radius: 3 });
  });
  it('Flip writes both sides starting from the kernel\'s choice, and the automatic button goes back', () => {
    const m = mount(feat, DOC, { blendSides: () => [-1, -1] });
    expect(m.q('[data-path="sides.0"]')?.textContent).toContain('toward the other face');
    expect(m.q('[data-path="sides.0"]')?.textContent).toContain('against the face normal');
    expect(m.q('[data-act="auto"]')).toBeNull();
    fireEvent.click(m.q('[data-index="0"] [data-act="flip"]')!);
    expect(m.drafts.at(-1)).toMatchObject({ sides: [1, -1] });
    const e = mount({ ...feat, sides: [1, -1] });
    expect(e.q('[data-index="0"]')?.getAttribute('data-side')).toBe('1');
    expect(e.q('[data-index="1"]')?.getAttribute('data-side')).toBe('-1');
    expect(e.q('[data-path="sides.0"]')?.textContent).toContain('on the side the face normal points to');
    fireEvent.click(e.q('[data-index="1"] [data-act="flip"]')!);
    expect(e.drafts.at(-1)).toMatchObject({ sides: [1, 1] });
    fireEvent.click(e.q('[data-act="auto"]')!);
    expect(e.drafts.at(-1)).toMatchObject({ sides: null });
  });
  it('the span choice shows two points (and drops the nearest-edge point), or the shared edge', () => {
    const m = mount(feat);
    expect(m.q('[data-path="from.0"]')).toBeNull();
    change(m.q('[data-path="span"] select')!, 'points');
    expect(m.drafts.at(-1)).toMatchObject({ from: [0, 0, 0], to: [10, 0, 0], at: null });
    const p = mount({ ...feat, from: [0, 0, 0], to: [10, 0, 0] });
    for (const k of ['from', 'to']) for (const i of [0, 1, 2]) expect(p.q(`[data-path="${k}.${i}"]`)).not.toBeNull();
    change(p.q('[data-path="span"] select')!, 'edge');
    expect(p.drafts.at(-1)).toMatchObject({ from: null, to: null });
    const e = mount({ ...feat, at: [1, 2, 3] });
    expect(e.q('[data-path="at.1"]')).not.toBeNull();
    fireEvent.click(e.q('[data-path="nearOn"] input')!);
    expect(e.drafts.at(-1)).toMatchObject({ at: null });
  });
  it('two points starts from the span of the picked faces, and follows them when the faces change', () => {
    const asked: string[][] = [];
    const blendSpan = (faces: string[]) => { asked.push(faces); return faces[1] === 'F2.S.e2' ? { from: [40, 0, 10], to: [40, 25, 10] } as never : { from: [0, 0, 10], to: [40, 0, 10] } as never; };
    const m = mount(feat, DOC, { blendSpan });
    change(m.q('[data-path="span"] select')!, 'points');
    expect(m.drafts.at(-1)).toMatchObject({ from: [0, 0, 10], to: [40, 0, 10], at: null });
    // opening a blend that already has points keeps them; a new pair of faces recomputes them
    const p = mount({ ...feat, from: [1, 2, 3], to: [4, 5, 6] }, DOC, { blendSpan });
    expect(p.drafts).toEqual([]);
    p.rerender(<FeatureEditor feature={{ ...feat, faces: ['F2.C1', 'F2.S.e2'], from: [1, 2, 3], to: [4, 5, 6] }} onDraft={(d) => p.drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} onPickRequest={() => {}} options={(a) => optionsFor(a, DOC, { blendSpan } as unknown as ThinActions)} />);
    expect(p.drafts.at(-1)).toMatchObject({ from: [40, 0, 10], to: [40, 25, 10] });
    // in edge mode nothing is written
    const e = mount(feat, DOC, { blendSpan });
    e.rerender(<FeatureEditor feature={{ ...feat, faces: ['F2.C1', 'F2.S.e2'] }} onDraft={(d) => e.drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} onPickRequest={() => {}} options={(a) => optionsFor(a, DOC, { blendSpan } as unknown as ThinActions)} />);
    expect(e.drafts).toEqual([]);
  });
  it('warns with one face, the same face twice, a radius of 0 or below, and two equal points', () => {
    expect(mount({ ...feat, faces: ['F2.C1'] }).q('[data-note="twoFaces"]')?.textContent).toContain('exactly two faces');
    expect(mount({ ...feat, faces: [] }).q('[data-note="twoFaces"]')).not.toBeNull();
    expect(mount({ ...feat, faces: ['A', 'A'] }).q('[data-note="sameFace"]')).not.toBeNull();
    expect(mount({ ...feat, radius: 0 }).q('[data-note="radius"]')).not.toBeNull();
    expect(mount({ ...feat, radius: [3, -2] }).q('[data-note="radius"]')).not.toBeNull();
    expect(mount({ ...feat, from: [1, 1, 1], to: [1, 1, 1] }).q('[data-note="spanPoint"]')).not.toBeNull();
  });
});

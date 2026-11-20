import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { FeatureEditor } from '@kit/ui';
import type { PartDoc } from '@ck/part-model';
import { optionsFor } from './FeatureOptions';
import { managedPaths } from './optionRules';
import { SLOTS } from './toolbarModel';
import {
  COMPOSITE_DEFAULTS, OFFSET_DEFAULTS, alongPatch, distanceIsZero, hasCurveList, normalPatch, offsetInOf, offsetNeedsFace, patchAlong, patchOffsetIn, proceduralNeedsOneFace, proceduralOn, proceduralPatch, projectAlongOf,
  addableCurves, curveManaged, curveRefLabel, degreeOutOfRange, directionOf, editsNeedOneFace, entriesPatch, frameOf, keepEndsOn, keepEndsPatch, methodOf, netSize, newEdit, newEntry,
  parsePoints, patchEntry, patchFrame, patchMethod, planarPatch, pointsText, retargetSketchCurve, sourceChoices, sourcePatch, sourceValue,
} from './curveRules';
import { CREATORS, compositeCurveOps, editCurveOps, freeformOps, offsetCurveOps, projectCurveOps } from './featureCreators';
import { pickValue } from './featureCommands';
import type { Ctx } from './featureCommands';
import './i18n';

afterEach(cleanup);
type Wire = Record<string, unknown>;

const line = (id: string, name = 'S' + id): Wire => ({ type: 'sketch', id, name, points: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], entities: [{ id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'l2', type: 'line', p1: 'b', p2: 'c' }] });
const DOC = { features: [line('S1'), line('S2'), { type: 'editCurve', id: 'E1', curves: [{ kind: 'sketchCurve', sketch: 'S1', entity: 'l1' }] }, { type: 'plane', id: 'P1', mode: 'offset', base: { kind: 'std', id: 'top' }, offset: 5 }] } as unknown as PartDoc;
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ doc: DOC, selection: [], mode: 'face', box: { min: [0, 0, 0], max: [40, 25, 10] }, edges: [], selectedId: null, ...over });
const added = (ops: unknown): Wire => ((ops as Array<{ feature: Wire }>)[0]).feature;

describe('curve forms: which fields they own', () => {
  it('each feature type hides exactly the fields its form draws', () => {
    expect([...managedPaths('projectCurve')].sort()).toEqual(['along', 'curve', 'curves', 'degree', 'direction', 'faces', 'gapTolerance', 'procedural', 'sketch', 'tolerance']);
    expect([...managedPaths('offsetCurve')].sort()).toEqual(['curve', 'curves', 'distance', 'face', 'gapTolerance', 'normal', 'plane', 'sketch', 'tolerance']);
    expect([...managedPaths('compositeCurve')].sort()).toEqual(['curve', 'curves', 'gapTolerance', 'sketch', 'tolerance']);
    expect(managedPaths('fill').has('patch') && managedPaths('fill').has('patchTolerance')).toBe(true);
    expect(managedPaths('editCurve').has('entries')).toBe(true);
    expect(managedPaths('freeform').has('edits')).toBe(true);
    expect(curveManaged('extrude').size).toBe(0);
  });
});

describe('project curve rules', () => {
  it('reads the source (a curve wins, as in the kernel) and writes one, clearing the other', () => {
    expect(sourceValue({ sketch: 'S1' })).toBe('sketch:S1');
    expect(sourceValue({ sketch: 'S1', curve: 'E1' })).toBe('curve:E1');
    expect(sourceValue({})).toBe('');
    expect(sourcePatch('curve:E1')).toEqual({ curve: 'E1', sketch: null });
    expect(sourcePatch('sketch:S2')).toEqual({ sketch: 'S2', curve: null });
  });
  it('offers sketches and only the curve features before this feature', () => {
    expect(sourceChoices(DOC, 'F9', {}).map(([v]) => v)).toEqual(['sketch:S1', 'sketch:S2', 'curve:E1']);
    expect(sourceChoices(DOC, 'E1', {}).map(([v]) => v)).toEqual(['sketch:S1', 'sketch:S2']);
    expect(sourceChoices(DOC, 'F9', { sketch: 'GONE' })[0][0]).toBe('sketch:GONE');
  });
  it('directions and the degree range', () => {
    expect([directionOf({}), directionOf({ direction: 'reverse' }), directionOf({ direction: 'sideways' })]).toEqual(['both', 'reverse', 'both']);
    expect([degreeOutOfRange(1), degreeOutOfRange(2), degreeOutOfRange(9), degreeOutOfRange(10), degreeOutOfRange('=3')]).toEqual([true, false, false, true, false]);
  });
});

describe('procedural project curve rules', () => {
  it('keep exact is a flag; off removes what only a procedural projection reads', () => {
    expect([proceduralOn({}), proceduralOn({ procedural: true }), proceduralOn({ procedural: false })]).toEqual([false, true, false]);
    expect(proceduralPatch(true)).toEqual({ procedural: true });
    expect(proceduralPatch(false)).toEqual({ procedural: null, along: null, gapTolerance: null, curves: null });
  });
  it('it needs exactly one face', () => {
    expect([proceduralNeedsOneFace({ procedural: true }), proceduralNeedsOneFace({ procedural: true, faces: ['a', 'b'] }), proceduralNeedsOneFace({ procedural: true, faces: ['a'] }), proceduralNeedsOneFace({ faces: [] })]).toEqual([true, true, false, false]);
  });
  it('along: the sketch direction, the nearest point of the face, or a direction', () => {
    expect([projectAlongOf({}), projectAlongOf({ along: 'normal' }), projectAlongOf({ along: [0, 0, -1] }), projectAlongOf({ along: 'sideways' })]).toEqual(['sketch', 'normal', 'vector', 'sketch']);
    expect(patchAlong({}, 'normal')).toEqual({ along: 'normal' });
    expect(patchAlong({}, 'sketch')).toEqual({ along: null });
    expect(patchAlong({}, 'vector')).toEqual({ along: [0, 0, -1] });
    expect(patchAlong({ along: [1, 0, 0] }, 'vector')).toEqual({ along: [1, 0, 0] });
    expect(alongPatch({ along: [1, 2, 3] }, 1, 9)).toEqual({ along: [1, 9, 3] });
  });
});

describe('offset curve rules', () => {
  it('where the offset runs follows the field that is set; the other fields go on a change', () => {
    expect([offsetInOf({}), offsetInOf({ plane: { kind: 'std', id: 'top' } }), offsetInOf({ face: 'F2.C1' }), offsetInOf({ face: '' }), offsetInOf({ normal: [0, 0, 1] })]).toEqual(['auto', 'plane', 'face', 'face', 'normal']);
    expect(patchOffsetIn({ face: 'F2.C1' }, 'auto')).toEqual({ plane: null, face: null, normal: null });
    expect(patchOffsetIn({}, 'plane')).toEqual({ plane: { kind: 'std', id: 'front' }, face: null, normal: null });
    expect(patchOffsetIn({ plane: { kind: 'feature', id: 'P1' } }, 'plane').plane).toEqual({ kind: 'feature', id: 'P1' });
    expect(patchOffsetIn({}, 'face')).toEqual({ plane: null, face: '', normal: null });
    expect(patchOffsetIn({}, 'normal')).toEqual({ plane: null, face: null, normal: [0, 0, 1] });
    expect(normalPatch({ normal: [1, 2, 3] }, 2, 9)).toEqual({ normal: [1, 2, 9] });
  });
  it('a zero distance and an empty face are flagged before the kernel refuses them', () => {
    expect([distanceIsZero(0), distanceIsZero(5), distanceIsZero('=a')]).toEqual([true, false, false]);
    expect([offsetNeedsFace({ face: '' }), offsetNeedsFace({ face: 'F2.C1' }), offsetNeedsFace({})]).toEqual([true, false, false]);
  });
  it('curves listed win over the source', () => {
    expect([hasCurveList({}), hasCurveList({ curves: [] }), hasCurveList({ curves: [{ kind: 'curve', id: 'E1' }] })]).toEqual([false, false, true]);
    expect(OFFSET_DEFAULTS).toEqual({ distance: 5, tolerance: 0.001 });
    expect(COMPOSITE_DEFAULTS).toEqual({ tolerance: 0.001 });
  });
  it('a curve source may be any earlier curve feature, a helix only for these two', () => {
    const doc = { features: [line('S1'), { type: 'helix', id: 'H1' }, { type: 'offsetCurve', id: 'O1', sketch: 'S1', distance: 1 }, { type: 'compositeCurve', id: 'C1', sketch: 'S1' }] } as unknown as PartDoc;
    expect(sourceChoices(doc, 'F9', {}).map(([v]) => v)).toEqual(['sketch:S1', 'curve:O1', 'curve:C1']);
    expect(sourceChoices(doc, 'F9', {}, true).map(([v]) => v)).toEqual(['sketch:S1', 'curve:H1', 'curve:O1', 'curve:C1']);
    expect(sourceChoices(doc, 'O1', {}, true).map(([v]) => v)).toEqual(['sketch:S1', 'curve:H1']);
  });
});

describe('edit curve rules', () => {
  it('method switches carry the field the other method does not read', () => {
    expect(methodOf({})).toBe('count');
    expect(patchMethod({ degree: 3 }, 'tolerance')).toEqual({ method: 'tolerance', count: null, tolerance: 0.01 });
    expect(patchMethod({ degree: 3, tolerance: 0.5 }, 'count')).toEqual({ method: null, tolerance: null, count: 4 });
  });
  it('keep ends is on unless it says false; planar needs a plane', () => {
    expect([keepEndsOn({}), keepEndsOn({ keepEnds: false })]).toEqual([true, false]);
    expect([keepEndsPatch(true), keepEndsPatch(false)]).toEqual([{ keepEnds: null }, { keepEnds: false }]);
    expect(planarPatch({}, true)).toEqual({ planar: true, plane: { kind: 'std', id: 'front' } });
    expect(planarPatch({ plane: { kind: 'feature', id: 'P1' } }, true)).toEqual({ planar: true, plane: { kind: 'feature', id: 'P1' } });
    expect(planarPatch({ planar: true }, false)).toEqual({ planar: null, plane: null });
  });
  it('names curves in words and lists what can still be added', () => {
    expect(curveRefLabel(DOC, { kind: 'sketchCurve', sketch: 'S1', entity: 'l1' })).toBe('Curve l1 of SS1 (S1)');
    expect(curveRefLabel(DOC, { kind: 'edge', faces: ['F2.C1', 'F2.S.e1'] })).toBe('Edge F2.C1 | F2.S.e1');
    expect(curveRefLabel(DOC, { kind: 'curve', id: 'E1' })).toContain('E1');
    const have = [{ kind: 'sketchCurve', sketch: 'S1', entity: 'l1' }];
    expect(addableCurves(DOC, 'F9', have).map((r) => (r.kind === 'curve' ? `curve:${r.id}` : `${r.sketch}.${r.entity}`))).toEqual(['S1.l2', 'S2.l1', 'S2.l2', 'curve:E1']);
    expect(addableCurves(DOC, 'S2', have).map((r) => String(r.sketch ?? r.id))).toEqual(['S1']);
  });
  it('moving a row to another sketch takes that sketch\'s first curve', () => {
    const refs = [{ kind: 'sketchCurve', sketch: 'S1', entity: 'l2' }];
    expect(retargetSketchCurve(DOC, refs, 0, { sketch: 'S2' })).toEqual([{ kind: 'sketchCurve', sketch: 'S2', entity: 'l1' }]);
    expect(retargetSketchCurve(DOC, refs, 0, { entity: 'l1' })).toEqual([{ kind: 'sketchCurve', sketch: 'S1', entity: 'l1' }]);
  });
  it('control point edits: next point, patches drop nulls, an empty list removes the field', () => {
    expect(newEntry([])).toEqual({ cv: 0, dx: 0, dy: 0, dz: 0 });
    expect(newEntry([{ cv: 3 }])).toMatchObject({ cv: 4 });
    expect(patchEntry([{ cv: 1, disabled: true }], 0, { disabled: null, dx: 2 })).toEqual([{ cv: 1, dx: 2 }]);
    expect(entriesPatch([])).toEqual({ entries: null });
  });
});

describe('freeform rules', () => {
  it('the net has spans + degree points each way', () => {
    expect(netSize({})).toEqual([5, 5]);
    expect(netSize({ degreeU: 2, spansU: 4, degreeV: 3, spansV: 1 })).toEqual([6, 4]);
  });
  it('parses and prints point lists', () => {
    expect(parsePoints('2,2; 3, 4')).toEqual([[2, 2], [3, 4]]);
    expect(parsePoints('(1 2)|(5,6)')).toEqual([[1, 2], [5, 6]]);
    expect(parsePoints('2,x')).toBeNull();
    expect(parsePoints('-1,2')).toBeNull();
    expect(pointsText([[2, 2], [3, 4]])).toBe('2,2; 3,4');
  });
  it('a new move starts at the middle of the net, in the face frame; the frame patch carries a plane only for plane', () => {
    expect(newEdit({})).toEqual({ points: [[2, 2]], frame: 'surface', dx: 0, dy: 0, dz: 0 });
    expect(patchFrame({}, 'plane')).toEqual({ frame: 'plane', plane: { kind: 'std', id: 'front' } });
    expect(patchFrame({ plane: { kind: 'std', id: 'top' } }, 'world')).toEqual({ frame: null, plane: null });
    expect(frameOf({ frame: 'surface' })).toBe('surface');
    expect(frameOf({})).toBe('world');
  });
  it('moves need exactly one face', () => {
    expect(editsNeedOneFace({ faces: ['a', 'b'], edits: [{}] })).toBe(true);
    expect(editsNeedOneFace({ faces: ['a'], edits: [{}] })).toBe(false);
    expect(editsNeedOneFace({ faces: ['a', 'b'], edits: [] })).toBe(false);
  });
});

describe('creators', () => {
  it('Project curve: the selected sketch, else the last with a curve; picked faces; a selected curve feature', () => {
    expect(added(projectCurveOps(ctx()))).toEqual({ type: 'projectCurve', sketch: 'S2', faces: [], degree: 3, tolerance: 0.001, direction: 'both' });
    expect(added(projectCurveOps(ctx({ selectedId: 'S1', selection: ['F3.C1'] })))).toMatchObject({ sketch: 'S1', faces: ['F3.C1'] });
    expect(added(projectCurveOps(ctx({ selectedId: 'E1' })))).toMatchObject({ curve: 'E1' });
    expect(projectCurveOps(ctx({ doc: { features: [] } as never }))).toBeNull();
  });
  it('Edit curve: picked edges, else a selected curve feature, else the sketch\'s curves, else the last curve feature', () => {
    const edges = [{ key: 'k1', faces: ['F2.C1', 'F2.S.e1'], mid: [1, 2, 3], pts: [[0, 0, 0], [2, 4, 6]] }];
    expect(added(editCurveOps(ctx({ mode: 'edge', selection: ['k1'], edges })))).toMatchObject({ type: 'editCurve', curves: [{ kind: 'edge', faces: ['F2.C1', 'F2.S.e1'], at: [1, 2, 3] }], method: 'tolerance', degree: 3, tolerance: 0.01, keepEnds: true, keepCorners: true });
    expect(added(editCurveOps(ctx({ selectedId: 'E1' }))).curves).toEqual([{ kind: 'curve', id: 'E1' }]);
    expect(added(editCurveOps(ctx({ selectedId: 'S1' }))).curves).toEqual([{ kind: 'sketchCurve', sketch: 'S1', entity: 'l1' }, { kind: 'sketchCurve', sketch: 'S1', entity: 'l2' }]);
    const onlyCurve = { features: [DOC.features[2]] } as unknown as PartDoc;
    expect(added(editCurveOps(ctx({ doc: onlyCurve }))).curves).toEqual([{ kind: 'curve', id: 'E1' }]);
    expect(editCurveOps(ctx({ doc: { features: [] } as never }))).toBeNull();
  });
  it('Offset curve: picked edges in order, else a selected curve feature, else the selected or last sketch', () => {
    const edges = [{ key: 'k1', faces: ['F2.C1', 'F2.S.e1'], mid: [1, 2, 3], pts: [[0, 0, 0], [2, 4, 6]] }];
    expect(added(offsetCurveOps(ctx({ mode: 'edge', selection: ['k1'], edges })))).toEqual({ type: 'offsetCurve', curves: [{ kind: 'edge', faces: ['F2.C1', 'F2.S.e1'], at: [1, 2, 3] }], distance: 5, tolerance: 0.001 });
    expect(added(offsetCurveOps(ctx({ selectedId: 'E1' })))).toEqual({ type: 'offsetCurve', curve: 'E1', distance: 5, tolerance: 0.001 });
    expect(added(offsetCurveOps(ctx({ selectedId: 'S1' })))).toMatchObject({ sketch: 'S1' });
    expect(added(offsetCurveOps(ctx()))).toMatchObject({ sketch: 'S2' });
    expect(offsetCurveOps(ctx({ doc: { features: [] } as never }))).toBeNull();
  });
  it('Composite curve: the same sources, no distance', () => {
    expect(added(compositeCurveOps(ctx({ selectedId: 'S1' })))).toEqual({ type: 'compositeCurve', sketch: 'S1', tolerance: 0.001 });
    expect(added(compositeCurveOps(ctx({ selectedId: 'E1' })))).toMatchObject({ curve: 'E1' });
    expect(compositeCurveOps(ctx({ doc: { features: [] } as never }))).toBeNull();
  });
  it('a face field takes the first picked face, not an edge', () => {
    expect(pickValue('face', ['F2.C1', 'F2.C0'], [])).toBe('F2.C1');
    expect(pickValue('face', [], [])).toBeNull();
  });
  it('Freeform: needs picked faces; rebuilds them as a cubic 2 x 2 spans net with no moves', () => {
    expect(freeformOps(ctx())).toBeNull();
    expect(added(freeformOps(ctx({ selection: ['F2.C1'] })))).toEqual({ type: 'freeform', faces: ['F2.C1'], degreeU: 3, degreeV: 3, spansU: 2, spansV: 2, edits: [] });
  });
  it('the commands are enabled by their rules and sit on the toolbars', () => {
    const en = (id: string, c: Ctx) => CREATORS.find((k) => k.id === id)!.enabled(c);
    expect(en('add-project-curve', ctx())).toBe(true);
    expect(en('add-project-curve', ctx({ box: null }))).toBe(false);   // nothing to project onto
    expect(en('add-edit-curve', ctx({ box: null }))).toBe(true);
    expect(en('add-freeform', ctx())).toBe(false);
    expect(en('add-freeform', ctx({ selection: ['F2.C1'] }))).toBe(true);
    expect(en('add-offset-curve', ctx())).toBe(true);
    expect(en('add-composite-curve', ctx())).toBe(true);
    expect(en('add-offset-curve', ctx({ doc: { features: [] } as never }))).toBe(false);
    expect(SLOTS.reference).toEqual(expect.arrayContaining(['add-project-curve', 'add-edit-curve', 'add-offset-curve', 'add-composite-curve']));
    expect(SLOTS['surface-edit']).toContain('add-freeform');
  });
});

function mount(feature: Wire, doc: PartDoc = DOC) {
  const drafts: Wire[] = [];
  const r = render(<FeatureEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} onPickRequest={() => {}} options={(a) => optionsFor(a, doc)} />);
  const q = (s: string) => r.container.querySelector(s) as HTMLElement | null;
  return { ...r, drafts, q };
}
const change = (el: Element, value: string) => { fireEvent.input(el, { target: { value } }); fireEvent.change(el, { target: { value } }); fireEvent.blur(el); };

describe('Project curve form', () => {
  it('draws the source, faces, direction, degree and tolerance, and switches the source', () => {
    const m = mount({ type: 'projectCurve', id: 'F9', sketch: 'S1', faces: [], degree: 3, tolerance: 0.001, direction: 'both' });
    for (const p of ['source', 'faces', 'direction', 'degree', 'tolerance']) expect(m.q(`[data-path="${p}"]`), p).not.toBeNull();
    expect(m.q('[data-note="allFaces"]')).not.toBeNull();
    const sel = m.q('[data-path="source"] select') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['sketch:S1', 'sketch:S2', 'curve:E1']);
    change(sel, 'curve:E1');
    expect(m.drafts.at(-1)).toMatchObject({ curve: 'E1', sketch: null });
    change(m.q('[data-path="direction"] select')!, 'forward');
    expect(m.drafts.at(-1)).toMatchObject({ direction: 'forward' });
  });
  it('lists picked faces and warns about a degree outside 2 to 9', () => {
    const m = mount({ type: 'projectCurve', id: 'F9', sketch: 'S1', faces: ['F2.C1', 'F2.S.e1'], degree: 12 });
    expect((m.q('[data-path="faces"] input') as HTMLInputElement).value).toBe('F2.C1, F2.S.e1');
    expect(m.q('[data-note="allFaces"]')).toBeNull();
    expect(m.q('[data-note="degree"]')?.textContent).toContain('between 2 and 9');
  });
});

describe('Project curve form: keep exact (procedural)', () => {
  const base = { type: 'projectCurve', id: 'F9', sketch: 'S1', faces: ['F2.C1'], degree: 3, tolerance: 0.001, direction: 'both' };
  it('the toggle swaps the spline fields (degree, direction) for the exact ones (along, gap tolerance)', () => {
    const m = mount(base);
    expect(m.q('[data-path="procedural"] input')).not.toBeNull();
    expect(m.q('[data-path="degree"]')).not.toBeNull();
    expect(m.q('[data-path="along"]')).toBeNull();
    fireEvent.click(m.q('[data-path="procedural"] input')!);
    expect(m.drafts.at(-1)).toMatchObject({ procedural: true });
    const on = mount({ ...base, procedural: true });
    for (const p of ['along', 'gapTolerance', 'tolerance']) expect(on.q(`[data-path="${p}"]`), p).not.toBeNull();
    for (const p of ['degree', 'direction']) expect(on.q(`[data-path="${p}"]`), p).toBeNull();
    expect(on.q('[data-note="allFaces"]')).toBeNull();
    expect(on.q('[data-note="oneFace"]')).toBeNull();
    fireEvent.click(on.q('[data-path="procedural"] input')!);
    expect(on.drafts.at(-1)).toMatchObject({ procedural: null, along: null, gapTolerance: null, curves: null });
  });
  it('the spline projection takes one sketch or curve: no curve list', () => {
    const m = mount(base);
    expect(m.q('[data-path="source"]')).not.toBeNull();
    expect(m.q('[data-path="curves"]')).toBeNull();
  });
  it('keep exact takes several curves in chain order: adding starts the list and hides the source, the next add appends, removing the last brings the source back', () => {
    const on = mount({ ...base, procedural: true });
    expect(on.q('[data-path="source"]')).not.toBeNull();
    const sel = on.q('[data-path="source"] select') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['sketch:S1', 'sketch:S2', 'curve:E1']);
    fireEvent.click(on.q('[data-path="curves"] [data-act="add"]')!);
    expect((on.drafts.at(-1) as Wire).curves).toEqual([{ kind: 'sketchCurve', sketch: 'S1', entity: 'l1' }]);
    const one = [{ kind: 'sketchCurve', sketch: 'S1', entity: 'l1' }];
    const listed = mount({ ...base, procedural: true, sketch: null, curves: one });
    expect(listed.q('[data-path="source"]')).toBeNull();
    expect(listed.q('[data-path="curves.0"]')).not.toBeNull();
    fireEvent.click(listed.q('[data-path="curves"] [data-act="add"]')!);
    expect((listed.drafts.at(-1) as Wire).curves).toEqual([...one, { kind: 'sketchCurve', sketch: 'S1', entity: 'l2' }]);
    // a curve feature can be listed too (it enters as its definition, or a spline through its points)
    const two = mount({ ...base, procedural: true, sketch: null, curves: [one[0], { kind: 'curve', id: 'E1' }] });
    expect(two.q('[data-path="curves.1"]')?.textContent).toContain('E1');
    const again = mount({ ...base, procedural: true, sketch: null, curves: one });
    fireEvent.click(again.q('[data-path="curves"] [data-act="remove"]')!);
    expect((again.drafts.at(-1) as Wire).curves).toEqual([]);
    // the other exact fields stay as they are
    for (const p of ['along', 'gapTolerance', 'tolerance', 'faces']) expect(again.q(`[data-path="${p}"]`), p).not.toBeNull();
  });
  it('warns when it is not exactly one face', () => {
    expect(mount({ ...base, procedural: true, faces: [] }).q('[data-note="oneFace"]')).not.toBeNull();
    expect(mount({ ...base, procedural: true, faces: ['a', 'b'] }).q('[data-note="oneFace"]')).not.toBeNull();
  });
  it('along: nearest point of the face, or a direction with its three numbers', () => {
    const m = mount({ ...base, procedural: true });
    change(m.q('[data-path="along"] select')!, 'normal');
    expect(m.drafts.at(-1)).toMatchObject({ along: 'normal' });
    change(m.q('[data-path="along"] select')!, 'vector');
    expect(m.drafts.at(-1)).toMatchObject({ along: [0, 0, -1] });
    const v = mount({ ...base, procedural: true, along: [0, 0, -1] });
    for (const i of [0, 1, 2]) expect(v.q(`[data-path="along.${i}"]`)).not.toBeNull();
  });
});

describe('Offset curve form', () => {
  const feat = { type: 'offsetCurve', id: 'F9', sketch: 'S1', distance: 5, tolerance: 0.001 };
  it('draws the source, distance, offset-in choice and tolerances; a sketch is the source until curves are listed', () => {
    const m = mount(feat);
    for (const p of ['source', 'curves', 'distance', 'offsetIn', 'tolerance', 'gapTolerance']) expect(m.q(`[data-path="${p}"]`), p).not.toBeNull();
    expect(m.q('[data-path="plane"]')).toBeNull();
    expect(m.q('[data-path="face"]')).toBeNull();
    const sel = m.q('[data-path="source"] select') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['sketch:S1', 'sketch:S2', 'curve:E1']);
    change(sel, 'curve:E1');
    expect(m.drafts.at(-1)).toMatchObject({ curve: 'E1', sketch: null });
  });
  it('adding a curve starts the list and hides the source; removing the last brings the source back', () => {
    const m = mount(feat);
    fireEvent.click(m.q('[data-path="curves"] [data-act="add"]')!);
    expect((m.drafts.at(-1) as Wire).curves).toEqual([{ kind: 'sketchCurve', sketch: 'S1', entity: 'l1' }]);
    const listed = mount({ ...feat, sketch: null, curves: [{ kind: 'sketchCurve', sketch: 'S1', entity: 'l1' }] });
    expect(listed.q('[data-path="source"]')).toBeNull();
    fireEvent.click(listed.q('[data-path="curves"] [data-act="remove"]')!);
    expect((listed.drafts.at(-1) as Wire).curves).toEqual([]);
  });
  it('the offset-in choice shows a plane, a face (with a Pick button) or a normal, and clears the others', () => {
    const m = mount(feat);
    change(m.q('[data-path="offsetIn"] select')!, 'plane');
    expect(m.drafts.at(-1)).toMatchObject({ plane: { kind: 'std', id: 'front' }, face: null, normal: null });
    const p = mount({ ...feat, plane: { kind: 'std', id: 'top' } });
    expect(p.q('[data-path="plane"]')).not.toBeNull();
    change(p.q('[data-path="plane"] select')!, 'feature:P1');
    expect(p.drafts.at(-1)).toMatchObject({ plane: { kind: 'feature', id: 'P1' } });
    const f = mount({ ...feat, face: '' });
    expect(f.q('[data-path="face"] button.fedit-pick')).not.toBeNull();
    expect(f.q('[data-note="needFace"]')).not.toBeNull();
    expect(mount({ ...feat, face: 'F2.C1' }).q('[data-note="needFace"]')).toBeNull();
    const n = mount({ ...feat, normal: [0, 0, 1] });
    for (const i of [0, 1, 2]) expect(n.q(`[data-path="normal.${i}"]`)).not.toBeNull();
    change(n.q('[data-path="offsetIn"] select')!, 'auto');
    expect(n.drafts.at(-1)).toMatchObject({ plane: null, face: null, normal: null });
  });
  it('a distance of 0 is flagged', () => {
    expect(mount({ ...feat, distance: 0 }).q('[data-note="distance"]')).not.toBeNull();
    expect(mount(feat).q('[data-note="distance"]')).toBeNull();
  });
});

describe('Composite curve form', () => {
  it('draws the source, the curve list and the two tolerances', () => {
    const m = mount({ type: 'compositeCurve', id: 'F9', sketch: 'S1', tolerance: 0.001 });
    for (const p of ['source', 'curves', 'gapTolerance', 'tolerance']) expect(m.q(`[data-path="${p}"]`), p).not.toBeNull();
    for (const p of ['distance', 'offsetIn']) expect(m.q(`[data-path="${p}"]`), p).toBeNull();
    change(m.q('[data-path="source"] select')!, 'sketch:S2');
    expect(m.drafts.at(-1)).toMatchObject({ sketch: 'S2', curve: null });
  });
});

describe('Edit curve form', () => {
  const feat = { type: 'editCurve', id: 'F9', curves: [{ kind: 'sketchCurve', sketch: 'S1', entity: 'l1' }, { kind: 'edge', faces: ['A', 'B'], at: [0, 0, 0] }], method: 'count', degree: 3, count: 6, keepEnds: true };
  it('lists the curves, removes one and adds the next free one', () => {
    const m = mount(feat);
    const rows = () => [...m.container.querySelectorAll('[data-path="curves"] .fedit-order-row')];
    expect(rows()).toHaveLength(2);
    expect(rows()[1].textContent).toContain('Edge A | B');
    fireEvent.click(rows()[1].querySelector('[data-act="remove"]')!);
    expect((m.drafts.at(-1) as Wire).curves).toEqual([feat.curves[0]]);
    fireEvent.click(m.q('[data-path="curves"] [data-act="add"]')!);
    expect(((m.drafts.at(-1) as Wire).curves as Wire[]).at(-1)).toEqual({ kind: 'sketchCurve', sketch: 'S1', entity: 'l2' });
  });
  it('the fit controls follow the method; keep ends unticks to false; planar shows the plane', () => {
    const m = mount(feat);
    expect(m.q('[data-path="count"]')).not.toBeNull();
    expect(m.q('[data-path="tolerance"]')).toBeNull();
    change(m.q('[data-path="method"] select')!, 'tolerance');
    expect(m.drafts.at(-1)).toMatchObject({ method: 'tolerance', tolerance: 0.01 });
    fireEvent.click(m.q('[data-path="keepEnds"] input')!);
    expect(m.drafts.at(-1)).toMatchObject({ keepEnds: false });
    expect(m.q('[data-path="plane"]')).toBeNull();
    fireEvent.click(m.q('[data-path="planar"] input')!);
    expect(m.drafts.at(-1)).toMatchObject({ planar: true, plane: { kind: 'std', id: 'front' } });
  });
  it('adds a control point edit and removes it again', () => {
    const m = mount({ ...feat, entries: [{ cv: 2, dx: 1, dy: 0, dz: 0 }] });
    expect(m.container.querySelectorAll('[data-path="entries"] .fedit-edit')).toHaveLength(1);
    fireEvent.click(m.q('[data-path="entries"] [data-act="add-edit"]')!);
    expect((m.drafts.at(-1) as Wire).entries).toEqual([{ cv: 2, dx: 1, dy: 0, dz: 0 }, { cv: 3, dx: 0, dy: 0, dz: 0 }]);
    fireEvent.click(m.container.querySelector('[data-path="entries"] .fedit-edit [data-act="remove"]')!);
    expect((m.drafts.at(-1) as Wire).entries).toEqual([{ cv: 3, dx: 0, dy: 0, dz: 0 }]);
  });
});

describe('Freeform form', () => {
  const feat = { type: 'freeform', id: 'F9', faces: ['F2.C1'], degreeU: 3, degreeV: 3, spansU: 2, spansV: 2, edits: [] };
  it('shows the net size, adds a move at the middle point and parses typed points', () => {
    const m = mount(feat);
    expect(m.q('[data-note="net"]')?.textContent).toContain('5 x 5');
    expect(m.q('[data-note="oneFace"]')).toBeNull();
    fireEvent.click(m.q('[data-path="edits"] [data-act="add-edit"]')!);
    expect((m.drafts.at(-1) as Wire).edits).toEqual([{ points: [[2, 2]], frame: 'surface', dx: 0, dy: 0, dz: 0 }]);
    const m2 = mount({ ...feat, edits: [{ points: [[2, 2]], dy: 2 }] });
    change(m2.container.querySelector('[data-path="edits.0.points"] input')!, '1,1; 3,3');
    expect((m2.drafts.at(-1) as Wire).edits).toEqual([{ points: [[1, 1], [3, 3]], dy: 2 }]);
    change(m2.container.querySelector('[data-path="edits.0.frame"] select')!, 'plane');
    expect(((m2.drafts.at(-1) as Wire).edits as Wire[])[0]).toMatchObject({ frame: 'plane', plane: { kind: 'std', id: 'front' } });
  });
  it('warns when moves are set on more than one face', () => {
    const m = mount({ ...feat, faces: ['F2.C1', 'F2.C0'], edits: [{ points: [[2, 2]] }] });
    expect(m.q('[data-note="oneFace"]')).not.toBeNull();
  });
});

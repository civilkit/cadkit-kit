import { describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { afterEach } from 'vitest';
import { FeatureEditor } from '@kit/ui';
import type { PartDoc } from '@ck/part-model';
import { optionsFor } from './FeatureOptions';
import { guidesPatch, loftGuides, loftProfiles, move, nextFree, sweepGuides, sweepGuidesPatch, tensionOf, tensionPatch, toggleKnit, sketchInfos, surfaceInfos } from './surfaceRules';
import { boundaryLoop, boundaryRefs, knitOps, openEdgesOf, thickenOps, trimSurfaceOps } from './featureCreators';
import { pickValue, type ViewEdge } from './featureCommands';
import './i18n';

afterEach(cleanup);
type Wire = Record<string, unknown>;

const sk = (id: string, closed: boolean): Wire => closed
  ? { type: 'sketch', id, name: 'S' + id, points: [{ id: 'c' }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 1 }] }
  : { type: 'sketch', id, name: 'S' + id, points: [{ id: 'a' }, { id: 'b' }], entities: [{ id: 'l0', type: 'line', p1: 'a', p2: 'b' }] };
const DOC = { features: [sk('A', true), sk('B', true), sk('C', true), sk('G', false), { type: 'surfaceExtrude', id: 'W', sketch: 'A' }, { type: 'loft', id: 'L', sketches: ['A', 'B'], surface: true }] } as unknown as PartDoc;

describe('surface rules', () => {
  it('lists sketches by kind and surfaces by feature', () => {
    expect(sketchInfos(DOC).map((s) => [s.id, s.closed, s.open])).toEqual([['A', true, false], ['B', true, false], ['C', true, false], ['G', false, true]]);
    expect(surfaceInfos(DOC).map((s) => s.id)).toEqual(['W', 'L']);
    expect(surfaceInfos(DOC, 'W').map((s) => s.id)).toEqual(['L']);
  });
  it('moves, finds the next free item, and keeps at least one knit surface', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(nextFree(['a', 'b', 'c'], ['a', 'c'])).toBe('b');
    expect(toggleKnit(['a', 'b', 'c'], ['a'], 'a')).toEqual(['a']);
    expect(toggleKnit(['a', 'b', 'c'], ['c'], 'a')).toEqual(['a', 'c']);
  });
  it('reads and writes guides and tension in the kernel wire forms', () => {
    expect(loftGuides({ guides: ['G', { sketch: 'H' }] })).toEqual(['G', 'H']);
    expect(guidesPatch(['G'])).toEqual({ guides: [{ sketch: 'G' }] });
    expect(guidesPatch([])).toEqual({ guides: null });
    expect(tensionOf({ startNormal: true }, 'startNormal')).toBe(1);
    expect(tensionPatch('endNormal', 0)).toEqual({ endNormal: null });
    expect(sweepGuidesPatch([{ sketch: 'G', entity: 'l0' }])).toEqual({ guides: [{ kind: 'sketchCurve', sketch: 'G', entity: 'l0' }], twist: null });
    expect(sweepGuides({ guides: [{ kind: 'sketchCurve', sketch: 'G', entity: 'l0' }, { kind: 'edge' }] })).toEqual([{ sketch: 'G', entity: 'l0' }]);
    expect(loftProfiles({ sketches: ['A', 3, 'B'] })).toEqual(['A', 'B']);
  });
});

describe('surface edges', () => {
  const E = (key: string, faces: string[], a: number[], b: number[]): ViewEdge => ({ key, faces, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], pts: [a, b] });
  const edges = [E('W.P#0', ['W.P'], [0, 0, 0], [1, 0, 0]), E('W.P#1', ['W.P'], [1, 0, 0], [1, 1, 0]), E('W.P#2', ['W.P'], [5, 5, 0], [6, 5, 0]), E('S.1#0', ['S.1', 'S.2'], [0, 0, 0], [0, 0, 1])];
  it('open border edges have one face and belong to one surface', () => {
    expect(openEdgesOf('W', edges).map((e) => e.key)).toEqual(['W.P#0', 'W.P#1', 'W.P#2']);
    expect(openEdgesOf('X', edges)).toEqual([]);
  });
  it('a loop is the border chained end to end from the first edge', () => {
    expect(boundaryLoop(openEdgesOf('W', edges)).map((e) => e.key)).toEqual(['W.P#0', 'W.P#1']);
  });
  it('edge references take one face for a border edge and two for an inner edge', () => {
    expect(boundaryRefs(['W.P#0', 'S.1#0', 'nope'], edges)).toEqual([{ faces: ['W.P'], at: [0.5, 0, 0] }, { faces: ['S.1', 'S.2'], at: [0, 0, 0.5] }]);
    expect(pickValue('edges', ['W.P#1'], edges)).toEqual([{ faces: ['W.P'], at: [1, 0.5, 0] }]);
  });
});

function mount(feature: Wire) {
  const drafts: Wire[] = [];
  const r = render(<FeatureEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} onPickRequest={() => {}} options={(a) => optionsFor(a, DOC)} />);
  const q = (s: string) => r.container.querySelector(s) as HTMLElement | null;
  return { ...r, drafts, q };
}

describe('surface editors', () => {
  it('loft: profile rows reorder, add and remove', () => {
    const m = mount({ type: 'loft', id: 'L9', op: 'add', sketches: ['A', 'B'] });
    const rows = () => [...m.container.querySelectorAll('[data-path="sketches"] .fedit-order-row')];
    expect(rows()).toHaveLength(2);
    fireEvent.click(rows()[0].querySelector('[data-act="down"]')!);
    expect(m.drafts.at(-1)).toMatchObject({ sketches: ['B', 'A'] });
    fireEvent.click(m.q('[data-path="sketches"] [data-act="add"]')!);
    expect((m.drafts.at(-1) as Wire).sketches).toEqual(['B', 'A', 'C']);
  });
  it('loft: the last two profiles cannot be removed, a third can', () => {
    const m = mount({ type: 'loft', id: 'L9', sketches: ['A', 'B', 'C'] });
    const rm = () => [...m.container.querySelectorAll<HTMLButtonElement>('[data-path="sketches"] [data-act="remove"]')];
    expect(rm().every((b) => !b.disabled)).toBe(true);
    fireEvent.click(rm()[1]);
    expect(m.drafts.at(-1)).toMatchObject({ sketches: ['A', 'C'] });
  });
  it('loft: the guide list offers open sketches and writes {sketch} entries; surface hides the operation', () => {
    const m = mount({ type: 'loft', id: 'L9', sketches: ['A', 'B'] });
    fireEvent.click(m.q('[data-path="guides"] [data-act="add"]')!);
    expect(m.drafts.at(-1)).toMatchObject({ guides: [{ sketch: 'G' }] });
    expect(m.q('[data-path="op"]')).not.toBeNull();
    const s = mount({ type: 'loft', id: 'L9', sketches: ['A', 'B'], surface: true });
    expect(s.container.querySelector('[data-path="op"]')).toBeNull();
  });
  it('sweep: profile and path drop-downs; picking a path writes the reference object', () => {
    const m = mount({ type: 'sweep', id: 'S9', op: 'add', sketch: 'A', path: { kind: 'sketch', id: 'G' } });
    const path = m.q('[data-path="path"] select') as HTMLSelectElement;
    expect(path.value).toBe('G');
    expect([...(m.q('[data-path="sketch"] select') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['A', 'B', 'C']);
    fireEvent.change(m.q('[data-path="sketch"] select')!, { target: { value: 'B' } });
    expect(m.drafts.at(-1)).toMatchObject({ sketch: 'B' });
  });
  it('fill: continuity and fairing', () => {
    const m = mount({ type: 'fill', id: 'F9', edges: [], continuity: 'G0', merge: true });
    fireEvent.change(m.q('[data-path="continuity"] select')!, { target: { value: 'G2' } });
    expect(m.drafts.at(-1)).toMatchObject({ continuity: 'G2' });
    fireEvent.change(m.q('[data-path="fairing"] select')!, { target: { value: 'plate' } });
    expect(m.drafts.at(-1)).toMatchObject({ fairing: 'plate' });
  });
  it('knit: one check per surface body, the knit itself excluded', () => {
    const m = mount({ type: 'knit', id: 'K9', surfaces: ['W'], solid: false });
    expect([...m.container.querySelectorAll('[data-path^="surfaces."]')].map((x) => x.getAttribute('data-path'))).toEqual(['surfaces.W', 'surfaces.L']);
    fireEvent.click(m.q('[data-path="surfaces.L"] input')!);
    expect((m.drafts.at(-1) as Wire).surfaces).toEqual(['W', 'L']);
  });
  it('trim: a tool surface replaces the plane', () => {
    const m = mount({ type: 'trimSurface', id: 'T9', surface: 'W', plane: { kind: 'face', id: 'F1' } });
    fireEvent.change(m.q('[data-path="toolSurface"] select')!, { target: { value: 'L' } });
    expect(m.drafts.at(-1)).toMatchObject({ toolSurface: 'L', plane: null });
  });
});

describe('selection to feature', () => {
  const doc = { features: [{ type: 'plane', id: 'P1' }, { type: 'surfacePlanar', id: 'SP', sketch: 'x' }, { type: 'surfaceExtrude', id: 'W', sketch: 'y' }, { type: 'extrude', id: 'E', sketch: 'z' }] } as unknown as PartDoc;
  const ctx = (selection: string[], selectedId: string | null = null, mode = 'face') => ({ doc, selection, mode, box: { min: [0, 0, 0], max: [10, 10, 10] }, edges: [] as ViewEdge[], selectedId });
  it('faces of two surfaces: the first is trimmed by the second', () => {
    expect(trimSurfaceOps(ctx(['SP.P', 'W.S.k1']))).toEqual([{ op: 'add', feature: { type: 'trimSurface', surface: 'SP', mutual: false, flip: false, toolSurface: 'W' } }]);
  });
  it('a surface face and a solid face: the solid face plane trims the surface', () => {
    expect(trimSurfaceOps(ctx(['W.S.k1', 'E.C1']))).toEqual([{ op: 'add', feature: { type: 'trimSurface', surface: 'W', mutual: false, flip: false, plane: { kind: 'face', id: 'E.C1' } } }]);
  });
  it('knit joins the picked surfaces, else the tree one, else all', () => {
    const ids = (c: ReturnType<typeof ctx>) => ((knitOps(c) as unknown as Array<{ feature: { surfaces: string[] } }>)[0].feature.surfaces);
    expect(ids(ctx(['W.S.k1', 'SP.P']))).toEqual(['W', 'SP']);
    expect(ids(ctx([], 'SP'))).toEqual(['SP']);
    expect(ids(ctx([]))).toEqual(['SP', 'W']);
  });
  it('thicken starts from the surface a picked face belongs to', () => {
    expect((thickenOps(ctx(['SP.P'])) as unknown as Array<{ feature: { surface: string } }>)[0].feature.surface).toBe('SP');
  });
});

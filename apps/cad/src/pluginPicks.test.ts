import { describe, expect, it } from 'vitest';
import { checkDefs, checkValue, type ParamDef } from '@kit/plugin';
import { addPick, clearPicks, designChanged, docSketches, mergeViewPicks, pickPlan, profileItem, sketchItem } from './pluginPicks';
import { pluginDocContext, selectionItems } from './pluginDoc';
import type { BodyRow } from './bodies';

describe('what a selection field picks with, from the kinds it declares', () => {
  it('bodies, faces and edges are picked in the view, in the matching pick mode when the field takes one kind of them', () => {
    expect(pickPlan(['edge'])).toEqual({ mode: 'edge', view: true, tree: false, regions: false });
    expect(pickPlan(['face'])).toEqual({ mode: 'face', view: true, tree: false, regions: false });
    expect(pickPlan(['body'])).toEqual({ mode: 'body', view: true, tree: false, regions: false });
    expect(pickPlan(['face', 'edge'])).toEqual({ mode: null, view: true, tree: false, regions: false });
  });
  it('sketches come from the Features list, closed regions from the sketch in the view; neither changes the pick mode', () => {
    expect(pickPlan(['sketch'])).toEqual({ mode: null, view: false, tree: true, regions: false });
    expect(pickPlan(['profile'])).toEqual({ mode: null, view: false, tree: true, regions: true });
    expect(pickPlan(['edge', 'sketch'])).toEqual({ mode: 'edge', view: true, tree: true, regions: false });
    expect(pickPlan(undefined)).toEqual({ mode: null, view: false, tree: false, regions: false });
  });
  it('a sketch is a kind a field opts into: it validates, and an item of it passes only a field that declares it', () => {
    const d: ParamDef = { name: 'path', type: 'selection', accept: ['sketch'] };
    expect(checkDefs([d])).toEqual([]);
    expect(checkValue(d, [{ type: 'sketch', id: 'F2', name: 'Sketch 1' }])).toBeNull();
    expect(checkValue({ ...d, accept: ['body', 'face'] }, [{ type: 'sketch', id: 'F2' }])).not.toBeNull();
    expect(checkValue({ ...d, accept: ['edge'] }, [{ type: 'edge', body: 'Rail', index: 0 }])).toBeNull();
    expect(checkValue({ ...d, accept: ['profile'] }, [profileItem({ id: 'F2', name: 'Sketch 1' }, 'e1', 0)])).toBeNull();
  });
});

describe('picked edges reach a field that takes edges, and only that', () => {
  const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], triFace: [0], faceIds: ['F1.S1'] };
  const rows = [{ key: '@body:F1.S1', name: 'Body 1', docName: 'Rail', faces: ['F1.S1'], edges: ['F1.E1', 'F1.E2'], volume: 1 }] as unknown as BodyRow[];
  it('an edge of a body is offered as its body and place in the body\'s edge list', () => {
    expect(pluginDocContext(rows, mesh, ['F1.E2']).selection).toEqual([]);   // what the plugin itself reads of the selection is unchanged
    const d = pluginDocContext(rows, mesh, ['F1.E2', 'F9.E9'], [], {}, { edges: true });
    expect(d.selection).toEqual([{ type: 'edge', body: 'Rail', index: 1 }]);
    expect(selectionItems(d.selection, { accept: ['edge'] })).toEqual([{ type: 'edge', body: 'Rail', index: 1 }]);
    expect(selectionItems(d.selection, { accept: ['body', 'face'] })).toEqual([]);   // an existing plugin's field sees no edges
  });
});

describe('sketches and their closed regions', () => {
  const feats = [
    { id: 'F1', type: 'sketch', name: 'Outline' },
    { id: 'F2', type: 'extrude', sketch: 'F1' },
    { id: 'F3', type: 'sketch' },
  ];
  const shapes = (f: { id: string }) => (f.id === 'F1' ? [{ id: 'e1' }, { id: 'e5' }, { id: 'r1', reference: true }] : []);
  it('lists the document\'s sketches with the regions a profile may be (projected outlines left out)', () => {
    expect(docSketches(feats, shapes)).toEqual([{ id: 'F1', name: 'Outline', regions: ['e1', 'e5'] }, { id: 'F3', name: 'F3', regions: [] }]);
  });
  it('a sketch pick and a region pick carry what the plugin needs to find them again', () => {
    expect(sketchItem({ id: 'F1', name: 'Outline' })).toEqual({ type: 'sketch', id: 'F1', name: 'Outline' });
    expect(profileItem({ id: 'F1', name: 'Outline' }, 'e5', 1)).toEqual({ type: 'profile', sketch: 'F1', region: 'e5', name: 'Outline', index: 1 });
  });
  it('adding a pick toggles it, never doubles it, and a maximum keeps the last ones', () => {
    const d: ParamDef = { name: 'p', type: 'selection', accept: ['sketch'] };
    const a = sketchItem({ id: 'F1', name: 'A' }), b = sketchItem({ id: 'F3', name: 'B' });
    expect(addPick(d, [], a)).toEqual([a]);
    expect(addPick(d, [a], b)).toEqual([a, b]);
    expect(addPick(d, [a, b], a)).toEqual([b]);
    expect(addPick({ ...d, maxItems: 1 }, [a], b)).toEqual([b]);
  });
  it('what the view picks replaces the view\'s part of a field and keeps its sketches and regions', () => {
    const s = sketchItem({ id: 'F1', name: 'A' });
    expect(mergeViewPicks([s, { type: 'edge', body: 'Rail', index: 0 }], [{ type: 'edge', body: 'Rail', index: 3 }])).toEqual([s, { type: 'edge', body: 'Rail', index: 3 }]);
    expect(mergeViewPicks(undefined, [{ type: 'body', name: 'Rail' }])).toEqual([{ type: 'body', name: 'Rail' }]);
  });
});

describe('picks are cleared when the design changes', () => {
  const features = [{ id: 'F1' }];
  it('a new feature list (an edit, undo, redo, another document) or a moved rollback marker is a change; the same list is not', () => {
    expect(designChanged({ features, rollback: null }, { features, rollback: null })).toBe(false);
    expect(designChanged({ features, rollback: null }, { features: [...features], rollback: null })).toBe(true);
    expect(designChanged({ features, rollback: null }, { features, rollback: 0 })).toBe(true);
    expect(designChanged(null, { features, rollback: null })).toBe(true);
  });
  const params: ParamDef[] = [
    { name: 'edges', type: 'selection', accept: ['edge'] },
    { name: 'sk', type: 'selection', accept: ['sketch'], optional: true },
    { name: 'size', type: 'number', default: 3 },
  ];
  it('every selection field is emptied and the other values kept; nothing picked: nothing to do', () => {
    expect(clearPicks(params, { edges: [{ type: 'edge', body: 'A', index: 0 }], sk: [sketchItem({ id: 'F1', name: 'A' })], size: 7 })).toEqual({ edges: [], sk: [], size: 7 });
    expect(clearPicks(params, { edges: [], size: 7 })).toBeNull();
  });
});

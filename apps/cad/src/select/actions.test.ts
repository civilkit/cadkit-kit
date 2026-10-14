import { describe, expect, it } from 'vitest';
import { BODY, vertexName } from '@kit/store';
import { SelModel } from './model';
import { areaText, bodiesOfSelection, invertSelection, lengthText, pickable, selectConnected, selectLoop, selectParallel, selectSimilar, selectTangent, summarize, toBodyMode } from './actions';
import { summaryText } from './summary';
import { boxData, roundedData, twoBoxes } from './fixtures';

const box = () => new SelModel(boxData());

describe('select operations', () => {
  it('tangent: needs a face or edge selection and the right mode', () => {
    const m = new SelModel(roundedData());
    expect(selectTangent(m, [], 'face')).toBeNull();
    expect(selectTangent(m, ['T'], 'vertex')).toBeNull();
    expect(selectTangent(m, ['T'], 'face')).toMatchObject({ mode: 'face', added: 2 });
    expect(selectTangent(m, ['TF|b#2'], 'edge')!.names.sort()).toEqual(['RF|b#3', 'TF|b#2', 'WF|b#4']);
  });
  it('parallel and similar keep the seeds and report what was added', () => {
    const m = box();
    expect(selectParallel(m, ['B+z'], 'face')).toMatchObject({ added: 1 });
    expect(selectSimilar(m, ['Bx00|0'], 'edge')!.names).toHaveLength(4);
    expect(selectParallel(m, ['B+z'], 'body')).toBeNull();
  });
  it('loop of a face switches to Edge mode', () => {
    const r = selectLoop(box(), ['B+z'], 'face')!;
    expect(r.mode).toBe('edge');
    expect(r.names).toHaveLength(4);
  });
  it('loop of an edge stays in Edge mode', () => {
    const r = selectLoop(box(), ['Bx00|0'], 'edge')!;
    expect(r.mode).toBe('edge');
    expect(r.names).toHaveLength(4);
  });
  it('connected grows a face to its body; a body selection stays', () => {
    const m = new SelModel(twoBoxes());
    expect(selectConnected(m, ['A+x'], 'face')!.names).toHaveLength(6);
    expect(selectConnected(m, ['@body:A+x'], 'body')!.names).toEqual(['@body:A+x']);
  });
});

describe('invert, pickable, bodies', () => {
  it('invert gives the rest of the faces', () => {
    const m = box();
    const r = invertSelection(m, ['B+z', 'B-z'], 'face');
    expect(r.names.sort()).toEqual(['B+x', 'B+y', 'B-x', 'B-y']);
  });
  it('invert of nothing is everything; invert twice is the original', () => {
    const m = box();
    expect(invertSelection(m, [], 'edge').names).toHaveLength(12);
    const once = invertSelection(m, ['Bx00|0'], 'edge');
    expect(invertSelection(m, once.names, 'edge').names).toEqual(['Bx00|0']);
  });
  it('invert in Body mode swaps the bodies; the legacy whole-part name counts as all', () => {
    const m = new SelModel(twoBoxes());
    expect(invertSelection(m, ['@body:A+x'], 'body').names).toEqual(['@body:C+x']);
    expect(invertSelection(m, [BODY], 'body').names).toEqual([]);
  });
  it('corners are the edge ends', () => {
    expect(pickable(box(), 'vertex')).toHaveLength(8);
    expect(pickable(box(), 'vertex')).toContain(vertexName([0, 0, 0]));
  });
  it('bodiesOfSelection maps faces and edges to their bodies', () => {
    const m = new SelModel(twoBoxes());
    expect(bodiesOfSelection(m, ['C+z', 'Ax00|0']).sort()).toEqual(['@body:A+x', '@body:C+x']);
    expect(toBodyMode(m, ['C+z'])).toEqual(['@body:C+x']);
    expect(toBodyMode(m, [])).toEqual([]);
  });
});

describe('summary', () => {
  it('counts and sizes: faces with an area, edges with a length', () => {
    const m = box();
    const s = summarize(m, ['B+z', 'B-z', 'B+x']);
    expect(s).toMatchObject({ faces: 3, edges: 0, bodies: 0 });
    expect(s.area).toBeCloseTo(60 + 60 + 24);
    expect(summaryText(s)).toBe('3 faces, 1.4 cm²');
    expect(summaryText(summarize(m, ['Bx00|0', 'Bz00|0']))).toBe('2 edges, 14 mm');
  });
  it('a body counts its faces in the area', () => {
    const m = new SelModel(twoBoxes());
    const s = summarize(m, ['@body:C+x']);
    expect(s).toMatchObject({ bodies: 1, faces: 0 });
    expect(s.area).toBeCloseTo(24);
    expect(summaryText(s)).toBe('1 body, 24 mm²');
  });
  it('nothing selected is empty text; singular nouns', () => {
    expect(summaryText(summarize(box(), []))).toBe('');
    expect(summaryText(summarize(box(), ['B+z']))).toBe('1 face, 60 mm²');
  });
  it('unit text', () => {
    expect(areaText(1240)).toBe('12.4 cm²');
    expect(areaText(40)).toBe('40 mm²');
    expect(lengthText(2500)).toBe('2.5 m');
  });
});

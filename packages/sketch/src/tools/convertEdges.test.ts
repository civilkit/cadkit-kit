import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type BodyEdge, type PlaneFrame3, type ToolEnv, type ToolEvent } from './types';
import { convertEdgesTool, faceBoundary, targetAt } from './convertEdges';
import { blankDraft } from './edit-fixtures';
import type { SketchDraft } from '../index';

const M = { shift: false, ctrl: false, alt: false };
const FRONT: PlaneFrame3 = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const TEETH = 24;
/** One tooth of a gear outline: a wavy free-form edge from one tooth boundary to the next, meeting its neighbours at radius 28. */
const tooth = (i: number, z = 0): BodyEdge => {
  const a0 = (i / TEETH) * Math.PI * 2, a1 = ((i + 1) / TEETH) * Math.PI * 2;
  const pts = Array.from({ length: 9 }, (_, k) => {
    const t = k / 8, a = a0 + (a1 - a0) * t, r = 28 + (k === 0 || k === 8 ? 0 : 2 * Math.sin(Math.PI * 2 * t) * (k % 2 ? 1 : 0.6));
    return [r * Math.cos(a), r * Math.sin(a), z];
  });
  return { key: 'E' + i, faces: ['F1.C1', 'F1.S' + i], pts };
};
const ring = (r: number, z: number, key: string): BodyEdge => ({ key, faces: ['F1.C1', 'F1.B'], pts: Array.from({ length: 49 }, (_, i) => [r * Math.cos((i / 48) * Math.PI * 2), r * Math.sin((i / 48) * Math.PI * 2), z]) });
const gear = (): BodyEdge[] => [...Array.from({ length: TEETH }, (_, i) => tooth(i)), ring(8, 0, 'bore'), ring(14, 2, 'hub')];   // the hub ring is on a raised step, not on the sketch's face
const env = (edges: BodyEdge[], selection: string[] = []): ToolEnv => ({ body: { frame: FRONT, edges }, tol: 1, selection });
const ev = (type: 'move' | 'click', x: number, y: number, shift = false): ToolEvent => ({ type, at: { x, y }, mods: { ...M, shift } });
const run = (e: ToolEvent, d: SketchDraft, en: ToolEnv) => convertEdgesTool.step({}, e, d, DEFAULT_SETTINGS, en);
const real = (d: SketchDraft) => d.entities.filter((e) => e.ext && !e.construction);

describe('Convert edges: what a click converts', () => {
  it('a click on the face converts the whole boundary: every tooth edge and the bore, not the raised hub', () => {
    const en = env(gear());
    const b = faceBoundary(en, { x: 20, y: 0 })!;
    expect(b.map((e) => e.key).sort()).toEqual([...Array.from({ length: TEETH }, (_, i) => 'E' + i), 'bore'].sort());
    const out = run(ev('click', 20, 0), blankDraft(), en);
    expect(real(out.draft).length).toBeGreaterThanOrEqual(2);
    expect(out.draft.entities.every((e) => !e.construction)).toBe(true);
    expect(out.hint).toBe('app.sketch.hint.converted');
    expect(out.hintArgs!.n).toBe(out.draft.entities.length);
  });
  it('a click inside the bore is empty space: nothing to convert, and it says so', () => {
    const out = run(ev('click', 0, 0), blankDraft(), env(gear()));
    expect(out.draft.entities).toHaveLength(0);
    expect(out.hint).toBe('app.sketch.hint.nothingToConvert');
  });
  it('a click outside the part converts nothing and says so', () => {
    const out = run(ev('click', 60, 60), blankDraft(), env(gear()));
    expect(out.draft.entities).toHaveLength(0);
    expect(out.hint).toBe('app.sketch.hint.nothingToConvert');
  });
  it('a click on one tooth edge converts the whole connected outline; Shift+click just that edge', () => {
    const en = env(gear());
    const on = { x: 28.9, y: 0.04 };   // on tooth 0's end, near its first vertex at radius 28
    const e0 = en.body!.edges[0].pts[4];
    const chain = targetAt(en, { x: e0[0], y: e0[1] }, false)!;
    expect(chain.kind).toBe('chain');
    expect(chain.edges.length).toBe(TEETH);
    expect(targetAt(en, { x: e0[0], y: e0[1] }, true)!.edges).toHaveLength(1);
    void on;
    const all = run(ev('click', e0[0], e0[1]), blankDraft(), en).draft.entities.length;
    const one = run(ev('click', e0[0], e0[1], true), blankDraft(), en).draft.entities.length;
    expect(all).toBeGreaterThan(one);
    expect(one).toBe(1);
  });
  it('the hover preview shows what the click would convert', () => {
    const en = env(gear());
    const hover = run(ev('move', 20, 0), blankDraft(), en);
    expect(hover.preview.length).toBeGreaterThan(TEETH);
    expect(hover.draft.entities).toHaveLength(0);
    expect(hover.hint).toBe('app.sketch.hint.convertEdges');
  });
  it('edges already in the sketch as dashed reference become solid outline in place; clicking again says they are already there', () => {
    const en = env(gear());
    const asRef = DEFAULT_REF(en);
    expect(asRef.entities.length).toBeGreaterThan(0);
    expect(asRef.entities.every((e) => e.construction)).toBe(true);
    const out = run(ev('click', 20, 0), asRef, en);
    expect(out.hint).toBe('app.sketch.hint.converted');
    expect(out.draft.entities.every((e) => !e.construction)).toBe(true);
    expect(out.draft.entities.length).toBe(asRef.entities.length);   // converted in place, no duplicates
    const again = run(ev('click', 20, 0), out.draft, en);
    expect(again.hint).toBe('app.sketch.hint.alreadyConverted');
  });
  it('Enter converts the edges selected in 3D; a click on one of several selected edges converts all of them', () => {
    const edges = gear();
    const sel = ['bore', 'E3', 'E4'];
    const en = env(edges, sel);
    const enter = run({ type: 'key', key: 'Enter' }, blankDraft(), en);
    expect(enter.hint).toBe('app.sketch.hint.converted');
    const e3 = edges[3].pts[4];
    expect(targetAt(en, { x: e3[0], y: e3[1] }, false)!.kind).toBe('selection');
  });
});

import { projectEdges } from './project';
function DEFAULT_REF(en: ToolEnv): SketchDraft { return projectEdges(blankDraft(), en.body!.frame, faceBoundary(en, { x: 20, y: 0 })!).draft; }

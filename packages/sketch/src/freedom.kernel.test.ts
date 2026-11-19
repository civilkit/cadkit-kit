/** Which parts are free, against the real kernel: the axes come from probes, so the solver has the last word. */
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc, type SketchSolverStatus } from '@ck/part-model';
import { toFeature, type SketchDraft } from './index';
import type { Solve } from './define';
import { applySuggestion, describeFree, freeParts, suggestionsFor } from './freedom';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function solver(seed: SketchDraft): Promise<Solve> {
  const s = await Session.open({ ...emptyPart('D'), features: [toFeature(seed)], seq: 2 } as unknown as PartDoc);
  sessions.push(s);
  return async (d) => {
    const r = await s.preview([{ op: 'replace', id: d.id, feature: toFeature(d, { includeTemp: true }) }], { upTo: 1, solveSketches: true });
    return ((r.body?.sketches ?? r.sketches)?.find((x) => x.id === d.id) as unknown as { status?: SketchSolverStatus } | undefined)?.status ?? null;
  };
}
const draft = (): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'b', x: 40, y: 0 }, { id: 'c', x: 30, y: 12 }],
  entities: [{ id: 'e1', type: 'line', p1: 'O', p2: 'b' }, { id: 'e2', type: 'circle', c: 'c', r: 5 }],
  constraints: [{ id: 'k1', type: 'horizontal', refs: ['e1'] }],
});

describe('freeParts in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('finds the line end free along x only, the circle centre free in both and its radius open; suggestions then close it', async () => {
    const d = draft();
    const solve = await solver(d);
    const st = await solve(d);
    expect(st!.dof).toBe(4);
    const parts = await freeParts(d, st, solve);
    expect(parts).toEqual([{ kind: 'point', id: 'b', axes: 'x' }, { kind: 'point', id: 'c', axes: 'xy' }, { kind: 'radius', id: 'e2' }]);
    let cur = d;
    for (const s of suggestionsFor(d, describeFree(d, parts))) {
      if (s.label === 'length' || s.label === 'hdist' || s.label === 'vdist' || s.label === 'radius') {
        const next = applySuggestion(cur, s).draft;
        const r = await solve(next);
        if (r && r.solved && !r.conflicts.length && !r.redundant.length && r.dof < (await solve(cur))!.dof) cur = next;
      }
    }
    expect((await solve(cur))!.dof).toBe(0);
  });

  it('a lone free point beside a fully dimensioned circle is found, named and offered pins', async () => {
    const d: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p3', x: 30, y: 5 }],
      entities: [{ id: 'e1', type: 'circle', c: 'p1', r: 10 }],
      constraints: [{ id: 'k1', type: 'coincident', refs: ['p1', 'O'] }, { id: 'k2', type: 'radius', refs: ['e1'], value: 10 }],
    };
    const solve = await solver(d);
    const st = await solve(d);
    expect(st!.dof).toBe(2);
    const parts = await freeParts(d, st, solve);
    expect(parts).toEqual([{ kind: 'point', id: 'p3', axes: 'xy' }]);
    const items = describeFree(d, parts);
    expect(items).toEqual([{ key: 'point:p3', partId: 'p3', entityId: '', entityType: 'point', ordinal: 1, role: 'point', axes: 'xy' }]);
    const sug = suggestionsFor(d, items);
    expect(sug.map((x) => x.label)).toEqual(['hdist', 'vdist']);
    let cur = d;
    for (const x of sug) cur = applySuggestion(cur, x).draft;
    expect((await solve(cur))!.dof).toBe(0);
  });
});

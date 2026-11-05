import { describe, expect, it } from 'vitest';
import { fromFeature, foldSolution, type SketchDraft } from './index';
import { deleteEntity } from './select';
import { equationTool } from './tools/equation';
import { addEquation, equationFields, equationNotes, equationSpec, isEquation, patchEquation, EQUATION_PRESETS } from './equation';

const base = (): SketchDraft => fromFeature({ type: 'sketch', id: 'S1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [] });

describe('equation curves in the draft', () => {
  it('adds a spline entity that carries only the formulas (the kernel makes its points)', () => {
    const { draft, id } = addEquation(base(), { x: 5, y: -2 });
    const e = draft.entities.find((x) => x.id === id)!;
    expect(e.type).toBe('spline');
    expect(e.pts).toEqual([]);
    expect(isEquation(e)).toBe(true);
    const eq = e.equation as { x: string; y: string; t: unknown[] };
    expect(eq.x).toContain('5');
    expect(eq.y).toContain('-2');
    expect(eq.t).toEqual([0, 360]);
    expect(draft.points).toHaveLength(1);
  });

  it('reads the fields with defaults and patches the formulas', () => {
    const { draft, id } = addEquation(base(), { x: 0, y: 0 });
    const f = equationFields(draft, id)!;
    expect(f.tol).toBe(0.01);
    expect(f.t0).toBe('0');
    expect(f.t1).toBe('360');
    const d2 = patchEquation(draft, id, { x: 'R*cos(t)', y: 'R*sin(t)', t0: '0', t1: '=360*n', tol: 0.005 });
    const eq = d2.entities.find((x) => x.id === id)!.equation;
    expect(eq).toEqual({ x: 'R*cos(t)', y: 'R*sin(t)', t: [0, '=360*n'], tol: 0.005 });
    expect(draft.entities.find((x) => x.id === id)!.equation).not.toEqual(eq);   // immutable
    expect(equationFields(d2, id)!.t1).toBe('=360*n');
  });

  it('builds the kernel spec: plain numbers stay numbers, anything else is a formula', () => {
    expect(equationSpec({ x: 't', y: '2*t', t0: ' 1.5 ', t1: '2*pi', tol: 0.02 })).toEqual({ x: 't', y: '2*t', t: [1.5, '=2*pi'], tol: 0.02 });
    expect(equationSpec({ x: 't', y: 't', t0: '-3', t1: '=w', tol: 0.01 }).t).toEqual([-3, '=w']);
  });

  it('takes the generated points from the solved sketch and drops stale ones', () => {
    let { draft, id } = addEquation(base(), { x: 0, y: 0 });
    draft = { ...draft, points: [...draft.points, { id: `${id}_p9`, x: 1, y: 1, fixed: true }, { id: 'p7', x: 3, y: 3 }] };
    const solved = {
      points: [{ id: 'O', x: 0, y: 0 }, { id: 'p7', x: 3, y: 4 }, { id: `${id}_start`, x: 0, y: 0, fixed: true }, { id: `${id}_p1`, x: 20, y: 5, fixed: true }, { id: `${id}_end`, x: 40, y: 0, fixed: true }],
      entities: [{ id, type: 'spline', pts: [`${id}_start`, `${id}_p1`, `${id}_end`], closed: false, equation: {} }],
    };
    const d = foldSolution(draft, solved);
    expect(d.points.map((p) => p.id)).toEqual(['O', 'p7', `${id}_start`, `${id}_p1`, `${id}_end`]);
    expect(d.points.find((p) => p.id === 'p7')!.y).toBe(4);
    expect(d.points.find((p) => p.id === `${id}_end`)).toMatchObject({ x: 40, y: 0, fixed: true });
    const e = d.entities.find((x) => x.id === id)!;
    expect(e.pts).toEqual([`${id}_start`, `${id}_p1`, `${id}_end`]);
    expect(e.closed).toBe(false);
  });

  it('turns the kernel reply into notes: an error by its code, warnings, and the point count', () => {
    expect(equationNotes({ error: 'equationFormula: y(t): could not be read' })).toEqual([{ key: 'app.sketch.equation.err.equationFormula', params: { detail: 'y(t): could not be read' } }]);
    expect(equationNotes({ error: 'something else' })[0].key).toBe('app.sketch.equation.err.other');
    const ok = equationNotes({ pts: [], closed: true, count: 18, deviation: 0.0071, tol: 0.01, warnings: [{ code: 'equationSelfIntersects', detail: 'near (0, 0)' }] });
    expect(ok[0]).toEqual({ key: 'app.sketch.equation.info.closed', params: { count: '18', deviation: '0.0071' } });
    expect(ok[1]).toEqual({ key: 'app.sketch.equation.warn.equationSelfIntersects', params: { detail: 'near (0, 0)' } });
  });

  it('offers presets that are complete specs', () => {
    expect(EQUATION_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const p of EQUATION_PRESETS) expect(p.fields.x && p.fields.y && p.fields.t0 && p.fields.t1).toBeTruthy();
  });

  it('deleting the curve takes its generated points with it, and keeps other fixed points', () => {
    let { draft, id } = addEquation(base(), { x: 0, y: 0 });
    const solved = { points: [{ id: `${id}_start`, x: 0, y: 0 }, { id: `${id}_end`, x: 40, y: 0 }], entities: [{ id, pts: [`${id}_start`, `${id}_end`], closed: false }] };
    draft = foldSolution(draft, solved);
    expect(draft.points).toHaveLength(3);
    const d = deleteEntity(draft, id);
    expect(d.entities).toHaveLength(0);
    expect(d.points.map((p) => p.id)).toEqual(['O']);
  });

  it('the tool adds a curve where the click is and reports it placed', () => {
    const env = { autoConstraints: true, arcSwitch: 'hover', onViewValues: 'dimensions' } as never;
    const out = equationTool.step(equationTool.start(), { type: 'click', at: { x: 10, y: 0 }, mods: {} } as never, base(), env);
    expect(out.state.placed).toBe('e1');
    expect(out.draft.entities[0]).toMatchObject({ id: 'e1', type: 'spline' });
    expect((out.draft.entities[0].equation as { x: string }).x).toBe('10 + t/9');
  });
});

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import type { SketchSolverStatus } from '@ck/part-model';
import type { SketchDraft } from '@kit/sketch';
import { reportState, sketchReport } from './reportData';
import { SketchReportBody, SketchReportSheet, SketchReportWindow } from './SketchReport';
import './i18n';

afterEach(cleanup);

/** A rectangle with a dimensioned width, a circle, an arc, a spline, an open pair of lines, one construction line, one reference dimension. */
const draft = (): SketchDraft => ({
  id: 'F1', name: 'Plate', plane: 'front', temp: [],
  points: [{ id: 'o', x: 0, y: 0, fixed: true }, { id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 10, y: 5 }, { id: 'd', x: 0, y: 5 }, { id: 'q', x: 20, y: 20 }, { id: 'm', x: 30, y: 0 }, { id: 'n', x: 40, y: 0 }, { id: 's', x: 50, y: 0 }, { id: 't', x: 60, y: 5 }],
  entities: [
    { id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }, { id: 'e3', type: 'line', p1: 'c', p2: 'd' }, { id: 'e4', type: 'line', p1: 'd', p2: 'a' },
    { id: 'e5', type: 'circle', c: 'q', r: 3 },
    { id: 'e6', type: 'arc', c: 'o', p1: 'm', p2: 'n' },
    { id: 'e7', type: 'spline', pts: ['s', 't'] },
    { id: 'e8', type: 'line', p1: 'q', p2: 'c', construction: true },
  ],
  constraints: [
    { id: 'k1', type: 'horizontal', refs: ['e1'] }, { id: 'k2', type: 'horizontal', refs: ['e3'] }, { id: 'k3', type: 'vertical', refs: ['e2'] },
    { id: 'k4', type: 'distance', refs: ['a', 'b'], value: 10 }, { id: 'k5', type: 'radius', refs: ['e5'], value: 3 }, { id: 'k6', type: 'horizontal', refs: ['e1'] },
  ],
  extras: { refDims: [{ id: 'r1', type: 'distance', refs: ['b', 'c'] }] },
} as unknown as SketchDraft);

const st = (over: Partial<SketchSolverStatus> = {}): SketchSolverStatus => ({ dof: 4, fullyDefined: false, conflicts: [], redundant: [], solved: true, state: 'under', residual: 0, ...over });

describe('reportState', () => {
  it('names the state, a conflict outranking over-constrained', () => {
    expect(reportState(null)).toBe('unknown');
    expect(reportState(st())).toBe('under');
    expect(reportState(st({ dof: 0, state: 'full', fullyDefined: true }))).toBe('full');
    expect(reportState(st({ state: 'over', redundant: ['k6'] }))).toBe('over');
    expect(reportState(st({ state: 'over', conflicts: ['k6'] }))).toBe('conflict');
    expect(reportState(st({ solved: false }))).toBe('unsolved');
  });
});

describe('sketchReport', () => {
  const r = sketchReport(draft(), st({ state: 'over', conflicts: ['k4'], redundant: ['k6'], dof: 0 }));
  it('counts what the sketch holds', () => {
    expect(r).toMatchObject({ name: 'Plate', points: 10, lines: 5, arcs: 1, circles: 1, splines: 1, other: 0, construction: 1, profiles: 2, openChains: 2 });
  });
  it('counts constraints by kind, dimensions as driving and reference', () => {
    expect(r.constraints).toBe(6);
    expect(r.byKind[0]).toEqual({ type: 'horizontal', count: 3 });
    expect(r.byKind.map((k) => k.type)).toEqual(['horizontal', 'distance', 'radius', 'vertical']);
    expect(r.driving).toBe(2);
    expect(r.driven).toBe(1);
  });
  it('lists the conflicting and redundant constraints, conflicts first', () => {
    expect(r.state).toBe('conflict');
    expect(r.issues).toEqual([{ id: 'k4', kind: 'conflict', type: 'distance', refs: ['a', 'b'] }, { id: 'k6', kind: 'redundant', type: 'horizontal', refs: ['e1'] }]);
  });
  it('an empty or unsolved sketch has no issues and no dof', () => {
    const e = sketchReport({ ...draft(), entities: [], constraints: [], extras: undefined }, null);
    expect(e).toMatchObject({ state: 'unknown', dof: null, lines: 0, constraints: 0, profiles: 0, issues: [], driven: 0 });
  });
});

describe('Sketch Report view', () => {
  const full = sketchReport(draft(), st({ state: 'over', conflicts: ['k4'], redundant: ['k6'], dof: 0 }));
  it('shows the state, the counts and the issues', () => {
    const { container, getByTestId } = render(<SketchReportBody report={full} onSelect={() => {}} />);
    expect(getByTestId('report-state').textContent).toContain('Plate');
    expect(getByTestId('report-state').textContent).toContain('Conflicting constraints');
    expect(getByTestId('report-lines').textContent).toContain('5');
    expect(getByTestId('report-profiles').textContent).toContain('2');
    expect(getByTestId('report-driving').textContent).toContain('2');
    expect(container.querySelectorAll('[data-issue]').length).toBe(2);
  });
  it('says the degrees of freedom when under-defined, and None without issues', () => {
    const { getByTestId } = render(<SketchReportBody report={sketchReport(draft(), st())} onSelect={() => {}} />);
    expect(getByTestId('report-state').textContent).toContain('4 degrees of freedom');
    expect(getByTestId('report-none')).toBeTruthy();
  });
  it('clicking an issue selects it', () => {
    const onSelect = vi.fn();
    const { container } = render(<SketchReportWindow report={full} onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(container.querySelector('[data-issue="k6"]')!);
    expect(onSelect).toHaveBeenCalledWith('k6');
  });
  it('the window closes; the same body sits in the Sheet on a phone or tablet', () => {
    const onClose = vi.fn();
    const win = render(<SketchReportWindow report={full} onSelect={() => {}} onClose={onClose} />);
    fireEvent.click(win.getByLabelText('Close panel'));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    const sheet = render(<SketchReportSheet report={full} onSelect={() => {}} onClose={() => {}} snap="half" onSnap={() => {}} />);
    expect(sheet.container.querySelector('section.sheet')).toBeTruthy();
    expect(sheet.container.querySelector('[data-testid="sketch-report"]')).toBeTruthy();
  });
});

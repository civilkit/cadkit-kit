import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import type { SketchSolverStatus } from '@ck/part-model';
import { describeFree, suggestionsFor, type SketchDraft } from '@kit/sketch';
import { DEFAULT_SKETCH_PREFS } from './sketchPrefs';
import { SketchBar } from './SketchBar';
import { SketchFreedomList } from './SketchFreedom';
import { freeText, suggestionText, tooltipText } from './freedomText';
import './i18n';

afterEach(cleanup);
const d: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 50, y: 10 }], entities: [{ id: 'e1', type: 'circle', c: 'c', r: 5 }], constraints: [] };
const items = describeFree(d, [{ kind: 'point', id: 'c', axes: 'xy' }, { kind: 'radius', id: 'e1' }]);
const sug = suggestionsFor(d, items);

describe('freedom wording', () => {
  it('says what can move and how to pin it', () => {
    expect(items.map(freeText)).toEqual(['Circle 1 centre can move in x and y', 'Circle 1 radius can change']);
    expect(sug.map(suggestionText)).toEqual(['X from origin 50', 'Y from origin 10', 'Radius 5']);
    expect(tooltipText({ id: 'k1', type: 'hdist', value: 10, driving: true })).toBe('Horizontal distance 10');
    expect(tooltipText({ id: 'r1', type: 'distance', driving: false })).toBe('(Distance)');
  });
});

describe('SketchFreedomList', () => {
  it('lists each finding with its chips, and a chip runs its suggestion', () => {
    const onRun = vi.fn();
    render(<SketchFreedomList items={items} suggestions={sug} busy={false} onRun={onRun} onAnalyse={vi.fn()} />);
    expect(screen.getByText('Circle 1 centre can move in x and y')).toBeTruthy();
    fireEvent.click(screen.getByText('Radius 5'));
    expect(onRun).toHaveBeenCalledWith(sug[2]);
  });
  it('before an analysis it offers the button; with nothing free it is empty', () => {
    const onAnalyse = vi.fn();
    const { container, rerender } = render(<SketchFreedomList items={null} suggestions={[]} busy={false} onRun={vi.fn()} onAnalyse={onAnalyse} />);
    fireEvent.click(screen.getByText('Show what is free'));
    expect(onAnalyse).toHaveBeenCalled();
    rerender(<SketchFreedomList items={[]} suggestions={[]} busy={false} onRun={vi.fn()} onAnalyse={onAnalyse} />);
    expect(container.textContent).toBe('');
  });
});

describe('the ribbon buttons', () => {
  const status = { dof: 3, fullyDefined: false, conflicts: [], redundant: [], solved: true, state: 'under', residual: 0 } as SketchSolverStatus;
  it('Show freedom and Show constraints are toggles; Show freedom is offered only while under-defined', () => {
    const onShowFree = vi.fn(), onShowConstraints = vi.fn();
    const props = { name: 'S', plane: 'Front', onOk: vi.fn(), onCancel: vi.fn(), construction: false, onConstruction: vi.fn(), onLookNormal: vi.fn(), status, busy: false, prefs: DEFAULT_SKETCH_PREFS, onPrefs: vi.fn(), onFullyDefine: vi.fn(), selected: 0, onClearSelection: vi.fn(), onShowFree, onShowConstraints, showConstraints: true };
    const { container, rerender } = render(<SketchBar {...props} />);
    fireEvent.click(container.querySelector('[data-action="show-freedom"]')!);
    expect(onShowFree).toHaveBeenCalledTimes(1);
    const sc = container.querySelector('[data-action="show-constraints"]')!;
    expect(sc.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(sc);
    expect(onShowConstraints).toHaveBeenCalledTimes(1);
    rerender(<SketchBar {...props} status={{ ...status, dof: 0, state: 'full', fullyDefined: true }} />);
    expect(container.querySelector('[data-action="show-freedom"]')).toBeNull();
  });
});

describe('an orphan point in the freedom list', () => {
  it('is worded as a point that can move and listed with its chips', () => {
    const od: SketchDraft = { ...d, points: [...d.points, { id: 'p3', x: 30, y: 5 }] };
    const oi = describeFree(od, [{ kind: 'point', id: 'p3', axes: 'xy' }]);
    expect(oi.map(freeText)).toEqual(['Point 1 can move in x and y']);
    render(<SketchFreedomList items={oi} suggestions={suggestionsFor(od, oi)} busy={false} onRun={vi.fn()} onAnalyse={vi.fn()} />);
    expect(screen.getByText('Point 1 can move in x and y')).toBeTruthy();
    expect(screen.getByText('X from origin 30')).toBeTruthy();
  });
});

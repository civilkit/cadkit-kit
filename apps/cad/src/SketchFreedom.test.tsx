import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, act } from '@testing-library/preact';
import type { SketchSolverStatus } from '@ck/part-model';
import { describeFree, suggestionsFor, type SketchDraft } from '@kit/sketch';
import { DEFAULT_SKETCH_PREFS } from './sketchPrefs';
import { SketchBar, DofBadge } from './SketchBar';
import { SketchConstraintList } from './SketchConstraintList';
import { FREE_VISIBLE, freeVisibleCount, constraintsStartFolded, popoverLayout } from './dofPopover';
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
    expect(screen.getByText('Circle 1 centre')).toBeTruthy();
    expect(screen.getByText('- x and y')).toBeTruthy();
    fireEvent.click(screen.getByText('Radius 5'));
    expect(onRun).toHaveBeenCalledWith(sug[2]);
  });
  it('Select them hands over each free entity once, and is absent without a handler', () => {
    const onSelectAll = vi.fn();
    const { rerender } = render(<SketchFreedomList items={items} suggestions={[]} busy={false} onRun={vi.fn()} onAnalyse={vi.fn()} onSelectAll={onSelectAll} />);
    fireEvent.click(screen.getByText('Select them'));
    const ids = onSelectAll.mock.calls[0][0] as string[];
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids.every((i) => i !== '')).toBe(true);
    rerender(<SketchFreedomList items={items} suggestions={[]} busy={false} onRun={vi.fn()} onAnalyse={vi.fn()} />);
    expect(screen.queryByText('Select them')).toBeNull();
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
    expect(screen.getByText('Point 1')).toBeTruthy();
    expect(screen.getByText('X from origin 30')).toBeTruthy();
  });
});

describe('popover rules', () => {
  it('shows five free parts until expanded, and folds Constraints above three free parts', () => {
    expect(FREE_VISIBLE).toBe(5);
    expect([3, 5, 9].map((n) => freeVisibleCount(n, false))).toEqual([3, 5, 5]);
    expect(freeVisibleCount(9, true)).toBe(9);
    expect([0, 3, 4, 9].map(constraintsStartFolded)).toEqual([false, false, true, true]);
  });
  it('places the panel under the badge, right-aligned, inside the window', () => {
    expect(popoverLayout(40, 1441, 900)).toEqual({ top: 46, right: 8, left: null, maxWidth: 1425, maxHeight: 838, sheet: false });
    const n = popoverLayout(60, 460, 800);
    expect(n.sheet).toBe(true);
    expect(n.left).toBe(8);
    expect(n.maxWidth).toBe(444);
    expect(popoverLayout(790, 1000, 800).maxHeight).toBe(120);
  });
});

describe('many free parts', () => {
  const many: SketchDraft = { ...d, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...Array.from({ length: 7 }, (_, i) => ({ id: 'p' + i, x: i, y: 1 }))], entities: [] };
  const mi = describeFree(many, many.points.slice(1).map((p) => ({ kind: 'point' as const, id: p.id, axes: 'xy' as const })));
  it('lists the first five, and Show all expands the rest', () => {
    const { container } = render(<SketchFreedomList items={mi} suggestions={suggestionsFor(many, mi)} busy={false} onRun={vi.fn()} onAnalyse={vi.fn()} />);
    expect(container.querySelectorAll('.sketch-free li').length).toBe(5);
    fireEvent.click(screen.getByText('Show all (7)'));
    expect(container.querySelectorAll('.sketch-free li').length).toBe(7);
    expect(screen.getByText('Show fewer')).toBeTruthy();
  });
});

describe('the badge popover', () => {
  const st = { dof: 9, fullyDefined: false, conflicts: [], redundant: [], solved: true, state: 'under', residual: 0 } as SketchSolverStatus;
  const rows = [{ id: 'k1', type: 'horizontal', refs: ['e1'] }, { id: 'k2', type: 'hdist', refs: ['p1', 'p2'], value: 60 }];
  const list = (collapsed: boolean, onRun = vi.fn()) => (
    <><SketchFreedomList items={items} suggestions={sug} busy={false} onRun={onRun} onAnalyse={vi.fn()} /><SketchConstraintList collapsed={collapsed} rows={rows} status={st} hot={null} onHover={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} /></>
  );
  it('opens as a solid panel with a pinned title; Escape, a click outside and the close button close it', async () => {
    const { container } = render(<div><button id="out">x</button><DofBadge status={st} list={list(false)} /></div>);
    expect(container.querySelector('.dof-pop')).toBeNull();
    fireEvent.click(container.querySelector('.dof-chip')!);
    const pop = container.querySelector('.dof-pop')!;
    expect(pop).toBeTruthy();
    expect(pop.querySelector('.dof-pop-head')!.textContent).toContain('Degrees of freedom: 9');
    expect(pop.querySelector('.dof-pop-body')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.dof-pop')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('.dof-chip'));
    fireEvent.click(container.querySelector('.dof-chip')!);
    await act(async () => { container.querySelector('#out')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container.querySelector('.dof-pop')).toBeNull();
    fireEvent.click(container.querySelector('.dof-chip')!);
    fireEvent.click(container.querySelector('[data-action="dof-close"]')!);
    expect(container.querySelector('.dof-pop')).toBeNull();
  });
  it('a chip inside it still applies its suggestion', () => {
    const onRun = vi.fn();
    const { container } = render(<DofBadge status={st} list={list(false, onRun)} />);
    fireEvent.click(container.querySelector('.dof-chip')!);
    fireEvent.click(screen.getByText('Radius 5'));
    expect(onRun).toHaveBeenCalledWith(sug[2]);
  });
  it('the Constraints section starts folded when told so, and opens on a click', () => {
    const { container } = render(<DofBadge status={st} list={list(true)} />);
    fireEvent.click(container.querySelector('.dof-chip')!);
    expect(screen.getByText('Constraints (2)')).toBeTruthy();
    expect(container.querySelectorAll('.sketch-cons li').length).toBe(0);
    fireEvent.click(container.querySelector('[data-action="constraints-fold"]')!);
    expect(container.querySelectorAll('.sketch-cons li').length).toBe(2);
  });
});

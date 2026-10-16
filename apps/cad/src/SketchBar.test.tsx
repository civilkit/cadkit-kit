import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/preact';
import type { SketchSolverStatus } from '@ck/part-model';
import { DEFAULT_SKETCH_PREFS } from './sketchPrefs';
import { SketchBar, defLevel } from './SketchBar';
import { SketchAnnotations } from './SketchAnnotations';
import { SketchConstraintList } from './SketchConstraintList';
import './i18n';

afterEach(cleanup);
const st = (over: Partial<SketchSolverStatus>): SketchSolverStatus => ({ dof: 3, fullyDefined: false, conflicts: [], redundant: [], solved: true, state: 'under', ...over } as SketchSolverStatus);
const bar = (status: SketchSolverStatus | null, extra: Partial<Parameters<typeof SketchBar>[0]> = {}) => {
  const props = { name: 'Sketch1', plane: 'Front', onOk: vi.fn(), onCancel: vi.fn(), construction: false, onConstruction: vi.fn(), onLookNormal: vi.fn(), status, busy: false, prefs: DEFAULT_SKETCH_PREFS, onPrefs: vi.fn(), onFullyDefine: vi.fn(), selected: 0, onClearSelection: vi.fn(), list: <div class="the-list">list</div>, ...extra };
  return { props, ...render(<SketchBar {...props} />) };
};

describe('definition level', () => {
  it('under, full, over (conflict or unsolved) and none', () => {
    expect(defLevel(st({}))).toBe('under');
    expect(defLevel(st({ dof: 0, state: 'full', fullyDefined: true }))).toBe('full');
    expect(defLevel(st({ state: 'over', conflicts: ['k1'] }))).toBe('over');
    expect(defLevel(st({ solved: false }))).toBe('over');
    expect(defLevel(null)).toBe('none');
  });
});

describe('SketchBar', () => {
  it('shows the chip with its level and the degrees of freedom, and Fully define is live until fully defined', () => {
    const { container, props } = bar(st({ dof: 4 }));
    expect(container.querySelector('.dof-chip')!.getAttribute('data-level')).toBe('under');
    expect(container.querySelector('.dof-chip')!.textContent).toContain('4 DOF');
    fireEvent.click(container.querySelector('[data-action="fully-define"]')!);
    expect(props.onFullyDefine).toHaveBeenCalled();
    cleanup();
    const full = bar(st({ dof: 0, state: 'full', fullyDefined: true }));
    expect(full.container.querySelector('.dof-chip')!.getAttribute('data-level')).toBe('full');
    expect((full.container.querySelector('[data-action="fully-define"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('the badge reads Fully defined or N DOF, and the list is a popover: closed by default, opened by the badge', () => {
    const { container } = bar(st({ dof: 4 }));
    expect(container.querySelector('.dof-chip')!.textContent).toBe('4 DOF');
    expect(container.querySelector('.the-list')).toBeNull();
    fireEvent.click(container.querySelector('.dof-chip')!);
    expect(container.querySelector('.the-list')).not.toBeNull();
    fireEvent.click(container.querySelector('.dof-chip')!);
    expect(container.querySelector('.the-list')).toBeNull();
    cleanup();
    expect(bar(st({ dof: 0, state: 'full', fullyDefined: true })).container.querySelector('.dof-chip')!.textContent).toBe('Fully defined');
  });
  it('a conflict opens the list by itself', () => {
    const { container } = bar(st({ state: 'over', conflicts: ['k8'] }));
    expect(container.querySelector('.dof-chip')!.getAttribute('data-level')).toBe('over');
    expect(container.querySelector('.the-list')).not.toBeNull();
  });
  it('the one bar holds name, OK, Cancel, Construction, Look normal and the plane as the name tooltip', () => {
    const { container, props } = bar(st({}));
    expect(container.querySelector('.sb-name')!.textContent).toBe('Sketch1');
    expect(container.querySelector('.sb-name')!.getAttribute('title')).toContain('Front');
    fireEvent.click(container.querySelector('[aria-label="Confirm sketch"]')!);
    fireEvent.click(container.querySelector('[aria-label="Cancel sketch"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Construction' }));
    fireEvent.click(screen.getByRole('button', { name: 'Look normal' }));
    expect([props.onOk, props.onCancel, props.onConstruction, props.onLookNormal].map((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1, 1]);
    expect(container.querySelectorAll('.sketch-bar').length).toBe(1);
  });
  it('folds Snaps and Display into one View menu on narrow windows', () => {
    const mm = vi.fn((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal('matchMedia', mm); (window as unknown as { matchMedia: unknown }).matchMedia = mm;
    try {
      const { props } = bar(st({}));
      expect(screen.queryByRole('button', { name: /Snaps/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /View/ }));
      expect(screen.getByLabelText('Quadrants')).toBeTruthy();
      fireEvent.click(screen.getByLabelText('Relation glyphs'));
      expect(props.onPrefs).toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); delete (window as unknown as { matchMedia?: unknown }).matchMedia; }
  });
  it('the snaps popover lists every kind and reports a toggle (grid goes to gridSnap, the rest into snaps)', () => {
    const { props } = bar(st({}));
    fireEvent.click(screen.getByRole('button', { name: /Snaps/ }));
    for (const name of ['End points', 'Centres', 'Midpoints', 'Quadrants', 'Intersections', 'Perpendicular', 'Tangent', 'On curve', 'Alignment guides', 'Grid']) expect(screen.getByLabelText(name)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Quadrants'));
    expect(props.onPrefs).toHaveBeenCalledWith({ snaps: { ...DEFAULT_SKETCH_PREFS.snaps, quadrant: false } });
    fireEvent.click(screen.getByLabelText('Grid'));
    expect(props.onPrefs).toHaveBeenCalledWith({ gridSnap: false });
  });
  it('the display popover toggles what is shown', () => {
    const { props } = bar(st({}));
    fireEvent.click(screen.getByRole('button', { name: /Display/ }));
    fireEvent.click(screen.getByLabelText('Relation glyphs'));
    expect(props.onPrefs).toHaveBeenCalledWith({ show: { ...DEFAULT_SKETCH_PREFS.show, relations: false } });
  });
  it('shows the selection count with a Clear button', () => {
    const { container, props } = bar(st({}), { selected: 5 });
    expect(container.querySelector('.aux-sel')!.textContent).toContain('5 selected');
    fireEvent.click(container.querySelector('.aux-sel button')!);
    expect(props.onClearSelection).toHaveBeenCalled();
  });
});

describe('reference dimensions on the canvas and in the list', () => {
  it('a driven label is italic, right-click and double-click flip it, a driving one edits on double-click', () => {
    const onEdit = vi.fn(), onToggleDriven = vi.fn();
    const { container } = render(<SketchAnnotations items={[{ id: 'k1', text: '20', kind: 'dimension', x: 10, y: 10 }, { id: 'r1', text: '(20)', kind: 'dimension', driven: true, x: 40, y: 10 }]} hot={null} onEdit={onEdit} onHover={() => {}} onToggleDriven={onToggleDriven} />);
    const [drv, ref] = [...container.querySelectorAll('.annot')];
    expect(ref.classList.contains('driven')).toBe(true);
    fireEvent.dblClick(drv); expect(onEdit).toHaveBeenCalledWith('k1');
    fireEvent.contextMenu(drv); expect(onToggleDriven).toHaveBeenCalledWith('k1', false);
    fireEvent.dblClick(ref); expect(onToggleDriven).toHaveBeenCalledWith('r1', true);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
  it('the constraint list marks blamed rows, brackets reference rows and has the driven toggle', () => {
    const onToggleDriven = vi.fn();
    const { container } = render(<SketchConstraintList rows={[{ id: 'k1', type: 'distance', refs: ['a', 'b'], value: 10, blame: 'conflict' }, { id: 'r1', type: 'distance', refs: ['a', 'c'], driven: true }, { id: 'k2', type: 'horizontal', refs: ['e1'] }]} status={st({ state: 'over', conflicts: ['k1'] })} hot={null} onHover={() => {}} onDelete={() => {}} onEdit={() => {}} onToggleDriven={onToggleDriven} />);
    const rows = [...container.querySelectorAll('li')];
    expect(rows[0].classList.contains('bad')).toBe(true);
    expect(rows[1].textContent).toContain('(Distance)');
    expect(rows[2].querySelector('.cdrv')).toBeNull();
    fireEvent.click(rows[1].querySelector('.cdrv')!); expect(onToggleDriven).toHaveBeenCalledWith('r1', true);
    fireEvent.click(rows[0].querySelector('.cdrv')!); expect(onToggleDriven).toHaveBeenCalledWith('k1', false);
  });
});

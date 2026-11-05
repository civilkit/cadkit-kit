import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import { StatusBar } from '@kit/ui';
import { SketchReadout, ModelReadout, CursorLabel, readout, clearReadout } from './sketchReadout';
import { cursorLabel } from './sketchStatus';
import { DEFAULT_SKETCH_PREFS, sanitizeSketchPrefs } from './sketchPrefs';
import './i18n';

afterEach(() => { cleanup(); clearReadout(); readout.model.value = null; });

const bar = (p: Partial<Parameters<typeof SketchReadout>[0]> = {}) => {
  const f = { onSnap: vi.fn(), onGrid: vi.fn(), onSpacing: vi.fn() };
  const r = render(<StatusBar notices={[]} hover={null} busy={false} sketch={<SketchReadout snapOn gridOn gridBase={0} {...f} {...p} />} />);
  return { ...r, ...f };
};

describe('status bar sketch readout', () => {
  it('shows pointer coordinates, delta, the active snap, zoom and grid spacing', () => {
    const { container } = bar();
    act(() => {
      readout.cursor.value = { u: 232.14, v: -5.06, upp: 0.1, grid: 10 };
      readout.from.value = { x: 220.14, y: -8.56 };
      readout.snapName.value = 'midpoint';
    });
    const text = container.textContent ?? '';
    expect(text).toContain('232.1 mm, -5.1 mm');
    expect(text).toContain('dx 12.0  dy 3.5  len 12.5  angle 16°');
    expect(text).toContain('Snap: midpoint');
    expect((container.querySelector('[data-testid="status-zoom"]') as HTMLInputElement).value).toBe('265%');
    expect((container.querySelector('[data-testid="status-spacing"]') as HTMLInputElement).value).toBe('10 mm');
    expect(text).toContain('Ready');   // the ordinary status stays
  });
  it('shows the snapped position when a snap is active', () => {
    const { container } = bar();
    act(() => { readout.cursor.value = { u: 1.04, v: 2.04, upp: 0.1, grid: 1 }; readout.snapAt.value = { x: 1, y: 2 }; });
    expect(container.querySelector('.st-coords')?.textContent).toBe('1.0 mm, 2.0 mm');
  });
  it('Snap and Grid boxes call back', () => {
    const { container, onSnap, onGrid } = bar({ snapOn: true, gridOn: false });
    const boxes = [...container.querySelectorAll('.st-toggle input')] as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    fireEvent.click(boxes[0]); fireEvent.click(boxes[1]);
    expect(onSnap).toHaveBeenCalledWith(false);
    expect(onGrid).toHaveBeenCalledWith(true);
  });
  it('the grid spacing is edited in place: Enter commits (millimetres), Escape cancels', () => {
    const { container, onSpacing } = bar({ gridBase: 5 });
    act(() => { readout.cursor.value = { u: 0, v: 0, upp: 0.1, grid: 5 }; });
    const input = container.querySelector('[data-testid="status-spacing"]') as HTMLInputElement;
    expect(input.value).toBe('5 mm');
    fireEvent.focus(input);
    expect(input.value).toBe('5');
    fireEvent.input(input, { target: { value: '2.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSpacing).toHaveBeenCalledWith(2.5);
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(onSpacing).toHaveBeenCalledTimes(1);
  });
  it('the zoom field is an input: it shows the percentage, Enter commits a new one, nonsense is ignored', () => {
    const onZoom = vi.fn();
    const { container } = bar({ onZoom });
    act(() => { readout.view.value = { upp: 25.4 / 96 / 2, grid: 5 }; });
    const input = container.querySelector('[data-testid="status-zoom"]') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.value).toBe('200%');
    fireEvent.focus(input);
    expect(input.value).toBe('200');
    fireEvent.input(input, { target: { value: '50%' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onZoom).toHaveBeenCalledWith(50);
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: '-3' } });
    fireEvent.blur(input);
    expect(onZoom).toHaveBeenCalledTimes(1);
  });
  it('shows the zoom and spacing without the pointer on the canvas', () => {
    const { container } = bar();
    act(() => { readout.view.value = { upp: 25.4 / 96, grid: 10 }; });
    expect((container.querySelector('[data-testid="status-zoom"]') as HTMLInputElement).value).toBe('100%');
    expect((container.querySelector('[data-testid="status-spacing"]') as HTMLInputElement).value).toBe('10 mm');
  });
  it('the layout does not move: the same elements in the same order whether or not the pointer is on the canvas', () => {
    const { container } = bar();
    const order = () => [...container.querySelectorAll('.st-sketch > *')].map((e) => (e.querySelector('[data-testid]') ?? e).getAttribute('data-testid'));
    const before = order();
    act(() => { readout.cursor.value = { u: 1, v: 2, upp: 0.1, grid: 1 }; readout.from.value = { x: 0, y: 0 }; readout.snapName.value = 'midpoint'; });
    expect(order()).toEqual(before);
    expect(before).toEqual(['status-snap', 'status-grid', 'status-zoom', 'status-spacing', 'status-coords', 'status-delta', 'status-snapname']);
    act(() => clearReadout());
    expect(order()).toEqual(before);
  });
  it('every field has an accessible name and a test id', () => {
    const { container } = bar();
    for (const id of ['status-snap', 'status-grid', 'status-zoom', 'status-spacing']) {
      const el = container.querySelector(`[data-testid="${id}"]`);
      expect(el, id).toBeTruthy();
      expect(el!.getAttribute('aria-label'), id).toBeTruthy();
    }
    expect(container.querySelector('[data-testid="status-zoom"]')!.getAttribute('aria-label')).not.toBe(container.querySelector('[data-testid="status-spacing"]')!.getAttribute('aria-label'));
  });
  it('keys typed in the fields never reach the global shortcuts (Enter confirms the sketch, digits switch the view)', () => {
    const { container } = bar();
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(e.key);
    addEventListener('keydown', spy); addEventListener('keyup', spy);
    try {
      for (const id of ['status-zoom', 'status-spacing']) {
        const input = container.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;
        input.focus();
        for (const key of ['7', '1', 'Enter', 'z', 'Escape']) { fireEvent.keyDown(input, { key }); fireEvent.keyUp(input, { key }); }
      }
      expect(seen).toEqual([]);
      // a key outside the fields still gets through (the spy works)
      fireEvent.keyDown(document.body, { key: '7' });
      expect(seen).toEqual(['7']);
    } finally { removeEventListener('keydown', spy); removeEventListener('keyup', spy); }
  });
  it('the model readout shows the point under the pointer and hides when there is none', () => {
    const { container } = render(<StatusBar notices={[]} hover={null} busy={false} sketch={<ModelReadout />} />);
    expect(container.querySelector('.st-coords')).toBeNull();
    act(() => { readout.model.value = [10, 20.25, -3]; });
    expect(container.querySelector('.st-coords')?.textContent).toBe('10.0 mm, 20.3 mm, -3.0 mm');
  });
});

describe('cursor-following coordinate label', () => {
  const c = { u: 5.61, v: -7.13, upp: 0.01, grid: 1, x: 100, y: 80, w: 800, h: 600 };
  it('says the sketch coordinates in the unit and sits down-right of the pointer', () => {
    expect(cursorLabel(c, null, 'mm', true)).toEqual({ text: '5.61 mm, -7.13 mm', left: 114, top: 94 });
    expect(cursorLabel(c, null, 'in', true)?.text).toBe('0.2209 in, -0.2807 in');
  });
  it('shows where the snap put the point', () => {
    expect(cursorLabel(c, { x: 5, y: -7 }, 'mm', true)?.text).toBe('5.00 mm, -7.00 mm');
  });
  it('is hidden when off, with no pointer, for a finger, or without a reported position', () => {
    expect(cursorLabel(c, null, 'mm', false)).toBeNull();
    expect(cursorLabel(null, null, 'mm', true)).toBeNull();
    expect(cursorLabel({ ...c, touch: true }, null, 'mm', true)).toBeNull();
    expect(cursorLabel({ u: 1, v: 2, upp: 0.1 }, null, 'mm', true)).toBeNull();
  });
  it('flips to the other side near the right and bottom edges', () => {
    const l = cursorLabel({ ...c, x: 780, y: 590 }, null, 'mm', true)!;
    expect(l.left).toBeLessThan(780);
    expect(l.top).toBeLessThan(590);
    expect(l.left).toBeGreaterThanOrEqual(0);
  });
  it('the component follows the readout signal and leaves when the pointer does', () => {
    const { container } = render(<CursorLabel enabled />);
    expect(container.querySelector('[data-testid="cursor-label"]')).toBeNull();
    act(() => { readout.cursor.value = c; });
    expect(container.querySelector('[data-testid="cursor-label"]')?.textContent).toBe('5.61 mm, -7.13 mm');
    act(() => { readout.cursor.value = null; });
    expect(container.querySelector('[data-testid="cursor-label"]')).toBeNull();
  });
  it('the setting defaults on and survives sanitising', () => {
    expect(DEFAULT_SKETCH_PREFS.cursorLabel).toBe(true);
    expect(sanitizeSketchPrefs({ cursorLabel: false }).cursorLabel).toBe(false);
    expect(sanitizeSketchPrefs({ cursorLabel: 'no' }).cursorLabel).toBe(true);
  });
});

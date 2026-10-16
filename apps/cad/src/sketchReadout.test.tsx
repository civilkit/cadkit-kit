import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import { StatusBar } from '@kit/ui';
import { SketchReadout, ModelReadout, readout, clearReadout } from './sketchReadout';
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
    expect(text).toContain('Zoom 265%');
    expect(text).toContain('10 mm');
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
    fireEvent.click(container.querySelector('.st-spacing')!);
    const input = container.querySelector('.st-spacing-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '2.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSpacing).toHaveBeenCalledWith(2.5);
    expect(container.querySelector('.st-spacing-input')).toBeNull();
    fireEvent.click(container.querySelector('.st-spacing')!);
    fireEvent.input(container.querySelector('.st-spacing-input')!, { target: { value: '9' } });
    fireEvent.keyDown(container.querySelector('.st-spacing-input')!, { key: 'Escape' });
    expect(onSpacing).toHaveBeenCalledTimes(1);
  });
  it('the model readout shows the point under the pointer and hides when there is none', () => {
    const { container } = render(<StatusBar notices={[]} hover={null} busy={false} sketch={<ModelReadout />} />);
    expect(container.querySelector('.st-coords')).toBeNull();
    act(() => { readout.model.value = [10, 20.25, -3]; });
    expect(container.querySelector('.st-coords')?.textContent).toBe('10.0 mm, 20.3 mm, -3.0 mm');
  });
});

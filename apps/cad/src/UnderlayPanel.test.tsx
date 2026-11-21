import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { UnderlayPanel, type UnderlayPanelProps } from './UnderlayPanel';
import { newUnderlay } from './underlay';
import './i18n';

afterEach(() => cleanup());

const props = (o: Partial<UnderlayPanelProps> = {}): UnderlayPanelProps => ({
  u: newUnderlay('F3', 'side.png', 'image/png', 'QUJD', 800, 400), calibration: null,
  onChange: vi.fn(), onCalibrate: vi.fn(), onCalibrateCancel: vi.fn(), onCalibrateApply: vi.fn(), onReplace: vi.fn(), onRemove: vi.fn(), onClose: vi.fn(), ...o,
});

describe('UnderlayPanel', () => {
  it('shows the picture and its numbers; the buttons call back', () => {
    const p = props();
    const r = render(<UnderlayPanel {...p} />);
    expect(r.getByTestId('ul-name').textContent).toBe('side.png');
    expect((r.getByTestId('ul-w') as HTMLInputElement).value).toBe('100');
    expect((r.getByTestId('ul-opacity') as HTMLInputElement).value).toBe('50');
    fireEvent.click(r.getByTestId('ul-calibrate')); expect(p.onCalibrate).toHaveBeenCalled();
    fireEvent.click(r.getByTestId('ul-replace')); expect(p.onReplace).toHaveBeenCalled();
    fireEvent.click(r.getByTestId('ul-remove')); expect(p.onRemove).toHaveBeenCalled();
  });
  it('a number applies on Enter or when the field is left, one edit each; junk or a width of 0 puts the old value back', () => {
    const p = props();
    const r = render(<UnderlayPanel {...p} />);
    const w = r.getByTestId('ul-w') as HTMLInputElement;
    fireEvent.input(w, { target: { value: '250,5' } });
    expect(p.onChange).not.toHaveBeenCalled();                       // typing alone is not an edit
    fireEvent.keyDown(w, { key: 'Enter' });
    expect(p.onChange).toHaveBeenLastCalledWith({ w: 250.5 });
    const x = r.getByTestId('ul-x') as HTMLInputElement;
    fireEvent.input(x, { target: { value: '-12' } });
    fireEvent.blur(x);
    expect(p.onChange).toHaveBeenLastCalledWith({ x: -12 });
    const n = (p.onChange as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.input(w, { target: { value: '0' } }); fireEvent.blur(w);
    fireEvent.input(x, { target: { value: 'abc' } }); fireEvent.blur(x);
    expect((p.onChange as ReturnType<typeof vi.fn>).mock.calls.length).toBe(n);
    expect(w.value).toBe('100'); expect(x.value).toBe('0');
  });
  it('opacity, show and lock are one change each; a locked picture cannot be edited or calibrated', () => {
    const p = props();
    const r = render(<UnderlayPanel {...p} />);
    fireEvent.change(r.getByTestId('ul-opacity'), { target: { value: '80' } });
    expect(p.onChange).toHaveBeenLastCalledWith({ opacity: 0.8 });
    fireEvent.click(r.getByTestId('ul-visible')); expect(p.onChange).toHaveBeenLastCalledWith({ visible: false });
    fireEvent.click(r.getByTestId('ul-locked')); expect(p.onChange).toHaveBeenLastCalledWith({ locked: true });
    cleanup();
    const q = render(<UnderlayPanel {...props({ u: { ...newUnderlay('F3', 'a.png', 'image/png', 'QUJD', 8, 4), locked: true } })} />);
    expect((q.getByTestId('ul-w') as HTMLInputElement).disabled).toBe(true);
    expect((q.getByTestId('ul-calibrate') as HTMLButtonElement).disabled).toBe(true);
  });
  it('calibration: the instruction for each step, then the real distance with Enter or the button', () => {
    const a = { x: 0, y: 0 };
    let r = render(<UnderlayPanel {...props({ calibration: { step: 'a' } })} />);
    expect(r.getByTestId('ul-cal').textContent).toMatch(/first point/);
    cleanup();
    r = render(<UnderlayPanel {...props({ calibration: { step: 'b', a } })} />);
    expect(r.getByTestId('ul-cal').textContent).toMatch(/second point/);
    expect(r.queryByTestId('ul-w')).toBeNull();                      // the fields give way to the steps
    cleanup();
    const p = props({ calibration: { step: 'dist', a, b: { x: 40, y: 0 } }, measured: 40 });
    r = render(<UnderlayPanel {...p} />);
    expect(r.getByTestId('ul-cal').textContent).toMatch(/40 mm apart now/);
    const apply = r.getByTestId('ul-cal-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    const real = r.getByTestId('ul-real') as HTMLInputElement;
    fireEvent.input(real, { target: { value: '80' } });
    expect(apply.disabled).toBe(false);
    fireEvent.keyDown(real, { key: 'Enter' });
    expect(p.onCalibrateApply).toHaveBeenLastCalledWith(80);
    fireEvent.input(real, { target: { value: '-5' } });
    expect(apply.disabled).toBe(true);
    fireEvent.click(r.getByTestId('ul-cal-cancel')); expect(p.onCalibrateCancel).toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { TeardropDialog, defaultToward } from './TeardropDialog';
import './i18n';

afterEach(cleanup);
const hole = { mouth: [0, 10, 0] as [number, number, number], out: [0, 1, 0] as [number, number, number], diameter: 8, thickness: 10, through: true };
const setup = (over: Partial<Parameters<typeof TeardropDialog>[0]> = {}) => {
  const p = { hole, up: 'y' as const, onAdd: vi.fn(), onClose: vi.fn(), ...over };
  render(<TeardropDialog {...p} />);
  return p;
};

describe('defaultToward', () => {
  it('prefers the model\'s up direction, and the next best when the hole runs along it', () => {
    expect(defaultToward([1, 0, 0], 'y')).toBe('py');
    expect(defaultToward([1, 0, 0], 'z')).toBe('pz');
    expect(defaultToward([0, 1, 0], 'y')).toBe('pz');   // a vertical hole in a Y-up model: Y is along it
    expect(defaultToward([0, 0, 1], 'z')).toBe('py');
  });
});

describe('TeardropDialog', () => {
  it('describes the hole and adds the plan for the chosen direction', () => {
    const p = setup();
    expect(screen.getByTestId('teardrop-hole').textContent).toContain('8 mm across');
    expect(screen.getByTestId('teardrop-hole').textContent).toContain('through');
    fireEvent.change(screen.getByTestId('teardrop-toward'), { target: { value: 'px' } });
    fireEvent.click(screen.getByTestId('teardrop-add'));
    const choice = (p.onAdd as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(choice.plan.xdir).toEqual([1, 0, 0]);
    expect(choice.plan.reach).toBeCloseTo(4 * Math.SQRT2, 5);
  });
  it('says so and will not add when the print-up direction runs along the hole', () => {
    const p = setup();
    fireEvent.change(screen.getByTestId('teardrop-toward'), { target: { value: 'py' } });
    expect(screen.getByTestId('teardrop-issue').getAttribute('data-issue')).toBe('parallel');
    expect((screen.getByTestId('teardrop-add') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('teardrop-add'));
    expect(p.onAdd).not.toHaveBeenCalled();
  });
  it('a flat top shows its field, and a flat outside the allowed range is refused', () => {
    setup();
    fireEvent.click(screen.getByTestId('teardrop-flat'));
    fireEvent.input(screen.getByTestId('teardrop-flatat'), { target: { value: '1' } });
    expect(screen.getByTestId('teardrop-issue').getAttribute('data-issue')).toBe('flatAt');
    fireEvent.input(screen.getByTestId('teardrop-flatat'), { target: { value: '4' } });
    expect(screen.queryByTestId('teardrop-issue')).toBeNull();
  });
  it('a peak angle outside 20 to 60 is refused', () => {
    setup();
    fireEvent.input(screen.getByTestId('teardrop-angle'), { target: { value: '75' } });
    expect(screen.getByTestId('teardrop-issue').getAttribute('data-issue')).toBe('halfAngle');
  });
  it('a blind hole says how deep, and Escape closes', () => {
    const p = setup({ hole: { ...hole, through: false, thickness: 6 } });
    expect(screen.getByTestId('teardrop-hole').textContent).toContain('6 mm deep');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalled();
  });
  it('offers the other holes of the pattern, on by default, and adds all of them or only the picked one', () => {
    const other = { ...hole, mouth: [10, 10, 0] as [number, number, number] };
    const p = setup({ others: [other, { ...hole, mouth: [20, 10, 0] as [number, number, number] }] });
    expect(screen.getByTestId('teardrop-all')).toBeTruthy();
    fireEvent.change(screen.getByTestId('teardrop-toward'), { target: { value: 'px' } });
    fireEvent.click(screen.getByTestId('teardrop-add'));
    expect((p.onAdd as ReturnType<typeof vi.fn>).mock.calls[0][0].holes.length).toBe(3);
    fireEvent.click(screen.getByTestId('teardrop-all'));
    fireEvent.click(screen.getByTestId('teardrop-add'));
    expect((p.onAdd as ReturnType<typeof vi.fn>).mock.calls[1][0].holes.length).toBe(1);
  });
  it('shows no pattern choice for a single hole', () => {
    setup();
    expect(screen.queryByTestId('teardrop-all')).toBeNull();
  });
  it('labels the model\'s up direction, so it is clear which choice is up', () => {
    setup({ up: 'y', hole: { ...hole, out: [1, 0, 0] as [number, number, number] } });
    const options = [...screen.getByTestId('teardrop-toward').querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toContain('+Y (up)');
    expect(options).toContain('+Z');
    expect(options).not.toContain('+Z (up)');
  });
  it('marks a bad value for assistive technology and says what to enter', () => {
    setup();
    fireEvent.input(screen.getByTestId('teardrop-angle'), { target: { value: '75' } });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Enter an overhang angle from 20 to 60 degrees');
    expect(screen.getByTestId('teardrop-angle').getAttribute('aria-invalid')).toBe('true');
  });
  it('tells how wide the peak is, not only how far it reaches', () => {
    setup();
    expect(screen.getByTestId('teardrop-reach').textContent).toContain('90 degrees wide');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { EquationPanel } from './EquationPanel';
import { en as catalogue } from './locales/en';
const en = (k: string): string => String((catalogue as Record<string, unknown>)[k]);
import './i18n';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const fields = { x: 't/9', y: '5*sin(t)', t0: '0', t1: '360', tol: 0.01 };
const props = () => ({ fields, result: null, onChange: vi.fn(), onDone: vi.fn(), onDelete: vi.fn() });

describe('EquationPanel', () => {
  it('sends the formulas after a pause while typing, and at once on Enter', () => {
    vi.useFakeTimers();
    const p = props();
    render(<EquationPanel {...p} />);
    const x = screen.getByLabelText(en('app.sketch.equation.x')) as HTMLInputElement;
    fireEvent.input(x, { target: { value: 'R*cos(t)' } });
    expect(p.onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(p.onChange).toHaveBeenCalledWith({ ...fields, x: 'R*cos(t)' });
    p.onChange.mockClear();
    const t1 = screen.getByLabelText(en('app.sketch.equation.t1')) as HTMLInputElement;
    fireEvent.input(t1, { target: { value: '720' } });
    fireEvent.keyDown(t1, { key: 'Enter' });
    expect(p.onChange).toHaveBeenCalledWith({ ...fields, x: 'R*cos(t)', t1: '720' });
  });
  it('ignores a tolerance that is not a positive number', () => {
    vi.useFakeTimers();
    const p = props();
    render(<EquationPanel {...p} />);
    const tol = screen.getByLabelText(en('app.sketch.equation.tol')) as HTMLInputElement;
    fireEvent.input(tol, { target: { value: '-1' } });
    vi.advanceTimersByTime(400);
    expect(p.onChange).not.toHaveBeenCalled();
    fireEvent.input(tol, { target: { value: '0,05' } });
    vi.advanceTimersByTime(400);
    expect(p.onChange).toHaveBeenCalledWith({ ...fields, tol: 0.05 });
  });
  it('a preset fills every field and is sent at once', () => {
    const p = props();
    render(<EquationPanel {...p} />);
    fireEvent.change(screen.getByLabelText(en('app.sketch.equation.preset')), { target: { value: 'circle' } });
    expect(p.onChange).toHaveBeenCalledWith({ x: '20*cos(t)', y: '20*sin(t)', t0: '0', t1: '360', tol: 0.01 });
    expect((screen.getByLabelText(en('app.sketch.equation.x')) as HTMLInputElement).value).toBe('20*cos(t)');
  });
  it('shows the kernel verdict: checking, the point count, a warning, a refusal in plain words', () => {
    const p = props();
    const { rerender, container } = render(<EquationPanel {...p} />);
    expect(screen.getByText(en('app.sketch.equation.checking'))).toBeTruthy();
    rerender(<EquationPanel {...p} result={{ pts: [], closed: true, count: 18, deviation: 0.007, tol: 0.01, warnings: [{ code: 'equationSelfIntersects', detail: 'near (1, 2)' }] }} />);
    expect(container.querySelector('[data-note="app.sketch.equation.info.closed"]')!.textContent).toContain('18');
    expect(container.querySelector('[data-note="app.sketch.equation.warn.equationSelfIntersects"]')!.textContent).toContain('near (1, 2)');
    rerender(<EquationPanel {...p} result={{ error: "equationFormula: y(t): uses the unknown name 'q'" }} />);
    const err = container.querySelector('[data-note="app.sketch.equation.err.equationFormula"]')!;
    expect(err.className).toContain('err');
    expect(err.textContent).toContain("unknown name 'q'");
  });
  it('Done and Delete', () => {
    const p = props();
    render(<EquationPanel {...p} />);
    fireEvent.click(screen.getByText(en('app.sketch.equation.delete')));
    expect(p.onDelete).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(en('app.sketch.equation.done')));
    expect(p.onDone).toHaveBeenCalled();
  });
});

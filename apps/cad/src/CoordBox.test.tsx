import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { VarsContext } from '@kit/ui';
import { opensCoordBox, placeCoordBox, coordBoxText } from '@kit/sketch';
import { CoordBox } from './CoordBox';
import './i18n';

afterEach(cleanup);
const scope = { vars: [], values: { w: 60 }, errors: {} };
const mount = (initial: string, onSubmit = vi.fn(), onCancel = vi.fn()) => {
  render(<VarsContext.Provider value={scope}><CoordBox initial={initial} x={10} y={10} onSubmit={onSubmit} onCancel={onCancel} /></VarsContext.Provider>);
  return { input: screen.getByRole('textbox') as HTMLInputElement, onSubmit, onCancel };
};
const enter = (el: HTMLElement) => fireEvent.keyDown(el, { key: 'Enter' });

describe('CoordBox', () => {
  it('starts with the key that opened it, focused, and Enter places the typed x,y', () => {
    const { input, onSubmit } = mount('-');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('-');
    fireEvent.input(input, { target: { value: '-30,0' } });
    enter(input);
    expect(onSubmit).toHaveBeenCalledWith({ x: -30, y: 0 });
  });
  it('reads variables and expressions, keeping the text for the dimension link', () => {
    const { input, onSubmit } = mount('');
    fireEvent.input(input, { target: { value: 'w/2,0' } });
    enter(input);
    expect(onSubmit).toHaveBeenCalledWith({ x: 30, y: 0, xExpr: 'w/2' });
  });
  it('refuses text that is not two values: nothing is placed and the box says so', () => {
    const { input, onSubmit } = mount('');
    fireEvent.input(input, { target: { value: '5' } });
    enter(input);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
  it('Escape closes it, and typed letters never reach the tool shortcuts', () => {
    const { input, onCancel } = mount('');
    const up = vi.fn();
    document.addEventListener('keydown', up);
    fireEvent.keyDown(input, { key: 'c' });
    expect(up).not.toHaveBeenCalled();
    document.removeEventListener('keydown', up);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('opensCoordBox', () => {
  it('digits, minus, point, @ and g open it while a first-point tool waits; letters that are tool keys do not', () => {
    for (const k of ['5', '-', '.', '@', 'g', 'G']) expect(opensCoordBox(k, 'circle')).toBe(true);
    for (const k of ['c', 'l', 'x', 'Enter', 'Escape']) expect(opensCoordBox(k, 'circle')).toBe(false);
  });
  it('only for tools that take a first point, and not with a modifier', () => {
    expect(opensCoordBox('5', 'trim')).toBe(false);
    expect(opensCoordBox('5', null)).toBe(false);
    expect(opensCoordBox('5', 'point', { ctrlKey: true })).toBe(false);
    for (const id of ['line', 'circle', 'point', 'rectangle', 'arc-centre']) expect(opensCoordBox('1', id)).toBe(true);
  });
});

describe('CoordBox fast typing and placement', () => {
  it('keys typed in quick succession, before the input has focus, all end up in the box', () => {
    // the app's key handler appends each key to the open box's text; the box is re-rendered with it
    const view = (initial: string) => <VarsContext.Provider value={scope}><CoordBox initial={initial} x={10} y={10} onSubmit={vi.fn()} onCancel={vi.fn()} /></VarsContext.Provider>;
    let text: string | null = null;
    const r = render(view(coordBoxText(null, '-')));
    text = '-';
    for (const k of ['3', '0', ',', '0']) { text = coordBoxText(text, k); r.rerender(view(text)); }
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('-30,0');
    expect(document.activeElement).toBe(input);
  });
  it('G opens it empty and adds nothing to the text', () => {
    expect(coordBoxText(null, 'g')).toBe('');
    expect(coordBoxText('-3', '0')).toBe('-30');
  });
  it('placeCoordBox keeps the box fully inside, flipping left and up near the edges', () => {
    expect(placeCoordBox(100, 100, 200, 40, 1441, 727)).toEqual({ left: 116, top: 116 });
    const a = placeCoordBox(1430, 100, 200, 40, 1441, 727);
    expect(a.left + 200).toBeLessThanOrEqual(1441); expect(a.left).toBeLessThan(1430);
    const b = placeCoordBox(100, 720, 200, 40, 1441, 727);
    expect(b.top + 40).toBeLessThanOrEqual(727); expect(b.top).toBeLessThan(720);
    const c = placeCoordBox(5000, 5000, 200, 40, 300, 100);
    expect(c.left + 200).toBeLessThanOrEqual(300); expect(c.top + 40).toBeLessThanOrEqual(100);
  });
  it('the rendered box is moved inside when the pointer is at the right edge', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 40 } as DOMRect);
    render(<VarsContext.Provider value={scope}><CoordBox initial="" x={1430} y={100} onSubmit={vi.fn()} onCancel={vi.fn()} /></VarsContext.Provider>);
    const left = parseFloat((document.querySelector('.coord-box') as HTMLElement).style.left);
    spy.mockRestore();
    expect(left + 200).toBeLessThanOrEqual(window.innerWidth);
  });
});

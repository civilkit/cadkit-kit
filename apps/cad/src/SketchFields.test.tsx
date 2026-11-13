import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { KeyboardPrimer, PRIMER_ID, SketchFields, armKeyboardPrime, focusSketchField, primeSketchKeyboard, parseTyped, stepText } from './SketchFields';
import './i18n';

afterEach(cleanup);
const field = { id: 'len', label: 'app.sketch.field.length', value: 7, locked: false, unit: 'length' as const };

describe('parseTyped', () => {
  it('reads decimals, a comma as the point, and refuses what is not a number', () => {
    expect(parseTyped('3.5')).toBe(3.5);
    expect(parseTyped(' 3,5 ')).toBe(3.5);
    expect(parseTyped('-0.25')).toBe(-0.25);
    expect(parseTyped('3.')).toBe(3);
    expect(parseTyped('')).toBeNull();
    expect(parseTyped('abc')).toBeNull();
    expect(parseTyped('1e999')).toBeNull();
  });
});

describe('SketchFields', () => {
  it('keeps what is typed while the field has focus: 3, 3. and 3.5 all stay as typed', () => {
    const onField = vi.fn();
    render(<SketchFields fields={[field]} x={0} y={0} onField={onField} />);
    const input = screen.getByLabelText('len') as HTMLInputElement;
    input.focus();
    for (const typed of ['3', '3.', '3.5']) {
      fireEvent.input(input, { target: { value: typed } });
      expect(input.value).toBe(typed);
    }
    expect(onField).toHaveBeenLastCalledWith('len', 3.5, false);
  });
  it('Enter locks the typed value', () => {
    const onField = vi.fn();
    render(<SketchFields fields={[field]} x={0} y={0} onField={onField} />);
    const input = screen.getByLabelText('len') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '12.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onField).toHaveBeenLastCalledWith('len', 12.5, true);
  });
  it('a phone check key that arrives as keyCode 13 under another key name locks the value too', () => {
    const onField = vi.fn();
    render(<SketchFields fields={[field]} x={0} y={0} onField={onField} />);
    const input = screen.getByLabelText('len') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Unidentified', keyCode: 13 });
    expect(onField).toHaveBeenLastCalledWith('len', 9, true);
  });
  it('shows the current value when nothing is being typed', () => {
    render(<SketchFields fields={[{ ...field, value: 3.14159 }]} x={0} y={0} onField={() => {}} />);
    expect((screen.getByLabelText('len') as HTMLInputElement).value).toBe('3.14');
  });
  it('name = value defines the parameter, then locks the value linked to it', async () => {
    const onField = vi.fn(), onDefine = vi.fn().mockResolvedValue(true);
    render(<SketchFields fields={[field]} x={0} y={0} onField={onField} onDefine={onDefine} />);
    const input = screen.getByLabelText('len') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'w = 4*2' } });
    expect(onField).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onDefine).toHaveBeenCalledWith('w', '=4*2');
    await Promise.resolve(); await Promise.resolve();
    expect(onField).toHaveBeenLastCalledWith('len', 8, true, 'w');
  });
  it('a refused definition locks nothing, and without onDefine the text is just an expression', async () => {
    const onField = vi.fn(), onDefine = vi.fn().mockResolvedValue(false);
    render(<SketchFields fields={[field]} x={0} y={0} onField={onField} onDefine={onDefine} />);
    const input = screen.getByLabelText('len') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'w = 4' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await Promise.resolve(); await Promise.resolve();
    expect(onField).not.toHaveBeenCalled();
  });
});

describe('SketchFields: relative angle switch', () => {
  it('shows a labelled switch beside the angle box and sends the turn event', () => {
    const onField = vi.fn();
    const ang = { id: 'ang', label: 'app.sketch.field.angle', value: 30, locked: false, unit: 'angle' as const, toggle: { id: 'turn', on: false, label: 'app.sketch.field.turn', tip: 'app.sketch.field.turn.tipOff' } };
    render(<SketchFields fields={[field, ang]} x={0} y={0} onField={onField} />);
    const btn = screen.getByTestId('field-turn');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBeTruthy();
    fireEvent.click(btn);
    expect(onField).toHaveBeenLastCalledWith('turn', 1, false);
  });
});

describe('SketchFields: typing that starts with no field focused', () => {
  const len = { id: 'len', label: 'app.sketch.field.length', value: 0, locked: false, unit: 'length' as const };
  const ang = { id: 'ang', label: 'app.sketch.field.angle', value: -90, locked: false, unit: 'angle' as const };
  it('the first field takes the whole seed, replacing its text, and has focus', () => {
    const onField = vi.fn();
    const { rerender } = render(<SketchFields fields={[len, ang]} x={0} y={0} onField={onField} seed={{ n: 0, text: '' }} />);
    rerender(<SketchFields fields={[len, ang]} x={0} y={0} onField={onField} seed={{ n: 1, text: '1' }} />);
    const input = screen.getByLabelText('len') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('1');
    // the next fast key arrives before the field had focus in the browser: the seed holds both characters
    rerender(<SketchFields fields={[len, ang]} x={0} y={0} onField={onField} seed={{ n: 2, text: '10' }} />);
    expect(input.value).toBe('10');
    expect(onField).toHaveBeenLastCalledWith('len', 10, false);
  });
  it('a seed that is already there when the fields appear (first render) is applied too', () => {
    render(<SketchFields fields={[len, ang]} x={0} y={0} onField={vi.fn()} seed={{ n: 3, text: '180' }} />);
    expect((screen.getByLabelText('len') as HTMLInputElement).value).toBe('180');
  });
  it('every field selects its text when it gets focus, so typing replaces it', () => {
    render(<SketchFields fields={[len, ang]} x={0} y={0} onField={vi.fn()} />);
    const a = screen.getByLabelText('ang') as HTMLInputElement;
    a.value = '-90';
    a.focus();
    expect(a.selectionStart).toBe(0);
    expect(a.selectionEnd).toBe(a.value.length);
  });
  it('the value box widens when a long expression is typed', () => {
    render(<SketchFields fields={[field]} x={0} y={0} onField={vi.fn()} />);
    const input = screen.getByLabelText('len') as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: '=width*2+wall*3+depth/4' } });
    expect(parseInt(input.style.width)).toBeGreaterThan(64);
  });
});

describe('step arrows in a value box', () => {
  it('steps a plain number by 1, Shift 10, Alt 0.1, without float noise', () => {
    expect(stepText('7', 1)).toBe('8');
    expect(stepText('7', -1)).toBe('6');
    expect(stepText('7', 1, { shift: true })).toBe('17');
    expect(stepText('0.3', 1, { alt: true })).toBe('0.4');
    expect(stepText('0.1', -1, { alt: true })).toBe('0');
    expect(stepText('2,5', 1)).toBe('3.5');
    expect(stepText('3', 1, { alt: true }, true)).toBe('4');   // a count stays whole
  });
  it('leaves expressions, names and empty text alone', () => {
    expect(stepText('=w*2', 1)).toBeNull();
    expect(stepText('wall', 1)).toBeNull();
    expect(stepText('w = 5', 1)).toBeNull();
    expect(stepText('', 1)).toBeNull();
  });
  it('ArrowUp and ArrowDown in the field change the live value; an expression is not touched', () => {
    const onField = vi.fn();
    render(<SketchFields fields={[field]} x={0} y={0} onField={onField} />);
    const input = screen.getByLabelText('len') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '10' } });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('11');
    expect(onField).toHaveBeenLastCalledWith('len', 11, false);
    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
    expect(onField).toHaveBeenLastCalledWith('len', 1, false);
    fireEvent.keyDown(input, { key: 'ArrowUp', altKey: true });
    expect(onField).toHaveBeenLastCalledWith('len', 1.1, false);
    fireEvent.input(input, { target: { value: '=w*2' } });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('=w*2');
    fireEvent.input(input, { target: { value: '5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onField).toHaveBeenLastCalledWith('len', 5, true);
  });
});

describe('the keyboard after a finger or pen lift (iOS only raises it for a focus() inside the gesture handler)', () => {
  it('focusSketchField focuses and selects the first value field at once, and says so', () => {
    const { container } = render(<SketchFields fields={[field]} x={10} y={10} onField={() => {}} />);
    const input = container.querySelector('.sketch-fields input') as HTMLInputElement;
    expect(focusSketchField()).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
  it('with no field on screen it reports false and moves nothing', () => {
    render(<div />);
    expect(focusSketchField()).toBe(false);
  });
  it('focus is called synchronously from the pointerup handler path, on the primer when the field has not rendered yet', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'focus');
    const seen: string[] = [];
    const { container } = render(<div><KeyboardPrimer /><div data-testid="canvas" onPointerUp={() => { primeSketchKeyboard(); seen.push((document.activeElement as HTMLElement | null)?.id ?? ''); }} /></div>);
    fireEvent.pointerUp(container.querySelector('[data-testid="canvas"]')!, { pointerType: 'pen' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([PRIMER_ID]);   // already focused when the handler returns, with no waiting for a render
    spy.mockRestore();
  });
  it('a focus made in pointerup is lost to the mousedown that follows, so the click after the lift makes it', () => {
    const { container } = render(<div><KeyboardPrimer /><button data-testid="canvas" /></div>);
    const canvas = container.querySelector('[data-testid="canvas"]') as HTMLElement;
    armKeyboardPrime();
    fireEvent.pointerUp(canvas, { pointerType: 'touch' });
    expect(document.activeElement?.id).not.toBe(PRIMER_ID);   // nothing yet: pointerup does not focus
    fireEvent.click(canvas);
    expect(document.activeElement?.id).toBe(PRIMER_ID);       // in the click, synchronously
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(canvas);                                  // one-shot: a later click does not steal the focus
    expect(document.activeElement?.id).not.toBe(PRIMER_ID);
  });
  it('an armed focus that sees no click is dropped after 600 ms', () => {
    vi.useFakeTimers();
    const { container } = render(<div><KeyboardPrimer /><button data-testid="canvas" /></div>);
    armKeyboardPrime();
    vi.advanceTimersByTime(700);
    fireEvent.click(container.querySelector('[data-testid="canvas"]')!);
    expect(document.activeElement?.id).not.toBe(PRIMER_ID);
    vi.useRealTimers();
  });
  it('the field that appears afterwards takes the focus from the primer (the keyboard stays up between boxes)', async () => {
    const view = render(<div><KeyboardPrimer /></div>);
    expect(primeSketchKeyboard()).toBe(true);
    expect(document.activeElement?.id).toBe(PRIMER_ID);
    view.rerender(<div><KeyboardPrimer /><SketchFields fields={[field]} x={1} y={1} seed={{ n: 1, text: null }} onField={() => {}} /></div>);
    await Promise.resolve();
    expect(document.activeElement?.closest('.sketch-fields')).not.toBeNull();
  });
  it('with useField off the primer is focused even when a field is on screen (the shape being finished takes its fields with it)', () => {
    render(<div><KeyboardPrimer /><SketchFields fields={[field]} x={1} y={1} onField={() => {}} /></div>);
    expect(primeSketchKeyboard(document, window, false)).toBe(true);
    expect(document.activeElement?.id).toBe(PRIMER_ID);
  });
  it('the primer lets go when no field comes', () => {
    vi.useFakeTimers();
    render(<KeyboardPrimer />);
    primeSketchKeyboard();
    expect(document.activeElement?.id).toBe(PRIMER_ID);
    vi.advanceTimersByTime(1600);
    expect(document.activeElement?.id).not.toBe(PRIMER_ID);
    vi.useRealTimers();
  });
  it('the primer is a 16 px, hidden, unsuggestive number box', () => {
    const { container } = render(<KeyboardPrimer />);
    const el = container.querySelector('#' + PRIMER_ID) as HTMLInputElement;
    expect(el.getAttribute('inputmode')).toBe('decimal');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('autocorrect')).toBe('off');
  });
});

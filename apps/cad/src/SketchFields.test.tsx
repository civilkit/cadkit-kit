import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { SketchFields, parseTyped } from './SketchFields';
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
});

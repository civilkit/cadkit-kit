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
});

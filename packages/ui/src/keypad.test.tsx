import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { SignKey, flipFocusedSign, flipSign, numberAttrs, searchAttrs, textAttrs } from './keypad';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const coarse = (on: boolean) => { window.matchMedia = ((q: string) => ({ matches: on && /coarse/.test(q), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia; };

describe('number keyboards', () => {
  it('a signed box carries the sign-key marker, a size does not, a count gets the digit pad', () => {
    expect(numberAttrs('signed')).toMatchObject({ inputMode: 'decimal', 'data-sign': '' });
    expect(numberAttrs('positive')).toEqual({ inputMode: 'decimal', enterKeyHint: 'done', autocomplete: 'off' });
    expect(numberAttrs('integer').inputMode).toBe('numeric');
    expect(numberAttrs('signed', 'next').enterKeyHint).toBe('next');
  });
  it('names and search boxes switch the suggestions off; search says Search', () => {
    expect(textAttrs).toMatchObject({ autocapitalize: 'off', autocorrect: 'off', spellcheck: false, autocomplete: 'off' });
    expect(searchAttrs).toMatchObject({ type: 'search', enterKeyHint: 'search', autocapitalize: 'off' });
  });
  it('flipSign adds and removes the minus, also on a formula', () => {
    expect(flipSign('5')).toBe('-5');
    expect(flipSign('-5')).toBe('5');
    expect(flipSign('')).toBe('-');
    expect(flipSign('=w*2')).toBe('-=w*2');
  });
});

describe('the sign key', () => {
  it('is not on screen until a signed box has the focus on a finger device, and goes when focus leaves it', async () => {
    coarse(true);
    const { container, queryByTestId } = render(<div><SignKey /><input data-sign="" inputMode="decimal" /><input inputMode="decimal" /></div>);
    const [signed, plain] = [...container.querySelectorAll('input')] as HTMLInputElement[];
    expect(queryByTestId('sign-key')).toBeNull();
    signed.focus();
    await Promise.resolve();
    expect(queryByTestId('sign-key')).not.toBeNull();
    plain.focus();
    await new Promise((r) => setTimeout(r, 5));
    expect(queryByTestId('sign-key')).toBeNull();
  });
  it('never shows with a mouse (the keyboard has a minus)', async () => {
    coarse(false);
    const { container, queryByTestId } = render(<div><SignKey /><input data-sign="" /></div>);
    (container.querySelector('input') as HTMLInputElement).focus();
    await Promise.resolve();
    expect(queryByTestId('sign-key')).toBeNull();
  });
  it('flips the sign of the focused box and tells the framework, without taking the focus', async () => {
    coarse(true);
    const seen: string[] = [];
    const { container, getByTestId } = render(<div><SignKey /><input data-sign="" value="12.5" onInput={(e) => seen.push(e.currentTarget.value)} /></div>);
    const input = container.querySelector('input') as HTMLInputElement;
    input.focus();
    await Promise.resolve();
    const down = fireEvent.pointerDown(getByTestId('sign-key'), { cancelable: true });
    expect(down).toBe(false);   // default prevented: the box keeps the focus
    fireEvent.click(getByTestId('sign-key'));
    expect(seen).toEqual(['-12.5']);
    fireEvent.click(getByTestId('sign-key'));
    expect(seen).toEqual(['-12.5', '12.5']);
    expect(document.activeElement).toBe(input);
  });
  it('a number box with nothing readable in it is left alone', () => {
    const { container } = render(<input type="number" data-sign="" />);
    (container.querySelector('input') as HTMLInputElement).focus();
    expect(flipFocusedSign()).toBe(false);
  });
});

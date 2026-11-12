import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { ExprInput, VarsContext, growWidth } from './ExprInput';
import { FeatureEditor } from './FeatureEditor';
import { resolveVariables } from './expr';

afterEach(cleanup);
const scope = resolveVariables([{ name: 'width', expr: '30' }, { name: 'wall', expr: '2' }]);

function setup(initial: number | string = 5, opts: { plain?: boolean } = {}) {
  const values: Array<number | string> = [];
  const r = render(
    <VarsContext.Provider value={scope}><ExprInput value={initial} unit="mm" label="Depth" plain={opts.plain} onValue={(v) => values.push(v)} /></VarsContext.Provider>,
  );
  const input = r.container.querySelector('input') as HTMLInputElement;
  return { r, input, values, hint: () => r.container.querySelector('.expr-hint')?.textContent ?? null };
}

describe('ExprInput grow', () => {
  it('a box that grows is 64 px for a short value and widens for a long formula, up to a cap', () => {
    expect(growWidth('12.5')).toBe(64);
    expect(growWidth('=width*2+wall*3+sqrt(depth)')).toBeGreaterThan(64);
    expect(growWidth('x'.repeat(200))).toBe(320);
    const r = render(<VarsContext.Provider value={scope}><ExprInput value={5} label="Depth" grow onValue={() => {}} /></VarsContext.Provider>);
    const input = r.container.querySelector('input') as HTMLInputElement;
    expect(input.style.width).toBe('64px');
    fireEvent.input(input, { target: { value: '=width*2+wall*3+width' } });
    expect(parseInt(input.style.width)).toBeGreaterThan(64);
  });
  it('a box without grow keeps the stylesheet width', () => {
    const r = render(<VarsContext.Provider value={scope}><ExprInput value={5} label="Depth" onValue={() => {}} /></VarsContext.Provider>);
    expect((r.container.querySelector('input') as HTMLInputElement).style.width).toBe('');
  });
});

describe('ExprInput', () => {
  it('a plain number stays a number, with no hint', () => {
    const m = setup();
    fireEvent.input(m.input, { target: { value: '12,5' } });
    expect(m.values.at(-1)).toBe(12.5);
    expect(m.hint()).toBeNull();
  });

  it('=width*2+3 is stored as the expression and shows the evaluated value', () => {
    const m = setup();
    fireEvent.input(m.input, { target: { value: '=width*2+3' } });
    expect(m.values.at(-1)).toBe('=width*2+3');
    expect(m.hint()).toBe('= 63 mm');
  });

  it('a bare variable name becomes =name', () => {
    const m = setup();
    fireEvent.input(m.input, { target: { value: 'wall' } });
    expect(m.values.at(-1)).toBe('=wall');
    expect(m.hint()).toBe('= 2 mm');
  });

  it('a bad expression shows the message and is not applied', () => {
    const m = setup();
    fireEvent.input(m.input, { target: { value: '=width*' } });
    expect(m.values).toEqual([]);
    expect(m.hint()).toBe('Not a valid expression');
    expect(m.input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.input(m.input, { target: { value: '=nope+1' } });
    expect(m.values).toEqual([]);
    expect(m.hint()).toBe('Unknown variable: nope');
  });

  it('an expression value is marked driven; the fx badge turns it into its number', () => {
    const m = setup('=width/2');
    expect(m.r.container.querySelector('.expr-field.driven')).not.toBeNull();
    expect(m.input.value).toBe('=width/2');
    fireEvent.click(m.r.container.querySelector('.expr-fx')!);
    expect(m.values.at(-1)).toBe(15);
  });

  it('completes variable names with the arrow keys and Enter', () => {
    const m = setup();
    fireEvent.focus(m.input);
    fireEvent.input(m.input, { target: { value: '=w' } });
    const items = [...m.r.container.querySelectorAll('.expr-ac li')].map((x) => x.querySelector('.expr-ac-name')!.textContent);
    expect(items).toEqual(['width', 'wall']);
    fireEvent.keyDown(m.input, { key: 'ArrowDown' });
    fireEvent.keyDown(m.input, { key: 'Enter' });
    expect(m.input.value).toBe('=wall');
    expect(m.values.at(-1)).toBe('=wall');
  });

  it('plain fields refuse expressions', () => {
    const m = setup(5, { plain: true });
    fireEvent.input(m.input, { target: { value: '=width' } });
    expect(m.values).toEqual([]);
    expect(m.hint()).toBe('This field takes a plain number');
  });
});

describe('FeatureEditor with expressions', () => {
  it('a numeric field takes =expr and keeps it in the draft; a stored expression shows as driven', () => {
    const drafts: Array<Record<string, unknown>> = [];
    const feature = { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: '=width/2', flip: false };
    const { container } = render(
      <VarsContext.Provider value={scope}><FeatureEditor feature={feature} onDraft={(d) => drafts.push(d)} onConfirm={() => {}} onCancel={() => {}} /></VarsContext.Provider>,
    );
    const depth = container.querySelector('[data-path="depth"]')!;
    expect(depth.querySelector('.expr-field.driven')).not.toBeNull();
    expect(depth.querySelector('.expr-hint')!.textContent).toBe('= 15 mm');
    fireEvent.input(depth.querySelector('input')!, { target: { value: '=wall*4' } });
    expect(drafts.at(-1)).toEqual({ depth: '=wall*4' });
  });
});

describe('ExprInput on a phone keypad', () => {
  const attr = (m: ReturnType<typeof setup>, n: string) => m.input.getAttribute(n);
  it('asks for the decimal keypad and a Done key', () => {
    const m = setup();
    expect(attr(m, 'inputmode')).toBe('decimal');
    expect(attr(m, 'enterkeyhint')).toBe('done');
  });
  it('a whole-number field asks for the digit pad, and a field with a next one says Next', () => {
    const r = render(<ExprInput value={3} label="Count" integer enterKeyHint="next" onValue={() => {}} />);
    const i = r.container.querySelector('input')!;
    expect(i.getAttribute('inputmode')).toBe('numeric');
    expect(i.getAttribute('enterkeyhint')).toBe('next');
    expect(r.container.querySelector('.expr-sign')).toBeNull();   // a count has no minus
  });
  it('the formula key switches to the full keyboard and back; a field driven by an expression starts there', () => {
    const m = setup();
    const kb = m.r.container.querySelector('.expr-kb') as HTMLButtonElement;
    fireEvent.click(kb);
    expect(m.input.getAttribute('inputmode')).toBe('text');
    fireEvent.click(kb);
    expect(m.input.getAttribute('inputmode')).toBe('decimal');
    const d = setup('=width*2');
    expect(d.input.getAttribute('inputmode')).toBe('text');
  });
  it('the sign key flips the minus of a number and does not take the focus', () => {
    const m = setup(5);
    const sign = m.r.container.querySelector('.expr-sign') as HTMLButtonElement;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    sign.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);   // the keyboard stays up
    fireEvent.click(sign);
    expect(m.values.at(-1)).toBe(-5);
    fireEvent.click(sign);
    expect(m.values.at(-1)).toBe(5);
  });
  it('a field that takes only plain numbers has no formula key; one that cannot be negative has no sign key', () => {
    const m = setup(5, { plain: true });
    expect(m.r.container.querySelector('.expr-kb')).toBeNull();
    const r = render(<ExprInput value={5} min={0} onValue={() => {}} />);
    expect(r.container.querySelector('.expr-sign')).toBeNull();
  });
});

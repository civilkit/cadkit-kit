import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { SpringWizard } from './SpringWizard';
import { DEFAULT_SPRING, type SpringParams } from './spring';
import './i18n';

afterEach(() => cleanup());

function mount(params: SpringParams = DEFAULT_SPRING, hint?: string) {
  const drafts: SpringParams[] = [], applies: SpringParams[] = [];
  let cancelled = 0;
  const r = render(<SpringWizard params={params} hint={hint} onDraft={(d) => drafts.push(d)} onApply={(d) => applies.push(d)} onCancel={() => { cancelled++; }} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const select = (path: string) => r.container.querySelector(`[data-path="${path}"] select`) as HTMLSelectElement;
  return { r, drafts, applies, cancelled: () => cancelled, q, input, select };
}

describe('SpringWizard', () => {
  it('previews its defaults at once and shows the pitch it works out', () => {
    const m = mount();
    expect(m.drafts.length).toBe(1);
    expect(m.q('[data-testid="spring-summary"]').textContent).toContain('4.75');
    expect(m.q('[data-testid="spring-ground-note"]')).not.toBeNull();
  });
  it('every valid change drafts the whole record', () => {
    const m = mount();
    fireEvent.change(m.input('coils'), { target: { value: '10' } });
    expect(m.drafts.at(-1)).toMatchObject({ outer: 20, wire: 2, length: 40, coils: 10 });
    fireEvent.change(m.select('hand'), { target: { value: 'left' } });
    expect(m.drafts.at(-1)).toMatchObject({ hand: 'left', coils: 10 });
    fireEvent.change(m.select('axis'), { target: { value: 'px' } });
    expect(m.drafts.at(-1)?.axis).toBe('px');
    fireEvent.change(m.input('x'), { target: { value: '5' } });
    expect(m.drafts.at(-1)?.origin).toEqual([5, 0, 0]);
  });
  it('a problem blocks Add and the preview, and says why', () => {
    const m = mount();
    const before = m.drafts.length;
    fireEvent.change(m.input('coils'), { target: { value: '40' } });
    expect(m.drafts.length).toBe(before);
    expect((m.q('[data-testid="spring-apply"]') as HTMLButtonElement).disabled).toBe(true);
    expect(m.q('[data-issue="pitch"]').textContent).toMatch(/touch/);
    fireEvent.click(m.q('[data-testid="spring-apply"]'));
    expect(m.applies.length).toBe(0);
  });
  it('Add applies the current record; Cancel and Escape cancel', () => {
    const m = mount();
    fireEvent.change(m.input('length'), { target: { value: '50' } });
    fireEvent.click(m.q('[data-testid="spring-apply"]'));
    expect(m.applies).toHaveLength(1);
    expect(m.applies[0]).toMatchObject({ length: 50 });
    fireEvent.click(m.q('[data-testid="spring-cancel"]'));
    fireEvent.keyDown(m.q('[data-testid="spring-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(2);
  });
  it('shows the preview failure the app hands in', () => {
    const m = mount(DEFAULT_SPRING, 'kernel said no');
    expect(m.q('[data-testid="spring-hint"]').textContent).toBe('kernel said no');
  });
});

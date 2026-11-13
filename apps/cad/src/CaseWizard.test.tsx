import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { CaseWizard } from './CaseWizard';
import { DEFAULT_CASE, type CaseParams } from './case';
import './i18n';

afterEach(() => cleanup());

function mount(params: CaseParams = DEFAULT_CASE, extra: { hint?: string; hasOthers?: boolean } = {}) {
  const drafts: CaseParams[] = [], applies: CaseParams[] = [];
  let cancelled = 0;
  const r = render(<CaseWizard params={params} {...extra} onDraft={(d) => drafts.push(d)} onApply={(d) => applies.push(d)} onCancel={() => { cancelled++; }} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const select = (path: string) => r.container.querySelector(`[data-path="${path}"] select`) as HTMLSelectElement;
  return { r, drafts, applies, cancelled: () => cancelled, q, input, select };
}

describe('CaseWizard', () => {
  it('shows the defaults, previews them at once and says what is not included', () => {
    const m = mount();
    expect(m.drafts).toHaveLength(1);
    expect(m.input('width').value).toBe('80');
    expect(m.input('depth').value).toBe('50');
    expect(m.input('height').value).toBe('30');
    expect(m.input('wall').value).toBe('2');
    expect(m.input('radius').value).toBe('0');
    expect(m.input('lidHeight').value).toBe('7.5');
    expect(m.input('tongueHeight').value).toBe('1.5');
    expect(m.input('tongueFraction').value).toBe('0.5');
    expect(m.input('clearance').value).toBe('0.2');
    expect(m.select('tongueOn').value).toBe('lid');
    expect(m.input('baseName').value).toBe('Base');
    expect(m.input('lidName').value).toBe('Lid');
    expect(m.q('[data-testid="case-summary"]').textContent).toContain('Base 22.5 mm and lid 7.5 mm tall');
    expect(m.q('[data-testid="case-not-included"]').textContent).toMatch(/screw bosses/);
    expect(m.q('[data-testid="case-others"]')).toBeNull();
  });
  it('mentions that other bodies are left alone when the document has some', () => {
    expect(mount(DEFAULT_CASE, { hasOthers: true }).q('[data-testid="case-others"]')).not.toBeNull();
  });
  it('every valid change drafts the whole record; the lid height follows the height until it is typed', () => {
    const m = mount();
    fireEvent.change(m.input('height'), { target: { value: '60' } });
    expect(m.drafts.at(-1)).toMatchObject({ width: 80, height: 60, lidHeight: 15 });
    expect(m.input('lidHeight').value).toBe('15');
    fireEvent.change(m.input('lidHeight'), { target: { value: '20' } });
    fireEvent.change(m.input('height'), { target: { value: '70' } });
    expect(m.drafts.at(-1)).toMatchObject({ height: 70, lidHeight: 20 });
    fireEvent.change(m.select('tongueOn'), { target: { value: 'base' } });
    expect(m.drafts.at(-1)?.tongueOn).toBe('base');
    fireEvent.input(m.input('lidName'), { target: { value: 'Cover' } });
    expect(m.drafts.at(-1)?.lidName).toBe('Cover');
    fireEvent.change(m.input('x'), { target: { value: '5' } });
    fireEvent.change(m.input('z'), { target: { value: '3' } });
    expect(m.drafts.at(-1)?.origin).toEqual([5, 0, 3]);
  });
  it('a problem blocks Add and the preview, and says why in plain words', () => {
    const m = mount();
    const before = m.drafts.length;
    fireEvent.change(m.input('wall'), { target: { value: '0.2' } });
    expect(m.drafts.length).toBe(before);
    expect((m.q('[data-testid="case-apply"]') as HTMLButtonElement).disabled).toBe(true);
    expect(m.q('[data-issue="wall"]').textContent).toBe('The wall must be at least 0.4 mm');
    fireEvent.click(m.q('[data-testid="case-apply"]'));
    expect(m.applies).toHaveLength(0);
    fireEvent.change(m.input('wall'), { target: { value: '2' } });
    fireEvent.change(m.input('radius'), { target: { value: '1' } });
    expect(m.q('[data-issue="radius"]').textContent).toMatch(/more than the wall/);
    fireEvent.change(m.input('radius'), { target: { value: '0' } });
    fireEvent.change(m.input('lidHeight'), { target: { value: '28' } });
    expect(m.q('[data-issue="lid"]').textContent).toMatch(/must each be taller than the wall/);
  });
  it('a narrower wall is accepted down to 0.4 mm and the tongue follows it', () => {
    const m = mount();
    fireEvent.change(m.input('wall'), { target: { value: '1' } });
    expect(m.q('[data-issue]')).toBeNull();
    expect(m.drafts.at(-1)).toMatchObject({ wall: 1, tongueHeight: 0.75 });
  });
  it('Add applies the current record; Cancel and Escape cancel; Enter in a number field applies', () => {
    const m = mount();
    fireEvent.change(m.input('width'), { target: { value: '100' } });
    fireEvent.click(m.q('[data-testid="case-apply"]'));
    expect(m.applies).toHaveLength(1);
    expect(m.applies[0]).toMatchObject({ width: 100 });
    fireEvent.keyDown(m.input('depth'), { key: 'Enter' });
    expect(m.applies).toHaveLength(2);
    fireEvent.click(m.q('[data-testid="case-cancel"]'));
    fireEvent.keyDown(m.q('[data-testid="case-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(2);
  });
  it('shows the preview failure the app hands in', () => {
    expect(mount(DEFAULT_CASE, { hint: 'kernel said no' }).q('[data-testid="case-hint"]').textContent).toBe('kernel said no');
  });
});

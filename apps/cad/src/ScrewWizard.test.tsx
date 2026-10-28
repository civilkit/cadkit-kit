import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { ScrewWizard } from './ScrewWizard';
import { DEFAULT_SCREW, type ScrewParams } from './screw';
import './i18n';

afterEach(() => cleanup());

function mount(params: ScrewParams = DEFAULT_SCREW, hint?: string) {
  const drafts: ScrewParams[] = [], applies: ScrewParams[] = [];
  let cancelled = 0;
  const r = render(<ScrewWizard params={params} hint={hint} onDraft={(d) => drafts.push(d)} onApply={(d) => applies.push(d)} onCancel={() => { cancelled++; }} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const select = (path: string) => r.container.querySelector(`[data-path="${path}"] select`) as HTMLSelectElement;
  return { r, drafts, applies, cancelled: () => cancelled, q, input, select };
}

describe('ScrewWizard', () => {
  it('previews its defaults at once and every change previews the whole record', () => {
    const m = mount();
    expect(m.drafts.length).toBe(1);
    fireEvent.change(m.input('length'), { target: { value: '12' } });
    expect(m.drafts.at(-1)).toMatchObject({ length: 12, size: 'M3' });
    fireEvent.change(m.select('size'), { target: { value: 'M5' } });
    expect(m.drafts.at(-1)?.size).toBe('M5');
    fireEvent.change(m.input('z'), { target: { value: '4' } });
    expect(m.drafts.at(-1)?.origin).toEqual([0, 0, 4]);
    fireEvent.change(m.select('axis'), { target: { value: 'px' } });
    expect(m.drafts.at(-1)?.axis).toBe('px');
  });
  it('a hex head has no drive; picking a head sets its usual drive', () => {
    const m = mount();
    fireEvent.change(m.select('head'), { target: { value: 'hex' } });
    expect(m.drafts.at(-1)).toMatchObject({ head: 'hex', drive: 'none' });
    expect(m.select('drive')).toBeNull();
    fireEvent.change(m.select('head'), { target: { value: 'button' } });
    expect(m.drafts.at(-1)).toMatchObject({ head: 'button', drive: 'hex' });
  });
  it('says the cross and Torx drives are approximations, and offers no thread option', () => {
    const m = mount();
    expect(m.q('[data-testid="screw-approx"]').textContent).toMatch(/approximation/);
    fireEvent.change(m.select('drive'), { target: { value: 'hex' } });
    expect(m.q('[data-testid="screw-approx"]')).toBeNull();
    expect(m.q('[data-path="thread"]')).toBeNull();
  });
  it('a bad length blocks Add screw and is not previewed', () => {
    const m = mount();
    const before = m.drafts.length;
    fireEvent.change(m.input('length'), { target: { value: '0' } });
    expect(m.drafts.length).toBe(before);
    expect(m.q('[data-issue="length"]')).not.toBeNull();
    expect((m.q('[data-testid="screw-apply"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('Add screw applies the record; Escape and the cross cancel', () => {
    const m = mount();
    fireEvent.click(m.q('[data-testid="screw-apply"]'));
    expect(m.applies.length).toBe(1);
    fireEvent.keyDown(m.q('[data-testid="screw-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(1);
    fireEvent.click(m.q('[data-testid="screw-cancel"]'));
    expect(m.cancelled()).toBe(2);
  });
});

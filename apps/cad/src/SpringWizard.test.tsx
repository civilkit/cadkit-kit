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
    expect(m.q('[data-testid="spring-ground-note"]')).toBeNull();   // plain ends: no grinding note, no closed turns field
    expect(m.input('closedTurns')).toBeNull();
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
  it('Ends: closed and ground show the closed turns field, and the grinding note only for ground', () => {
    const m = mount();
    fireEvent.change(m.select('ends'), { target: { value: 'closed' } });
    expect(m.drafts.at(-1)).toMatchObject({ ends: 'closed', closedTurns: 1 });
    expect(m.input('closedTurns').value).toBe('1');
    expect(m.q('[data-testid="spring-ground-note"]')).toBeNull();
    expect(m.q('[data-testid="spring-slow-note"]')).not.toBeNull();
    fireEvent.change(m.select('ends'), { target: { value: 'ground' } });
    expect(m.q('[data-testid="spring-ground-note"]')).not.toBeNull();
    fireEvent.change(m.input('closedTurns'), { target: { value: '1.5' } });
    expect(m.drafts.at(-1)).toMatchObject({ ends: 'ground', closedTurns: 1.5 });
  });
  it('closed turns that leave no body block Add and say how many are left', () => {
    const m = mount({ ...DEFAULT_SPRING, ends: 'closed', coils: 8, closedTurns: 1 });
    fireEvent.change(m.input('closedTurns'), { target: { value: '4' } });
    expect((m.q('[data-testid="spring-apply"]') as HTMLButtonElement).disabled).toBe(true);
    expect(m.q('[data-issue="closed"]').textContent).toContain('0');
  });
  it('Type: extension takes its own numbers, drops the length and ends fields, and shows the overall length; compression brings them back', () => {
    const m = mount();
    fireEvent.change(m.select('kind'), { target: { value: 'extension' } });
    expect(m.drafts.at(-1)).toMatchObject({ kind: 'extension', outer: 12, wire: 1, coils: 15 });
    expect(m.input('length')).toBeNull(); expect(m.select('ends')).toBeNull();
    expect(m.q('[data-testid="spring-extension-note"]')).not.toBeNull();
    expect(m.q('[data-testid="spring-summary"]').textContent).toMatch(/Overall length/);
    fireEvent.change(m.select('kind'), { target: { value: 'compression' } });
    expect(m.drafts.at(-1)).toMatchObject({ kind: 'compression', outer: 20, wire: 2, length: 40, coils: 8 });
    expect(m.input('length')).not.toBeNull(); expect(m.select('ends')).not.toBeNull();
  });
  it('an extension spring with a coil too thin for the hooks blocks Add', () => {
    const m = mount();
    fireEvent.change(m.select('kind'), { target: { value: 'extension' } });
    fireEvent.change(m.input('outer'), { target: { value: '2.5' } });
    expect((m.q('[data-testid="spring-apply"]') as HTMLButtonElement).disabled).toBe(true);
    expect(m.q('[data-issue="hookOuter"]')).not.toBeNull();
  });
  it('far end diameter and pitch ratio draft as part of the record; the far end equal to the first end goes back to a cylinder', () => {
    const m = mount();
    expect(m.input('topOuter').value).toBe('20');
    fireEvent.change(m.input('topOuter'), { target: { value: '12' } });
    expect(m.drafts.at(-1)).toMatchObject({ topOuter: 12 });
    expect(m.q('[data-testid="spring-slow-note"]')).not.toBeNull();
    fireEvent.change(m.input('topOuter'), { target: { value: '20' } });
    expect(m.drafts.at(-1)).toMatchObject({ topOuter: null });
    fireEvent.change(m.input('progression'), { target: { value: '0.6' } });
    expect(m.drafts.at(-1)).toMatchObject({ progression: 0.6 });
    fireEvent.change(m.input('progression'), { target: { value: '0.1' } });
    expect(m.q('[data-issue="pitch"]')).not.toBeNull();
  });
  it('the extension type has no far end diameter or pitch ratio', () => {
    const m = mount();
    fireEvent.change(m.select('kind'), { target: { value: 'extension' } });
    expect(m.input('topOuter')).toBeNull(); expect(m.input('progression')).toBeNull();
  });
  it('Type: torsion takes its own numbers, shows the two leg lengths and the leg angle, and drops the compression fields', () => {
    const m = mount();
    fireEvent.change(m.select('kind'), { target: { value: 'torsion' } });
    expect(m.drafts.at(-1)).toMatchObject({ kind: 'torsion', outer: 14, wire: 1.2, coils: 5.25, leg1: 21, leg2: 21 });
    expect(m.input('leg1').value).toBe('21'); expect(m.input('leg2')).not.toBeNull();
    expect(m.input('length')).toBeNull(); expect(m.select('ends')).toBeNull(); expect(m.input('topOuter')).toBeNull();
    expect(m.q('[data-testid="spring-summary"]').textContent).toMatch(/90 degrees/);
    fireEvent.change(m.input('leg2'), { target: { value: '30' } });
    expect(m.drafts.at(-1)).toMatchObject({ leg2: 30 });
    fireEvent.change(m.select('kind'), { target: { value: 'compression' } });
    expect(m.input('leg1')).toBeNull();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { BearingWizard } from './BearingWizard';
import { DEFAULT_BEARING, type BearingParams } from './bearing';
import './i18n';

afterEach(() => cleanup());

function mount(params: BearingParams = DEFAULT_BEARING, hint?: string) {
  const drafts: BearingParams[] = [], applies: BearingParams[] = [];
  let cancelled = 0;
  const r = render(<BearingWizard params={params} hint={hint} onDraft={(d) => drafts.push(d)} onApply={(d) => applies.push(d)} onCancel={() => { cancelled++; }} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const select = (path: string) => r.container.querySelector(`[data-path="${path}"] select`) as HTMLSelectElement;
  const options = (path: string) => Array.from(select(path).options).map((o) => o.value);
  return { r, drafts, applies, cancelled: () => cancelled, q, input, select, options };
}

describe('BearingWizard', () => {
  it('previews its defaults at once and every change previews the whole record', () => {
    const m = mount();
    expect(m.drafts.length).toBe(1);
    expect(m.drafts[0]).toMatchObject({ designation: '608', bore: 8, od: 22, width: 7, seal: '2Z' });
    fireEvent.change(m.select('seal'), { target: { value: '2RS' } });
    expect(m.drafts.at(-1)?.seal).toBe('2RS');
    fireEvent.change(m.input('chamfer'), { target: { value: '0.5' } });
    expect(m.drafts.at(-1)?.chamfer).toBe(0.5);
    fireEvent.change(m.input('z'), { target: { value: '4' } });
    expect(m.drafts.at(-1)?.origin).toEqual([0, 0, 4]);
    fireEvent.change(m.select('axis'), { target: { value: 'nx' } });
    expect(m.drafts.at(-1)?.axis).toBe('nx');
  });
  it('picking a size in the list fills bore, outer diameter and width', () => {
    const m = mount();
    fireEvent.change(m.select('preset'), { target: { value: '6204' } });
    expect(m.drafts.at(-1)).toMatchObject({ designation: '6204', bore: 20, od: 47, width: 14 });
    expect(m.input('bore').value).toBe('20');
    expect(m.q('[data-testid="bearing-nominal"]').textContent).toMatch(/6204.*nominal ISO 15/);
  });
  it('searching narrows the list; a whole designation picks it, with its seal suffix', () => {
    const m = mount();
    fireEvent.input(m.input('search'), { target: { value: '620' } });
    expect(m.options('preset')).toEqual(['6200', '6201', '6202', '6203', '6204', '6205', '6206', '6207', '6208', '6209']);
    expect(m.drafts.at(-1)?.designation).toBe('608');   // narrowing alone changes nothing
    fireEvent.input(m.input('search'), { target: { value: '6204-2RS' } });
    expect(m.drafts.at(-1)).toMatchObject({ designation: '6204', od: 47, seal: '2RS' });
    fireEvent.input(m.input('search'), { target: { value: 'MR63' } });
    expect(m.drafts.at(-1)).toMatchObject({ designation: 'MR63', bore: 3, od: 6, width: 2.5 });
    fireEvent.input(m.input('search'), { target: { value: 'nothing' } });
    expect(m.options('preset')).toEqual(['']);
    expect(m.r.container.textContent).toMatch(/No size matches/);
  });
  it('typing a size by hand makes it a custom size', () => {
    const m = mount();
    fireEvent.change(m.input('od'), { target: { value: '30' } });
    expect(m.drafts.at(-1)).toMatchObject({ designation: '', od: 30, bore: 8 });
    expect(m.q('[data-testid="bearing-nominal"]').textContent).toMatch(/Custom/);
  });
  it('shows the ball fields for an open bearing only, with the model\'s defaults', () => {
    const m = mount();
    expect(m.q('[data-path="balls"]')).toBeNull();
    fireEvent.change(m.select('seal'), { target: { value: 'open' } });
    expect(m.input('balls').value).toBe('7');
    expect(Number(m.input('ballDiameter').value)).toBeGreaterThan(3);
    fireEvent.change(m.input('balls'), { target: { value: '5' } });
    expect(m.drafts.at(-1)?.balls).toBe(5);
    fireEvent.change(m.select('seal'), { target: { value: '2Z' } });
    expect(m.drafts.at(-1)).toMatchObject({ seal: '2Z', balls: null });
  });
  it('says the races are plain cylinders', () => {
    const m = mount();
    expect(m.q('[data-testid="bearing-approx"]').textContent).toMatch(/plain cylinders/);
  });
  it('the housing seat read-out follows the size and the fit', () => {
    const m = mount();
    const text = () => m.q('[data-testid="bearing-seat"]').textContent ?? '';
    expect(text()).toMatch(/diameter 22\.01.* depth 7 mm/);
    expect(text()).toMatch(/H7/);
    fireEvent.change(m.select('seatFit'), { target: { value: 'press' } });
    expect(text()).toMatch(/diameter 22 mm/);
    fireEvent.change(m.select('preset'), { target: { value: '6204' } });
    expect(text()).toMatch(/diameter 47 mm, depth 14 mm/);
  });
  it('cutting the seat needs a face: the box is off without one and a note says why', () => {
    const m = mount();
    expect(m.input('seat').disabled).toBe(true);
    expect(m.q('[data-testid="bearing-seat-note"]')).not.toBeNull();
    const withFace = mount({ ...DEFAULT_BEARING, placedOn: 'F1.C2', origin: [0, 0, 12], axis: 'nz' });
    expect(withFace.input('seat').disabled).toBe(false);
    expect(withFace.q('[data-testid="bearing-seat-note"]')).toBeNull();
    fireEvent.click(withFace.input('seat'));
    expect(withFace.drafts.at(-1)).toMatchObject({ seat: true, placedOn: 'F1.C2' });
    fireEvent.click(withFace.q('[data-testid="bearing-apply"]'));
    expect(withFace.applies[0]).toMatchObject({ seat: true, origin: [0, 0, 12], axis: 'nz' });
  });
  it('a bore as large as the outer diameter blocks Add bearing and is not previewed', () => {
    const m = mount();
    const before = m.drafts.length;
    fireEvent.change(m.input('bore'), { target: { value: '22' } });
    expect(m.drafts.length).toBe(before);
    expect(m.q('[data-issue="size"]')).not.toBeNull();
    expect((m.q('[data-testid="bearing-apply"]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(m.q('[data-testid="bearing-apply"]'));
    expect(m.applies.length).toBe(0);
  });
  it('balls that do not fit say so', () => {
    const m = mount({ ...DEFAULT_BEARING, seal: 'open' });
    fireEvent.change(m.input('balls'), { target: { value: '20' } });
    expect(m.q('[data-issue="model"]')?.textContent).toMatch(/do not fit/);
    expect((m.q('[data-testid="bearing-apply"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows the live preview failure', () => {
    const m = mount(DEFAULT_BEARING, 'the kernel said no');
    expect(m.q('[data-testid="bearing-hint"]').textContent).toBe('the kernel said no');
  });
  it('Add bearing applies the record; Escape and the cross cancel', () => {
    const m = mount();
    fireEvent.click(m.q('[data-testid="bearing-apply"]'));
    expect(m.applies.length).toBe(1);
    fireEvent.keyDown(m.q('[data-testid="bearing-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(1);
    fireEvent.click(m.q('[data-testid="bearing-cancel"]'));
    expect(m.cancelled()).toBe(2);
  });
});

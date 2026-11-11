import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { WasherWizard } from './WasherWizard';
import { filterRows } from './SizePicker';
import { DEFAULT_WASHER, type WasherParams } from './washer';
import { WASHER_SIZES, washerLabel } from './washerSizes';
import './i18n';

afterEach(() => cleanup());

function mount(params: WasherParams = DEFAULT_WASHER, hint?: string) {
  const drafts: WasherParams[] = [], applies: WasherParams[] = [];
  let cancelled = 0;
  const r = render(<WasherWizard params={params} hint={hint} onDraft={(d) => drafts.push(d)} onApply={(d) => applies.push(d)} onCancel={() => { cancelled++; }} />);
  const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
  const input = (path: string) => r.container.querySelector(`[data-path="${path}"] input`) as HTMLInputElement;
  const select = (path: string) => r.container.querySelector(`[data-path="${path}"] select`) as HTMLSelectElement;
  const rows = () => Array.from(r.container.querySelectorAll('[data-row]')).map((e) => e.getAttribute('data-row'));
  const filter = (v: string) => fireEvent.input(q('[data-testid="washer-size-filter"]'), { target: { value: v } });
  return { r, drafts, applies, cancelled: () => cancelled, q, input, select, rows, filter };
}

describe('SizePicker filter', () => {
  it('matches every word, case-insensitively, on label or id', () => {
    const rows = WASHER_SIZES.map((w) => ({ id: w.id, label: washerLabel(w) }));
    expect(filterRows(rows, 'm8').every((r) => /M8\b|M8[0-9]/.test(r.label) || /m8/i.test(r.label))).toBe(true);
    expect(filterRows(rows, 'M8').map((r) => r.id)).toEqual(expect.arrayContaining(['iso7089-M8', 'iso7093-M8', 'din127b-M8']));
    expect(filterRows(rows, '7089').every((r) => r.id.startsWith('iso7089'))).toBe(true);
    expect(filterRows(rows, 'iso 7093 m12').map((r) => r.id)).toEqual(['iso7093-M12']);
    expect(filterRows(rows, '')).toHaveLength(rows.length);
    expect(filterRows(rows, 'zzz')).toEqual([]);
  });
});

describe('WasherWizard', () => {
  it('previews its defaults at once, highlighting the M8 row', () => {
    const m = mount();
    expect(m.drafts.length).toBe(1);
    expect(m.q('[data-row="iso7089-M8"]').getAttribute('aria-selected')).toBe('true');
  });
  it('filters the standard list; spring shows only DIN 127 B rows', () => {
    const m = mount();
    m.filter('7093');
    expect(m.rows().every((id) => id!.startsWith('iso7093'))).toBe(true);
    m.filter('zzz');
    expect(m.q('.size-picker-empty')).not.toBeNull();
    m.filter('');
    fireEvent.change(m.select('kind'), { target: { value: 'spring' } });
    expect(m.rows().every((id) => id!.startsWith('din127b'))).toBe(true);
    expect(m.drafts.at(-1)).toMatchObject({ kind: 'spring', inner: 8.1, outer: 14.8, thickness: 2, gap: 2 });
  });
  it('picking a row fills the three numbers; editing a number switches to Custom', () => {
    const m = mount();
    fireEvent.click(m.q('[data-row="iso7089-M12"]'));
    expect(m.drafts.at(-1)).toMatchObject({ inner: 13, outer: 24, thickness: 2.5 });
    expect(m.input('inner').value).toBe('13');
    fireEvent.change(m.input('outer'), { target: { value: '25' } });
    expect(m.drafts.at(-1)).toMatchObject({ inner: 13, outer: 25 });
    expect(m.q('[data-testid="washer-size-list"]')).toBeNull();
    expect(m.q('[data-mode="custom"]').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(m.q('[data-mode="standard"]'));
    expect(m.q('[data-testid="washer-size-list"]')).not.toBeNull();
    expect(m.q('[aria-selected="true"]')).toBeNull();   // no row matches the edited numbers
  });
  it('Enter in the filter picks the only match', () => {
    const m = mount();
    m.filter('iso 7093 m16');
    fireEvent.keyDown(m.q('[data-testid="washer-size-filter"]'), { key: 'Enter' });
    expect(m.drafts.at(-1)).toMatchObject({ inner: 17, outer: 50, thickness: 3 });
  });
  it('a gap field only for a spring washer, with the no-lift note', () => {
    const m = mount();
    expect(m.q('[data-path="gap"]')).toBeNull();
    fireEvent.change(m.select('kind'), { target: { value: 'spring' } });
    expect(m.q('[data-path="gap"]')).not.toBeNull();
    fireEvent.change(m.input('gap'), { target: { value: '3' } });
    expect(m.drafts.at(-1)?.gap).toBe(3);
    expect(m.q('[data-testid="washer-flat-note"]').textContent).toMatch(/lift/);
  });
  it('position and axis go into the draft', () => {
    const m = mount();
    fireEvent.change(m.input('z'), { target: { value: '4' } });
    expect(m.drafts.at(-1)?.origin).toEqual([0, 0, 4]);
    fireEvent.change(m.select('axis'), { target: { value: 'pz' } });
    expect(m.drafts.at(-1)?.axis).toBe('pz');
  });
  it('a bad size blocks Add washer and is not previewed', () => {
    const m = mount();
    const before = m.drafts.length;
    fireEvent.change(m.input('outer'), { target: { value: '5' } });
    expect(m.drafts.length).toBe(before);
    expect(m.q('[data-issue="outer"]')).not.toBeNull();
    expect((m.q('[data-testid="washer-apply"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('Add washer applies the record; Escape and the cross cancel', () => {
    const m = mount();
    fireEvent.click(m.q('[data-testid="washer-apply"]'));
    expect(m.applies.length).toBe(1);
    fireEvent.keyDown(m.q('[data-testid="washer-wizard"]'), { key: 'Escape' });
    expect(m.cancelled()).toBe(1);
    fireEvent.click(m.q('[data-testid="washer-cancel"]'));
    expect(m.cancelled()).toBe(2);
  });
});

describe('WasherWizard: washer on a hole', () => {
  type Seat = { face: string; origin: [number, number, number]; axis: 'pz' | 'nz' };
  const hole = (d: number, extra: Record<string, unknown> = {}, seats: Seat[] = [{ face: 'F2.C1', origin: [20, 15, 8], axis: 'pz' }]) =>
    ({ ok: true as const, hole: { face: 'F4.S.h1', diameter: d, seats, seat: 0, blind: false, counterbore: false, ...extra } });
  const mountPick = () => {
    const drafts: WasherParams[] = [];
    let asked = 0;
    const mk = (picked: { id: number; result: never } | null) => <WasherWizard params={DEFAULT_WASHER} picked={picked} onPickHole={() => { asked++; }} onDraft={(d) => drafts.push(d)} onApply={() => {}} onCancel={() => {}} />;
    const r = render(mk(null));
    const q = (sel: string) => r.container.querySelector(sel) as HTMLElement;
    return { r, drafts, asked: () => asked, q, pick: (id: number, result: unknown) => r.rerender(mk({ id, result } as never)) };
  };
  it('has a Pick hole button that asks the app to wait for a click, and says no hole yet', () => {
    const m = mountPick();
    fireEvent.click(m.q('[data-testid="washer-pick-hole"]'));
    expect(m.asked()).toBe(1);
    expect(m.q('[data-testid="washer-hole"]').textContent).toMatch(/No hole picked/);
  });
  it('a 9 mm hole gives the M8 washer coaxial on the seat, with the size read-out', () => {
    const m = mountPick();
    m.pick(1, hole(9));
    expect(m.drafts.at(-1)).toMatchObject({ inner: 8.4, outer: 16, thickness: 1.6, origin: [20, 15, 8], axis: 'pz', offset: 0 });
    expect(m.q('[data-row="iso7089-M8"]').getAttribute('aria-selected')).toBe('true');
    expect(m.q('[data-testid="washer-hole-size"]').getAttribute('data-fit')).toBe('contains');
    expect(m.q('[data-testid="washer-hole-read"]').textContent).toMatch(/Hole 9 mm/);
  });
  it('a hole smaller than any clearance hole says the nearest size is used', () => {
    const m = mountPick();
    m.pick(1, hole(1.2));
    expect(m.q('[data-testid="washer-hole-size"]').getAttribute('data-fit')).toBe('nearest');
    expect(m.q('[data-testid="washer-hole-size"]').textContent).toMatch(/nearest, M1\.6/);
    expect(m.drafts.at(-1)).toMatchObject({ inner: 1.7 });
  });
  it('the user can pick another standard size, switch kind (spring re-reads the hole) and change the offset', () => {
    const m = mountPick();
    m.pick(1, hole(11));
    expect(m.drafts.at(-1)).toMatchObject({ inner: 10.5 });   // M10
    fireEvent.click(m.q('[data-row="iso7089-M12"]'));
    expect(m.drafts.at(-1)).toMatchObject({ inner: 13, origin: [20, 15, 8] });   // still on the hole
    fireEvent.change(m.r.container.querySelector('[data-path="offset"] input') as HTMLInputElement, { target: { value: '0.5' } });
    expect(m.drafts.at(-1)).toMatchObject({ origin: [20, 15, 8.5], offset: 0.5 });
    fireEvent.change(m.r.container.querySelector('[data-path="kind"] select') as HTMLSelectElement, { target: { value: 'spring' } });
    expect(m.drafts.at(-1)).toMatchObject({ kind: 'spring', inner: 10.2, origin: [20, 15, 8.5] });   // DIN 127 B M10
  });
  it('a through hole offers the other end', () => {
    const m = mountPick();
    m.pick(1, hole(9, {}, [{ face: 'F2.C1', origin: [20, 15, 8], axis: 'pz' }, { face: 'F2.C0', origin: [20, 15, 0], axis: 'nz' }]));
    fireEvent.click(m.q('[data-testid="washer-hole-other"]'));
    expect(m.drafts.at(-1)).toMatchObject({ origin: [20, 15, 0], axis: 'nz' });
  });
  it('a counterbore says it seats on the floor; a countersink is refused with a plain message and leaves the washer alone', () => {
    const m = mountPick();
    m.pick(1, hole(9, { counterbore: true }));
    expect(m.q('[data-testid="washer-hole-cbore"]')).not.toBeNull();
    const before = m.drafts.length;
    m.pick(2, { ok: false, reason: 'countersink' });
    expect(m.q('[data-testid="washer-hole-refused"]').textContent).toMatch(/countersunk.*not supported/);
    expect(m.drafts.length).toBe(before);
  });
  it('editing the position by hand leaves the hole', () => {
    const m = mountPick();
    m.pick(1, hole(9));
    fireEvent.change(m.r.container.querySelector('[data-path="x"] input') as HTMLInputElement, { target: { value: '3' } });
    expect(m.drafts.at(-1)).toMatchObject({ hole: null });
    expect(m.q('[data-path="offset"]')).toBeNull();
  });
});

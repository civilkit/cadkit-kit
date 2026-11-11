import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { MaterialEditor } from './MaterialEditor';
import { loadCustom } from './materials';
import './i18n';

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(cleanup);

function mount(over: Partial<Parameters<typeof MaterialEditor>[0]> = {}) {
  const applied: Array<{ name: string; useColour: boolean }> = [];
  const cancels: number[] = [];
  const r = render(<MaterialEditor current="steel" useColour={true} loadVolume={async () => 1000} onApply={(c) => applied.push(c)} onCancel={() => cancels.push(1)} {...over} />);
  const item = (id: string) => r.container.querySelector(`[data-material="${id}"]`) as HTMLElement;
  return { ...r, applied, cancels, item };
}

describe('MaterialEditor', () => {
  it('lists materials by category and starts on the current one', async () => {
    const m = mount();
    const cats = [...m.container.querySelectorAll('.mat-cat')].map((c) => c.textContent);
    expect(cats.slice(0, 3)).toEqual(['Steel', 'Aluminium', 'Copper, brass, bronze']);
    expect(cats[cats.length - 1]).toBe('Custom');
    expect(m.item('steel-mild').getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(m.getByTestId('material-mass').textContent).toContain('7.85 g'));
  });
  it('searches by name', () => {
    const m = mount();
    fireEvent.input(m.getByLabelText('Search materials'), { target: { value: 'stainless' } });
    expect([...m.container.querySelectorAll('.mat-item[data-material]')].map((e) => e.getAttribute('data-material')).filter((x) => x !== 'custom:new')).toEqual(['steel-304', 'steel-316']);
    fireEvent.input(m.getByLabelText('Search materials'), { target: { value: 'zzzz' } });
    expect(m.container.textContent).toContain('No material matches.');
  });
  it('shows the swatch, properties and the mass with the new density, then applies on OK', async () => {
    const m = mount();
    fireEvent.click(m.item('al-6061'));
    expect(m.getByTestId('material-swatch').getAttribute('data-color')).toBe('#c9d0d8');
    expect(m.container.textContent).toContain('68.9 GPa');
    expect(m.container.textContent).toContain('276 MPa');
    await waitFor(() => expect(m.getByTestId('material-mass').textContent).toContain('2.7 g'));
    expect(m.getByTestId('material-mass').textContent).toContain('was 7.85 g');
    fireEvent.click(m.getByTestId('material-ok'));
    expect(m.applied).toEqual([expect.objectContaining({ name: 'Aluminium 6061', useColour: true })]);
  });
  it('reports the use-colour toggle', () => {
    const m = mount();
    fireEvent.click(m.getByTestId('material-use-colour'));
    fireEvent.click(m.item('brass'));
    fireEvent.click(m.getByTestId('material-ok'));
    expect(m.applied[0]).toMatchObject({ name: 'Brass', useColour: false });
    expect(localStorage.getItem('cad.materials.useColour')).toBe('0');
  });
  it('makes a custom material: name, density, colour, kept in the browser', async () => {
    const m = mount();
    fireEvent.click(m.item('custom:new'));
    expect((m.getByTestId('material-ok') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(m.getByLabelText('Name'), { target: { value: 'Foam' } });
    fireEvent.input(m.getByLabelText('Density'), { target: { value: '30' } });
    fireEvent.input(m.getByLabelText('Colour'), { target: { value: '#ff8800' } });
    await waitFor(() => expect(m.getByTestId('material-mass').textContent).toContain('0.03 g'));
    expect(m.getByTestId('material-swatch').getAttribute('data-color')).toBe('#ff8800');
    fireEvent.click(m.getByTestId('material-ok'));
    expect(m.applied[0].name).toBe('Foam');
    expect(loadCustom()).toEqual([expect.objectContaining({ name: 'Foam', density: 30, color: '#ff8800' })]);
  });
  it('refuses a custom name that is a built-in', () => {
    const m = mount();
    fireEvent.click(m.item('custom:new'));
    fireEvent.input(m.getByLabelText('Name'), { target: { value: 'brass' } });
    fireEvent.input(m.getByLabelText('Density'), { target: { value: '5' } });
    expect((m.getByTestId('material-ok') as HTMLButtonElement).disabled).toBe(true);
    expect(m.container.textContent).toContain('built-in material');
  });
  it('Enter applies, Escape and the cross cancel', () => {
    const m = mount();
    fireEvent.click(m.item('oak'));
    fireEvent.keyDown(m.getByTestId('material-editor'), { key: 'Enter' });
    expect(m.applied).toHaveLength(1);
    fireEvent.keyDown(m.getByTestId('material-editor'), { key: 'Escape' });
    fireEvent.click(m.getByLabelText('Cancel', { selector: '.fedit-cancel' }));
    expect(m.cancels).toHaveLength(2);
  });
  it('says so when the part has no solid', async () => {
    const m = mount({ loadVolume: async () => null });
    await waitFor(() => expect(m.getByTestId('material-mass').textContent).toContain('No solid'));
  });

  it('groups the Steel category by region and standard, general steels first', () => {
    const m = mount();
    const subs = [...m.container.querySelectorAll('.mat-sub')].map((e) => e.textContent);
    expect(subs).toEqual(['General', 'Australia / AS/NZS 3679.1', 'United States / ASTM A36', 'United States / ASTM A992', 'United States / ASTM A572', 'United States / ASTM A53', 'United States / ASTM A500', 'Europe / EN 10025-2', 'Europe / EN 10210', 'Europe / EN 10219']);
    expect(m.container.querySelectorAll('.mat-cat')).toHaveLength(11);   // sub-headings are not categories
    fireEvent.input(m.getByLabelText('Search materials'), { target: { value: 'aluminium' } });
    expect(m.container.querySelectorAll('.mat-sub')).toHaveLength(0);   // a category with no regional grades has no sub-headings
  });
  it('shows ultimate strength, shear modulus, expansion, standard, grade and region for a steel grade, and applies its name', async () => {
    const m = mount();
    fireEvent.click(m.item('en-10025-2-s355'));
    const t = m.container.querySelector('.mat-props')!.textContent!;
    for (const want of ['355 MPa', '470 MPa', '210 GPa', '81 GPa', '0.3', '12 x 10⁻⁶ /K', 'EN 10025-2 / S355', 'Europe']) expect(t, want).toContain(want);
    expect(m.getByTestId('material-verified').textContent).toContain('checked');
    expect(m.container.querySelector('[data-testid="material-unverified-badge"]')).not.toBeNull();   // other grades in the list wear the badge, this one does not
    await waitFor(() => expect(m.getByTestId('material-mass').textContent).toContain('7.85 g'));
    fireEvent.click(m.getByTestId('material-ok'));
    expect(m.applied).toEqual([expect.objectContaining({ name: 'EN 10025-2 S355' })]);
  });
  it('an unverified grade wears a badge in the list and a warning with its note; A500 Gr C round shows the alternate yield', () => {
    const m = mount();
    const badge = (id: string) => m.item(id).querySelector('[data-testid="material-unverified-badge"]');
    expect(badge('astm-a53-grb')?.textContent).toBe('unverified');
    expect(badge('as-nzs-3679.1-300')).not.toBeNull();
    expect(badge('astm-a992')).toBeNull();
    expect(badge('steel-mild')).toBeNull();   // the general materials make no claim either way
    fireEvent.click(m.item('astm-a500-grc-round'));
    expect(m.getByTestId('material-verified').textContent).toContain('Unverified');
    expect(m.getByTestId('material-note').textContent).toContain('2021 revision');
    expect(m.getByTestId('material-yield-alt').textContent).toBe('345 MPa');
    expect(m.container.querySelector('.mat-props')!.textContent).toContain('315 MPa');
    fireEvent.click(m.item('steel-mild'));
    expect(m.container.querySelector('[data-testid="material-verified"]')).toBeNull();
    expect(m.container.querySelector('.mat-props')!.textContent).not.toContain('Ultimate');
  });
  it('searches the grades by standard or grade', () => {
    const m = mount();
    fireEvent.input(m.getByLabelText('Search materials'), { target: { value: 's355' } });
    expect([...m.container.querySelectorAll('.mat-item[data-material]')].map((e) => e.getAttribute('data-material')).filter((x) => x !== 'custom:new')).toEqual(['en-10025-2-s355', 'en-10210-s355j2h', 'en-10219-s355j2h']);
    fireEvent.input(m.getByLabelText('Search materials'), { target: { value: 'a992' } });
    expect([...m.container.querySelectorAll('.mat-item[data-material]')].map((e) => e.getAttribute('data-material')).filter((x) => x !== 'custom:new')).toEqual(['astm-a992']);
  });
  it('a part that names a steel grade opens on it', () => {
    const m = mount({ current: 'ASTM A992' });
    expect(m.item('astm-a992').getAttribute('aria-selected')).toBe('true');
    expect(m.getByTestId('material-swatch').getAttribute('data-color')).toBe('#8d97a5');
  });
});

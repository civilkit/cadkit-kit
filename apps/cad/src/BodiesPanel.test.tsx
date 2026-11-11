import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { BodiesPanel, type BodiesPanelProps } from './BodiesPanel';
import type { BodyRow } from './bodies';

afterEach(cleanup);

const row = (key: string, name: string, extra: Partial<BodyRow> = {}): BodyRow => ({ key, name, named: true, faces: [key], edges: [], origin: null, volume: 1500, look: {}, hidden: false, ...extra });
function setup(over: Partial<BodiesPanelProps> = {}) {
  const p = { rows: [row('@body:a', 'Panel'), row('@body:b', 'Tach lens', { look: { opacity: 0.18, color: '#b9c7d6' } }), row('@body:c', 'Needle', { hidden: true })], selected: [] as string[],
    onSelect: vi.fn(), onToggleHidden: vi.fn(), onSolo: vi.fn(), onShowAll: vi.fn(), onHideOthers: vi.fn(), onRename: vi.fn(), onLook: vi.fn(), ...over };
  const r = render(<BodiesPanel {...p} />);
  const li = (k: string) => r.container.querySelector(`li[data-key="${k}"]`) as HTMLElement;
  return { p, r, li };
}

describe('BodiesPanel made-by line', () => {
  it('shows the feature that made each body under its name, when the app can name it', () => {
    const rows = [row('@body:a', 'History', { origin: 'F2' }), row('@body:b', 'Original (STEP)', { origin: 'F9' }), row('@body:c', 'Loose', { origin: null })];
    const { li } = setup({ rows, madeBy: (o) => (o === 'F2' ? 'Boss-Extrude1' : null) });
    expect(li('@body:a').querySelector('.body-origin')!.textContent).toBe('made by Boss-Extrude1');
    expect(li('@body:b').querySelector('.body-origin')).toBeNull();
    expect(li('@body:c').querySelector('.body-origin')).toBeNull();
    expect(li('@body:a').querySelector('.body-name')!.textContent).toBe('History');
  });
});

describe('BodiesPanel', () => {
  it('lists each body with its name, volume, eye and solo button, and counts bodies and hidden ones', () => {
    const { r, li } = setup();
    expect(r.container.querySelectorAll('li.body-row')).toHaveLength(3);
    expect(li('@body:a').textContent).toContain('Panel');
    expect(li('@body:a').textContent).toContain('1.5 cm³');
    expect(r.container.querySelector('.bodies-count')!.textContent).toBe('3 bodies · 1 hidden');
    expect(li('@body:c').classList.contains('off')).toBe(true);
    expect(li('@body:c').querySelector('.body-eye svg')!.getAttribute('data-icon')).toBe('eye-off');
    expect(li('@body:a').querySelector('.body-eye')!.getAttribute('aria-label')).toBe('Hide body: Panel');
    expect(li('@body:a').querySelector('.body-solo')!.getAttribute('aria-label')).toBe('Show only this body: Panel');
  });
  it('the eye, solo and row clicks each call their own handler', () => {
    const { p, li } = setup();
    fireEvent.click(li('@body:a').querySelector('.body-eye')!);
    expect(p.onToggleHidden).toHaveBeenCalledWith('@body:a');
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.click(li('@body:b').querySelector('.body-solo')!);
    expect(p.onSolo).toHaveBeenCalledWith('@body:b');
    fireEvent.click(li('@body:b'));
    expect(p.onSelect).toHaveBeenCalledWith('@body:b', false);
    fireEvent.click(li('@body:a'), { shiftKey: true });
    expect(p.onSelect).toHaveBeenLastCalledWith('@body:a', true);
  });
  it('Space on a focused row toggles its eye; Enter selects; arrows move focus; F2 renames', () => {
    const { p, li } = setup();
    li('@body:a').focus();
    fireEvent.keyDown(li('@body:a'), { key: ' ' });
    expect(p.onToggleHidden).toHaveBeenCalledWith('@body:a');
    fireEvent.keyDown(li('@body:a'), { key: 'Enter' });
    expect(p.onSelect).toHaveBeenCalledWith('@body:a', false);
    fireEvent.keyDown(li('@body:a'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(li('@body:b'));
    fireEvent.keyDown(li('@body:b'), { key: 'F2' });
    const input = li('@body:b').querySelector('input.body-name-edit') as HTMLInputElement;
    expect(input.value).toBe('Tach lens');
    fireEvent.input(input, { target: { value: 'Glass lens' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onRename).toHaveBeenCalledWith('@body:b', 'Glass lens');
  });
  it('Space on the eye button itself is the button\'s own click, not a second toggle', () => {
    const { p, li } = setup();
    fireEvent.keyDown(li('@body:a').querySelector('.body-eye')!, { key: ' ' });
    expect(p.onToggleHidden).not.toHaveBeenCalled();
  });
  it('Show all and Hide others', () => {
    const { p, r } = setup({ selected: ['@body:a'] });
    const [showAll, hideOthers] = Array.from(r.container.querySelectorAll<HTMLButtonElement>('.bodies-actions button'));
    fireEvent.click(showAll); fireEvent.click(hideOthers);
    expect(p.onShowAll).toHaveBeenCalled();
    expect(p.onHideOthers).toHaveBeenCalled();
  });
  it('Hide others needs a selection and Show all needs something hidden', () => {
    const { r } = setup({ rows: [row('@body:a', 'A'), row('@body:b', 'B')] });
    const [showAll, hideOthers] = Array.from(r.container.querySelectorAll<HTMLButtonElement>('.bodies-actions button'));
    expect(showAll.disabled).toBe(true);
    expect(hideOthers.disabled).toBe(true);
  });
  it('a body has a clear coat slider, and a texture choice when the app has the online library', () => {
    const { p, r } = setup({ selected: ['@body:a'] });
    const group = r.container.querySelector('.body-look')!;
    const coat = group.querySelector('input[id$="-cc"]') as HTMLInputElement;
    expect(coat.value).toBe('0');
    fireEvent.input(coat, { target: { value: '40' } });
    expect(p.onLook).toHaveBeenLastCalledWith('@body:a', { clearcoat: 0.4 });
    fireEvent.input(coat, { target: { value: '0' } });
    expect(p.onLook).toHaveBeenLastCalledWith('@body:a', { clearcoat: undefined });
    expect(r.container.querySelector('[data-testid=body-texture]')).toBeNull();   // no library: no half-working picker
    cleanup();
    const lib = { enabled: false, onEnable: vi.fn(), list: async () => [] };
    const t2 = setup({ selected: ['@body:a'], rows: [row('@body:a', 'Panel', { look: { texture: { source: 'polyhaven', id: 'oak_plank', name: 'Oak Plank' } } })], library: lib });
    const box = t2.r.container.querySelector('[data-testid=body-texture]')!;
    expect(box.textContent).toContain('Oak Plank');
    fireEvent.click(Array.from(box.querySelectorAll('button')).find((b) => b.textContent === 'Remove texture')!);
    expect(t2.p.onLook).toHaveBeenLastCalledWith('@body:a', { texture: undefined });
  });
  it('says that a texture shows only on a body that is not see-through', () => {
    const { r } = setup({ selected: ['@body:a'], rows: [row('@body:a', 'Panel', { look: { opacity: 0.5, texture: { source: 'polyhaven', id: 'oak_plank' } } })], library: { enabled: false, onEnable: () => {}, list: async () => [] } });
    expect(r.container.querySelector('[data-testid=body-texture]')!.textContent).toContain('not see-through');
  });
  it('the selected body shows its appearance: colour, opacity and finish go to onLook; Glass sets all three', () => {
    const { p, r } = setup({ selected: ['@body:b'] });
    const group = r.container.querySelector('.body-look')!;
    expect(group.getAttribute('aria-label')).toBe('Appearance: Tach lens');
    const range = group.querySelector('input[type=range]') as HTMLInputElement;
    expect(range.value).toBe('18');
    expect(group.textContent).toContain('Very clear bodies are not picked');
    fireEvent.input(range, { target: { value: '60' } });
    expect(p.onLook).toHaveBeenLastCalledWith('@body:b', { opacity: 0.6 });
    fireEvent.input(range, { target: { value: '100' } });
    expect(p.onLook).toHaveBeenLastCalledWith('@body:b', { opacity: undefined });
    fireEvent.change(group.querySelector('select')!, { target: { value: 'chrome' } });
    expect(p.onLook).toHaveBeenLastCalledWith('@body:b', { finish: 'chrome' });
    fireEvent.click(Array.from(group.querySelectorAll('button')).find((b) => b.textContent === 'Glass')!);
    expect(p.onLook).toHaveBeenLastCalledWith('@body:b', { color: '#b9c7d6', opacity: 0.18, finish: 'glass' });
  });
  it('says so when there is no solid', () => {
    const { r } = setup({ rows: [] });
    expect(r.container.textContent).toContain('No solid yet.');
  });
  it('the edit buttons follow the selection: copy needs one body, combine at least two, delete at least one', () => {
    const edits = { onCopy: vi.fn(), onRemove: vi.fn(), onCombine: vi.fn() };
    const btn = (r: ReturnType<typeof setup>['r'], label: string) => [...r.container.querySelectorAll<HTMLButtonElement>('.bodies-edit button')].find((b) => b.textContent === label)!;
    const none = setup(edits);
    for (const l of ['Copy', 'Delete', 'Join', 'Cut', 'Intersect']) expect(btn(none.r, l).disabled, l).toBe(true);
    cleanup();
    const one = setup({ ...edits, selected: ['@body:a'] });
    expect([btn(one.r, 'Copy').disabled, btn(one.r, 'Delete').disabled, btn(one.r, 'Join').disabled]).toEqual([false, false, true]);
    fireEvent.click(btn(one.r, 'Copy'));
    expect(edits.onCopy).toHaveBeenCalledWith('@body:a');
    cleanup();
    const two = setup({ ...edits, selected: ['@body:b', '@body:a'] });
    expect([btn(two.r, 'Copy').disabled, btn(two.r, 'Join').disabled, btn(two.r, 'Cut').disabled, btn(two.r, 'Intersect').disabled]).toEqual([true, false, false, false]);
    fireEvent.click(btn(two.r, 'Cut'));
    expect(edits.onCombine).toHaveBeenCalledWith('cut', ['@body:b', '@body:a']);   // the first selected keeps the result
    fireEvent.click(btn(two.r, 'Delete'));
    expect(edits.onRemove).toHaveBeenCalledWith(['@body:b', '@body:a']);
  });
  it('without the edit handlers the panel shows no edit buttons', () => {
    expect(setup().r.container.querySelector('.bodies-edit')).toBeNull();
  });
});

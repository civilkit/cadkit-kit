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
});

import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { TabStrip, dropIndex } from './TabStrip';
import '../i18n';

afterEach(() => cleanup());
const tabs = [{ id: 1, name: 'Bracket', dirty: false, active: false }, { id: 2, name: 'Gear train', dirty: true, active: true }];

// jsdom has no DragEvent: a plain event that carries the pointer's x
const dragAt = (type: string, x: number): Event => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'clientX', { value: x }); return e; };

describe('TabStrip', () => {
  it('shows each part, marks the active and unsaved ones, and reports clicks', () => {
    const calls: string[] = [];
    const r = render(<TabStrip tabs={tabs} onSwitch={(id) => calls.push('switch' + id)} onClose={(id) => calls.push('close' + id)} onNew={() => calls.push('new')} />);
    const els = [...r.container.querySelectorAll('.tab')] as HTMLElement[];
    expect(els.map((e) => e.querySelector('.tab-name')?.textContent)).toEqual(['Bracket', 'Gear train']);
    expect(els[1].classList.contains('active')).toBe(true);
    expect(els[1].querySelector('.tab-dirty')).not.toBeNull();
    expect(els[0].querySelector('.tab-dirty')).toBeNull();
    fireEvent.click(els[0]);
    fireEvent.click(els[1].querySelector('.tab-x')!);   // the × closes without switching
    fireEvent.click(r.container.querySelector('[data-action="new-tab"]')!);
    expect(calls).toEqual(['switch1', 'close2', 'new']);
  });
  it('a middle click closes a tab', () => {
    const calls: string[] = [];
    const r = render(<TabStrip tabs={tabs} onSwitch={() => {}} onClose={(id) => calls.push('close' + id)} onNew={() => {}} />);
    fireEvent(r.container.querySelectorAll('.tab')[0], new MouseEvent('auxclick', { button: 1, bubbles: true }));
    expect(calls).toEqual(['close1']);
  });
  it('dropIndex says where a dragged tab lands', () => {
    expect(dropIndex([1, 2, 3, 4], 1, 3, false)).toBe(1);   // 2, 1, 3, 4
    expect(dropIndex([1, 2, 3, 4], 1, 3, true)).toBe(2);    // 2, 3, 1, 4
    expect(dropIndex([1, 2, 3, 4], 4, 1, false)).toBe(0);
    expect(dropIndex([1, 2, 3, 4], 2, 4, true)).toBe(3);
  });
  it('dragging a tab onto another reports the new place', async () => {
    const calls: string[] = [];
    const three = [...tabs, { id: 3, name: 'Flange', dirty: false, active: false }];
    const r = render(<TabStrip tabs={three} onSwitch={() => {}} onClose={() => {}} onNew={() => {}} onMove={(id, to) => calls.push(`${id}->${to}`)} />);
    const els = [...r.container.querySelectorAll('.tab')] as HTMLElement[];
    fireEvent.dragStart(els[0]);
    fireEvent(els[2], dragAt('dragover', 5));   // jsdom boxes are empty: any x > 0 is the second half
    await waitFor(() => expect(els[2].classList.contains('drop-after')).toBe(true));
    fireEvent(els[2], dragAt('drop', 5));
    expect(calls).toEqual(['1->2']);
    expect(r.container.querySelector('.dragging')).toBeNull();
  });
  it('a tab dropped on itself, or with no move handler, is left alone', () => {
    const calls: string[] = [];
    const r = render(<TabStrip tabs={tabs} onSwitch={() => {}} onClose={() => {}} onNew={() => {}} onMove={() => calls.push('x')} />);
    const els = [...r.container.querySelectorAll('.tab')] as HTMLElement[];
    fireEvent.dragStart(els[0]); fireEvent.drop(els[0]);
    expect(calls).toEqual([]);
    cleanup();
    const r2 = render(<TabStrip tabs={tabs} onSwitch={() => {}} onClose={() => {}} onNew={() => {}} />);
    expect(r2.container.querySelector('.tab')!.getAttribute('draggable')).toBe('false');
  });
  it('the list of all parts opens from the ▾ button and switches', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: 'Part ' + (i + 1), dirty: i === 2, active: i === 0 }));
    const calls: string[] = [];
    const r = render(<TabStrip tabs={many} onSwitch={(id) => calls.push('switch' + id)} onClose={() => {}} onNew={() => {}} />);
    expect(r.container.querySelector('.tab-list')).toBeNull();
    fireEvent.click(r.container.querySelector('[data-action="tab-list"]')!);
    const items = [...r.container.querySelectorAll('.tab-list [data-list-tab]')] as HTMLElement[];
    expect(items).toHaveLength(8);
    expect(items[2].querySelector('.tab-dirty')).not.toBeNull();
    fireEvent.click(items[4]);
    expect(calls).toEqual(['switch5']);
    expect(r.container.querySelector('.tab-list')).toBeNull();
  });
  it('a few parts that fit show no list button', () => {
    const r = render(<TabStrip tabs={tabs} onSwitch={() => {}} onClose={() => {}} onNew={() => {}} />);
    expect(r.container.querySelector('[data-action="tab-list"]')).toBeNull();
  });
});

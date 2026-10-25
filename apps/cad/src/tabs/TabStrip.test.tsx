import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { TabStrip } from './TabStrip';
import '../i18n';

afterEach(() => cleanup());
const tabs = [{ id: 1, name: 'Bracket', dirty: false, active: false }, { id: 2, name: 'Gear train', dirty: true, active: true }];

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
});

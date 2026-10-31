import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { DocSwitcher } from './DocSwitcher';

afterEach(cleanup);
const tabs = [{ id: 1, name: 'Plate', dirty: true, active: true }, { id: 2, name: 'Bracket', dirty: false, active: false }];
const props = (over = {}) => ({ tabs, title: 'Plate', dirty: true, open: false, onOpen: () => {}, onSwitch: () => {}, onClose: () => {}, onNew: () => {}, ...over });

describe('DocSwitcher', () => {
  it('the title is the button: name, unsaved dot and the number of open documents', () => {
    const { container } = render(<DocSwitcher {...props()} />);
    expect(container.querySelector('.doc-switch .doc-name')?.textContent).toContain('Plate');
    expect(container.querySelector('.doc-dirty')).toBeTruthy();
    expect(container.querySelector('.doc-count')?.textContent).toBe('2');
    expect(container.querySelector('.doc-list')).toBeNull();
  });
  it('one document: no count', () => {
    const { container } = render(<DocSwitcher {...props({ tabs: [tabs[0]!] })} />);
    expect(container.querySelector('.doc-count')).toBeNull();
  });
  it('opens the list of documents with New, switches and closes from it', () => {
    const onOpen = vi.fn(), onSwitch = vi.fn(), onClose = vi.fn(), onNew = vi.fn();
    const { container } = render(<DocSwitcher {...props({ open: true, onOpen, onSwitch, onClose, onNew })} />);
    expect([...container.querySelectorAll('[data-list-tab]')].map((e) => e.textContent?.trim())).toEqual(['Plate', 'Bracket']);
    fireEvent.click(container.querySelector('[data-list-tab="2"]')!);
    expect(onSwitch).toHaveBeenCalledWith(2);
    fireEvent.click(container.querySelectorAll('.doc-x')[1]!);
    expect(onClose).toHaveBeenCalledWith(2);
    fireEvent.click(container.querySelector('.doc-new')!);
    expect(onNew).toHaveBeenCalled();
    fireEvent.click(container.querySelector('.doc-switch')!);
    expect(onOpen).toHaveBeenCalledWith(false);
  });
});

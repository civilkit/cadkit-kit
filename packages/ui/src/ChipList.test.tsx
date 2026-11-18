import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import './i18n';
import { ChipList } from './ChipList';

afterEach(cleanup);
const items = [{ key: 'a', label: 'A|B', kind: 'edge' }, { key: 'b', label: 'Face F1', kind: 'face', count: 3 }];

describe('ChipList', () => {
  const setup = (extra = {}) => {
    const p = { onRemove: vi.fn(), onHover: vi.fn() };
    const m = render(<ChipList items={items} removeLabel={(c) => 'Remove ' + c.label} {...p} {...extra} />);
    return { p, ...m };
  };
  it('draws a chip per item with its kind class, and an x per chip that reports the item and index', () => {
    const { p, container, getByLabelText } = setup();
    expect(container.querySelectorAll('.chip').length).toBe(2);
    expect(container.querySelector('.chip.edge')).toBeTruthy();
    expect(container.querySelectorAll('.chip')[1].getAttribute('data-run')).toBe('3');
    fireEvent.click(getByLabelText('Remove Face F1'));
    expect(p.onRemove).toHaveBeenCalledWith(items[1], 1);
    expect(p.onHover).toHaveBeenLastCalledWith(null);
  });
  it('hovering a chip reports it, leaving the list reports null', () => {
    const { p, container } = setup();
    fireEvent.mouseEnter(container.querySelectorAll('.chip')[0]);
    expect(p.onHover).toHaveBeenLastCalledWith(items[0]);
    fireEvent.mouseLeave(container.querySelector('.chips')!);
    expect(p.onHover).toHaveBeenLastCalledWith(null);
  });
  it('a chip name is a button only when onReveal is given and the chip can be revealed', () => {
    const onReveal = vi.fn();
    const { container } = setup({ onReveal, canReveal: (c: { key: string }) => c.key === 'a', revealLabel: 'Show' });
    const names = container.querySelectorAll('.chip-name');
    expect(names.length).toBe(1);
    fireEvent.click(names[0]);
    expect(onReveal).toHaveBeenCalledWith(items[0]);
  });
});

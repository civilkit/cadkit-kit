import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { StatusBar } from './StatusBar';

afterEach(cleanup);

describe('StatusBar: alerts chip', () => {
  const chip = (o: Partial<{ total: number; unread: number; unreadErrors: number; open: boolean }> = {}, onToggle = () => {}) => ({ total: 3, unread: 0, unreadErrors: 0, open: false, onToggle, ...o });
  it('is absent until something has been raised', () => {
    const { container } = render(<StatusBar alerts={chip({ total: 0 })} hover={null} busy={false} />);
    expect(container.querySelector('.st-alerts')).toBeNull();
  });
  it('shows the unread count, red while an unread one is an error, and toggles the history', () => {
    let n = 0;
    const { container } = render(<StatusBar alerts={chip({ unread: 2, unreadErrors: 1 }, () => { n++; })} hover={null} busy={false} />);
    const b = container.querySelector('.st-alerts') as HTMLButtonElement;
    expect(b.querySelector('b')!.className).toBe('err'); expect(b.textContent).toContain('2');
    fireEvent.click(b); expect(n).toBe(1);
  });
  it('shows the total, quietly, once everything has been read', () => {
    const { container } = render(<StatusBar alerts={chip()} hover={null} busy={false} />);
    expect(container.querySelector('.st-alerts b')!.textContent).toBe('3');
    expect(container.querySelector('.st-alerts b')!.className).toBe('');
  });
  it('never shows the message text in the bar', () => {
    const { container } = render(<StatusBar alerts={chip({ unread: 1, unreadErrors: 1 })} hover={null} busy={false} />);
    expect(container.querySelector('.st-notice')).toBeNull();
  });
});

describe('StatusBar: clickable item', () => {
  it('an item with onClick is a button and calls back', () => {
    let n = 0;
    const { container } = render(<StatusBar hover={null} busy={false} items={[{ label: 'FDM:', value: '2 errors', tone: 'err', onClick: () => { n++; } }]} />);
    const b = container.querySelector('button.st-chip') as HTMLButtonElement;
    expect(b.textContent).toContain('2 errors');
    b.click();
    expect(n).toBe(1);
  });
});

describe('StatusBar: low-priority items', () => {
  it('an item marked low carries st-low (a narrow screen hides it), others do not', () => {
    const { container } = render(<StatusBar hover={null} busy={false} items={[{ label: 'Faces', value: '14', low: true }, { label: 'Errors', value: '0' }, { label: 'Chk', value: '1', low: true, onClick: () => {} }]} />);
    const low = [...container.querySelectorAll('.st-low')].map((e) => e.textContent);
    expect(low).toEqual(['Faces 14', 'Chk 1']);
    expect(container.querySelectorAll('.st-item').length).toBe(3);
  });
});

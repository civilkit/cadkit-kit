import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { NotificationHistory } from './NotificationHistory';
import type { Notice } from '@kit/store';

afterEach(cleanup);
const n = (id: number, text: string, level: Notice['level'] = 'info', count = 1): Notice => ({ id, text, level, at: 1_700_000_000_000 + id * 1000, count, rev: 0 });

describe('NotificationHistory', () => {
  it('lists the messages newest first, with counts and the full text of a long one', () => {
    const long = 'The edit broke the model at F4 moveFace: ' + 'z'.repeat(400);
    const { container } = render(<NotificationHistory history={[n(1, 'first'), n(2, long, 'error', 3)]} onClose={() => {}} onClear={() => {}} />);
    const rows = [...container.querySelectorAll('.ah-row')];
    expect(rows.map((r) => r.getAttribute('data-level'))).toEqual(['error', 'info']);
    expect(rows[0].querySelector('.ah-text')!.textContent).toBe(long);
    expect(rows[0].querySelector('.toast-count')!.textContent).toBe('×3');
  });
  it('says so when there is nothing, and has no Clear', () => {
    const { container } = render(<NotificationHistory history={[]} onClose={() => {}} onClear={() => {}} />);
    expect(container.querySelector('.ah-empty')).not.toBeNull();
    expect(container.textContent).not.toContain('Clear');
  });
  it('Clear and Close call back, and Esc closes', () => {
    let cleared = 0, closed = 0;
    const { container } = render(<NotificationHistory history={[n(1, 'a')]} onClose={() => { closed++; }} onClear={() => { cleared++; }} />);
    fireEvent.click([...container.querySelectorAll('.ah-btn')].find((b) => b.textContent === 'Clear')!);
    fireEvent.click(container.querySelector('.ah-close')!);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect([cleared, closed]).toEqual([1, 2]);
  });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { StatusBar } from './StatusBar';

afterEach(cleanup);

describe('StatusBar: old messages go away', () => {
  it('shows the newest notice for a few seconds only', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    const { container } = render(<StatusBar notices={[{ id: 1, text: 'F5 cuts nothing', level: 'error', at: Date.now() }]} hover={null} busy={false} />);
    expect(container.textContent).toContain('F5 cuts nothing');
    vi.setSystemTime(new Date('2026-10-14T12:00:09Z'));
    const again = render(<StatusBar notices={[{ id: 1, text: 'F5 cuts nothing', level: 'error', at: new Date('2026-10-14T12:00:00Z').getTime() }]} hover={null} busy={false} />);
    expect(again.container.textContent).not.toContain('F5 cuts nothing');
    vi.useRealTimers();
  });
});

describe('StatusBar: clickable item', () => {
  it('an item with onClick is a button and calls back', () => {
    let n = 0;
    const { container } = render(<StatusBar notices={[]} hover={null} busy={false} items={[{ label: 'FDM:', value: '2 errors', tone: 'err', onClick: () => { n++; } }]} />);
    const b = container.querySelector('button.st-chip') as HTMLButtonElement;
    expect(b.textContent).toContain('2 errors');
    b.click();
    expect(n).toBe(1);
  });
});

describe('StatusBar: low-priority items', () => {
  it('an item marked low carries st-low (a narrow screen hides it), others do not', () => {
    const { container } = render(<StatusBar notices={[]} hover={null} busy={false} items={[{ label: 'Faces', value: '14', low: true }, { label: 'Errors', value: '0' }, { label: 'Chk', value: '1', low: true, onClick: () => {} }]} />);
    const low = [...container.querySelectorAll('.st-low')].map((e) => e.textContent);
    expect(low).toEqual(['Faces 14', 'Chk 1']);
    expect(container.querySelectorAll('.st-item').length).toBe(3);
  });
});

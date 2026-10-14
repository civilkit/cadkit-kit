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

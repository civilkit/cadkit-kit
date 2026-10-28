import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/preact';
import { BusyOverlay } from './BusyOverlay';
import { Toast } from './Toast';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('BusyOverlay', () => {
  it('stays hidden for quick work and appears after the delay with a running timer', () => {
    vi.useFakeTimers();
    render(<BusyOverlay busy={true} onCancel={() => {}} delayMs={400} />);
    expect(screen.queryByText(/Rebuilding model/)).toBeNull();
    act(() => { vi.advanceTimersByTime(450); });
    expect(screen.getByText(/Rebuilding model/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1400); });
    expect(screen.getByText(/1\.[5-9] s/)).toBeTruthy();
  });
  it('never shows when the work finishes before the delay', () => {
    vi.useFakeTimers();
    const { rerender } = render(<BusyOverlay busy={true} onCancel={() => {}} delayMs={400} />);
    act(() => { vi.advanceTimersByTime(200); });
    rerender(<BusyOverlay busy={false} onCancel={() => {}} delayMs={400} />);
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryByText(/Rebuilding model/)).toBeNull();
  });
  it('calls onCancel from the Cancel button', () => {
    vi.useFakeTimers();
    const onCancel = vi.fn();
    render(<BusyOverlay busy={true} onCancel={onCancel} delayMs={0} />);
    act(() => { vi.advanceTimersByTime(50); });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
  it('adds the seconds to a custom label when asked, so a long step shows that it is still going', () => {
    vi.useFakeTimers();
    render(<BusyOverlay busy={true} onCancel={() => {}} delayMs={0} label="Building part" showElapsed />);
    act(() => { vi.advanceTimersByTime(3200); });
    expect(screen.getByText('Building part 3 s')).toBeTruthy();
  });
  it('leaves the Cancel button out of work that cannot be stopped', () => {
    vi.useFakeTimers();
    render(<BusyOverlay busy={true} onCancel={() => {}} delayMs={0} label="Building part" cancelable={false} />);
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.getByText('Building part')).toBeTruthy();
    expect(screen.queryByText('Cancel')).toBeNull();
  });
});

describe('Toast', () => {
  it('shows the newest notice and hides it after the timeout', () => {
    vi.useFakeTimers();
    const n = [{ id: 1, text: 'Opened "Bolt"', level: 'info' as const }];
    render(<Toast notices={n} ms={3000} />);
    expect(screen.getByText('Opened "Bolt"')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3100); });
    expect(screen.queryByText('Opened "Bolt"')).toBeNull();
  });
  it('shows a new notice again after an earlier one timed out', () => {
    vi.useFakeTimers();
    const first = [{ id: 1, text: 'one', level: 'info' as const }];
    const { rerender } = render(<Toast notices={first} ms={1000} />);
    act(() => { vi.advanceTimersByTime(1200); });
    rerender(<Toast notices={[...first, { id: 2, text: 'two', level: 'error' as const }]} ms={1000} />);
    expect(screen.getByText('two')).toBeTruthy();
  });
});

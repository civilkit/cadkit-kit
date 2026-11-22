import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import { HistoryPlayer, nextStep } from './HistoryPlayer';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('nextStep', () => {
  it('steps one feature, restarts from the end, and finishes at the last one', () => {
    expect(nextStep(null, 4)).toBe(1);
    expect(nextStep(1, 4)).toBe(2);
    expect(nextStep(3, 4)).toBeNull();
    expect(nextStep(0, 0)).toBeNull();
  });
});

describe('HistoryPlayer', () => {
  it('plays through the features at the chosen speed and stops at the end', async () => {
    vi.useFakeTimers();
    const calls: Array<number | null> = [];
    let cur: number | null = null;
    const Host = () => <HistoryPlayer total={3} rollback={cur} onRollback={(n) => { calls.push(n); cur = n; }} />;
    const { getByTestId } = render(<Host />);
    await act(async () => { fireEvent.click(getByTestId('hist-play')); });
    expect(calls).toEqual([1]);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(calls).toEqual([1, 2]);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(calls).toEqual([1, 2, null]);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(calls).toEqual([1, 2, null]);
    expect(getByTestId('hist-play').getAttribute('aria-pressed')).toBe('false');
  });
  it('pause stops it', async () => {
    vi.useFakeTimers();
    const calls: Array<number | null> = [];
    const { getByTestId } = render(<HistoryPlayer total={9} rollback={null} onRollback={(n) => { calls.push(n); }} />);
    await act(async () => { fireEvent.click(getByTestId('hist-play')); });
    await act(async () => { fireEvent.click(getByTestId('hist-play')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(calls.length).toBe(1);
  });
});

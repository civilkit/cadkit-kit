import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSlowClick } from './slowClick';

describe('createSlowClick', () => {
  let t = 0;
  beforeEach(() => { vi.useFakeTimers(); t = 1000; });
  afterEach(() => vi.useRealTimers());
  const make = () => { const fire = vi.fn(); return { fire, sc: createSlowClick(fire, () => t) }; };

  it('renames on a slow second click on the only selected row', () => {
    const { fire, sc } = make();
    sc.click('a', false, true);
    t += 900; sc.click('a', true, true);
    vi.advanceTimersByTime(400);
    expect(fire).toHaveBeenCalledWith('a');
  });
  it('does not rename on a fast second click (a double click)', () => {
    const { fire, sc } = make();
    sc.click('a', false, true);
    t += 200; sc.click('a', true, true);
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
  });
  it('a double click after the slow click cancels the rename', () => {
    const { fire, sc } = make();
    sc.click('a', false, true);
    t += 900; sc.click('a', true, true);
    t += 100; sc.click('a', true, true);
    sc.cancel();
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
  });
  it('needs the same row, the only selection and no modifier', () => {
    const a = make();
    a.sc.click('a', false, true); t += 900; a.sc.click('b', true, true); vi.advanceTimersByTime(1000);
    expect(a.fire).not.toHaveBeenCalled();
    const b = make();
    b.sc.click('a', false, true); t += 900; b.sc.click('a', false, true); vi.advanceTimersByTime(1000);
    expect(b.fire).not.toHaveBeenCalled();
    const c = make();
    c.sc.click('a', false, true); t += 900; c.sc.click('a', true, false); vi.advanceTimersByTime(1000);
    expect(c.fire).not.toHaveBeenCalled();
  });
  it('a long pause is just another click', () => {
    const { fire, sc } = make();
    sc.click('a', false, true);
    t += 5000; sc.click('a', true, true);
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
  });
});

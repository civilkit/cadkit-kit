// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { resetPageZoom, watchPageZoom, pageScale, RESET_HOLD_MS } from './pageZoom';

const ORIGINAL = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
const meta = () => document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!;
const setup = () => { document.head.innerHTML = `<meta name="viewport" content="${ORIGINAL}">`; };
const fakeVV = (scale: number) => { const vv = new EventTarget() as EventTarget & { scale: number }; vv.scale = scale; Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true }); return vv; };

afterEach(() => { vi.useRealTimers(); document.head.innerHTML = ''; Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true }); });

describe('resetPageZoom', () => {
  it('pins the scale to 1 and restores the original content after the hold', () => {
    setup(); vi.useFakeTimers();
    expect(resetPageZoom()).toBe(true);
    expect(meta().content).toMatch(/minimum-scale=1/);
    expect(meta().content).toMatch(/maximum-scale=1/);
    vi.advanceTimersByTime(RESET_HOLD_MS - 1);
    expect(meta().content).toMatch(/minimum-scale=1/);
    vi.advanceTimersByTime(2);
    expect(meta().content).toBe(ORIGINAL);
    expect(meta().dataset.zoomPinned).toBeUndefined();
  });
  it('a second call while pinned does not capture the pinned text as the original', () => {
    setup(); vi.useFakeTimers();
    resetPageZoom(); resetPageZoom();
    vi.advanceTimersByTime(RESET_HOLD_MS + 5);
    expect(meta().content).toBe(ORIGINAL);
  });
  it('returns false when there is no meta viewport', () => { document.head.innerHTML = ''; expect(resetPageZoom()).toBe(false); });
});

describe('watchPageZoom', () => {
  it('cancels page pinch gestures but not over a field', () => {
    setup(); fakeVV(1);
    const stop = watchPageZoom();
    const input = document.body.appendChild(document.createElement('input'));
    const a = new Event('gesturestart', { cancelable: true, bubbles: true }); document.body.dispatchEvent(a);
    const b = new Event('gesturechange', { cancelable: true, bubbles: true }); document.body.dispatchEvent(b);
    const c = new Event('gesturestart', { cancelable: true, bubbles: true }); input.dispatchEvent(c);
    expect([a.defaultPrevented, b.defaultPrevented, c.defaultPrevented]).toEqual([true, true, false]);
    stop(); input.remove();
  });
  it('calls onStuck once when the scale rises and onClear when it is back', () => {
    setup(); const vv = fakeVV(1); const onStuck = vi.fn(), onClear = vi.fn();
    const stop = watchPageZoom({ onStuck, onClear });
    vv.scale = 1.005; vv.dispatchEvent(new Event('resize')); expect(onStuck).not.toHaveBeenCalled();
    vv.scale = 1.4; vv.dispatchEvent(new Event('resize')); vv.dispatchEvent(new Event('resize'));
    expect(onStuck).toHaveBeenCalledTimes(1);
    vv.scale = 1; vv.dispatchEvent(new Event('resize')); expect(onClear).toHaveBeenCalledTimes(1);
    stop();
  });
  it('resets the zoom when a field blurs while zoomed, and not when the page is at 1', () => {
    setup(); vi.useFakeTimers(); const vv = fakeVV(1.5);
    const stop = watchPageZoom();
    document.dispatchEvent(new Event('focusout'));
    expect(meta().content).toMatch(/maximum-scale=1/); expect(meta().dataset.zoomPinned).toBe('1');
    vi.advanceTimersByTime(RESET_HOLD_MS + 1); expect(meta().content).toBe(ORIGINAL);
    vv.scale = 1; document.dispatchEvent(new Event('focusout')); expect(meta().dataset.zoomPinned).toBeUndefined();
    stop();
  });
  it('stops listening', () => {
    setup(); fakeVV(1); const stop = watchPageZoom(); stop();
    const e = new Event('gesturestart', { cancelable: true }); document.body.dispatchEvent(e); expect(e.defaultPrevented).toBe(false);
  });
  it('pageScale is 1 without a visual viewport', () => { expect(pageScale()).toBe(1); });
});

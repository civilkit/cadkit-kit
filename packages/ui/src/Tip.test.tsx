import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen, act } from '@testing-library/preact';
import { Tip, placeTip } from './Tip';

afterEach(() => { cleanup(); vi.useRealTimers(); });

// jsdom has no PointerEvent: give a plain event the pointerType the component reads, and (as Preact does when the
// element has no onpointer* property) name it with the handler's casing, e.g. PointerEnter.
const ptr = (el: Element, type: 'pointerenter' | 'pointerleave' | 'pointerdown', pointerType: string) => act(() => {
  const name = 'on' + type in el ? type : { pointerenter: 'PointerEnter', pointerleave: 'PointerLeave', pointerdown: 'PointerDown' }[type];
  const e = new Event(name, { bubbles: false });
  Object.assign(e, { pointerType });
  el.dispatchEvent(e);
});

const setup = (keys?: string) => {
  const r = render(<Tip label="Line" keys={keys}><button>x</button></Tip>);
  return { ...r, btn: r.container.querySelector('button')! };
};

describe('Tip', () => {
  it('shows at once on pointer enter and hides on leave', () => {
    const { btn } = setup();
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip').textContent).toBe('Line');
    fireEvent.pointerLeave(btn, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('shows on keyboard focus and hides on blur', () => {
    const { btn } = setup();
    fireEvent.focus(btn);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.blur(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('hides on Escape', () => {
    const { btn } = setup();
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('wires aria-describedby to the tooltip while it shows, and uses no native title', () => {
    const { btn } = setup('L');
    expect(btn.getAttribute('aria-describedby')).toBeNull();
    fireEvent.pointerEnter(btn, { pointerType: 'mouse' });
    const tip = screen.getByRole('tooltip');
    expect(btn.getAttribute('aria-describedby')).toBe(tip.id);
    expect(btn.hasAttribute('title')).toBe(false);
    expect(tip.querySelector('kbd')!.textContent).toBe('L');
  });
  it('keeps the child\'s own handlers', () => {
    const onFocus = vi.fn(), onClick = vi.fn();
    const { container } = render(<Tip label="A"><button onFocus={onFocus} onClick={onClick}>x</button></Tip>);
    const b = container.querySelector('button')!;
    fireEvent.focus(b); fireEvent.click(b);
    expect(onFocus).toHaveBeenCalled(); expect(onClick).toHaveBeenCalled();
  });
  it('shows on touch tap and goes away by itself; a long press also shows it', () => {
    vi.useFakeTimers();
    const { btn } = setup();
    ptr(btn, 'pointerenter', 'touch');
    ptr(btn, 'pointerleave', 'touch');
    expect(screen.getByRole('tooltip')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2500); });
    expect(screen.queryByRole('tooltip')).toBeNull();
    ptr(btn, 'pointerdown', 'touch');
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });
  it('shows nothing for an empty label', () => {
    const r = render(<Tip label=""><button>x</button></Tip>);
    fireEvent.pointerEnter(r.container.querySelector('button')!, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('placeTip', () => {
  const a = (l: number, t: number, w = 30, h = 30) => ({ left: l, top: t, right: l + w, bottom: t + h });
  it('prefers the requested side', () => {
    expect(placeTip(a(100, 100), 60, 24, 800, 600, 'bottom').side).toBe('bottom');
    expect(placeTip(a(100, 100), 60, 24, 800, 600, 'right').side).toBe('right');
  });
  it('flips above when there is no room below, and stays inside the viewport', () => {
    const p = placeTip(a(100, 580), 60, 24, 800, 600, 'bottom');
    expect(p.side).toBe('top');
    expect(p.y + 24).toBeLessThanOrEqual(600);
  });
  it('flips to the left near the right edge and slides along the edge near a corner', () => {
    expect(placeTip(a(765, 100), 120, 24, 800, 600, 'right').side).toBe('left');
    const c = placeTip(a(780, 5, 15, 15), 120, 24, 800, 600, 'bottom');
    expect(c.x + 120).toBeLessThanOrEqual(800);
    expect(c.x).toBeGreaterThanOrEqual(0);
  });
  it('never returns coordinates outside the viewport', () => {
    for (const [l, t] of [[0, 0], [790, 0], [0, 590], [790, 590], [400, 300]]) {
      for (const s of ['top', 'bottom', 'left', 'right'] as const) {
        const p = placeTip(a(l, t, 10, 10), 150, 30, 800, 600, s);
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + 150).toBeLessThanOrEqual(800); expect(p.y + 30).toBeLessThanOrEqual(600);
      }
    }
  });
});

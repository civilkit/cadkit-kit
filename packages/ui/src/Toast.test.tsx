import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import { createStore, type Notifications } from '@kit/store';
import { Toast, TOAST_LONG } from './Toast';

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** the stack wired to a notification service the way the app does it */
function Stack(p: { a: Notifications }) { return <Toast notices={p.a.notices.value} onDismiss={p.a.dismiss} />; }
function mount() {
  const store = createStore(); const a = store.alerts;
  const r = render(<Stack a={a} />);
  const fire = (fn: () => void) => { act(() => { fn(); }); r.rerender(<Stack a={a} />); };
  const wait = (ms: number) => { act(() => { vi.advanceTimersByTime(ms); }); r.rerender(<Stack a={a} />); };
  return { a, store, container: r.container, fire, wait };
}

describe('Toast', () => {
  it('shows nothing when there are no notices', () => {
    expect(mount().container.querySelector('.toast-stack')).toBeNull();
  });
  it('renders each level with its own class, errors as role=alert and the rest as role=status', () => {
    const { container, fire, a } = mount();
    fire(() => { a.notify('i'); a.notify('s', 'success'); a.notify('w', 'warn'); a.notify('e', 'error'); });
    expect([...container.querySelectorAll('.toast')].map((e) => e.getAttribute('data-level'))).toEqual(['info', 'success', 'warning', 'error']);
    expect(container.querySelector('.toast.error')!.getAttribute('role')).toBe('alert');
    expect(container.querySelector('.toast.info')!.getAttribute('role')).toBe('status');
  });
  it('merges identical messages into one toast with a count', () => {
    const { container, fire, a } = mount();
    fire(() => { a.notify('Saved'); a.notify('Saved'); a.notify('Saved'); });
    expect(container.querySelectorAll('.toast').length).toBe(1);
    expect(container.querySelector('.toast-count')!.textContent).toBe('×3');
  });
  it('the close button dismisses a toast', () => {
    const { container, fire, a } = mount();
    fire(() => { a.notify('Hello'); });
    fire(() => { fireEvent.click(container.querySelector('.toast-close')!); });
    expect(container.querySelector('.toast')).toBeNull();
  });
  it('Esc dismisses the newest toast only, and not while typing in a field', () => {
    const { container, fire, a } = mount();
    fire(() => { a.notify('older'); a.notify('newer'); });
    const input = document.createElement('input'); document.body.appendChild(input);
    fire(() => { fireEvent.keyDown(input, { key: 'Escape' }); });
    expect(container.querySelectorAll('.toast').length).toBe(2);
    fire(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    expect([...container.querySelectorAll('.toast-text')].map((e) => e.textContent)).toEqual(['older']);
    input.remove();
  });
  it('an action button runs the action and closes the toast', () => {
    const { container, fire, a } = mount(); let ran = 0;
    fire(() => { a.notify('Deleted F5', 'info', { label: 'Undo', run: () => { ran++; } }); });
    const btn = container.querySelector('.toast-act') as HTMLButtonElement;
    expect(btn.textContent).toBe('Undo');
    fire(() => { fireEvent.click(btn); });
    expect(ran).toBe(1); expect(container.querySelector('.toast')).toBeNull();
  });
  it('collapses a long message behind Show more, which expands it in place', () => {
    const { container, fire, a } = mount();
    fire(() => { a.notify('x'.repeat(TOAST_LONG + 1)); });
    const text = container.querySelector('.toast-text')!;
    expect(text.classList.contains('clamp')).toBe(true);
    const more = container.querySelector('.toast-more') as HTMLButtonElement;
    expect(more.textContent).toBe('Show more');
    fire(() => { fireEvent.click(more); });
    expect(container.querySelector('.toast-text')!.classList.contains('clamp')).toBe(false);
    expect((container.querySelector('.toast-more') as HTMLButtonElement).textContent).toBe('Show less');
  });
  it('leaves a short message without Show more', () => {
    const { container, fire, a } = mount();
    fire(() => { a.notify('short'); });
    expect(container.querySelector('.toast-more')).toBeNull();
    expect(container.querySelector('.toast-copy')).toBeNull();
  });
  it('an error has a Copy button that copies the full text', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container, fire, a } = mount();
    const long = 'The edit broke the model at F4 moveFace: ' + 'y'.repeat(300);
    fire(() => { a.notify(long, 'error'); });
    await act(async () => { fireEvent.click(container.querySelector('.toast-copy')!); });
    expect(writeText).toHaveBeenCalledWith(long);
  });
  it('info dismisses itself after its duration scales with the length', () => {
    vi.useFakeTimers();
    const { container, a, fire, wait } = mount();
    fire(() => { a.notify('short'); });   // 4000 + 5 * 60
    wait(4200);
    expect(container.querySelector('.toast')).not.toBeNull();
    wait(300);
    expect(container.querySelector('.toast')).toBeNull();
    fire(() => { a.notify('y'.repeat(100)); });   // 10 s
    wait(9000);
    expect(container.querySelector('.toast')).not.toBeNull();
    wait(1200);
    expect(container.querySelector('.toast')).toBeNull();
  });
  it('an error stays for a long time', () => {
    vi.useFakeTimers();
    const { container, a, fire, wait } = mount();
    fire(() => { a.notify('boom', 'error'); });
    wait(59000);
    expect(container.querySelector('.toast')).not.toBeNull();
    wait(2000);
    expect(container.querySelector('.toast')).toBeNull();
  });
  it('never dismisses while hovered or focused, then finishes what was left', () => {
    vi.useFakeTimers();
    const { container, a, fire, wait } = mount();
    fire(() => { a.notify('short'); });   // 4300
    wait(3000);
    fire(() => { fireEvent.mouseEnter(container.querySelector('.toast')!); });
    wait(60000);
    expect(container.querySelector('.toast')).not.toBeNull();
    fire(() => { fireEvent.mouseLeave(container.querySelector('.toast')!); });
    wait(1400);
    expect(container.querySelector('.toast')).toBeNull();
    fire(() => { a.notify('again'); });
    fire(() => { fireEvent.focus(container.querySelector('.toast')!); });
    wait(60000);
    expect(container.querySelector('.toast')).not.toBeNull();
  });
  it('an identical message merging in restarts the timer', () => {
    vi.useFakeTimers();
    const { container, a, fire, wait } = mount();
    fire(() => { a.notify('short'); });
    wait(4000);
    fire(() => { a.notify('short'); });
    wait(4000);
    expect(container.querySelector('.toast')).not.toBeNull();
    wait(500);
    expect(container.querySelector('.toast')).toBeNull();
  });
});

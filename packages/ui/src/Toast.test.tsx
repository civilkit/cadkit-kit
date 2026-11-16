import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { createStore } from '@kit/store';
import { Toast } from './Toast';

afterEach(cleanup);
const n = (id: number, text: string, level: 'info' | 'warn' | 'error' = 'info', at = Date.now()) => ({ id, text, level, at });

describe('Toast', () => {
  it('shows the recent notices, newest last, and not the expired ones', () => {
    const { container } = render(<Toast notices={[n(1, 'old', 'info', Date.now() - 60000), n(2, 'one'), n(3, 'two', 'error')]} />);
    expect(container.textContent).toContain('one'); expect(container.textContent).toContain('two'); expect(container.textContent).not.toContain('old');
  });
  it('shows at most three at once and queues the rest', () => {
    const { container, rerender } = render(<Toast notices={[]} />);
    rerender(<Toast notices={[1, 2, 3, 4, 5].map((i) => n(i, 'msg ' + i))} />);
    expect(container.querySelectorAll('.toast').length).toBe(3);
    expect(container.textContent).toContain('msg 1'); expect(container.textContent).not.toContain('msg 5');
  });
  it('identical messages merge into one toast with a count', () => {
    const { container, rerender } = render(<Toast notices={[]} />);
    rerender(<Toast notices={[n(1, 'Saved'), n(2, 'Saved'), n(3, 'Saved')]} />);
    expect(container.querySelectorAll('.toast').length).toBe(1);
    expect(container.querySelector('.toast-count')!.textContent).toBe('×3');
  });
  it('tapping a toast dismisses it', () => {
    const { container, rerender } = render(<Toast notices={[]} />);
    rerender(<Toast notices={[n(1, 'Hello')]} />);
    fireEvent.click(container.querySelector('.toast-text')!);
    expect(container.querySelector('.toast')).toBeNull();
  });
  it('a notice with an action shows its button; clicking runs it and hides the toast', async () => {
    const store = createStore();
    let ran = 0;
    const { container, rerender } = render(<Toast notices={store.notices.value} />);
    store.notify('Deleted F5', 'info', { label: 'Undo', run: () => { ran++; } });
    rerender(<Toast notices={store.notices.value} />);
    const btn = container.querySelector('.toast-act') as HTMLButtonElement;
    expect(btn.textContent).toBe('Undo');
    fireEvent.click(btn);
    expect(ran).toBe(1);
    rerender(<Toast notices={store.notices.value} />);
    expect(container.querySelector('.toast')).toBeNull();
  });
  it('expired toasts go and the next queued one takes the place', () => {
    let t = 1000;
    const list = [1, 2, 3, 4].map((i) => n(i, 'm' + i, 'info', 1000));
    const { container, rerender } = render(<Toast notices={[]} now={() => t} />);
    rerender(<Toast notices={list} now={() => t} />);
    expect(container.querySelectorAll('.toast').length).toBe(3);
    t = 5000; rerender(<Toast notices={list} now={() => t} />);
    expect(container.querySelector('.toast')).toBeNull();
  });
});

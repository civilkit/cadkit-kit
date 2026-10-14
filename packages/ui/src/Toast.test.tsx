import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { createStore } from '@kit/store';
import { Toast } from './Toast';

afterEach(cleanup);

describe('Toast', () => {
  it('shows the newest notice', () => {
    const { container } = render(<Toast notices={[{ id: 1, text: 'one', level: 'info' }, { id: 2, text: 'two', level: 'error' }]} />);
    expect(container.textContent).toContain('two');
    expect(container.textContent).not.toContain('one');
  });
  it('a notice with an action shows its button; clicking runs it and hides the toast', async () => {
    const store = createStore();
    let ran = 0;
    store.notify('Deleted F5', 'info', { label: 'Undo', run: () => { ran++; } });
    const { container, rerender } = render(<Toast notices={store.notices.value} />);
    const btn = container.querySelector('.toast-act') as HTMLButtonElement;
    expect(btn.textContent).toBe('Undo');
    fireEvent.click(btn);
    expect(ran).toBe(1);
    rerender(<Toast notices={store.notices.value} />);
    expect(container.querySelector('.toast')).toBeNull();
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen, act, waitFor } from '@testing-library/preact';
import { Slot, slotMemory, type SlotItem } from './Slot';

afterEach(() => { cleanup(); });
beforeEach(() => { slotMemory.reset(); try { localStorage.clear(); } catch { /* */ } });

const mk = (over: Partial<SlotItem> = {}): SlotItem[] => [
  { id: 'a', label: 'Alpha', keys: 'Shift+A', run: vi.fn(), ...over },
  { id: 'b', label: 'Beta', run: vi.fn() },
  { id: 'c', label: 'Gamma', enabled: () => false, run: vi.fn() },
];

describe('Slot', () => {
  it('shows the first item, with a corner triangle when it holds more than one', () => {
    const { container } = render(<Slot id="s1" items={mk()} variant="rail" side="right" />);
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeTruthy();
    expect(container.querySelector('.slot.multi .slot-more')).not.toBeNull();
  });
  it('a single item has no triangle and no list', () => {
    const { container } = render(<Slot id="s2" items={[mk()[0]]} variant="rail" />);
    expect(container.querySelector('.slot-more')).toBeNull();
  });
  it('a click runs the shown item; a right click opens the list with names and keys; choosing runs it and it becomes the shown one', () => {
    const items = mk();
    const { container } = render(<Slot id="s3" items={items} variant="rail" side="right" />);
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(items[0].run).toHaveBeenCalledOnce();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Alpha' }));
    const rows = [...document.querySelectorAll('.slot-row')];
    expect(rows.map((r) => r.querySelector('.slot-name')!.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(rows[0].querySelector('kbd')!.textContent).toBe('Shift+A');
    expect((rows[2] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(rows[1]);
    expect(items[1].run).toHaveBeenCalledOnce();
    expect(document.querySelector('.slot-flyout')).toBeNull();
    expect(screen.getByRole('button', { name: 'Beta' })).toBeTruthy();   // last used
    expect(container.querySelector('[data-slot="s3"]')).not.toBeNull();
    expect(slotMemory.get('s3')).toBe('b');
  });
  it('a long press opens the list and the click that follows does not run the item', async () => {
    const items = mk();
    render(<Slot id="s4" items={items} variant="rail" side="right" />);
    const b = screen.getByRole('button', { name: 'Alpha' });
    fireEvent.pointerDown(b);
    await waitFor(() => expect(document.querySelector('.slot-flyout')).not.toBeNull(), { timeout: 3000 });   // the 380 ms hold fires
    fireEvent.pointerUp(b);
    fireEvent.click(b);
    expect(document.querySelector('.slot-flyout')).not.toBeNull();
    expect(items[0].run).not.toHaveBeenCalled();
  });
  it('a flick towards the list opens it at once', async () => {
    const items = mk();
    render(<Slot id="s5" items={items} variant="rail" side="right" />);
    const b = screen.getByRole('button', { name: 'Alpha' });
    // jsdom has no PointerEvent and no onpointer* properties, so Preact listens under the camel-case names there. The events go
    // through act (the render is flushed when it returns) and the check waits for the list instead of sleeping a fixed time,
    // so a loaded machine cannot make it flaky.
    const ev = (type: string, x: number) => act(() => { b.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10 })); });
    await ev('PointerDown', 10);
    await ev('PointerMove', 30);
    await waitFor(() => expect(document.querySelector('.slot-flyout')).not.toBeNull());
    expect(items[0].run).not.toHaveBeenCalled();
  });
  it('the corner triangle opens the list and Escape closes it', () => {
    const { container } = render(<Slot id="s6" items={mk()} variant="ribbon" />);
    fireEvent.click(container.querySelector('.slot-more')!);
    expect(document.querySelector('.slot-flyout')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.slot-flyout')).toBeNull();
  });
  it('shows the pressed item (the active tool) instead of the last used, and a radio slot is not drawn pressed', () => {
    const items: SlotItem[] = [{ id: 'x', label: 'X', run() {} }, { id: 'y', label: 'Y', pressed: () => true, run() {} }];
    const { rerender } = render(<Slot id="s7" items={items} variant="icon" />);
    expect(screen.getByRole('button', { name: 'Y' }).getAttribute('aria-pressed')).toBe('true');
    rerender(<Slot id="s7" items={items} variant="icon" radio />);
    expect(screen.getByRole('button', { name: 'Y' }).getAttribute('aria-pressed')).toBeNull();
  });
  it('a menu slot opens its list on click, keeps it open for toggles and marks the ones that are on', () => {
    let on = false;
    const items: SlotItem[] = [{ id: 't', label: 'Grid', pressed: () => on, run: () => { on = !on; } }, { id: 'u', label: 'Axes', run() {} }];
    render(<Slot id="s8" items={items} variant="ribbon" menu keepOpen icon="display" title="Show" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    fireEvent.click(document.querySelector('.slot-row')!);
    expect(on).toBe(true);
    expect(document.querySelector('.slot-flyout')).not.toBeNull();
    expect(document.querySelector('.slot-row .slot-check.on')!.textContent).toBe('✓');
  });
  it('is disabled when the shown item cannot run, and has no label text unless asked', () => {
    const items = [{ id: 'd', label: 'Dis', enabled: () => false, run() {} }];
    const { container, rerender } = render(<Slot id="s9" items={items} variant="ribbon" />);
    expect((screen.getByRole('button', { name: 'Dis' }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('.slot-lab')).toBeNull();
    rerender(<Slot id="s9" items={items} variant="ribbon" labels />);
    expect(container.querySelector('.slot-lab')!.textContent).toBe('Dis');
  });
});

describe('Slot: a disabled button says why', () => {
  const hover = (name: string) => { fireEvent.pointerEnter(screen.getByRole('button', { name }), { pointerType: 'mouse' }); return document.querySelector('.tip')?.textContent ?? ''; };
  it('shows the item\'s reason, else a generic one, in the tooltip', () => {
    const { unmount } = render(<Slot id="w1" items={[{ id: 'x', label: 'Round', enabled: () => false, why: () => 'Select two faces', run: vi.fn() }]} variant="ribbon" />);
    expect(hover('Round')).toContain('Select two faces');
    unmount();
    render(<Slot id="w2" items={[{ id: 'y', label: 'Shell', enabled: () => false, run: vi.fn() }]} variant="ribbon" />);
    expect(hover('Shell')).toContain('Not available right now');
  });
  it('an enabled button shows its tip, not a reason', () => {
    render(<Slot id="w3" items={[{ id: 'z', label: 'Hole', tip: 'Drill', why: () => 'nope', run: vi.fn() }]} variant="ribbon" />);
    const t = hover('Hole');
    expect(t).toContain('Drill'); expect(t).not.toContain('nope');
  });
});

describe('Slot fixed', () => {
  it('keeps showing the first item after another is picked from the list', () => {
    const items = mk();
    render(<Slot id="sfix" items={items} variant="rail" side="right" fixed />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Alpha' }));
    fireEvent.click([...document.querySelectorAll('.slot-row')][1]);
    expect(items[1].run).toHaveBeenCalledOnce();
    expect(slotMemory.get('sfix')).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeTruthy();
  });
});

describe('automation hooks', () => {
  it('a single command button carries cmd-<id>', () => {
    const { container } = render(<Slot id="one" items={[mk()[0]]} variant="rail" />);
    expect(container.querySelector('[data-testid="cmd-a"]')).not.toBeNull();
  });
  it('the button and the list rows carry test ids by command id', () => {
    const { container } = render(<Slot id="views" items={mk()} variant="rail" side="right" />);
    expect(container.querySelector('[data-testid="slot-views"]')).not.toBeNull();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Alpha' }));
    expect(document.querySelector('[data-testid="cmd-b"]')!.getAttribute('aria-label')).toBe('Beta');
  });
});

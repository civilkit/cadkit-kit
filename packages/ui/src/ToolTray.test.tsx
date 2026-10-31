import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import { ToolTray } from './ToolTray';
import type { Command } from './Ribbon';

afterEach(cleanup);
for (const n of ['onpointerdown']) if (!(n in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, n, { value: null, writable: true, configurable: true });

const run = vi.fn();
const cmds: Command[] = [
  { id: 'add-extrude', label: 'Extrude', tab: 'Home', group: 'Create', run },
  { id: 'add-revolve', label: 'Revolve', tab: 'Home', group: 'Create', run },
  { id: 'fit', label: 'Fit', tab: 'View', group: 'Views', run },
];
const props = (over: Partial<Parameters<typeof ToolTray>[0]> = {}) => ({ commands: cmds, activeTab: 'Home', onTab: () => {}, onDone: () => {}, ...over });

describe('ToolTray', () => {
  it('shows the tabs as chips and the tools of the active tab in one labelled strip', () => {
    const { container } = render(<ToolTray {...props()} />);
    expect([...container.querySelectorAll('.tt-tab')].map((e) => e.textContent)).toEqual(['Home', 'View']);
    expect(container.querySelector('.tt-tab.on')?.textContent).toBe('Home');
    const labels = [...container.querySelectorAll('.tt-strip .slot-lab')].map((e) => e.textContent);
    expect(labels).toEqual(['Extrude', 'Revolve']);
    expect(container.querySelectorAll('.tt-strip').length).toBe(1);
  });
  it('a tab chip asks for that tab and keeps the strip', () => {
    const onTab = vi.fn(); const onDone = vi.fn();
    const { container } = render(<ToolTray {...props({ onTab, onDone })} />);
    fireEvent.click(container.querySelectorAll('.tt-tab')[1]!);
    expect(onTab).toHaveBeenCalledWith('View');
    expect(onDone).not.toHaveBeenCalled();
  });
  it('picking a tool runs it and closes the strip', async () => {
    run.mockClear();
    const onDone = vi.fn();
    const { container } = render(<ToolTray {...props({ onDone })} />);
    fireEvent.click(container.querySelector('.tt-strip [data-testid="cmd-add-extrude"]')!);
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(onDone).toHaveBeenCalled();
  });
  it('tapping the page behind it, or Escape, closes it', () => {
    const onDone = vi.fn();
    const { container } = render(<ToolTray {...props({ onDone })} />);
    const e = new MouseEvent('pointerdown', { bubbles: true });
    act(() => { container.querySelector('.tool-scrim')!.dispatchEvent(e); });
    expect(onDone).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledTimes(2);
  });
  it('a contextual mode with one tab (a sketch) has no chips', () => {
    const { container } = render(<ToolTray {...props({ onlyTab: 'Home' })} />);
    expect(container.querySelector('.tt-tabs')).toBeNull();
  });
});

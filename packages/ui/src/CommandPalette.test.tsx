import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { CommandPalette } from './CommandPalette';
import type { Command } from './Ribbon';

afterEach(cleanup);
const mk = (over: Partial<Command> & { id: string; label: string }): Command => ({ tab: 'Home', group: 'Edit', run: () => {}, ...over });

describe('CommandPalette', () => {
  it('lists commands with shortcut badges and filters as you type', () => {
    const cmds = [mk({ id: 'a', label: 'Fillet', keys: 'Y' }), mk({ id: 'b', label: 'Boolean', keys: 'B' }), mk({ id: 'c', label: 'Shell' })];
    render(<CommandPalette commands={cmds} onClose={() => {}} />);
    expect(screen.getByText('Fillet')).toBeTruthy();
    expect(screen.getByText('Y')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Search commands'), { target: { value: 'bool' } });
    expect(screen.queryByText('Fillet')).toBeNull();
    expect(screen.getByText('Boolean')).toBeTruthy();
  });
  it('Enter runs the highlighted command and closes; arrows move the highlight', () => {
    const a = vi.fn(), b = vi.fn(), close = vi.fn();
    render(<CommandPalette commands={[mk({ id: 'a', label: 'One', run: a }), mk({ id: 'b', label: 'Two', run: b })]} onClose={close} />);
    const input = screen.getByLabelText('Search commands');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(b).toHaveBeenCalled();
    expect(a).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
  it('hides a hideUnlessEnabled command while it is disabled, shows it when enabled, and matches keywords', () => {
    let on = false;
    const cmds = [mk({ id: 'imp', label: 'Import DXF into sketch', hideUnlessEnabled: true, enabled: () => on, why: () => 'Start a sketch first' }), mk({ id: 'new', label: 'New sketch from DXF', keywords: 'import' }), mk({ id: 'g', label: 'Grey', enabled: () => false, why: () => 'Because' })];
    const { unmount } = render(<CommandPalette commands={cmds} onClose={() => {}} />);
    fireEvent.input(screen.getByLabelText('Search commands'), { target: { value: 'import dxf' } });
    expect(screen.queryByText('Import DXF into sketch')).toBeNull();
    expect(screen.getByText('New sketch from DXF')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Search commands'), { target: { value: '' } });
    expect(screen.getByText('Grey').closest('[role=option]')!.getAttribute('title')).toBe('Because');
    unmount();
    on = true;
    render(<CommandPalette commands={cmds} onClose={() => {}} />);
    fireEvent.input(screen.getByLabelText('Search commands'), { target: { value: 'import dxf' } });
    expect(screen.getByText('Import DXF into sketch')).toBeTruthy();
  });
  it('does not run a disabled command', () => {
    const run = vi.fn();
    render(<CommandPalette commands={[mk({ id: 'a', label: 'Save', enabled: () => false, run })]} onClose={() => {}} />);
    fireEvent.keyDown(screen.getByLabelText('Search commands'), { key: 'Enter' });
    expect(run).not.toHaveBeenCalled();
  });
  it('Escape closes, and an empty result says so', () => {
    const close = vi.fn();
    render(<CommandPalette commands={[mk({ id: 'a', label: 'One' })]} onClose={close} />);
    const input = screen.getByLabelText('Search commands');
    fireEvent.input(input, { target: { value: 'zzz' } });
    expect(screen.getByText(/No command matches/)).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(close).toHaveBeenCalled();
  });
  it('shows pinned commands as an icon grid until you type', () => {
    const cmds = [mk({ id: 'a', label: 'Fillet', icon: 'F' }), mk({ id: 'b', label: 'Shell' })];
    const { container } = render(<CommandPalette commands={cmds} pinned={['a']} onClose={() => {}} />);
    expect(container.querySelectorAll('.pgrid button').length).toBe(1);
    fireEvent.input(screen.getByLabelText('Search commands'), { target: { value: 'sh' } });
    expect(container.querySelectorAll('.pgrid button').length).toBe(0);
  });
  it('a pinned command without an icon shows its full label, not a fragment', () => {
    const { container } = render(<CommandPalette commands={[mk({ id: 'a', label: 'Samples' })]} pinned={['a']} onClose={() => {}} />);
    expect(container.querySelector('.pgrid button')!.textContent).toBe('Samples');
  });
});

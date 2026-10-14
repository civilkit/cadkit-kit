import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import './i18n';
import { ContextMenu } from './ContextMenu';
import type { MenuItem } from './menuModel';

afterEach(cleanup);
const items: MenuItem[] = [
  { id: 'a', label: 'Fillet', keys: 'Shift+F', enabled: true },
  { id: 'b', label: 'Chamfer', enabled: false },
  { id: '-', label: '', enabled: false, separator: true },
  { id: 'c', label: 'Shell', enabled: true },
];

describe('ContextMenu', () => {
  it('lists the rows with keys and a hint, and runs a clicked row', () => {
    const onRun = vi.fn();
    render(<ContextMenu x={10} y={10} items={items} hint="Drag the dot" onRun={onRun} onClose={() => {}} />);
    expect(screen.getByText('Shift+F')).toBeTruthy();
    expect(screen.getByText('Drag the dot')).toBeTruthy();
    fireEvent.click(screen.getByText('Shell'));
    expect(onRun).toHaveBeenCalledWith('c');
    fireEvent.click(screen.getByText('Chamfer'));
    expect(onRun).toHaveBeenCalledTimes(1);   // disabled
  });
  it('arrow keys skip disabled rows and Enter runs the active one; Escape closes', () => {
    const onRun = vi.fn(), onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={items} onRun={onRun} onClose={onClose} />);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(onRun).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(onRun).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(menu, { key: 'End' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(onRun).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
  it('closes on a click outside', () => {
    const onClose = vi.fn();
    render(<div><ContextMenu x={0} y={0} items={items} onRun={() => {}} onClose={onClose} /><p>elsewhere</p></div>);
    fireEvent.mouseDown(screen.getByText('elsewhere'));
    expect(onClose).toHaveBeenCalled();
  });
});

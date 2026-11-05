import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import type { Command } from '@kit/ui';
import './i18n';
import { ExportMenu } from './ExportMenu';

afterEach(cleanup);

const items = (run = vi.fn()): Command[] => [
  { id: 'export-stl', label: 'STL (binary)', tab: 'Home', group: 'Export', run },
  { id: 'export-dxf-sketch', label: 'DXF of the sketch', tab: 'Home', group: 'Export', enabled: () => false, run },
];
function Host(p: { items: Command[] }) {
  const [open, setOpen] = useState(false);
  return <div><ExportMenu items={p.items} open={open} onOpenChange={setOpen} keys="Ctrl+E" /><p>elsewhere</p></div>;
}

describe('ExportMenu', () => {
  it('is closed until the button is pressed, then lists the formats', () => {
    render(<Host items={items()} />);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByLabelText('Export'));
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['STL (binary)', 'DXF of the sketch']);
  });
  it('runs the chosen command and closes; a disabled format does nothing', () => {
    const run = vi.fn();
    render(<Host items={items(run)} />);
    fireEvent.click(screen.getByLabelText('Export'));
    expect((screen.getByText('DXF of the sketch').closest('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('STL (binary)'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('closes on Escape and on a click outside', () => {
    render(<Host items={items()} />);
    fireEvent.click(screen.getByLabelText('Export'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByLabelText('Export'));
    fireEvent.mouseDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('shows an Only visible bodies checkbox when asked and reports its changes', () => {
    const onChange = vi.fn();
    render(<ExportMenu items={items()} open onOpenChange={() => {}} visibleOnly={{ on: false, onChange }} />);
    fireEvent.click(screen.getByLabelText('Only visible bodies (STL, OBJ, 3MF, GLB)'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it('shows the mesh quality and chord rows when asked and reports their changes', () => {
    const onQuality = vi.fn(), onChord = vi.fn();
    render(<ExportMenu items={items()} open onOpenChange={() => {}} meshQuality={{ quality: 'normal', chord: '', onQuality, onChord }} />);
    const sel = screen.getByLabelText('Mesh quality (STL, OBJ, 3MF, GLB)') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['coarse', 'normal', 'fine']);
    expect(sel.value).toBe('normal');
    fireEvent.change(sel, { target: { value: 'coarse' } });
    expect(onQuality).toHaveBeenCalledWith('coarse');
    fireEvent.input(screen.getByLabelText('Chord tolerance (mm)'), { target: { value: '0.1' } });
    expect(onChord).toHaveBeenCalledWith('0.1');
  });
  it('has no quality rows unless asked', () => {
    render(<ExportMenu items={items()} open onOpenChange={() => {}} />);
    expect(screen.queryByLabelText('Mesh quality (STL, OBJ, 3MF, GLB)')).toBeNull();
  });
});

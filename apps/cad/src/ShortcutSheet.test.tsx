import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { ShortcutSheet } from './ShortcutSheet';
import { buildCommands, type Actions } from './commands';

const cmds = () => buildCommands({
  open: vi.fn(), save: vi.fn(), samples: vi.fn(), undo: vi.fn(), redo: vi.fn(), palette: vi.fn(), toggleDrawer: vi.fn(), settings: vi.fn(), hasDocument: () => true, newPart: vi.fn(), toggleProjection: vi.fn(), sketchHere: vi.fn(), sketchOnFace: vi.fn(), hasFaceSelection: () => false, addExtrude: vi.fn(), newSketch: vi.fn(), toggleLeftPanel: vi.fn(),
  setView: vi.fn(), fit: vi.fn(), setMode: vi.fn(), mode: () => 'face', toggleLayer: vi.fn(), layer: () => true,
} as unknown as Actions);

describe('ShortcutSheet', () => {
  it('shows the groups, filters by the search box and closes on Escape', () => {
    const onClose = vi.fn();
    render(<ShortcutSheet commands={cmds()} onClose={onClose} />);
    expect(document.querySelectorAll('[data-group]').length).toBe(4);
    expect(document.querySelector('[data-shortcut="view-top"] kbd')?.textContent).toBe('1');
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'fit' } });
    expect(document.querySelector('[data-shortcut="fit"]')).not.toBeNull();
    expect(document.querySelector('[data-shortcut="view-top"]')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

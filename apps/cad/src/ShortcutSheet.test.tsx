import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { beforeEach, afterEach } from 'vitest';
import { getKeymapState, resetKeymapForTests, setKeymapState } from './keymapStore';
import { ShortcutSheet } from './ShortcutSheet';
import { buildCommands, type Actions } from './commands';

const cmds = () => buildCommands({
  open: vi.fn(), save: vi.fn(), samples: vi.fn(), undo: vi.fn(), redo: vi.fn(), palette: vi.fn(), toggleDrawer: vi.fn(), settings: vi.fn(), hasDocument: () => true, newPart: vi.fn(), toggleProjection: vi.fn(), sketchHere: vi.fn(), sketchOnFace: vi.fn(), hasFaceSelection: () => false, addExtrude: vi.fn(), newSketch: vi.fn(), toggleLeftPanel: vi.fn(),
  setView: vi.fn(), fit: vi.fn(), setMode: vi.fn(), mode: () => 'face', toggleLayer: vi.fn(), layer: () => true,
} as unknown as Actions);

describe('ShortcutSheet', () => {
  afterEach(cleanup);
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

describe('ShortcutSheet editor', () => {
  beforeEach(() => resetKeymapForTests());
  afterEach(cleanup);
  const open = () => { const c = cmds(); render(<ShortcutSheet commands={c} onClose={vi.fn()} />); };
  const press = (key: string, o: object = {}) => fireEvent.keyDown(window, { key, ...o });
  it('click, press a free key: the row shows it and the override is saved', () => {
    open();
    fireEvent.click(screen.getByTestId('rebind-fit'));
    press('g');
    expect(document.querySelector('[data-shortcut="fit"] kbd')?.textContent).toBe('G');
    expect(getKeymapState().overrides).toEqual({ fit: 'G' });
    fireEvent.click(screen.getByTestId('reset-fit'));
    expect(document.querySelector('[data-shortcut="fit"] kbd')?.textContent).toBe('Z');
    expect(getKeymapState().overrides).toEqual({});
  });
  it('a key already in use asks first; replacing unbinds the other command', () => {
    open();
    fireEvent.click(screen.getByTestId('rebind-fit'));
    press('e');   // Edge select
    expect(screen.getByTestId('keymap-clash').textContent).toContain('E is already used');
    expect(getKeymapState().overrides).toEqual({});
    fireEvent.click(screen.getByTestId('keymap-replace'));
    expect(getKeymapState().overrides).toEqual({ fit: 'E', 'sel-edge': null });
  });
  it('Esc while recording cancels the recording and leaves the sheet open', () => {
    const onClose = vi.fn();
    render(<ShortcutSheet commands={cmds()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('rebind-fit'));
    press('Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect(getKeymapState().overrides).toEqual({});
    press('Escape');
    expect(onClose).toHaveBeenCalled();
  });
  it('a preset changes the listed keys and Reset all puts them back', () => {
    open();
    fireEvent.change(screen.getByTestId('keymap-preset'), { target: { value: 'freecad' } });
    expect(document.querySelector('[data-shortcut="view-front"] kbd')?.textContent).toBe('1');
    expect(document.querySelector('[data-shortcut="view-top"] kbd')?.textContent).toBe('2');
    fireEvent.click(screen.getByTestId('keymap-reset'));
    expect(document.querySelector('[data-shortcut="view-top"] kbd')?.textContent).toBe('1');
    expect(getKeymapState()).toEqual({ preset: 'default', overrides: {} });
  });
  it('an unbound command keeps its row, empty, so it can be bound again; built-in keys have no editor', () => {
    setKeymapState({ preset: 'default', overrides: { fit: null } }, false);
    open();
    expect(document.querySelector('[data-shortcut="fit"] kbd')?.textContent).toBe(screen.getByTestId('rebind-fit').textContent);
    expect(document.querySelector('[data-shortcut="fit"] kbd.none')).not.toBeNull();
    expect(document.querySelector('[data-shortcut="orbit"] button.kbd-btn')).toBeNull();
  });
});

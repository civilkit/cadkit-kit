import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { DEFAULT_DISPLAY } from '@kit/store';
import { t } from './i18n';
import { DisplayMenu, DISPLAY_LAYERS } from './DisplayMenu';

afterEach(cleanup);

describe('DisplayMenu', () => {
  it('is closed until the button is pressed, then lists every layer with its state', () => {
    render(<DisplayMenu display={{ ...DEFAULT_DISPLAY, planes: false }} onToggle={() => {}} />);
    expect(screen.queryByText('Sketches')).toBeNull();
    fireEvent.click(screen.getByText('Display'));
    for (const l of DISPLAY_LAYERS) expect(screen.getByLabelText(t('layer.' + l))).toBeTruthy();
    expect((screen.getByLabelText('Planes') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Sketches') as HTMLInputElement).checked).toBe(true);
  });
  it('reports a toggle with the layer and its new state', () => {
    const onToggle = vi.fn();
    render(<DisplayMenu display={DEFAULT_DISPLAY} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('Display'));
    fireEvent.click(screen.getByLabelText('Sketches'));
    expect(onToggle).toHaveBeenCalledWith('sketches', false);
  });
  it('closes on Escape and on a click outside', () => {
    render(<div><DisplayMenu display={DEFAULT_DISPLAY} onToggle={() => {}} /><p>elsewhere</p></div>);
    fireEvent.click(screen.getByText('Display'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Edges')).toBeNull();
    fireEvent.click(screen.getByText('Display'));
    fireEvent.mouseDown(screen.getByText('elsewhere'));
    expect(screen.queryByLabelText('Edges')).toBeNull();
  });
});

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

describe('DisplayMenu look sections', () => {
  const base = { style: 'shadedEdges', ghostOpacity: 0.35, light: 'studio', background: 'theme', appearance: { color: '#c3ccd8', material: 'default' }, anyHidden: false } as const;
  const mk = (over = {}) => {
    const look = { ...base, ...over, onLook: vi.fn(), onAppearance: vi.fn(), onShowAll: vi.fn() };
    render(<DisplayMenu display={DEFAULT_DISPLAY} onToggle={() => {}} look={look as never} />);
    fireEvent.click(screen.getByText('Display'));
    return look;
  };
  it('changes the style, lighting and background', () => {
    const look = mk();
    fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'wireframe' } });
    expect(look.onLook).toHaveBeenCalledWith({ style: 'wireframe' });
    fireEvent.change(screen.getByLabelText('Lighting'), { target: { value: 'flat' } });
    expect(look.onLook).toHaveBeenCalledWith({ light: 'flat' });
    fireEvent.change(screen.getByLabelText('Background'), { target: { value: 'gradient' } });
    expect(look.onLook).toHaveBeenCalledWith({ background: 'gradient' });
  });
  it('shows the opacity slider only for the ghost style', () => {
    cleanup();
    mk();
    expect(screen.queryByLabelText('Opacity')).toBeNull();
    cleanup();
    const look = mk({ style: 'ghost' });
    fireEvent.input(screen.getByLabelText('Opacity'), { target: { value: '0.6' } });
    expect(look.onLook).toHaveBeenCalledWith({ ghostOpacity: 0.6 });
  });
  it('picks a colour from the palette and a material', () => {
    const look = mk();
    fireEvent.click(screen.getByLabelText('#e8730c'));
    expect(look.onAppearance).toHaveBeenCalledWith({ color: '#e8730c' });
    expect((screen.getByLabelText('#c3ccd8') as HTMLElement).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'brushed' } });
    expect(look.onAppearance).toHaveBeenCalledWith({ material: 'brushed' });
  });
  it('offers Show all only when something is hidden', () => {
    cleanup();
    mk();
    expect(screen.queryByText('Show all')).toBeNull();
    cleanup();
    const look = mk({ anyHidden: true });
    fireEvent.click(screen.getByText('Show all'));
    expect(look.onShowAll).toHaveBeenCalled();
  });
});

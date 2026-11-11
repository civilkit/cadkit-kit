import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { DEFAULT_APPEARANCE, sanitizeAppearance, type Appearance } from '@kit/viewport';
import { t } from './i18n';
import { SurfaceControls, grainPatch, pbrPatch } from './SurfaceControls';
import { sanitizeLook, withAppearance, DEFAULT_LOOK } from './look';

afterEach(cleanup);
const slide = (label: string, v: number): void => { fireEvent.input(screen.getByLabelText(label), { target: { value: String(v) } }); };

describe('SurfaceControls', () => {
  it('a slider reports the change merged with the overrides already there', () => {
    const on = vi.fn();
    const a: Appearance = { ...DEFAULT_APPEARANCE, pbr: { roughness: 0.7 } };
    render(<SurfaceControls appearance={a} onAppearance={on} />);
    slide(t('surface.clearcoat'), 0.4);
    expect(on).toHaveBeenCalledWith({ pbr: { roughness: 0.7, clearcoat: 0.4 } });
    slide(t('surface.metalness'), 0.1);
    expect(on).toHaveBeenLastCalledWith({ pbr: { roughness: 0.7, metalness: 0.1 } });
  });
  it('shows the material\'s own roughness and metalness until they are changed', () => {
    render(<SurfaceControls appearance={{ ...DEFAULT_APPEARANCE, material: 'matte' }} onAppearance={() => {}} />);
    expect((screen.getByLabelText(t('surface.roughness')) as HTMLInputElement).value).toBe('0.85');
    expect((screen.getByLabelText(t('surface.metalness')) as HTMLInputElement).value).toBe('0');
  });
  it('the grain fields appear with the grain, and switching it on starts from the wood defaults', () => {
    const on = vi.fn();
    const { rerender } = render(<SurfaceControls appearance={DEFAULT_APPEARANCE} onAppearance={on} />);
    expect(screen.queryByTestId('grain-controls')).toBeNull();
    fireEvent.click(screen.getByLabelText(t('surface.grain')));
    expect(on).toHaveBeenCalledWith({ look: { kind: 'wood' } });
    rerender(<SurfaceControls appearance={{ ...DEFAULT_APPEARANCE, look: { kind: 'wood', scale: 6 } }} onAppearance={on} />);
    expect(screen.getByTestId('grain-controls')).toBeTruthy();
    slide(t('surface.grain.contrast'), 0.8);
    expect(on).toHaveBeenLastCalledWith({ look: { kind: 'wood', scale: 6, contrast: 0.8 } });
    fireEvent.change(screen.getByLabelText(t('surface.grain.direction')), { target: { value: 'z' } });
    expect(on).toHaveBeenLastCalledWith({ look: { kind: 'wood', scale: 6, axis: 'z' } });
    rerender(<SurfaceControls appearance={{ ...DEFAULT_APPEARANCE, look: { kind: 'wood', off: true } }} onAppearance={on} />);
    expect(screen.queryByTestId('grain-controls')).toBeNull();
  });
  it('Reset clears both, and is off when nothing is overridden', () => {
    const on = vi.fn();
    const { rerender } = render(<SurfaceControls appearance={DEFAULT_APPEARANCE} onAppearance={on} />);
    expect((screen.getByText(t('surface.reset')) as HTMLButtonElement).disabled).toBe(true);
    rerender(<SurfaceControls appearance={{ ...DEFAULT_APPEARANCE, pbr: { roughness: 0.2 } }} onAppearance={on} />);
    fireEvent.click(screen.getByText(t('surface.reset')));
    expect(on).toHaveBeenCalledWith({ pbr: undefined, look: undefined });
  });
});

describe('surface patches and storage', () => {
  it('grainPatch off removes the look; on keeps what was set', () => {
    expect(grainPatch({ ...DEFAULT_APPEARANCE, look: { kind: 'wood', scale: 3 } }, null)).toEqual({ look: { kind: 'wood', scale: 3, off: true } });
    expect(grainPatch({ ...DEFAULT_APPEARANCE, look: { kind: 'wood', scale: 3, off: true } }, {})).toEqual({ look: { kind: 'wood', scale: 3 } });
    expect(grainPatch({ ...DEFAULT_APPEARANCE, look: { kind: 'wood', scale: 3 } }, { tone: '#112233' })).toEqual({ look: { kind: 'wood', scale: 3, tone: '#112233' } });
    expect(pbrPatch(DEFAULT_APPEARANCE, 'roughness', 0.3)).toEqual({ pbr: { roughness: 0.3 } });
  });
  it('an appearance that only has surface overrides is kept by the stored look, and removing them removes it', () => {
    const l = withAppearance(DEFAULT_LOOK, 'P', { pbr: { clearcoat: 0.5 }, look: { kind: 'wood', contrast: 0.9 } });
    const back = sanitizeLook(JSON.parse(JSON.stringify(l)));
    expect(back.appearances.P?.pbr).toEqual({ clearcoat: 0.5 });
    expect(back.appearances.P?.look).toEqual({ kind: 'wood', contrast: 0.9 });
    const cleared = withAppearance(back, 'P', { pbr: undefined, look: undefined });
    expect(cleared.appearances.P).toBeUndefined();
  });
  it('out-of-range slider values are clamped when stored', () => {
    const a = sanitizeAppearance({ color: '#aabbcc', material: 'default', pbr: { roughness: 3, clearcoat: -1 }, look: { kind: 'wood', scale: 999, contrast: 2 } });
    expect(a.pbr).toEqual({ roughness: 1, clearcoat: 0 });
    expect(a.look).toMatchObject({ scale: 50, contrast: 1 });
  });
});

describe('texture picker', () => {
  const assets = [{ id: 'walnut_veneer_02', name: 'Walnut Veneer 02', authors: ['A Author'], scale: 1000, thumb: 'https://cdn.polyhaven.com/t.png' }, { id: 'oak_plank', name: 'Oak Plank', authors: [], scale: 2000, thumb: 'https://cdn.polyhaven.com/o.png' }];
  it('says libraries are off, asks before enabling, and lists nothing until then', () => {
    const onEnable = vi.fn(); const list = vi.fn(async () => assets);
    render(<SurfaceControls appearance={DEFAULT_APPEARANCE} onAppearance={() => {}} library={{ enabled: false, onEnable, list }} />);
    fireEvent.click(screen.getByText(t('surface.texture.choose')));
    expect(screen.getByTestId('texture-off')).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(t('surface.texture.allow')));
    expect(onEnable).toHaveBeenCalled();
  });
  it('lists the textures, filters by name and applies one with its size and credit', async () => {
    const on = vi.fn();
    render(<SurfaceControls appearance={DEFAULT_APPEARANCE} onAppearance={on} library={{ enabled: true, onEnable: () => {}, list: async () => assets }} />);
    fireEvent.click(screen.getByText(t('surface.texture.choose')));
    await screen.findByText('Walnut Veneer 02');
    fireEvent.input(screen.getByLabelText(t('surface.texture.search')), { target: { value: 'oak' } });
    expect(screen.queryByText('Walnut Veneer 02')).toBeNull();
    fireEvent.input(screen.getByLabelText(t('surface.texture.search')), { target: { value: '' } });
    fireEvent.click(screen.getByText('Walnut Veneer 02'));
    expect(on).toHaveBeenCalledWith({ texture: { source: 'polyhaven', id: 'walnut_veneer_02', scale: 1000, name: 'Walnut Veneer 02', author: 'A Author' } });
  });
  it('shows the credit of the texture in use and can remove it', () => {
    const on = vi.fn();
    render(<SurfaceControls appearance={{ ...DEFAULT_APPEARANCE, texture: { source: 'polyhaven', id: 'oak_plank', name: 'Oak Plank', author: 'B Author' } }} onAppearance={on} library={{ enabled: false, onEnable: () => {}, list: async () => [] }} />);
    expect(screen.getByTestId('texture-credit').textContent).toContain('B Author');
    fireEvent.click(screen.getByText(t('surface.texture.remove')));
    expect(on).toHaveBeenCalledWith({ texture: undefined });
  });
  it('an unsafe texture id or an unknown source is dropped when stored', () => {
    expect(sanitizeAppearance({ color: '#aabbcc', material: 'default', texture: { source: 'polyhaven', id: '../x' } }).texture).toBeUndefined();
    expect(sanitizeAppearance({ color: '#aabbcc', material: 'default', texture: { source: 'other', id: 'x' } }).texture).toBeUndefined();
    expect(sanitizeAppearance({ color: '#aabbcc', material: 'default', texture: { source: 'polyhaven', id: 'oak_plank', scale: 99999 } }).texture).toEqual({ source: 'polyhaven', id: 'oak_plank', scale: 5000 });
    const l = withAppearance(DEFAULT_LOOK, 'P', { texture: { source: 'polyhaven', id: 'oak_plank' } });
    expect(sanitizeLook(JSON.parse(JSON.stringify(l))).appearances.P?.texture?.id).toBe('oak_plank');
  });
});

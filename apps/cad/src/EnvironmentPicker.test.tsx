import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { t } from './i18n';
import { EnvironmentPicker } from './EnvironmentPicker';

afterEach(cleanup);
const A = { id: 'studio_small_03', name: 'Studio Small 03', authors: ['G Author'], thumb: 'https://cdn.polyhaven.com/t.png' };
const lib = (enabled: boolean, over = {}) => ({ enabled, onEnable: vi.fn(), list: async () => [], listHdris: async () => [A, { ...A, id: 'sky_01', name: 'Sky 01', authors: [] }], ...over });

describe('EnvironmentPicker', () => {
  it('shows the built-in studio light by default and offers to allow online libraries when they are off', () => {
    const l = lib(false);
    render(<EnvironmentPicker environment={undefined} onEnvironment={() => {}} library={l} />);
    expect(screen.getByTestId('environment-current').textContent).toContain(t('env.studio'));
    fireEvent.click(screen.getByText(t('env.choose')));
    expect(screen.getByTestId('environment-off')).toBeTruthy();
    fireEvent.click(screen.getByText(t('surface.texture.allow')));
    expect(l.onEnable).toHaveBeenCalled();
  });
  it('lists the environments, filters by name and picks one with its credit', async () => {
    const on = vi.fn();
    render(<EnvironmentPicker environment={undefined} onEnvironment={on} library={lib(true)} />);
    fireEvent.click(screen.getByText(t('env.choose')));
    await waitFor(() => expect(document.querySelectorAll('[data-environment]').length).toBe(2));
    fireEvent.input(screen.getByLabelText(t('env.search')), { target: { value: 'sky' } });
    expect(document.querySelectorAll('[data-environment]').length).toBe(1);
    fireEvent.input(screen.getByLabelText(t('env.search')), { target: { value: '' } });
    fireEvent.click(document.querySelector('[data-environment="studio_small_03"]')!);
    expect(on).toHaveBeenCalledWith({ source: 'polyhaven', id: 'studio_small_03', name: 'Studio Small 03', author: 'G Author' });
  });
  it('credits the chosen environment and goes back to the studio light', () => {
    const on = vi.fn();
    render(<EnvironmentPicker environment={{ source: 'polyhaven', id: 'sky_01', name: 'Sky 01', author: 'S Author' }} onEnvironment={on} library={lib(true)} />);
    expect(screen.getByTestId('environment-credit').textContent).toContain('S Author');
    fireEvent.click(screen.getByText(t('env.choose')));
    fireEvent.click(screen.getByTestId('environment-studio'));
    expect(on).toHaveBeenCalledWith(undefined);
  });
  it('renders nothing when the library has no environments', () => {
    const { container } = render(<EnvironmentPicker environment={undefined} onEnvironment={() => {}} library={{ enabled: true, onEnable: () => {}, list: async () => [] }} />);
    expect(container.innerHTML).toBe('');
  });
});

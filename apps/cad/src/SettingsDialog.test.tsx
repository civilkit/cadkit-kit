import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { WORKSPACE_PRESETS } from '@kit/store';
import { SettingsDialog } from './SettingsDialog';

afterEach(cleanup);

describe('SettingsDialog', () => {
  it('toggling a checkbox sends only that option', () => {
    const onChange = vi.fn();
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={onChange} onPreset={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('Tool rail'));
    expect(onChange).toHaveBeenCalledWith({ toolRail: false });
  });
  it('choosing a preset calls onPreset, and the ribbon select changes the ribbon', () => {
    const onPreset = vi.fn(), onChange = vi.fn();
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={onChange} onPreset={onPreset} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Preset'), { target: { value: 'classic' } });
    expect(onPreset).toHaveBeenCalledWith('classic');
    fireEvent.change(screen.getByLabelText('Ribbon'), { target: { value: 'full' } });
    expect(onChange).toHaveBeenCalledWith({ ribbon: 'full' });
  });
  it('the opacity slider reports a 0..1 value', () => {
    const onChange = vi.fn();
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={onChange} onPreset={() => {}} onClose={() => {}} />);
    fireEvent.input(screen.getByLabelText('Opacity'), { target: { value: '40' } });
    expect(onChange).toHaveBeenCalledWith({ opacity: 0.4 });
  });
});

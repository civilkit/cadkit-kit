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
    fireEvent.input(screen.getByLabelText('Floating panel opacity'), { target: { value: '40' } });
    expect(onChange).toHaveBeenCalledWith({ opacity: 0.4 });
  });
  it('shows a language picker only when there is more than one language, and reports the choice', () => {
    const onLocale = vi.fn();
    const { rerender } = render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={() => {}} onPreset={() => {}} onClose={() => {}} locale="en" locales={['en']} onLocale={onLocale} />);
    expect(screen.queryByLabelText('Language')).toBeNull();
    rerender(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={() => {}} onPreset={() => {}} onClose={() => {}} locale="en" locales={['en', 'de']} onLocale={onLocale} />);
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'de' } });
    expect(onLocale).toHaveBeenCalledWith('de');
  });
  it('the button labels select offers icons only and reports the choice', () => {
    const onChange = vi.fn();
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={onChange} onPreset={() => {}} onClose={() => {}} />);
    const sel = screen.getByLabelText('Button labels') as HTMLSelectElement;
    expect(sel.value).toBe('icons-and-text');
    fireEvent.change(sel, { target: { value: 'icons' } });
    expect(onChange).toHaveBeenCalledWith({ toolLabels: 'icons' });
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { WORKSPACE_PRESETS } from '@kit/store';
import { SettingsDialog } from './SettingsDialog';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('SettingsDialog', () => {
  it('toggling a checkbox sends only that option', () => {
    const onChange = vi.fn();
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={onChange} onPreset={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('Tool rail'));
    expect(onChange).toHaveBeenCalledWith({ toolRail: false });
  });
  it('the handles checkbox is in Layout, on by default, and sends only that option', () => {
    const onChange = vi.fn();
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={onChange} onPreset={() => {}} onClose={() => {}} />);
    const box = screen.getByLabelText('Direct-manipulation handles on the canvas') as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ handles: false });
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
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
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

describe('SettingsDialog: sketching', () => {
  const prefs = { autoConstraints: true, arcSwitch: 'hover' as const, onViewValues: 'dimensions' as const, gridSnap: true };
  it('shows the sketch input styles and reports only what changed', () => {
    const onSketchPrefs = vi.fn();
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={() => {}} onPreset={() => {}} onClose={() => {}} sketchPrefs={prefs} onSketchPrefs={onSketchPrefs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Sketching' }));
    fireEvent.change(screen.getByLabelText('Line to tangent arc'), { target: { value: 'keys' } });
    expect(onSketchPrefs).toHaveBeenCalledWith({ arcSwitch: 'keys' });
    fireEvent.change(screen.getByLabelText('Values beside the pointer'), { target: { value: 'both' } });
    expect(onSketchPrefs).toHaveBeenCalledWith({ onViewValues: 'both' });
    fireEvent.click(screen.getByLabelText('Snap to the grid'));
    expect(onSketchPrefs).toHaveBeenCalledWith({ gridSnap: false });
    fireEvent.click(screen.getByLabelText(/Infer constraints/));
    expect(onSketchPrefs).toHaveBeenCalledWith({ autoConstraints: false });
  });
  it('hides the section when the caller gives no sketch settings', () => {
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={() => {}} onPreset={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('tab', { name: 'Sketching' })).toBeNull();
  });
});

describe('SettingsDialog: preset display', () => {
  it('shows the preset the layout matches, and Custom for a mix', () => {
    const { unmount } = render(<SettingsDialog workspace={WORKSPACE_PRESETS.classic} onChange={() => {}} onPreset={() => {}} onClose={() => {}} />);
    expect((screen.getByLabelText('Preset') as HTMLSelectElement).value).toBe('classic');
    unmount();
    render(<SettingsDialog workspace={{ ...WORKSPACE_PRESETS.plasticity, ribbon: 'full' }} onChange={() => {}} onPreset={() => {}} onClose={() => {}} />);
    const sel = screen.getByLabelText('Preset') as HTMLSelectElement;
    expect(sel.value).toBe('custom');
    expect(sel.selectedOptions[0].textContent).toMatch(/Custom/);
  });
});

describe('SettingsDialog: tabs', () => {
  const full = { locale: 'en', locales: ['en', 'de'], onLocale: () => {}, theme: 'auto' as const, onTheme: () => {}, sketchPrefs: { autoConstraints: true, arcSwitch: 'hover' as const, onViewValues: 'dimensions' as const, gridSnap: true }, onSketchPrefs: () => {} };
  const base = { workspace: WORKSPACE_PRESETS.plasticity, onChange: () => {}, onPreset: () => {}, onClose: () => {} };
  it('has General, Layout and Sketching tabs, each showing only its own settings', () => {
    render(<SettingsDialog {...base} {...full} />);
    expect(screen.getAllByRole('tab').map((x) => x.textContent)).toEqual(['General', 'Layout', 'Sketching']);
    expect(screen.getByLabelText('Preset')).toBeTruthy();                // Layout is the default
    expect(screen.queryByLabelText('Language')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(screen.getByLabelText('Language')).toBeTruthy();
    expect(screen.getByLabelText('Theme')).toBeTruthy();
    expect(screen.queryByLabelText('Preset')).toBeNull();
  });
  it('shows only the tabs that have something in them', () => {
    render(<SettingsDialog {...base} />);
    expect(screen.getAllByRole('tab').map((x) => x.textContent)).toEqual(['Layout']);
  });
  it('remembers the last tab, and the arrow keys move between tabs', () => {
    const { unmount } = render(<SettingsDialog {...base} {...full} />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });      // Layout -> Sketching
    expect(screen.getByRole('tab', { name: 'Sketching' }).getAttribute('aria-selected')).toBe('true');
    unmount();
    render(<SettingsDialog {...base} {...full} />);
    expect(screen.getByRole('tab', { name: 'Sketching' }).getAttribute('aria-selected')).toBe('true');
  });
});

import { DEFAULT_SKETCH_PREFS } from './sketchPrefs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { WORKSPACE_PRESETS } from '@kit/store';
import { SettingsDialog } from './SettingsDialog';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('SettingsDialog, Kernel tab', () => {
  const base = { workspace: WORKSPACE_PRESETS.plasticity, onChange: () => {}, onPreset: () => {}, onClose: () => {} };
  const prefs = { mode: 'local' as const, url: 'http://127.0.0.1:7461', token: '' };
  const kernel = (over: Record<string, unknown> = {}) => ({ prefs, status: { state: 'builtin' as const }, onChange: vi.fn(), onTest: vi.fn(), onRetry: vi.fn(), ...over });

  it('is there only when the app passes it, offers Built-in or Local service, and sends the choice', () => {
    const { unmount } = render(<SettingsDialog {...base} />);
    expect(screen.queryByRole('tab', { name: 'Kernel' })).toBeNull();
    unmount();
    const k = kernel({ prefs: { ...prefs, mode: 'builtin' } });
    render(<SettingsDialog {...base} kernel={k} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Kernel' }));
    expect(screen.queryByLabelText('Service address')).toBeNull();
    fireEvent.change(screen.getByLabelText('Kernel to use'), { target: { value: 'local' } });
    expect(k.onChange).toHaveBeenCalledWith({ mode: 'local' });
  });
  it('the token is a password field that is committed on change, never shown as text', () => {
    const k = kernel();
    render(<SettingsDialog {...base} kernel={k} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Kernel' }));
    const tok = screen.getByLabelText('Access token') as HTMLInputElement;
    expect(tok.type).toBe('password');
    fireEvent.input(tok, { target: { value: 's3cret' } });
    fireEvent.change(tok, { target: { value: 's3cret' } });
    expect(k.onChange).toHaveBeenLastCalledWith({ token: 's3cret' });
    const addr = screen.getByLabelText('Service address') as HTMLInputElement;
    expect(addr.value).toBe('http://127.0.0.1:7461');
    fireEvent.input(addr, { target: { value: 'http://127.0.0.1:9000' } });
    fireEvent.change(addr, { target: { value: 'http://127.0.0.1:9000' } });
    expect(k.onChange).toHaveBeenLastCalledWith({ url: 'http://127.0.0.1:9000' });
    expect(document.body.textContent).not.toContain('s3cret');
  });
  it('Test connection tests the typed values and shows the version or the reason', async () => {
    const onTest = vi.fn()
      .mockResolvedValueOnce({ ok: true, version: { kernel: '0.4.1', protocol: 1, git: 'a', build: 'b', cores: 8 } })
      .mockResolvedValueOnce({ ok: false, kind: 'unauthorized', detail: 'x' });
    render(<SettingsDialog {...base} kernel={kernel({ onTest })} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Kernel' }));
    fireEvent.input(screen.getByLabelText('Access token'), { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(onTest).toHaveBeenCalledWith({ url: 'http://127.0.0.1:7461', token: 'tok' });
    expect((await screen.findByText(/Connected: kernel 0\.4\.1, protocol 1, 8 cores/)).textContent).toMatch(/matches this app/);
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect((await screen.findByText(/Not usable: the token is missing or was refused/)).textContent).toBeTruthy();
  });
  it('shows the status, and offers a retry only after the service failed', () => {
    const connected = { state: 'connected' as const, version: { kernel: '0.4.1', protocol: 1, git: '', build: '', cores: 8 } };
    const { unmount } = render(<SettingsDialog {...base} kernel={kernel({ status: connected })} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Kernel' }));
    expect(screen.getByText(/Connected to the local service: kernel 0\.4\.1/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try the service again' })).toBeNull();
    unmount();
    const k = kernel({ status: { state: 'failed', kind: 'mismatch', detail: 'protocol 2 (this app speaks 1)', midSession: false } });
    render(<SettingsDialog {...base} kernel={k} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Kernel' }));
    expect(screen.getByText(/not used: it is a different kernel build than this app \(protocol 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try the service again' }));
    expect(k.onRetry).toHaveBeenCalled();
  });
});

describe('SettingsDialog', () => {
  it('the Navigation tab sets the up axis, the orbit mode and the pivot', () => {
    const onNavPrefs = vi.fn();
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={() => {}} onPreset={() => {}} onClose={() => {}}
      navPrefs={{ upAxis: 'y', orbitMode: 'turntable', orbitPivot: 'centre' }} onNavPrefs={onNavPrefs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Navigation' }));
    expect((screen.getByLabelText('Up axis') as HTMLSelectElement).value).toBe('y');
    fireEvent.change(screen.getByLabelText('Up axis'), { target: { value: 'z' } });
    expect(onNavPrefs).toHaveBeenLastCalledWith({ upAxis: 'z' });
    fireEvent.change(screen.getByLabelText('Orbit mode'), { target: { value: 'trackball' } });
    expect(onNavPrefs).toHaveBeenLastCalledWith({ orbitMode: 'trackball' });
    fireEvent.change(screen.getByLabelText('Orbit around'), { target: { value: 'cursor' } });
    expect(onNavPrefs).toHaveBeenLastCalledWith({ orbitPivot: 'cursor' });
  });
  it('the Positioning tab edits the move ball snap increments, and only valid numbers go out', () => {
    const onTriPrefs = vi.fn();
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={() => {}} onPreset={() => {}} onClose={() => {}} triPrefs={{ distance: 10, angle: 15 }} onTriPrefs={onTriPrefs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Positioning' }));
    const angle = screen.getByLabelText('Snap angle (degrees)') as HTMLInputElement;
    expect(angle.value).toBe('15');
    fireEvent.change(angle, { target: { value: '45' } });
    expect(onTriPrefs).toHaveBeenLastCalledWith({ angle: 45 });
    fireEvent.change(screen.getByLabelText('Snap distance (mm)'), { target: { value: '2.5' } });
    expect(onTriPrefs).toHaveBeenLastCalledWith({ distance: 2.5 });
    onTriPrefs.mockClear();
    fireEvent.change(angle, { target: { value: '-3' } });
    fireEvent.change(angle, { target: { value: '500' } });
    expect(onTriPrefs).not.toHaveBeenCalled();
  });
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
  const prefs = { ...DEFAULT_SKETCH_PREFS, autoConstraints: true, arcSwitch: 'hover' as const, onViewValues: 'dimensions' as const, gridSnap: true };
  it('shows the sketch input styles and reports only what changed', () => {
    const onSketchPrefs = vi.fn();
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={() => {}} onPreset={() => {}} onClose={() => {}} sketchPrefs={prefs} onSketchPrefs={onSketchPrefs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Sketching' }));
    fireEvent.change(screen.getByLabelText('Line to tangent arc'), { target: { value: 'keys' } });
    expect(onSketchPrefs).toHaveBeenCalledWith({ arcSwitch: 'keys' });
    fireEvent.change(screen.getByLabelText('Values beside the pointer'), { target: { value: 'both' } });
    expect(onSketchPrefs).toHaveBeenCalledWith({ onViewValues: 'both' });
    const markers = screen.getByLabelText('Constraint markers') as HTMLSelectElement;
    expect(markers.value).toBe('hover');
    expect([...markers.options].map((o) => o.textContent)).toEqual(['Hovered or selected', 'Always', 'Off']);
    fireEvent.change(markers, { target: { value: 'off' } });
    expect(onSketchPrefs).toHaveBeenCalledWith({ constraintMarkers: 'off' });
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
  const full = { locale: 'en', locales: ['en', 'de'], onLocale: () => {}, theme: 'auto' as const, onTheme: () => {}, sketchPrefs: DEFAULT_SKETCH_PREFS, onSketchPrefs: () => {} };
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

describe('SettingsDialog, Export', () => {
  const base = { workspace: WORKSPACE_PRESETS.plasticity, onChange: () => {}, onPreset: () => {}, onClose: () => {} };
  it('offers On, Ask each time and Off for cosmetic knurls on the General tab and sends the choice', () => {
    const onExportPrefs = vi.fn();
    render(<SettingsDialog {...base} exportPrefs={{ knurl: 'on' }} onExportPrefs={onExportPrefs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    const sel = screen.getByLabelText('Include cosmetic knurls in exports') as HTMLSelectElement;
    expect(sel.value).toBe('on');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['On: cut as real grooves in the file', 'Ask each time', 'Off: plain solid, as before']);
    fireEvent.change(sel, { target: { value: 'ask' } });
    expect(onExportPrefs).toHaveBeenLastCalledWith({ knurl: 'ask' });
    fireEvent.change(sel, { target: { value: 'off' } });
    expect(onExportPrefs).toHaveBeenLastCalledWith({ knurl: 'off' });
  });
  it('shows no Export section when the app passes none', () => {
    render(<SettingsDialog {...base} />);
    expect(screen.queryByRole('tab', { name: 'General' })).toBeNull();
  });
});

describe('SettingsDialog, icon set', () => {
  it('offers Default and SolidCraft (preview) on General and sends the choice', () => {
    const onIconSet = vi.fn();
    render(<SettingsDialog workspace={WORKSPACE_PRESETS.plasticity} onChange={() => {}} onPreset={() => {}} onClose={() => {}} iconSet="default" onIconSet={onIconSet} />);
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    const sel = screen.getByLabelText('Icon set') as HTMLSelectElement;
    expect(sel.value).toBe('default');
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(['Default', 'SolidCraft (preview)']);
    fireEvent.change(sel, { target: { value: 'solidcraft' } });
    expect(onIconSet).toHaveBeenCalledWith('solidcraft');
  });
});

import type { Workspace, WorkspacePreset } from '@kit/store';
import { t } from './i18n';
import { SketchPrefsSection } from './SketchPrefsSection';
import type { SketchPrefs } from './sketchPrefs';
import { THEMES, type Theme } from './theme';

/** Workspace options as plain controls. Changing a control applies immediately and is remembered by the caller. */
const languageName = (code: string, pseudo: string) => {
  if (code === pseudo) return 'Pseudo-locale (testing)';
  try { return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code; } catch { return code; }
};

export function SettingsDialog(p: {
  workspace: Workspace; onChange(patch: Partial<Workspace>): void; onPreset(name: WorkspacePreset): void; onClose(): void;
  locale?: string; locales?: string[]; pseudo?: string; onLocale?(code: string): void;
  theme?: Theme; onTheme?(theme: Theme): void;
  sketchPrefs?: SketchPrefs; onSketchPrefs?(patch: Partial<SketchPrefs>): void;
}) {
  const w = p.workspace;
  const check = (key: 'leftTabs' | 'toolRail' | 'selectionBar' | 'drawerOpen') => (
    <label class="set-row">
      <input type="checkbox" checked={w[key]} onChange={(e) => p.onChange({ [key]: (e.currentTarget as HTMLInputElement).checked })} />
      <span>{t('settings.' + key)}</span>
    </label>
  );
  const select = <K extends 'ribbon' | 'leftPanel' | 'rightPanel'>(key: K, options: Array<Workspace[K]>) => (
    <label class="set-row">
      <span>{t('settings.' + key)}</span>
      <select aria-label={t('settings.' + key)} value={w[key]} onChange={(e) => p.onChange({ [key]: (e.currentTarget as HTMLSelectElement).value } as Partial<Workspace>)}>
        {options.map((v) => <option key={v} value={v}>{t(`settings.${key}.${v}`)}</option>)}
      </select>
    </label>
  );
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dlg set-dlg" role="dialog" aria-label={t('app.settings.title')}>
        <div class="dlg-head"><b>{t('settings.label')}</b><button class="rb-btn" onClick={p.onClose}>{t('ui.close')}</button></div>
        <div class="set-body">
          <label class="set-row">
            <span>{t('settings.preset')}</span>
            <select aria-label={t('settings.preset')} value="" onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value as WorkspacePreset; if (v) p.onPreset(v); }}>
              <option value="">{t('settings.preset.choose')}</option>
              <option value="plasticity">{t('settings.preset.plasticity')}</option>
              <option value="classic">{t('settings.preset.classic')}</option>
              <option value="minimal">{t('settings.preset.minimal')}</option>
            </select>
          </label>
          {select('ribbon', ['off', 'compact', 'full'])}
          {select('leftPanel', ['docked', 'floating', 'hidden'])}
          {select('rightPanel', ['off', 'docked', 'floating'])}
          {check('leftTabs')}
          {check('toolRail')}
          {check('selectionBar')}
          {check('drawerOpen')}
          {p.locales && p.locales.length > 1 && p.onLocale ? (
            <label class="set-row"><span>{t('settings.language')}</span>
              <select aria-label={t('settings.language')} value={p.locale} onChange={(e) => p.onLocale!((e.currentTarget as HTMLSelectElement).value)}>
                {p.locales.map((c) => <option key={c} value={c}>{languageName(c, p.pseudo ?? '')}</option>)}
              </select>
            </label>
          ) : null}
          {p.onTheme ? (
            <label class="set-row"><span>{t('settings.theme')}</span>
              <select aria-label={t('settings.theme')} value={p.theme ?? 'auto'} onChange={(e) => p.onTheme!((e.currentTarget as HTMLSelectElement).value as Theme)}>
                {THEMES.map((v) => <option key={v} value={v}>{t('settings.theme.' + v)}</option>)}
              </select>
            </label>
          ) : null}
          {p.sketchPrefs && p.onSketchPrefs ? <SketchPrefsSection prefs={p.sketchPrefs} onChange={p.onSketchPrefs} /> : null}
          <label class="set-row"><span>{t('settings.opacity')}</span>
            <input type="range" min="15" max="100" value={Math.round(w.opacity * 100)} aria-label={t('settings.opacity')} onInput={(e) => p.onChange({ opacity: Number((e.currentTarget as HTMLInputElement).value) / 100 })} /></label>
          <label class="set-row"><span>{t('settings.blur')}</span>
            <input type="range" min="0" max="30" value={w.blur} aria-label={t('settings.blur')} onInput={(e) => p.onChange({ blur: Number((e.currentTarget as HTMLInputElement).value) })} /></label>
        </div>
      </div>
    </div>
  );
}

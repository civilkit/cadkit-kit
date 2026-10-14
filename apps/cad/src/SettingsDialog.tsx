import { useState } from 'preact/hooks';
import { matchPreset, type Workspace, type WorkspacePreset } from '@kit/store';
import { t } from './i18n';
import { SketchPrefsSection } from './SketchPrefsSection';
import type { SketchPrefs } from './sketchPrefs';
import type { TriPrefs } from './triball/triballPrefs';
import { THEMES, type Theme } from './theme';

/** Workspace options as plain controls. Changing a control applies immediately and is remembered by the caller. */
type Tab = 'general' | 'layout' | 'sketching' | 'positioning';
const TAB_KEY = 'cad.settingsTab';
const loadTab = (): Tab => { try { const v = localStorage.getItem(TAB_KEY); return v === 'general' || v === 'sketching' || v === 'layout' || v === 'positioning' ? v : 'layout'; } catch { return 'layout'; } };
const saveTab = (tab: Tab) => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* private window */ } };

const languageName = (code: string, pseudo: string) => {
  if (code === pseudo) return 'Pseudo-locale (testing)';
  try { return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code; } catch { return code; }
};

export function SettingsDialog(p: {
  workspace: Workspace; onChange(patch: Partial<Workspace>): void; onPreset(name: WorkspacePreset): void; onClose(): void;
  locale?: string; locales?: string[]; pseudo?: string; onLocale?(code: string): void;
  theme?: Theme; onTheme?(theme: Theme): void;
  sketchPrefs?: SketchPrefs; onSketchPrefs?(patch: Partial<SketchPrefs>): void;
  triPrefs?: TriPrefs; onTriPrefs?(patch: Partial<TriPrefs>): void;
}) {
  const w = p.workspace;
  // a tab appears only when it has something to show; the last one used is remembered
  const tabs: Tab[] = [
    ...((p.locales && p.locales.length > 1 && p.onLocale) || p.onTheme ? (['general'] as Tab[]) : []),
    'layout',
    ...(p.sketchPrefs && p.onSketchPrefs ? (['sketching'] as Tab[]) : []),
    ...(p.triPrefs && p.onTriPrefs ? (['positioning'] as Tab[]) : []),
  ];
  const [saved] = useState(loadTab);
  const [chosen, setChosen] = useState<Tab>(saved);
  const tab: Tab = tabs.includes(chosen) ? chosen : 'layout';
  const choose = (id: Tab) => { setChosen(id); saveTab(id); };
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.indexOf(tab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    choose(next);
    setTimeout(() => document.getElementById('settab-' + next)?.focus(), 0);
  };
  const check = (key: 'leftTabs' | 'toolRail' | 'selectionBar' | 'drawerOpen' | 'handles') => (
    <label class="set-row">
      <input type="checkbox" checked={w[key]} onChange={(e) => p.onChange({ [key]: (e.currentTarget as HTMLInputElement).checked })} />
      <span>{t('settings.' + key)}</span>
    </label>
  );
  const select = <K extends 'ribbon' | 'leftPanel' | 'rightPanel' | 'toolLabels'>(key: K, options: Array<Workspace[K]>) => (
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
        <div class="set-tabs" role="tablist" aria-label={t('settings.label')} onKeyDown={onTabKey}>
          {tabs.map((id) => (
            <button key={id} role="tab" id={'settab-' + id} aria-selected={tab === id} aria-controls={'setpanel-' + id} tabIndex={tab === id ? 0 : -1} class="set-tab" onClick={() => choose(id)}>
              {t('settings.tab.' + id)}
            </button>
          ))}
        </div>
        <div class="set-body" role="tabpanel" id={'setpanel-' + tab} aria-labelledby={'settab-' + tab}>
          {tab === 'layout' ? (<>
          <label class="set-row">
            <span>{t('settings.preset')}</span>
            <select aria-label={t('settings.preset')} value={matchPreset(w) ?? 'custom'} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v !== 'custom') p.onPreset(v as WorkspacePreset); }}>
              {matchPreset(w) === null ? <option value="custom">{t('settings.preset.custom')}</option> : null}
              <option value="plasticity">{t('settings.preset.plasticity')}</option>
              <option value="classic">{t('settings.preset.classic')}</option>
              <option value="minimal">{t('settings.preset.minimal')}</option>
            </select>
          </label>
          {select('ribbon', ['off', 'compact', 'full'])}
          {select('leftPanel', ['docked', 'floating', 'hidden'])}
          {select('rightPanel', ['off', 'docked', 'floating'])}
          {select('toolLabels', ['icons-and-text', 'icons'])}
          {check('leftTabs')}
          {check('toolRail')}
          {check('selectionBar')}
          {check('drawerOpen')}
          {check('handles')}
          <label class="set-row"><span>{t('settings.opacity')}</span>
            <input type="range" min="15" max="100" value={Math.round(w.opacity * 100)} aria-label={t('settings.opacity')} onInput={(e) => p.onChange({ opacity: Number((e.currentTarget as HTMLInputElement).value) / 100 })} /></label>
          <label class="set-row"><span>{t('settings.lineWidth')}</span>
            <input type="range" min="1" max="8" step="0.5" value={w.lineWidth} aria-label={t('settings.lineWidth')} onInput={(e) => p.onChange({ lineWidth: Number((e.currentTarget as HTMLInputElement).value) })} /></label>
          <label class="set-row"><span>{t('settings.blur')}</span>
            <input type="range" min="0" max="30" value={w.blur} aria-label={t('settings.blur')} onInput={(e) => p.onChange({ blur: Number((e.currentTarget as HTMLInputElement).value) })} /></label>
          </>) : null}
          {tab === 'general' ? (<>
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
          </>) : null}
          {tab === 'sketching' ? (<>
          {p.sketchPrefs && p.onSketchPrefs ? <SketchPrefsSection prefs={p.sketchPrefs} onChange={p.onSketchPrefs} /> : null}
          </>) : null}
          {tab === 'positioning' && p.triPrefs && p.onTriPrefs ? (
          <div class="set-section" role="group" aria-label={t('settings.triball.title')}>
            <b class="set-head">{t('settings.triball.title')}</b>
            <label class="set-row"><span>{t('settings.triball.distance')}</span>
              <input type="number" min="0.001" step="any" aria-label={t('settings.triball.distance')} value={p.triPrefs.distance} onChange={(e) => { const n = Number((e.currentTarget as HTMLInputElement).value); if (n > 0) p.onTriPrefs!({ distance: n }); }} /></label>
            <label class="set-row"><span>{t('settings.triball.angle')}</span>
              <input type="number" min="0.001" max="180" step="any" aria-label={t('settings.triball.angle')} value={p.triPrefs.angle} onChange={(e) => { const n = Number((e.currentTarget as HTMLInputElement).value); if (n > 0 && n <= 180) p.onTriPrefs!({ angle: n }); }} /></label>
            <div class="tb-note">{t('settings.triball.note')}</div>
          </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'preact/hooks';
import { statusText, failText, type KernelPrefs, type KernelStatus, type TestOutcome } from './kernelService';
import { matchPreset, type Workspace, type WorkspacePreset } from '@kit/store';
import { t } from './i18n';
import { SketchPrefsSection } from './SketchPrefsSection';
import type { SketchPrefs } from './sketchPrefs';
import type { NavPrefs } from './navPrefs';
import { UP_AXES, ORBIT_MODES, ORBIT_PIVOTS } from '@kit/viewport';
import type { TriPrefs } from './triball/triballPrefs';
import { THEMES, type Theme } from './theme';
import { LAYOUT_PREFS, type LayoutPref } from './layoutMode';

/** Workspace options as plain controls. Changing a control applies immediately and is remembered by the caller. */
type Tab = 'general' | 'layout' | 'sketching' | 'positioning' | 'navigation' | 'kernel';
const TAB_KEY = 'cad.settingsTab';
const loadTab = (): Tab => { try { const v = localStorage.getItem(TAB_KEY); return v === 'general' || v === 'sketching' || v === 'layout' || v === 'positioning' || v === 'navigation' || v === 'kernel' ? v : 'layout'; } catch { return 'layout'; } };
const saveTab = (tab: Tab) => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* private window */ } };

const languageName = (code: string, pseudo: string) => {
  if (code === pseudo) return 'Pseudo-locale (testing)';
  try { return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code; } catch { return code; }
};

export function SettingsDialog(p: {
  workspace: Workspace; onChange(patch: Partial<Workspace>): void;
  /** The screen layout: automatic (by window size and pointer), or forced to phone, tablet or desktop. */
  layoutPref?: LayoutPref; onLayoutPref?(v: LayoutPref): void; onPreset(name: WorkspacePreset): void; onResetLayout?(): void; onClose(): void;
  locale?: string; locales?: string[]; pseudo?: string; onLocale?(code: string): void;
  theme?: Theme; onTheme?(theme: Theme): void;
  sketchPrefs?: SketchPrefs; onSketchPrefs?(patch: Partial<SketchPrefs>): void;
  navPrefs?: NavPrefs; onNavPrefs?(patch: Partial<NavPrefs>): void;
  triPrefs?: TriPrefs; onTriPrefs?(patch: Partial<TriPrefs>): void;
  kernel?: { prefs: KernelPrefs; status: KernelStatus; onChange(patch: Partial<KernelPrefs>): void; onTest(v: { url: string; token: string }): Promise<TestOutcome>; onRetry(): void };
}) {
  const w = p.workspace;
  // a tab appears only when it has something to show; the last one used is remembered
  const tabs: Tab[] = [
    ...((p.locales && p.locales.length > 1 && p.onLocale) || p.onTheme ? (['general'] as Tab[]) : []),
    'layout',
    ...(p.sketchPrefs && p.onSketchPrefs ? (['sketching'] as Tab[]) : []),
    ...(p.navPrefs && p.onNavPrefs ? (['navigation'] as Tab[]) : []),
    ...(p.triPrefs && p.onTriPrefs ? (['positioning'] as Tab[]) : []),
    ...(p.kernel ? (['kernel'] as Tab[]) : []),
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
  const check = (key: 'leftTabs' | 'toolRail' | 'sketchPalette' | 'selectionBar' | 'drawerOpen' | 'handles') => (
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
          {p.onLayoutPref ? (
            <label class="set-row">
              <span>{t('settings.layoutMode')}</span>
              <select aria-label={t('settings.layoutMode')} value={p.layoutPref ?? 'auto'} onChange={(e) => p.onLayoutPref!((e.currentTarget as HTMLSelectElement).value as LayoutPref)}>
                {LAYOUT_PREFS.map((v) => <option key={v} value={v}>{t('settings.layoutMode.' + v)}</option>)}
              </select>
            </label>
          ) : null}
          {p.onResetLayout ? <div class="set-row"><span>{t('settings.resetLayout.hint')}</span><button class="rb-btn" onClick={p.onResetLayout}>{t('cmd.reset-layout')}</button></div> : null}
          {select('ribbon', ['off', 'compact', 'full'])}
          {select('leftPanel', ['docked', 'floating', 'hidden'])}
          {select('rightPanel', ['off', 'docked', 'floating'])}
          {select('toolLabels', ['icons-and-text', 'icons'])}
          {check('leftTabs')}
          {check('toolRail')}
          {check('sketchPalette')}
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
          {tab === 'navigation' && p.navPrefs && p.onNavPrefs ? (
          <div class="set-section" role="group" aria-label={t('settings.nav.title')}>
            <b class="set-head">{t('settings.nav.title')}</b>
            {([['upAxis', UP_AXES], ['orbitMode', ORBIT_MODES], ['orbitPivot', ORBIT_PIVOTS]] as const).map(([key, options]) => (
              <label class="set-row" key={key}><span>{t('settings.nav.' + key)}</span>
                <select aria-label={t('settings.nav.' + key)} value={p.navPrefs![key]} onChange={(e) => p.onNavPrefs!({ [key]: (e.currentTarget as HTMLSelectElement).value } as Partial<NavPrefs>)}>
                  {options.map((v) => <option key={v} value={v}>{t(`settings.nav.${key}.${v}`)}</option>)}
                </select>
              </label>
            ))}
            <div class="tb-note">{t('settings.nav.note')}</div>
          </div>
          ) : null}
          {tab === 'positioning' && p.triPrefs && p.onTriPrefs ? (
          <div class="set-section" role="group" aria-label={t('settings.triball.title')}>
            <b class="set-head">{t('settings.triball.title')}</b>
            <label class="set-row"><span>{t('settings.triball.distance')}</span>
              <input type="number" inputMode="decimal" enterKeyHint="done" min="0.001" step="any" aria-label={t('settings.triball.distance')} value={p.triPrefs.distance} onChange={(e) => { const n = Number((e.currentTarget as HTMLInputElement).value); if (n > 0) p.onTriPrefs!({ distance: n }); }} /></label>
            <label class="set-row"><span>{t('settings.triball.angle')}</span>
              <input type="number" inputMode="decimal" enterKeyHint="done" min="0.001" max="180" step="any" aria-label={t('settings.triball.angle')} value={p.triPrefs.angle} onChange={(e) => { const n = Number((e.currentTarget as HTMLInputElement).value); if (n > 0 && n <= 180) p.onTriPrefs!({ angle: n }); }} /></label>
            <div class="tb-note">{t('settings.triball.note')}</div>
          </div>
          ) : null}
          {tab === 'kernel' && p.kernel ? <KernelSection {...p.kernel} /> : null}
        </div>
      </div>
    </div>
  );
}

/** Kernel choice: built-in (wasm) or a local service, its address and token, a connection test and the current status. */
function KernelSection(k: NonNullable<Parameters<typeof SettingsDialog>[0]['kernel']>) {
  const [url, setUrl] = useState(k.prefs.url);
  const [token, setToken] = useState(k.prefs.token);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestOutcome | null>(null);
  const local = k.prefs.mode === 'local';
  const test = async () => {
    setBusy(true); setResult(null);
    try { setResult(await k.onTest({ url, token })); } finally { setBusy(false); }
  };
  const tone = k.status.state === 'connected' ? 'ok' : k.status.state === 'failed' ? 'err' : k.status.state === 'connecting' ? 'warn' : 'ok';
  return (
    <div class="set-section" role="group" aria-label={t('settings.kernel.title')}>
      <b class="set-head">{t('settings.kernel.title')}</b>
      <label class="set-row"><span>{t('settings.kernel.mode')}</span>
        <select aria-label={t('settings.kernel.mode')} value={k.prefs.mode} onChange={(e) => k.onChange({ mode: (e.currentTarget as HTMLSelectElement).value === 'local' ? 'local' : 'builtin' })}>
          <option value="builtin">{t('settings.kernel.mode.builtin')}</option>
          <option value="local">{t('settings.kernel.mode.local')}</option>
        </select></label>
      {local ? (<>
        <label class="set-row"><span>{t('settings.kernel.url')}</span>
          <input type="text" spellcheck={false} autocomplete="off" aria-label={t('settings.kernel.url')} value={url}
            onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)} onChange={() => k.onChange({ url })} /></label>
        <label class="set-row"><span>{t('settings.kernel.token')}</span>
          <input type="password" spellcheck={false} autocomplete="off" aria-label={t('settings.kernel.token')} value={token}
            onInput={(e) => setToken((e.currentTarget as HTMLInputElement).value)} onChange={() => k.onChange({ token })} /></label>
        <div class="tb-note">{t('settings.kernel.token.hint')}</div>
        <div class="set-row">
          <button class="rb-btn" disabled={busy} onClick={() => void test()}>{busy ? t('settings.kernel.testing') : t('settings.kernel.test')}</button>
          {k.status.state === 'failed' ? <button class="rb-btn" onClick={k.onRetry}>{t('settings.kernel.retry')}</button> : null}
        </div>
        {result ? <div class="tb-note" role="status" data-tone={result.ok ? 'ok' : 'err'}>
          {result.ok ? t('settings.kernel.test.ok', { version: result.version.kernel || '?', protocol: result.version.protocol, cores: result.version.cores })
            : t('settings.kernel.test.failed', { reason: failText(result.kind, result.detail) })}</div> : null}
      </>) : null}
      <div class="set-row" role="status"><span class={'st-item'}><b class={tone}>{'\u25CF'}</b> {statusText(k.status)}</span></div>
      <div class="tb-note">{t('settings.kernel.note')}</div>
    </div>
  );
}

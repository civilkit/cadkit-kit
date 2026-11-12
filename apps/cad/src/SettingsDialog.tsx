import { useEffect, useState } from 'preact/hooks';
import { MASS_DIGITS, MASS_UNITS, type MassPrefs } from './massPrefs';
import { statusText, failText, type KernelPrefs, type KernelStatus, type TestOutcome } from './kernelService';
import { matchPreset, type Workspace, type WorkspacePreset } from '@kit/store';
import { t } from './i18n';
import { SketchPrefsSection } from './SketchPrefsSection';
import type { SketchPrefs } from './sketchPrefs';
import { ZOOM_SPEEDS, type NavPrefs } from './navPrefs';
import { KNURL_EXPORT_MODES, type ExportPrefs } from './exportPrefs';
import { UP_AXES, ORBIT_MODES, ORBIT_PIVOTS } from '@kit/viewport';
import type { TriPrefs } from './triball/triballPrefs';
import { THEMES, type Theme } from './theme';
import { ICON_SETS, type IconSet } from '@kit/ui';
import { LAYOUT_PREFS, type LayoutPref } from './layoutMode';
import type { LinkState } from '@kit/agent-link';

/** Workspace options as plain controls. Changing a control applies immediately and is remembered by the caller. */
type Tab = 'general' | 'layout' | 'sketching' | 'positioning' | 'navigation' | 'kernel' | 'agent';
const TAB_KEY = 'cad.settingsTab';
const loadTab = (): Tab => { try { const v = localStorage.getItem(TAB_KEY); return v === 'general' || v === 'sketching' || v === 'layout' || v === 'positioning' || v === 'navigation' || v === 'kernel' || v === 'agent' ? v : 'layout'; } catch { return 'layout'; } };
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
  /** The icon set (a preview of SolidCraft's icons beside our own). */
  iconSet?: IconSet; onIconSet?(set: IconSet): void;
  sketchPrefs?: SketchPrefs; onSketchPrefs?(patch: Partial<SketchPrefs>): void;
  navPrefs?: NavPrefs; onNavPrefs?(patch: Partial<NavPrefs>): void;
  /** how a mass is shown (unit and digits) */
  massPrefs?: MassPrefs; onMassPrefs?(patch: Partial<MassPrefs>): void;
  exportPrefs?: ExportPrefs; onExportPrefs?(patch: Partial<ExportPrefs>): void;
  triPrefs?: TriPrefs; onTriPrefs?(patch: Partial<TriPrefs>): void;
  /** The agent link: let a local MCP agent see (and, if allowed, change) the open document. */
  agent?: AgentLinkProps;
  /** The online libraries (textures): off by default; what is downloaded is kept in the browser. */
  online?: { enabled: boolean; cacheBytes: number; onEnabled(v: boolean): void; onClear(): void };
  kernel?: { prefs: KernelPrefs; status: KernelStatus; onChange(patch: Partial<KernelPrefs>): void; onTest(v: { url: string; token: string }): Promise<TestOutcome>; onRetry(): void };
}) {
  const w = p.workspace;
  // a tab appears only when it has something to show; the last one used is remembered
  const tabs: Tab[] = [
    ...((p.locales && p.locales.length > 1 && p.onLocale) || p.onTheme || p.onIconSet || (p.exportPrefs && p.onExportPrefs) || p.online || (p.massPrefs && p.onMassPrefs) ? (['general'] as Tab[]) : []),
    'layout',
    ...(p.sketchPrefs && p.onSketchPrefs ? (['sketching'] as Tab[]) : []),
    ...(p.navPrefs && p.onNavPrefs ? (['navigation'] as Tab[]) : []),
    ...(p.triPrefs && p.onTriPrefs ? (['positioning'] as Tab[]) : []),
    ...(p.kernel ? (['kernel'] as Tab[]) : []),
    ...(p.agent ? (['agent'] as Tab[]) : []),
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
          {p.online ? (
            <div class="set-section" role="group" aria-label={t('settings.online.title')} data-testid="online-section">
              <b class="set-head">{t('settings.online.title')}</b>
              <label class="set-row"><span>{t('settings.online.use')}</span>
                <input type="checkbox" checked={p.online.enabled} aria-label={t('settings.online.use')} onChange={(e) => p.online!.onEnabled((e.currentTarget as HTMLInputElement).checked)} /></label>
              <div class="tb-note">{t('settings.online.note')}</div>
              <div class="set-row"><span>{t('settings.online.cache', { size: p.online.cacheBytes < 1048576 ? `${Math.round(p.online.cacheBytes / 1024)} KB` : `${(p.online.cacheBytes / 1048576).toFixed(1)} MB` })}</span>
                <button class="rb-btn" data-testid="online-clear" disabled={p.online.cacheBytes === 0} onClick={p.online.onClear}>{t('settings.online.clear')}</button></div>
            </div>
          ) : null}
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
          {p.onIconSet ? (
            <label class="set-row"><span>{t('settings.iconSet')}</span>
              <select aria-label={t('settings.iconSet')} value={p.iconSet ?? 'default'} onChange={(e) => p.onIconSet!((e.currentTarget as HTMLSelectElement).value as IconSet)}>
                {ICON_SETS.map((v) => <option key={v} value={v}>{t('settings.iconSet.' + v)}</option>)}
              </select>
            </label>
          ) : null}
          {p.massPrefs && p.onMassPrefs ? (
          <div class="set-section" role="group" aria-label={t('settings.mass.title')} data-testid="mass-section">
            <b class="set-head">{t('settings.mass.title')}</b>
            <label class="set-row"><span>{t('settings.mass.unit')}</span>
              <select aria-label={t('settings.mass.unit')} value={p.massPrefs.unit} onChange={(e) => p.onMassPrefs!({ unit: (e.currentTarget as HTMLSelectElement).value as MassPrefs['unit'] })}>
                {MASS_UNITS.map((v) => <option key={v} value={v}>{t('settings.mass.unit.' + v)}</option>)}
              </select>
            </label>
            <label class="set-row"><span>{t('settings.mass.digits')}</span>
              <select aria-label={t('settings.mass.digits')} value={String(p.massPrefs.digits)} onChange={(e) => p.onMassPrefs!({ digits: Number((e.currentTarget as HTMLSelectElement).value) })}>
                {MASS_DIGITS.map((v) => <option key={v} value={String(v)}>{String(v)}</option>)}
              </select>
            </label>
            <div class="tb-note">{t('settings.mass.note')}</div>
          </div>
          ) : null}
          {p.exportPrefs && p.onExportPrefs ? (
          <div class="set-section" role="group" aria-label={t('settings.export.title')}>
            <b class="set-head">{t('settings.export.title')}</b>
            <label class="set-row"><span>{t('settings.export.knurl')}</span>
              <select aria-label={t('settings.export.knurl')} value={p.exportPrefs.knurl} onChange={(e) => p.onExportPrefs!({ knurl: (e.currentTarget as HTMLSelectElement).value as ExportPrefs['knurl'] })}>
                {KNURL_EXPORT_MODES.map((v) => <option key={v} value={v}>{t('settings.export.knurl.' + v)}</option>)}
              </select>
            </label>
            <div class="tb-note">{t('settings.export.note')}</div>
          </div>
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
            <label class="set-row"><span>{t('settings.nav.zoomSpeed')}</span>
              <select aria-label={t('settings.nav.zoomSpeed')} value={String(p.navPrefs.zoomSpeed)} onChange={(e) => p.onNavPrefs!({ zoomSpeed: Number((e.currentTarget as HTMLSelectElement).value) })}>
                {ZOOM_SPEEDS.map((v) => <option key={v} value={String(v)}>{v === 1 ? t('settings.nav.zoomSpeed.normal') : `${v}x`}</option>)}
              </select>
            </label>
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
          {tab === 'agent' && p.agent ? <AgentSection {...p.agent} /> : null}
        </div>
        <AboutLine />
      </div>
    </div>
  );
}

export interface AgentLinkProps { state: LinkState; allowEdit: boolean; onConnect(code: string): Promise<void>; onDisconnect(): Promise<void>; onAllowEdit(v: boolean): void }

/** The agent link: off until the user pastes a pairing code; a second box decides whether the agent may change the document. */
function AgentSection(a: AgentLinkProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const on = a.state.state === 'connected';
  const link = async () => { setBusy(true); try { await a.onConnect(code); setCode(''); } catch { /* the state shows why */ } finally { setBusy(false); } };
  return (
    <div class="set-section" role="group" aria-label={t('settings.agent.title')} data-testid="agent-section">
      <b class="set-head">{t('settings.agent.title')}</b>
      <div class="tb-note">{t('settings.agent.note')}</div>
      {on ? (<>
        <div class="set-row" role="status"><span class="st-item"><b class="ok">{'\u25CF'}</b> {t('settings.agent.linked', { count: (a.state as { calls: number }).calls })}</span></div>
        <label class="set-row"><span>{t('settings.agent.edit')}</span>
          <input type="checkbox" checked={a.allowEdit} aria-label={t('settings.agent.edit')} onChange={(e) => a.onAllowEdit((e.currentTarget as HTMLInputElement).checked)} /></label>
        <div class="tb-note">{t(a.allowEdit ? 'settings.agent.edit.on' : 'settings.agent.edit.off')}</div>
        <div class="set-row"><button class="rb-btn" data-testid="agent-off" onClick={() => void a.onDisconnect()}>{t('settings.agent.off')}</button></div>
      </>) : (<>
        <label class="set-row"><span>{t('settings.agent.code')}</span>
          <input type="text" spellcheck={false} autocomplete="off" placeholder="52311-ABCD-EFGH-JKMN-PQRS" aria-label={t('settings.agent.code')} value={code}
            onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) void link(); }} /></label>
        <div class="set-row"><button class="rb-btn" data-testid="agent-on" disabled={busy || !code.trim()} onClick={() => void link()}>{busy ? t('settings.agent.linking') : t('settings.agent.on')}</button></div>
        {a.state.state === 'error' ? <div class="tb-note" role="alert" data-tone="err">{t('settings.agent.failed', { reason: a.state.message })}</div> : null}
        <div class="tb-note">{t('settings.agent.how')}</div>
      </>)}
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

/** The product version, the kit commit and the kernel build this app was built from (version.json next to the page; absent in a dev build). */
function AboutLine() {
  const [v, setV] = useState<{ version?: string; kit?: string; kernel?: string } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(new URL('version.json', document.baseURI), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j && typeof j === 'object') setV(j); }).catch(() => { /* a dev build has none */ });
    return () => { live = false; };
  }, []);
  if (!v?.version) return null;
  return <div class="tb-note set-version" role="note">{t('settings.about', { version: v.version, kit: v.kit ?? '?', kernel: v.kernel || '?' })} · <a href="https://civilkit.io/cad/whats-new/" target="_blank" rel="noopener">{t('settings.about.news')}</a></div>;
}

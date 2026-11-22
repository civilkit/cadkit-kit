// Installing, switching and removing plugins (the manager part of the Plugins panel). Third-party plugins stay off until the user turns the
// setting on; an install is two steps: look at the package (plan: nothing is changed), then confirm. Everything shown comes from the plan.
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { fetchGithubPackage, fetchZipUrl, filesFromZip, parseGithubSpec, type Plan, type PluginManager } from '@kit/plugin';
import { t } from './i18n';
import { setThirdPartyEnabled, thirdPartyEnabled } from './pluginStore';

export interface PluginManageProps { manager: PluginManager; onChanged(): void; onOpenHub?(): void }

export function PluginManage(p: PluginManageProps): JSX.Element {
  const [on, setOn] = useState(thirdPartyEnabled());
  const [plan, setPlan] = useState<{ plan: Plan; source: { kind: 'zip' | 'github'; name: string }; fetchWarnings: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [spec, setSpec] = useState('');
  const [, bump] = useState(0);
  const refresh = (): void => { bump((n) => n + 1); p.onChanged(); };
  useEffect(() => { void p.manager.load().then(refresh); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const look = async (get: () => Promise<{ files: Map<string, Uint8Array>; warnings?: string[] } | { error: string }>, source: { kind: 'zip' | 'github'; name: string }): Promise<void> => {
    setBusy(true); setMsg(null); setPlan(null);
    try {
      const r = await get();
      if ('error' in r) { setMsg(r.error); return; }
      setPlan({ plan: await p.manager.plan(r.files), source, fetchWarnings: r.warnings ?? [] });
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const onFile = (e: Event): void => {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!f) return;
    void look(async () => filesFromZip(new Uint8Array(await f.arrayBuffer())).then((z) => ('error' in z ? z : { files: z })), { kind: 'zip', name: f.name });
  };
  /** One box for both: `github:owner/repo@tag` or a direct https link to a .zip */
  const onGithub = (): void => {
    const v = spec.trim();
    if (/^https?:/i.test(v)) {
      void look(() => fetchZipUrl(v, (u) => fetch(u), filesFromZip), { kind: 'zip', name: v });
      return;
    }
    const s = parseGithubSpec(v);
    if (typeof s === 'string') { setMsg(s); return; }
    void look(async () => {
      const r = await fetchGithubPackage(s, (u) => fetch(u));
      return 'error' in r ? r : { files: r.files, warnings: r.warnings };
    }, { kind: 'github', name: v });
  };
  const confirm = async (): Promise<void> => {
    if (!plan) return;
    setBusy(true);
    try { await p.manager.install(plan.plan, plan.source); setPlan(null); setMsg(null); refresh(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  const i = plan?.plan.inspection;
  const installable = !!plan && !plan.plan.refusal && !!i?.ok;
  return (
    <div data-testid="plugin-manage" style="margin-top:14px;border-top:1px solid var(--border,#8884);padding-top:10px">
      <div class="fedit-fld-label" style="font-weight:600;margin-bottom:6px">{t('plugin.installed')}</div>
      {p.onOpenHub ? (
        <div style="margin-bottom:8px">
          <button type="button" class="fedit-card-btn" data-testid="plugin-open-hub" onClick={p.onOpenHub}>{t('hub.browseBtn')}</button>
        </div>
      ) : null}
      <label class="fedit-fld" style="display:flex;gap:8px;align-items:flex-start">
        <input type="checkbox" checked={on} data-testid="plugin-thirdparty" onChange={(e) => { const v = (e.currentTarget as HTMLInputElement).checked; setThirdPartyEnabled(v); setOn(v); void p.manager.load().then(refresh); }} />
        <span>{t('plugin.thirdParty')}<span class="thread-hint" style="display:block">{t('plugin.thirdPartyTip')}</span></span>
      </label>
      {on ? (
        <div>
          {p.manager.list().length === 0 ? <div class="thread-hint" data-testid="plugin-none-installed">{t('plugin.noneInstalled')}</div> : null}
          {p.manager.list().map((x) => (
            <div key={x.id} data-testid={`plugin-row-${x.id}`} style="display:flex;gap:8px;align-items:center;margin:6px 0">
              <input type="checkbox" checked={x.enabled && !x.blocked} disabled={!!x.blocked} aria-label={t('plugin.enable')} data-testid={`plugin-enable-${x.id}`} onChange={(e) => { void p.manager.setEnabled(x.id, (e.currentTarget as HTMLInputElement).checked).then(refresh); }} />
              <span style="flex:1"><strong>{x.manifest.name}</strong> {x.version}{x.blocked ? <span class="thread-hint" style="display:block">{x.blocked}</span> : null}</span>
              <button type="button" class="fedit-card-btn" data-testid={`plugin-remove-${x.id}`} onClick={() => { void p.manager.remove(x.id).then(refresh); }}>{t('plugin.remove')}</button>
            </div>
          ))}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            <label class="fedit-card-btn" style="cursor:pointer">{t('plugin.installFile')}<input type="file" accept=".zip" style="display:none" data-testid="plugin-file" onChange={onFile} /></label>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <input type="text" value={spec} placeholder={t('plugin.fromPlaceholder')} aria-label={t('plugin.installGithub')} data-testid="plugin-github" style="flex:1" onInput={(e) => setSpec((e.currentTarget as HTMLInputElement).value)} />
            <button type="button" class="fedit-card-btn" disabled={!spec.trim() || busy} data-testid="plugin-github-go" onClick={onGithub}>{t('plugin.installGithub')}</button>
          </div>
          {busy ? <div class="thread-hint">{t('plugin.checking')}</div> : null}
          {msg ? <div class="fedit-hint" role="alert" data-testid="plugin-manage-msg">{msg}</div> : null}
          {plan && i ? (
            <div data-testid="plugin-confirm" style="margin-top:10px;padding:8px;border:1px solid var(--border,#8886);border-radius:6px">
              {i.manifest ? (
                <div>
                  <strong>{i.manifest.name}</strong> {i.manifest.version}
                  <div class="thread-hint">{i.manifest.id}{i.manifest.license ? ` · ${i.manifest.license}` : ''}{i.manifest.author ? ` · ${i.manifest.author}` : ''}</div>
                  <div class="thread-hint">{t('plugin.adds')}: {i.manifest.contributes.generators.map((g) => g.title).join(', ')}</div>
                  {i.hash ? <div class="thread-hint" data-testid="plugin-hash">{t('plugin.pin')}: {i.hash.slice(0, 16)}…</div> : null}
                </div>
              ) : null}
              {plan.plan.change ? <div class="thread-hint" data-testid="plugin-change">{t('plugin.update', { from: plan.plan.change.from, to: plan.plan.change.to })}{plan.plan.change.sameHash ? ` (${t('plugin.identical')})` : ''}</div> : null}
              {plan.plan.refusal ? <div class="fedit-hint" role="alert">{plan.plan.refusal}</div> : null}
              {i.errors.map((e) => <div key={e} class="fedit-hint" role="alert">{e}</div>)}
              {[...plan.fetchWarnings, ...i.warnings].map((w) => <div key={w} class="thread-hint" data-testid="plugin-warning">⚠ {w}</div>)}
              <div style="display:flex;gap:6px;margin-top:8px">
                <button type="button" class="fedit-card-btn prop-create" disabled={!installable || busy} data-testid="plugin-install" onClick={() => { void confirm(); }}>{t('plugin.install')}</button>
                <button type="button" class="fedit-card-btn" data-testid="plugin-install-cancel" onClick={() => setPlan(null)}>{t('ui.cancel', undefined, 'Cancel')}</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

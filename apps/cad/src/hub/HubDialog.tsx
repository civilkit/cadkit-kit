// Community Package Hub dialog: searchable, filterable catalog of community parts, assemblies,
// libraries, and parametric plugin generators, wired to CadKit's existing library adder and
// plugin installer (respecting the "Allow plugins from other people" safety gate and SHA-256 pins).
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { viaRelay } from './relay';
import { fetchGithubPackage, fetchZipUrl, filesFromZip, parseGithubSpec, type Plan, type PluginManager } from '@kit/plugin';
import { textAttrs } from '@kit/ui';
import { t } from '../i18n';
import { errText } from '../library/AddLibrary';
import type { LibraryRecord, LibraryRegistry, Preview } from '../library/registry';
import { setThirdPartyEnabled, thirdPartyEnabled } from '../pluginStore';
import {
  BUILTIN_HUB_INDEX,
  BUILTIN_REGISTRY_ID,
  HUB_PACKAGE_KINDS,
  HubRegistryStore,
  filterHubPackages,
  hubCategories,
  hubSourceLink,
  type HubIndex,
  type HubPackage,
  type HubPackageKind,
  type HubSort,
} from './registry';
import './hub.css';

export interface HubDialogProps {
  store: HubRegistryStore;
  libraryRegistry?: LibraryRegistry;
  pluginManager?: PluginManager;
  /** Called after a plugin is installed so the app refreshes its menus and panels. */
  onPluginInstalled?(): void;
  /** Called after a library is added from the Hub. */
  onLibraryAdded?(record: LibraryRecord): void;
  /** Injectable fetch for plugin package downloads (defaults to globalThis.fetch). */
  fetch?: (url: string) => Promise<Response>;
  /** When true, marks the built-in catalog as preview-only (no install buttons). Defaults to false since the
   *  built-in SolidCraft Community Plugins catalog lists real released plugins. */
  builtinIsPreview?: boolean;
  onClose(): void;
}

function kindLabel(kind: HubPackageKind | 'all'): string {
  switch (kind) {
    case 'part': return t('hub.kind.part');
    case 'assembly': return t('hub.kind.assembly');
    case 'plugin': return t('hub.kind.plugin');
    case 'library': return t('hub.kind.library');
    default: return t('hub.kind.all');
  }
}

interface PendingPlugin {
  pkg: HubPackage;
  plan: Plan;
  source: { kind: 'zip' | 'github'; name: string };
  fetchWarnings: string[];
}

interface PendingLibrary {
  pkg: HubPackage;
  preview: Preview;
}

export function HubDialog(p: HubDialogProps): JSX.Element {
  const [regId, setRegId] = useState(() => p.store.activeRegistryId());
  const [index, setIndex] = useState<HubIndex>(() => (regId === BUILTIN_REGISTRY_ID ? BUILTIN_HUB_INDEX : BUILTIN_HUB_INDEX));
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [offlineReason, setOfflineReason] = useState('');
  const [loadErr, setLoadErr] = useState('');

  const [addingReg, setAddingReg] = useState(false);
  const [regUrl, setRegUrl] = useState('');
  const [regBusy, setRegBusy] = useState(false);
  const [regErr, setRegErr] = useState('');

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<HubPackageKind | 'all'>('all');
  const [category, setCategory] = useState('all');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<HubSort>('name');
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const [thirdParty, setThirdParty] = useState(() => thirdPartyEnabled());
  const [gatePrompt, setGatePrompt] = useState(false);
  const [gatePkg, setGatePkg] = useState<HubPackage | null>(null);
  const [manualZipPkg, setManualZipPkg] = useState<HubPackage | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState('');
  const [actionOk, setActionOk] = useState('');
  const [pendingPlugin, setPendingPlugin] = useState<PendingPlugin | null>(null);
  const [pendingLib, setPendingLib] = useState<PendingLibrary | null>(null);
  const [, bump] = useState(0);

  const doFetch = p.fetch ?? ((u: string) => globalThis.fetch(u));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [p.onClose]);

  useEffect(() => p.store.subscribe(() => bump((n) => n + 1)), [p.store]);
  useEffect(() => (p.libraryRegistry ? p.libraryRegistry.subscribe(() => bump((n) => n + 1)) : undefined), [p.libraryRegistry]);

  const loadRegistry = async (id: string, refresh = false): Promise<void> => {
    setLoading(true);
    setLoadErr('');
    setOffline(false);
    setOfflineReason('');
    try {
      const res = await p.store.load(id, { refresh });
      setIndex(res.index);
      setOffline(res.offline);
      setOfflineReason(res.error ?? '');
    } catch (e) {
      setLoadErr((e as Error).message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRegistry(regId, false);
  }, [regId]);

  const registries = p.store.listRegistries();
  const categories = useMemo(() => hubCategories(index.packages), [index]);
  const filtered = useMemo(
    () => filterHubPackages(index.packages, { query, kind, category, tag, verifiedOnly, sort }),
    [index, query, kind, category, tag, verifiedOnly, sort],
  );

  const installedPluginIds = new Set((p.pluginManager?.list() ?? []).map((x) => x.id));
  const isLibraryAdded = (pkg: HubPackage): boolean => !!p.libraryRegistry?.get(pkg.source);

  const onSwitchRegistry = (id: string): void => {
    p.store.setActiveRegistry(id);
    setRegId(id);
    setCategory('all');
    setTag(null);
  };

  const onAddRegistry = async (): Promise<void> => {
    if (!regUrl.trim()) return;
    setRegBusy(true);
    setRegErr('');
    try {
      const res = await p.store.addRegistry(regUrl.trim());
      setRegUrl('');
      setAddingReg(false);
      setRegId(res.registryId);
      setIndex(res.index);
      setOffline(res.offline);
      setOfflineReason(res.error ?? '');
      setLoadErr('');
    } catch (e) {
      setRegErr((e as Error).message || String(e));
    } finally {
      setRegBusy(false);
    }
  };

  const onRemoveRegistry = (): void => {
    if (regId === BUILTIN_REGISTRY_ID) return;
    p.store.removeRegistry(regId);
    setRegId(BUILTIN_REGISTRY_ID);
  };

  const toggleThirdParty = (checked: boolean): void => {
    setThirdPartyEnabled(checked);
    setThirdParty(checked);
    if (checked) {
      setGatePrompt(false);
      const resume = gatePkg;
      setGatePkg(null);
      if (resume) void startPluginInstall(resume, true);
    }
    if (p.pluginManager) {
      void p.pluginManager.load().then(() => {
        bump((n) => n + 1);
        p.onPluginInstalled?.();
      });
    }
  };

  const installFromPickedZip = async (pkg: HubPackage, file: File): Promise<void> => {
    if (!p.pluginManager) return;
    setActionErr('');
    setActionOk('');
    setBusyId(pkg.id);
    try {
      const unzipped = await filesFromZip(new Uint8Array(await file.arrayBuffer()));
      if ('error' in unzipped) {
        setActionErr(unzipped.error);
        return;
      }
      const plan = await p.pluginManager.plan(unzipped);
      if (pkg.sha256 && plan.inspection.hash && plan.inspection.hash.toLowerCase() !== pkg.sha256.toLowerCase()) {
        setActionErr(t('hub.plugin.shaMismatch', { expected: pkg.sha256.slice(0, 12), actual: plan.inspection.hash.slice(0, 12) }));
        return;
      }
      setManualZipPkg(null);
      setPendingPlugin({ pkg, plan, source: { kind: 'zip', name: file.name }, fetchWarnings: [] });
    } catch (e) {
      setActionErr((e as Error).message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const startPluginInstall = async (pkg: HubPackage, allowOverride = false): Promise<void> => {
    setActionErr('');
    setActionOk('');
    setPendingLib(null);
    setPendingPlugin(null);
    setManualZipPkg(null);
    if (!p.pluginManager) return;
    if (!thirdParty && !allowOverride) {
      setGatePkg(pkg);
      setGatePrompt(true);
      return;
    }
    setBusyId(pkg.id);
    try {
      let fetched: { files: Map<string, Uint8Array>; warnings?: string[] } | { error: string };
      let source: { kind: 'zip' | 'github'; name: string };
      if (/^https?:/i.test(pkg.source)) {
        source = { kind: 'zip', name: pkg.source };
        fetched = await fetchZipUrl(pkg.source, doFetch, filesFromZip);
      } else if (pkg.downloadUrl) {
        // a plugin with a release zip: read it through the relay (GitHub's release downloads cannot be read from a page); the raw-file route never worked for these
        source = { kind: 'zip', name: pkg.downloadUrl };
        fetched = await fetchZipUrl(pkg.downloadUrl, (u) => doFetch(viaRelay(u)), filesFromZip);
      } else {
        const spec = parseGithubSpec(pkg.source);
        if (typeof spec === 'string') {
          setActionErr(spec);
          return;
        }
        source = { kind: 'github', name: pkg.source };
        const r = await fetchGithubPackage(spec, doFetch);
        fetched = 'error' in r ? r : { files: r.files, warnings: r.warnings };
      }
      if ('error' in fetched) {
        // too big to install is said as it is; any other failure to read the zip offers the manual download
        if (pkg.downloadUrl && !fetched.error.startsWith('This plugin is bigger')) {
          setManualZipPkg(pkg);
        } else {
          setActionErr(fetched.error);
        }
        return;
      }
      const plan = await p.pluginManager.plan(fetched.files);
      if (pkg.sha256 && plan.inspection.hash && plan.inspection.hash.toLowerCase() !== pkg.sha256.toLowerCase()) {
        setActionErr(t('hub.plugin.shaMismatch', { expected: pkg.sha256.slice(0, 12), actual: plan.inspection.hash.slice(0, 12) }));
        return;
      }
      setPendingPlugin({ pkg, plan, source, fetchWarnings: fetched.warnings ?? [] });
    } catch (e) {
      if (pkg.downloadUrl) setManualZipPkg(pkg);
      else setActionErr((e as Error).message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const confirmPluginInstall = async (): Promise<void> => {
    if (!pendingPlugin || !p.pluginManager) return;
    setBusyId(pendingPlugin.pkg.id);
    setActionErr('');
    try {
      await p.pluginManager.install(pendingPlugin.plan, pendingPlugin.source);
      setActionOk(t('hub.installedOk', { name: pendingPlugin.pkg.name }));
      setPendingPlugin(null);
      bump((n) => n + 1);
      p.onPluginInstalled?.();
    } catch (e) {
      setActionErr((e as Error).message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const startLibraryAdd = async (pkg: HubPackage): Promise<void> => {
    setActionErr('');
    setActionOk('');
    setPendingPlugin(null);
    setPendingLib(null);
    if (!p.libraryRegistry) return;
    setBusyId(pkg.id);
    try {
      const preview = await p.libraryRegistry.preview(pkg.source);
      if (preview.needsConfirm) {
        setPendingLib({ pkg, preview });
        return;
      }
      const rec = await p.libraryRegistry.add(preview);
      setActionOk(t('hub.libraryAddedOk', { name: rec.name }));
      bump((n) => n + 1);
      p.onLibraryAdded?.(rec);
    } catch (e) {
      setActionErr(errText(e));
    } finally {
      setBusyId(null);
    }
  };

  const confirmLibraryAdd = async (): Promise<void> => {
    if (!pendingLib || !p.libraryRegistry) return;
    setBusyId(pendingLib.pkg.id);
    setActionErr('');
    try {
      const rec = await p.libraryRegistry.add(pendingLib.preview, { confirm: true });
      setActionOk(t('hub.libraryAddedOk', { name: rec.name }));
      setPendingLib(null);
      bump((n) => n + 1);
      p.onLibraryAdded?.(rec);
    } catch (e) {
      setActionErr(errText(e));
    } finally {
      setBusyId(null);
    }
  };

  const previewOnly = regId === BUILTIN_REGISTRY_ID && p.builtinIsPreview === true;
  const pluginInstallable = !!pendingPlugin && !pendingPlugin.plan.refusal && !!pendingPlugin.plan.inspection.ok;

  return (
    <div class="dlg-back" data-testid="hub-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dlg hub-dlg" role="dialog" aria-label={t('hub.title')} data-testid="hub-dialog">
        <div class="dlg-head">
          <b>{t('hub.title')}</b>
          <button type="button" class="rb-btn" data-testid="hub-add-registry-toggle" aria-expanded={addingReg} onClick={() => { setAddingReg(!addingReg); setRegErr(''); }}>
            {t('hub.registry.add')}
          </button>
          <button type="button" class="rb-btn" data-testid="hub-close" onClick={p.onClose}>{t('ui.close')}</button>
        </div>

        <div class="hub-reg-bar">
          <label>
            {t('hub.registry.label')}{' '}
            <select aria-label={t('hub.registry.label')} data-testid="hub-registry-select" value={regId} onChange={(e) => onSwitchRegistry((e.currentTarget as HTMLSelectElement).value)}>
              {registries.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <button type="button" class="rb-btn" disabled={loading} data-testid="hub-registry-refresh" onClick={() => void loadRegistry(regId, true)}>{t('hub.registry.refresh')}</button>
          {regId !== BUILTIN_REGISTRY_ID ? (
            <button type="button" class="rb-btn" disabled={loading} data-testid="hub-registry-remove" onClick={onRemoveRegistry}>{t('hub.registry.remove')}</button>
          ) : null}
          <span class="hub-count" style="margin-left:auto" data-testid="hub-count">
            {t('hub.count', { shown: filtered.length, total: index.packages.length })}
          </span>
        </div>

        {addingReg ? (
          <div class="hub-reg-add" data-testid="hub-registry-add-form">
            <input
              {...textAttrs}
              type="url"
              value={regUrl}
              placeholder={t('hub.registry.urlPlaceholder')}
              aria-label={t('hub.registry.urlLabel')}
              data-testid="hub-registry-url"
              onInput={(e) => setRegUrl((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && regUrl.trim() && !regBusy) void onAddRegistry(); }}
            />
            <button type="button" class="rb-btn" disabled={!regUrl.trim() || regBusy} data-testid="hub-registry-submit" onClick={() => void onAddRegistry()}>
              {regBusy ? t('hub.registry.adding') : t('hub.registry.addSubmit')}
            </button>
            {regErr ? <div class="hub-banner err" role="alert" style="flex:0 0 100%" data-testid="hub-registry-err">{regErr}</div> : null}
          </div>
        ) : null}

        <div class="hub-controls">
          <div class="hub-search-row">
            <input
              {...textAttrs}
              type="search"
              value={query}
              placeholder={t('hub.search.placeholder')}
              aria-label={t('hub.search.label')}
              data-testid="hub-search"
              onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            />
            <select aria-label={t('hub.category.label')} data-testid="hub-category" value={category} onChange={(e) => setCategory((e.currentTarget as HTMLSelectElement).value)}>
              <option value="all">{t('hub.category.all')}</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select aria-label={t('hub.sort.label')} data-testid="hub-sort" value={sort} onChange={(e) => setSort((e.currentTarget as HTMLSelectElement).value as HubSort)}>
              <option value="name">{t('hub.sort.name')}</option>
              <option value="kind">{t('hub.sort.kind')}</option>
              <option value="updated">{t('hub.sort.updated')}</option>
              <option value="author">{t('hub.sort.author')}</option>
            </select>
          </div>
          <div class="hub-filter-row">
            <div class="hub-pills" role="group" aria-label={t('hub.title')}>
              {(['all', ...HUB_PACKAGE_KINDS] as const).map((k) => (
                <button key={k} type="button" class="hub-pill" aria-pressed={kind === k} data-testid={`hub-kind-${k}`} onClick={() => setKind(k)}>
                  {kindLabel(k)}
                </button>
              ))}
            </div>
            {tag ? (
              <button type="button" class="hub-pill" aria-pressed="true" data-testid="hub-tag-clear" onClick={() => setTag(null)}>
                {t('hub.tagClear', { tag })}
              </button>
            ) : null}
            <label class="hub-verified-toggle">
              <input type="checkbox" checked={verifiedOnly} data-testid="hub-verified-only" onChange={(e) => setVerifiedOnly((e.currentTarget as HTMLInputElement).checked)} />
              <span>{t('hub.verifiedOnly')}</span>
            </label>
          </div>
        </div>

        {(loading || offline || loadErr || actionErr || actionOk || (gatePrompt && !thirdParty) || manualZipPkg || pendingPlugin || pendingLib) ? (
          <div class="hub-status" data-testid="hub-status">
            {loading ? <div class="hub-banner" role="status" data-testid="hub-loading">{t('hub.loading')}</div> : null}
            {offline ? (
              <div class="hub-banner warn" role="status" data-testid="hub-offline-banner">
                {t('hub.offlineBanner', { reason: offlineReason })}
              </div>
            ) : null}
            {loadErr ? <div class="hub-banner err" role="alert" data-testid="hub-load-err">{loadErr}</div> : null}
            {actionErr ? <div class="hub-banner err" role="alert" data-testid="hub-action-err">{actionErr}</div> : null}
            {actionOk ? <div class="hub-banner ok" role="status" data-testid="hub-action-ok">{actionOk}</div> : null}

            {gatePrompt && !thirdParty ? (
              <div class="hub-banner warn" role="alert" data-testid="hub-plugin-gate">
                <span>{t('hub.plugin.gateNotice')}</span>
                <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
                  <input type="checkbox" checked={thirdParty} data-testid="hub-plugin-gate-toggle" onChange={(e) => toggleThirdParty((e.currentTarget as HTMLInputElement).checked)} />
                  <span>{t('hub.plugin.enableGate')}</span>
                </label>
              </div>
            ) : null}

            {manualZipPkg && manualZipPkg.downloadUrl ? (
              <div class="hub-banner warn" role="alert" data-testid="hub-manual-zip">
                <span>{t('hub.plugin.manualZipNote', { name: manualZipPkg.name })}</span>
                <a class="rb-btn" href={manualZipPkg.downloadUrl} target="_blank" rel="noopener noreferrer" data-testid="hub-manual-zip-download">{t('hub.downloadZip')}</a>
                <label class="rb-btn" style="cursor:pointer" data-testid="hub-manual-zip-pick">
                  {t('hub.plugin.pickZip')}
                  <input type="file" accept=".zip" style="display:none" onChange={(e) => {
                    const f = (e.currentTarget as HTMLInputElement).files?.[0];
                    (e.currentTarget as HTMLInputElement).value = '';
                    if (f && manualZipPkg) void installFromPickedZip(manualZipPkg, f);
                  }} />
                </label>
                <button type="button" class="rb-btn" onClick={() => setManualZipPkg(null)}>{t('ui.cancel')}</button>
              </div>
            ) : null}

            {pendingPlugin ? (
              <div class="hub-confirm" role="alertdialog" data-testid="hub-plugin-confirm">
                <strong>
                  {t('hub.plugin.confirmTitle', {
                    name: pendingPlugin.plan.inspection.manifest?.name ?? pendingPlugin.pkg.name,
                    version: pendingPlugin.plan.inspection.manifest?.version ?? pendingPlugin.pkg.version,
                  })}
                </strong>
                {pendingPlugin.plan.inspection.manifest ? (
                  <div class="hub-card-meta">
                    <span>{t('plugin.adds')}: {pendingPlugin.plan.inspection.manifest.contributes.generators.map((g) => g.title).join(', ')}</span>
                    {pendingPlugin.plan.inspection.hash ? <span>{t('plugin.pin')}: {pendingPlugin.plan.inspection.hash.slice(0, 16)}…</span> : null}
                  </div>
                ) : null}
                {pendingPlugin.plan.refusal ? <div class="hub-banner err" role="alert">{pendingPlugin.plan.refusal}</div> : null}
                {pendingPlugin.plan.inspection.errors.map((err) => <div key={err} class="hub-banner err" role="alert">{err}</div>)}
                {[...pendingPlugin.fetchWarnings, ...pendingPlugin.plan.inspection.warnings].map((w) => <div key={w} class="hub-card-meta">{w}</div>)}
                <div class="hub-confirm-actions">
                  <button type="button" class="rb-btn" disabled={!pluginInstallable || busyId !== null} data-testid="hub-plugin-confirm-btn" onClick={() => void confirmPluginInstall()}>
                    {t('hub.plugin.confirmInstall')}
                  </button>
                  <button type="button" class="rb-btn" data-testid="hub-plugin-cancel-btn" onClick={() => setPendingPlugin(null)}>
                    {t('ui.cancel')}
                  </button>
                </div>
              </div>
            ) : null}

            {pendingLib ? (
              <div class="hub-confirm" role="alertdialog" data-testid="hub-library-confirm">
                <div>
                  {pendingLib.preview.licence
                    ? t('library.licence.warn', { licence: pendingLib.preview.licence })
                    : t('library.licence.warnUnknown')}
                </div>
                <div class="hub-confirm-actions">
                  <button type="button" class="rb-btn" disabled={busyId !== null} data-testid="hub-library-confirm-btn" onClick={() => void confirmLibraryAdd()}>
                    {t('hub.library.confirmAdd')}
                  </button>
                  <button type="button" class="rb-btn" data-testid="hub-library-cancel-btn" onClick={() => setPendingLib(null)}>
                    {t('ui.cancel')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div class="hub-body">

          {previewOnly ? <div class="cat-sub" role="note" data-testid="hub-preview-note">{t('hub.preview.note')}</div> : null}

          {filtered.length === 0 ? (
            <div class="cat-sub dlg-empty" data-testid="hub-empty">{t('hub.empty')}</div>
          ) : (
            <div class="hub-grid" data-testid="hub-grid">
              {filtered.map((pkg) => {
                const isPlugin = pkg.kind === 'plugin';
                const alreadyDone = isPlugin ? installedPluginIds.has(pkg.id) : isLibraryAdded(pkg);
                const busy = busyId === pkg.id;
                const link = hubSourceLink(pkg.source);
                const canAct = isPlugin ? !!p.pluginManager : !!p.libraryRegistry;
                return (
                  <article key={pkg.id} class="hub-card" data-testid={`hub-card-${pkg.id}`}>
                    {pkg.preview ? <img class="hub-card-preview" loading="lazy" decoding="async" alt="" src={pkg.preview} /> : null}
                    <div class="hub-card-head">
                      <div class="hub-card-title">
                        <strong>{pkg.name}</strong>
                        <div class="hub-card-meta">
                          <span>{t('hub.by', { author: pkg.author })}</span>
                          <span>{pkg.version}</span>
                        </div>
                      </div>
                      <span class={`hub-badge kind-${pkg.kind}`} data-testid={`hub-badge-kind-${pkg.id}`}>{kindLabel(pkg.kind)}</span>
                    </div>

                    <div class="hub-badges">
                      <span class="hub-badge" data-testid={`hub-badge-license-${pkg.id}`}>{pkg.license}</span>
                      {pkg.sha256 ? (
                        <span class="hub-badge verified" title={t('hub.verifiedTip', { sha: pkg.sha256 })} data-testid={`hub-badge-sha-${pkg.id}`}>
                          {t('hub.verifiedBadge')}
                        </span>
                      ) : null}
                    </div>

                    <p class="hub-card-summary">{pkg.summary}</p>

                    {pkg.tags.length > 0 ? (
                      <div class="hub-tags">
                        {pkg.tags.map((tg) => (
                          <button key={tg} type="button" class="hub-tag" aria-pressed={tag === tg} data-testid={`hub-tag-${pkg.id}-${tg}`} onClick={() => setTag(tag === tg ? null : tg)}>
                            #{tg}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div class="hub-card-foot">
                      <span style="display:inline-flex;gap:10px;align-items:center">
                        {link ? (
                          <a class="hub-source-link" href={pkg.homepage ?? link} target="_blank" rel="noopener noreferrer">{t('hub.sourceLink')}</a>
                        ) : null}
                        {pkg.downloadUrl ? (
                          <a class="hub-source-link" href={pkg.downloadUrl} target="_blank" rel="noopener noreferrer" data-testid={`hub-zip-${pkg.id}`}>{t('hub.downloadZip')}</a>
                        ) : null}
                      </span>
                      {previewOnly ? <span class="cat-sub" data-testid={`hub-preview-${pkg.id}`}>{t('hub.preview.badge')}</span> : (
                      <button
                        type="button"
                        class="rb-btn"
                        disabled={!canAct || alreadyDone || busy}
                        data-testid={`hub-action-${pkg.id}`}
                        onClick={() => void (isPlugin ? startPluginInstall(pkg) : startLibraryAdd(pkg))}
                      >
                        {busy
                          ? t('hub.action.working')
                          : alreadyDone
                            ? (isPlugin ? t('hub.action.installed') : t('hub.action.added'))
                            : (isPlugin ? t('hub.action.installPlugin') : t('hub.action.addLibrary'))}
                      </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

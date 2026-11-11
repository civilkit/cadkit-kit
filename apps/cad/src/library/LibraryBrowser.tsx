// The Libraries tab of the Catalog panel: ONE list of parts. BOSL2's parametric entries and the app's bundled samples are
// "Included", the libraries the user added (GitHub, web address, folder) are "Add-ons"; every card looks the same, with an image,
// and every card can be dragged onto the model (see useCatalog) or clicked to select it. One search box covers all libraries.
// All text that comes from a manifest is rendered as plain text (Preact escapes it); links are only made for https addresses.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from '../i18n';
import { BoslForm, boslItem } from '../catalog/bosl/BoslForm';
import { BOSL_THUMBS } from '../catalog/bosl/thumbs.generated';
import { CatalogIcon } from '../catalog/CatalogIcon';
import { armedItem } from '../catalog/state';
import type { CatalogItem } from '../catalog/shapes';
import { effectiveLicence, type LibraryManifest } from './manifest';
import { sourceLink, parseSource } from './source';
import type { LibraryRecord, LibraryRegistry, PartData } from './registry';
import type { SourceEntry } from './insert';
import { BOSL_LIB_ID, boslEntries, entryKey, filterEntries, partEntries, partItem, sanitizeFilter, type LibEntry, type LibInfo, type WizardId } from './entries';
import { libCategory, libQuery, libSelected, libSource, libTags, saveFilter } from './state';
import { FilterBar } from './FilterBar';
import { AddLibrary, errText } from './AddLibrary';
import { CategoryIcon } from './CategoryIcon';
import { generateThumb, type ThumbRenderer } from './thumbs';

export interface LibraryActions {
  /** Insert into the open document at the part's own origin; resolves true when it was added. */
  insert(data: PartData, lib: LibraryRecord): Promise<boolean>;
  openNew(data: PartData, lib: LibraryRecord): void;
  download(data: PartData, lib: LibraryRecord): void;
  /** The recorded sources still present in the open document. */
  sources(): SourceEntry[];
}
export interface LibraryBrowserProps {
  registry: LibraryRegistry;
  hasDoc: boolean;
  actions: LibraryActions;
  /** Pointer pressed on a card: starts a drag, or (a click) arms the item for click-to-place (the Catalog's own handler). */
  onItemDown(item: CatalogItem, e: JSX.TargetedPointerEvent<HTMLElement>): void;
  onItemKey(item: CatalogItem): void;
  notify?(text: string, level?: 'error' | 'warn' | 'info'): void;
  /** Renders a part to PNG for the cards of parts that came without a thumbnail (omitted: they keep the placeholder). */
  renderThumb?: ThumbRenderer;
  /** Open the wizard that makes a kind of part (the filter bar's "Make one with a wizard" link; a missing one shows no link). */
  wizards?: Partial<Record<WizardId, () => void>>;
}

const PAGE = 60;
const BOSL_HOME = 'https://github.com/BelfrySCAD/BOSL2';
const safeLink = (u: string | undefined): string | null => { try { return u && /^https:\/\//.test(u) ? new URL(u).href : null; } catch { return null; } };
const blobUrl = (bytes: Uint8Array, type: string): string => URL.createObjectURL(new Blob([bytes as BlobPart], { type }));

interface ManState { manifest: LibraryManifest | null; offline: boolean; error: string; loading: boolean }

export function Thumb({ registry, entry, installed, renderThumb }: { registry: LibraryRegistry; entry: LibEntry; installed: boolean; renderThumb?: ThumbRenderer }) {
  const [url, setUrl] = useState<string | null>(null);
  const part = entry.part;
  useEffect(() => {
    if (!part) return;
    let dead = false;
    const made: string[] = [];
    const show = (bytes: Uint8Array, type: string) => { if (dead) return; const u = blobUrl(bytes, type); made.push(u); setUrl(u); };
    setUrl(null);
    void (async () => {
      if (part.thumb) { const th = await registry.thumb(entry.libId, part.id); if (th) return show(th.bytes, th.type); }
      const emb = await registry.embeddedThumb(entry.libId, part.id);   // the picture the saved part carries itself
      if (emb) return show(emb, 'image/png');
      const gen = await registry.generatedThumb(entry.libId, part.id);
      if (gen) return show(gen, 'image/png');
      if (installed && renderThumb) { const png = await generateThumb(registry, entry.libId, part.id, renderThumb); if (png) show(png, 'image/png'); }
    })();
    return () => { dead = true; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [registry, entry.libId, part?.id, part?.thumb, installed, renderThumb]);
  if (entry.bosl) {
    const src = BOSL_THUMBS[entry.id];
    if (src) return <img src={src} width="64" height="48" alt="" draggable={false} />;
    const item = boslItem(entry.bosl);
    return <span class="lib-ph" data-testid="lib-placeholder"><CatalogIcon kind={item.kind} op={item.op} /></span>;
  }
  return url ? <img src={url} width="64" height="48" alt="" draggable={false} /> : <span class="lib-ph" data-testid="lib-placeholder"><CategoryIcon category={entry.category} /></span>;
}

function Detail({ registry, entry, rec, manifest, hasDoc, actions, installed, ask, setAsk, install, installing, onClose }: {
  registry: LibraryRegistry; entry: LibEntry; rec: LibraryRecord; manifest: LibraryManifest; hasDoc: boolean; actions: LibraryActions;
  installed: boolean; ask: 'insert' | 'open' | 'download' | 'install' | null; setAsk(a: 'insert' | 'open' | 'download' | 'install' | null): void;
  install(): Promise<void>; installing: boolean; onClose(): void;
}) {
  const part = entry.part!;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const licence = effectiveLicence(manifest, part);
  const shown = rec.builtin ? t('library.licence.bundled') : licence ?? t('library.licence.unknown');
  useEffect(() => { setErr(''); }, [entry.key]);
  const run = async (kind: 'insert' | 'open' | 'download' | 'install') => {
    if (registry.needsConfirm(rec.id, licence, rec)) { setAsk(kind); return; }
    setAsk(null); setBusy(true); setErr('');
    try {
      if (kind === 'install') { await install(); return; }
      const data = await registry.part(rec.id, part.id);
      if (kind === 'insert') await actions.insert(data, rec);
      else if (kind === 'open') actions.openNew(data, rec);
      else actions.download(data, rec);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const link = safeLink(part.source);
  const home = safeLink(manifest.homepage) ?? (() => { try { return sourceLink(parseSource(rec.source)); } catch { return null; } })();
  return (
    <div class="lib-detail" data-testid="lib-detail" aria-label={part.title}>
      <div class="bosl-form-h"><b>{part.title}</b><button class="bosl-reset" onClick={onClose}>{t('library.detail.close')}</button></div>
      <div class="lib-meta">
        <span>{entry.libName}</span>
        <span>{t('library.licence')}: <b data-testid="lib-licence">{shown}</b></span>
        <span>{t('library.detail.category')}: {part.category}</span>
        {part.tags.length ? <span class="lib-tags">{part.tags.join(', ')}</span> : null}
        {part.bytes !== undefined ? <span>{t('library.detail.size')}: {Math.max(1, Math.round(part.bytes / 1024))} KB</span> : null}
      </div>
      <div class="lib-links">
        {link ? <a href={link} target="_blank" rel="noopener noreferrer nofollow">{t('library.partSource')}</a> : null}
        {home ? <a href={home} target="_blank" rel="noopener noreferrer nofollow">{t('library.homepage')}</a> : null}
      </div>
      <div class="cat-sub">{t('library.detail.drag')}</div>
      {ask ? (
        <div class="lib-warn" role="alertdialog" data-testid="lib-confirm">
          <div>{licence ? t('library.licence.warn', { licence }) : t('library.licence.warnUnknown')}</div>
          <button onClick={() => { registry.confirm(rec.id, licence); void run(ask); }}>{t('library.confirm')}</button>
          <button onClick={() => setAsk(null)}>{t('library.confirm.cancel')}</button>
        </div>
      ) : null}
      <div class="lib-actions">
        <button disabled={busy || !hasDoc} title={hasDoc ? t('library.insert.tip') : t('library.insert.needDoc')} onClick={() => void run('insert')}>{t('library.insert')}</button>
        <button disabled={busy} onClick={() => void run('open')}>{t('library.open')}</button>
        <button disabled={busy} onClick={() => void run('download')}>{t('library.download')}</button>
        {!rec.builtin && !installed ? <button disabled={busy || installing} title={t('library.install.tip')} onClick={() => void run('install')}>{t('library.install')}</button> : null}
      </div>
      {busy || installing ? <div class="cat-sub" role="status">{t('library.working')}</div> : null}
      {err ? <div class="lib-err" role="alert">{err}</div> : null}
    </div>
  );
}

export function SourcesNote({ sources }: { sources: SourceEntry[] }) {
  if (!sources.length) return null;
  return (
    <div class="lib-sources" data-testid="lib-sources">
      <div class="cat-sub">{t('library.sources.title')}</div>
      <ul>{sources.map((s, i) => <li key={i}>{t('library.sources.item', { part: s.part, library: s.library, licence: s.licence ?? t('library.licence.unknown') })}</li>)}</ul>
    </div>
  );
}

/** One library's row in "Libraries": what it is, and refresh / remove / links for the ones the user added. */
export function LibRow({ info, onRefresh, onRemove, onToggle }: { info: LibInfo; onRefresh(): void; onRemove(): void; /** switch the library on or off (omitted: it cannot be switched, as BOSL2 which is part of the app) */ onToggle?(): void }) {
  const home = info.id === BOSL_LIB_ID ? BOSL_HOME : safeLink(info.homepage) ?? (() => { try { return info.record ? sourceLink(parseSource(info.record.source)) : null; } catch { return null; } })();
  return (
    <li class="lib-row" data-lib={info.id} data-origin={info.origin} data-enabled={info.enabled === false ? 'false' : 'true'}>
      <div class="lib-row-h"><b>{info.name}</b><span class="lib-origin" data-origin={info.origin}>{t('library.origin.' + info.origin)}</span>
        {info.enabled === false ? <span class="lib-offline" data-testid="lib-disabled">{t('library.disabled')}</span> : null}
        {info.offline ? <span class="lib-offline" title={t('library.offline.tip')} data-testid="lib-offline">{t('library.offline')}</span> : null}</div>
      <div class="cat-sub">{info.loading ? t('library.loading') : t('library.count', { count: info.count })}{' - '}{t('library.licence')}: {info.origin === 'included' && info.id !== BOSL_LIB_ID ? t('library.licence.bundled') : info.licence ?? t('library.licence.unknown')}</div>
      {info.id === BOSL_LIB_ID ? <div class="cat-sub" data-testid="bosl-credit">{t('library.bosl.credit')}</div> : null}
      {info.error ? <div class="lib-err" role="alert">{info.error}</div> : null}
      <div class="lib-row-a">
        {home ? <a href={home} target="_blank" rel="noopener noreferrer nofollow">{t('library.homepage')}</a> : null}
        {onToggle ? <button title={t(info.enabled === false ? 'library.enable.tip' : 'library.disable.tip')} aria-label={t(info.enabled === false ? 'library.enable' : 'library.disable') + ': ' + info.name} onClick={onToggle}>{t(info.enabled === false ? 'library.enable' : 'library.disable')}</button> : null}
        {info.origin === 'addon' ? (
          <>
            <button title={t('library.refresh.tip')} onClick={onRefresh}>{t('library.refresh')}</button>
            <button title={t('library.remove.tip')} aria-label={t('library.remove') + ': ' + info.name} onClick={onRemove}>{t('library.remove')}</button>
          </>
        ) : null}
      </div>
    </li>
  );
}

export function LibraryBrowser({ registry, hasDoc, actions, onItemDown, onItemKey, notify, renderThumb, wizards }: LibraryBrowserProps) {
  const [, bump] = useState(0);
  useEffect(() => registry.subscribe(() => bump((n) => n + 1)), [registry]);
  const allRecs = registry.list();
  const recs = registry.listEnabled();   // a disabled library is not browsed (it stays in Manage libraries)
  const ids = recs.map((r) => r.id).join('\n');
  const allIds = allRecs.map((r) => r.id).join('\n');
  const [mans, setMans] = useState<Record<string, ManState>>({});
  const [installed, setInstalled] = useState<Record<string, Set<string>>>({});
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [ask, setAsk] = useState<{ key: string; kind: 'insert' | 'open' | 'download' | 'install' } | null>(null);
  const [installing, setInstalling] = useState<Set<string>>(new Set());

  const load = (id: string, refresh: boolean) => {
    setMans((m) => ({ ...m, [id]: { manifest: m[id]?.manifest ?? null, offline: false, error: '', loading: true } }));
    (refresh ? registry.refresh(id) : registry.manifest(id)).then(
      (r) => setMans((m) => ({ ...m, [id]: { manifest: r.manifest, offline: r.offline, error: '', loading: false } })),
      (e) => setMans((m) => ({ ...m, [id]: { manifest: null, offline: false, error: errText(e), loading: false } })));
  };
  // every library's list is read (from the cache when there is one): the search covers all of them
  useEffect(() => { for (const r of allRecs) if (!mans[r.id]) load(r.id, false); }, [allIds]);
  const cachedKey = registry.rev;
  useEffect(() => {
    let dead = false;
    for (const r of recs) if (!r.builtin && mans[r.id]?.manifest) void registry.installedIds(r.id).then((s) => { if (!dead) setInstalled((x) => ({ ...x, [r.id]: s })); });
    return () => { dead = true; };
  }, [ids, mans, cachedKey]);

  const boslName = t('library.bosl.name');
  const loadingAny = recs.some((r) => !mans[r.id] || mans[r.id].loading);
  const entries = useMemo(() => [
    ...boslEntries(boslName),
    ...recs.flatMap((r) => (mans[r.id]?.manifest ? partEntries(r, mans[r.id].manifest!) : [])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [ids, mans, boslName]);

  const infos: LibInfo[] = [
    { id: BOSL_LIB_ID, name: boslName, origin: 'included', count: entries.filter((e) => e.libId === BOSL_LIB_ID).length, licence: 'BSD-2-Clause' },
    ...allRecs.map((r): LibInfo => ({ enabled: registry.enabled(r.id), id: r.id, name: r.name, origin: r.builtin ? 'included' : 'addon', count: mans[r.id]?.manifest?.parts.length ?? r.parts, licence: mans[r.id]?.manifest?.licence ?? r.licence, record: r, homepage: mans[r.id]?.manifest?.homepage ?? r.homepage, loading: mans[r.id]?.loading, error: mans[r.id]?.error, offline: mans[r.id]?.offline })),
  ];

  const source = libSource.value, q = libQuery.value;
  // a remembered category or tag the libraries do not have (any more, or not yet: a list still loading) is ignored, not shown as an empty list
  const { category, tags } = sanitizeFilter(entries, { category: libCategory.value, tags: libTags.value, source });
  const setFilter = (c: string, tg: string[]) => { libCategory.value = c; libTags.value = tg; saveFilter('catalog', { category: c, tags: tg }); setShown(PAGE); };
  const list = filterEntries(entries, { q, source, category, tags });
  const sel = libSelected.value ? entries.find((e) => e.key === libSelected.value) : undefined;
  const armed = armedItem.value;
  const isInstalled = (e: LibEntry): boolean => e.kind === 'bosl' || !!registry.get(e.libId)?.builtin || !!installed[e.libId]?.has(e.id);

  const install = async (e: LibEntry): Promise<void> => {
    const rec = registry.get(e.libId);
    if (!rec || e.kind !== 'part') return;
    if (registry.needsConfirm(rec.id, effectiveLicence(mans[rec.id].manifest!, e.part!), rec)) { libSelected.value = e.key; setAsk({ key: e.key, kind: 'install' }); return; }
    setInstalling((s) => new Set(s).add(e.key));
    try { await registry.install(rec.id, e.id); notify?.(t('library.installed', { title: e.title }), 'info'); }
    catch (err) { notify?.(errText(err), 'error'); }
    finally { setInstalling((s) => { const n = new Set(s); n.delete(e.key); return n; }); }
  };

  const card = (e: LibEntry) => {
    const item = e.kind === 'bosl' ? boslItem(e.bosl!) : partItem(e);
    const inst = isInstalled(e);
    const busy = installing.has(e.key);
    const state = e.kind === 'bosl' || registry.get(e.libId)?.builtin ? null : busy ? 'installing' : inst ? 'installed' : 'cloud';
    const select = () => { libSelected.value = e.key; setAsk(null); };
    return (
      <div key={e.key} class="lib-card" data-origin={e.origin}>
        <button class={'cat-item lib-item' + (armed === item.id ? ' armed' : '') + (libSelected.value === e.key ? ' sel' : '')} data-item={item.id} data-part={e.id} data-lib={e.libId} data-origin={e.origin}
          title={e.kind === 'bosl' ? e.bosl!.notes : e.title} aria-pressed={armed === item.id}
          onPointerDown={(ev) => { select(); onItemDown(e.kind === 'bosl' ? boslItem(e.bosl!) : partItem(e), ev); }}
          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(); onItemKey(e.kind === 'bosl' ? boslItem(e.bosl!) : partItem(e)); } }}>
          <Thumb registry={registry} entry={e} installed={inst} renderThumb={renderThumb} />
          <span class="cat-name">{e.title}</span>
          <i class="lib-origin" data-origin={e.origin}>{t('library.origin.' + e.origin)}</i>
          {state ? <span class="lib-state" data-state={state} title={t('library.state.' + state + '.tip')}>{state === 'cloud' ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label={t('library.state.cloud')}><path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 0 9.5z" /></svg> : t('library.state.' + state)}</span> : null}
        </button>
        {state === 'cloud' ? <button class="lib-install" onClick={() => void install(e)} title={t('library.install.tip')}>{t('library.install')}</button> : null}
      </div>
    );
  };

  return (
    <section class="lib" data-testid="library-section" aria-label={t('library.title')}>
      <div class="lib-head">
        <div class="cat-h">{t('library.title')}</div>
        <button class="lib-addbtn" onClick={() => setAdding(!adding)} aria-expanded={adding}>{t('library.add')}</button>
      </div>
      {adding ? <AddLibrary registry={registry} onDone={(id) => { setAdding(false); if (id) { libSource.value = 'addon'; setFilter('all', []); } }} /> : null}
      <FilterBar entries={entries} q={q} onQ={(v) => { libQuery.value = v; setShown(PAGE); }} source={source} onSource={(v) => { libSource.value = v; setShown(PAGE); }}
        category={category} tags={tags} onFilter={setFilter} wizards={wizards} />
      <div class="cat-grid" data-testid="lib-grid">
        {list.slice(0, shown).map(card)}
        {!loadingAny && list.length === 0 ? <div class="empty">{t('library.none')}</div> : null}
      </div>
      {loadingAny ? <div class="cat-sub" role="status">{t('library.loading')}</div> : null}
      {list.length > shown ? <button class="lib-link" onClick={() => setShown(shown + PAGE)}>{t('library.more')}</button> : null}
      {sel?.kind === 'bosl' ? <BoslForm entry={sel.bosl!} /> : null}
      {sel?.kind === 'part' && registry.get(sel.libId) && mans[sel.libId]?.manifest ? (
        <Detail registry={registry} entry={sel} rec={registry.get(sel.libId)!} manifest={mans[sel.libId].manifest!} hasDoc={hasDoc} actions={actions} installed={isInstalled(sel)}
          ask={ask?.key === sel.key ? ask.kind : null} setAsk={(k) => setAsk(k ? { key: sel.key, kind: k } : null)} install={() => install(sel)} installing={installing.has(sel.key)} onClose={() => { libSelected.value = null; }} />
      ) : null}
      {!sel ? <div class="cat-sub">{t('library.selectHint', { count: entries.length })}</div> : null}
      <details class="lib-manage" data-testid="lib-manage">
        <summary>{t('library.manage', { count: infos.length })}</summary>
        <ul>
          {infos.map((i) => <LibRow key={i.id} info={i} onToggle={i.record ? () => { registry.setEnabled(i.id, !registry.enabled(i.id)); if (libSelected.value?.startsWith(entryKey(i.id, ''))) libSelected.value = null; } : undefined} onRefresh={() => load(i.id, true)} onRemove={() => { void registry.remove(i.id); setMans((m) => { const { [i.id]: _x, ...rest } = m; return rest; }); if (libSelected.value?.startsWith(entryKey(i.id, ''))) libSelected.value = null; }} />)}
        </ul>
      </details>
      <SourcesNote sources={actions.sources()} />
    </section>
  );
}

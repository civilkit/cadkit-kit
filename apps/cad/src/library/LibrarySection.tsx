// The "Libraries" section of the Catalog panel: a library picker, add-library flow, category filter, search, a card grid with
// thumbnails and the detail panel of the selected part (licence, links, Insert / Open as new document / Download). All text that comes
// from a manifest is rendered as plain text (Preact escapes it); links are only made for https addresses.
import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import { effectiveLicence, type LibraryManifest, type LibraryPart } from './manifest';
import { LibraryError } from './source';
import { sourceLink, parseSource } from './source';
import type { LibraryRecord, LibraryRegistry, PartData, Preview } from './registry';
import type { SourceEntry } from './insert';
import { libCategory, libPart, libQuery, libSelected, matches } from './state';

export interface LibraryActions {
  /** Insert into the open document; resolves true when it was added. */
  insert(data: PartData, lib: LibraryRecord): Promise<boolean>;
  openNew(data: PartData, lib: LibraryRecord): void;
  download(data: PartData, lib: LibraryRecord): void;
  /** The recorded sources still present in the open document. */
  sources(): SourceEntry[];
}
export interface LibrarySectionProps { registry: LibraryRegistry; hasDoc: boolean; actions: LibraryActions }

const PAGE = 60;

export function errText(e: unknown): string {
  if (e instanceof LibraryError) return t('library.err.' + e.code, { detail: e.detail ?? '' });
  return String((e as Error)?.message ?? e);
}
const safeLink = (u: string | undefined): string | null => { try { return u && /^https:\/\//.test(u) ? new URL(u).href : null; } catch { return null; } };

function Thumb({ registry, lib, part }: { registry: LibraryRegistry; lib: string; part: LibraryPart }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let dead = false, made: string | null = null;
    setUrl(null);
    if (part.thumb) void registry.thumb(lib, part.id).then((th) => {
      if (dead || !th) return;
      made = URL.createObjectURL(new Blob([th.bytes as BlobPart], { type: th.type }));
      setUrl(made);
    });
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [registry, lib, part.id, part.thumb]);
  return url ? <img src={url} width="64" height="48" alt="" draggable={false} /> : <span class="lib-nothumb" aria-hidden="true" />;
}

function AddFlow({ registry, onDone }: { registry: LibraryRegistry; onDone(id: string | null): void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pv, setPv] = useState<Preview | null>(null);
  const [ok, setOk] = useState(false);
  const run = async (f: () => Promise<Preview>) => {
    setBusy(true); setErr(''); setPv(null); setOk(false);
    try { setPv(await f()); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const folder = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const map = new Map<string, { arrayBuffer(): Promise<ArrayBuffer>; size: number }>();
    let name = 'library';
    for (const f of Array.from(files)) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const parts = rel.split('/');
      if (parts.length > 1) name = parts[0];
      map.set(parts.length > 1 ? parts.slice(1).join('/') : rel, f);
    }
    await run(() => registry.preview({ local: map, name }));
  };
  const add = async () => {
    if (!pv) return;
    setBusy(true); setErr('');
    try { const rec = await registry.add(pv, { confirm: ok }); onDone(rec.id); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const lic = pv?.licence;
  return (
    <div class="lib-add" data-testid="lib-add">
      <div class="cat-sub">{t('library.add.hint')}</div>
      <div class="lib-add-row">
        <input type="text" value={text} placeholder={t('library.add.placeholder')} aria-label={t('library.add.title')} onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) void run(() => registry.preview(text)); }} />
        <button disabled={busy || !text.trim()} onClick={() => void run(() => registry.preview(text))}>{t('library.add.fetch')}</button>
      </div>
      <label class="lib-folder">{t('library.add.folder')}
        <input type="file" {...({ webkitdirectory: '' } as object)} onChange={(e) => void folder((e.currentTarget as HTMLInputElement).files)} />
      </label>
      {err ? <div class="lib-err" role="alert">{err}</div> : null}
      {pv ? (
        <div class="lib-found" data-testid="lib-found">
          <b>{t('library.add.found', { name: pv.record.name, count: pv.record.parts, licence: lic ?? t('library.licence.unknown') })}</b>
          {pv.record.description ? <div class="cat-sub">{pv.record.description}</div> : null}
          {pv.needsConfirm ? (
            <>
              <div class="lib-warn" role="note">{lic ? t('library.licence.warn', { licence: lic }) : t('library.licence.warnUnknown')}</div>
              <label class="lib-accept"><input type="checkbox" checked={ok} onChange={(e) => setOk((e.currentTarget as HTMLInputElement).checked)} />{t('library.add.accept')}</label>
            </>
          ) : null}
          <button disabled={busy || (pv.needsConfirm && !ok)} onClick={() => void add()}>{t('library.add.confirmAdd')}</button>
        </div>
      ) : null}
      <button class="lib-link" onClick={() => onDone(null)}>{t('library.add.cancel')}</button>
    </div>
  );
}

function Detail({ registry, lib, manifest, part, hasDoc, actions, onClose }: { registry: LibraryRegistry; lib: LibraryRecord; manifest: LibraryManifest; part: LibraryPart; hasDoc: boolean; actions: LibraryActions; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ask, setAsk] = useState<null | 'insert' | 'open' | 'download'>(null);
  const licence = effectiveLicence(manifest, part);
  const shown = lib.builtin ? t('library.licence.bundled') : licence ?? t('library.licence.unknown');
  useEffect(() => { setErr(''); setAsk(null); }, [part.id, lib.id]);
  const run = async (kind: 'insert' | 'open' | 'download') => {
    if (registry.needsConfirm(lib.id, licence, lib)) { setAsk(kind); return; }
    setAsk(null); setBusy(true); setErr('');
    try {
      const data = await registry.part(lib.id, part.id);
      if (kind === 'insert') await actions.insert(data, lib);
      else if (kind === 'open') actions.openNew(data, lib);
      else actions.download(data, lib);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const link = safeLink(part.source);
  const home = safeLink(manifest.homepage) ?? (() => { try { return sourceLink(parseSource(lib.source)); } catch { return null; } })();
  return (
    <div class="lib-detail" data-testid="lib-detail" aria-label={part.title}>
      <div class="bosl-form-h"><b>{part.title}</b><button class="bosl-reset" onClick={onClose}>{t('library.detail.close')}</button></div>
      <div class="lib-meta">
        <span>{t('library.licence')}: <b data-testid="lib-licence">{shown}</b></span>
        <span>{t('library.detail.category')}: {part.category}</span>
        {part.tags.length ? <span class="lib-tags">{part.tags.join(', ')}</span> : null}
        {part.bytes !== undefined ? <span>{t('library.detail.size')}: {Math.max(1, Math.round(part.bytes / 1024))} KB</span> : null}
      </div>
      <div class="lib-links">
        {link ? <a href={link} target="_blank" rel="noopener noreferrer nofollow">{t('library.partSource')}</a> : null}
        {home ? <a href={home} target="_blank" rel="noopener noreferrer nofollow">{t('library.homepage')}</a> : null}
      </div>
      {ask ? (
        <div class="lib-warn" role="alertdialog" data-testid="lib-confirm">
          <div>{licence ? t('library.licence.warn', { licence }) : t('library.licence.warnUnknown')}</div>
          <button onClick={() => { registry.confirm(lib.id, licence); void run(ask); }}>{t('library.confirm')}</button>
          <button onClick={() => setAsk(null)}>{t('library.confirm.cancel')}</button>
        </div>
      ) : null}
      <div class="lib-actions">
        <button disabled={busy || !hasDoc} title={hasDoc ? t('library.insert.tip') : t('library.insert.needDoc')} onClick={() => void run('insert')}>{t('library.insert')}</button>
        <button disabled={busy} onClick={() => void run('open')}>{t('library.open')}</button>
        <button disabled={busy} onClick={() => void run('download')}>{t('library.download')}</button>
      </div>
      {busy ? <div class="cat-sub" role="status">{t('library.working')}</div> : null}
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

export function LibrarySection({ registry, hasDoc, actions }: LibrarySectionProps) {
  const [, bump] = useState(0);
  useEffect(() => registry.subscribe(() => bump((n) => n + 1)), [registry]);
  const libs = registry.list();
  const selId = libSelected.value && libs.some((l) => l.id === libSelected.value) ? libSelected.value : libs[0]?.id ?? null;
  const lib = libs.find((l) => l.id === selId);
  const [adding, setAdding] = useState(false);
  const [state, setState] = useState<{ manifest: LibraryManifest | null; offline: boolean; error: string; loading: boolean }>({ manifest: null, offline: false, error: '', loading: false });
  const [shown, setShown] = useState(PAGE);
  const load = (refresh: boolean) => {
    if (!selId) return;
    setState((s) => ({ ...s, loading: true, error: '' }));
    (refresh ? registry.refresh(selId) : registry.manifest(selId)).then(
      (r) => setState({ manifest: r.manifest, offline: r.offline, error: '', loading: false }),
      (e) => setState({ manifest: null, offline: false, error: errText(e), loading: false }));
  };
  useEffect(() => { setShown(PAGE); setState({ manifest: null, offline: false, error: '', loading: !!selId }); load(false); }, [selId]);

  const cat = libCategory.value, q = libQuery.value;
  const m = state.manifest;
  const categories = m ? ['all', ...[...new Set(m.parts.map((p) => p.category))].sort()] : ['all'];
  const list = m ? m.parts.filter((p) => (cat === 'all' || p.category === cat) && matches(p, q)) : [];
  const sel = m && libPart.value ? m.parts.find((p) => p.id === libPart.value) : undefined;

  return (
    <section class="lib" data-testid="library-section" aria-label={t('library.title')}>
      <div class="cat-h">{t('library.title')}</div>
      <div class="cat-sub">{t('library.hint')}</div>
      <div class="lib-bar">
        <select aria-label={t('library.pick')} value={adding ? '__add' : selId ?? ''} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v === '__add') setAdding(true); else { setAdding(false); libSelected.value = v; libPart.value = null; libCategory.value = 'all'; } }}>
          {libs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          <option value="__add">{t('library.add')}</option>
        </select>
        {lib && !adding ? (
          <>
            <button title={t('library.refresh.tip')} onClick={() => load(true)}>{t('library.refresh')}</button>
            <button title={t('library.remove.tip')} aria-label={t('library.remove')} onClick={() => { void registry.remove(lib.id); libSelected.value = null; libPart.value = null; }}>{t('library.remove')}</button>
          </>
        ) : null}
        {state.offline && !adding ? <span class="lib-offline" title={t('library.offline.tip')} data-testid="lib-offline">{t('library.offline')}</span> : null}
      </div>
      {adding || !lib ? (
        <>
          {!lib && !adding ? <div class="empty">{t('library.empty')}</div> : null}
          {adding || !lib ? <AddFlow registry={registry} onDone={(id) => { setAdding(false); if (id) { libSelected.value = id; libPart.value = null; } }} /> : null}
        </>
      ) : (
        <>
          <div class="cat-sub lib-info">
            {m ? t('library.count', { count: m.parts.length }) : null}{' - '}{t('library.licence')}: {lib.builtin ? t('library.licence.bundled') : (m?.licence ?? lib.licence ?? t('library.licence.unknown'))}
          </div>
          <input class="bosl-search" type="search" value={q} placeholder={t('library.search')} aria-label={t('library.search')} onInput={(e) => { libQuery.value = (e.currentTarget as HTMLInputElement).value; setShown(PAGE); }} />
          <div class="bosl-cats" role="tablist">
            {categories.map((c) => <button key={c} role="tab" aria-selected={cat === c} class={'bosl-cat' + (cat === c ? ' on' : '')} onClick={() => { libCategory.value = c; setShown(PAGE); }}>{c === 'all' ? t('library.cat.all') : c}</button>)}
          </div>
          {state.loading ? <div class="empty" role="status">{t('library.loading')}</div> : null}
          {state.error ? <div class="lib-err" role="alert">{state.error}</div> : null}
          <div class="cat-grid" data-testid="lib-grid">
            {list.slice(0, shown).map((p) => (
              <button key={p.id} class={'cat-item lib-item' + (libPart.value === p.id ? ' sel' : '')} data-part={p.id} title={p.title} aria-pressed={libPart.value === p.id} onClick={() => { libPart.value = p.id; }}>
                <Thumb registry={registry} lib={lib.id} part={p} />
                <span class="cat-name">{p.title}</span>
              </button>
            ))}
            {m && list.length === 0 ? <div class="empty">{t('library.none')}</div> : null}
          </div>
          {list.length > shown ? <button class="lib-link" onClick={() => setShown(shown + PAGE)}>{t('library.more')}</button> : null}
          {m && sel ? <Detail registry={registry} lib={lib} manifest={m} part={sel} hasDoc={hasDoc} actions={actions} onClose={() => { libPart.value = null; }} /> : null}
        </>
      )}
      <SourcesNote sources={actions.sources()} />
    </section>
  );
}


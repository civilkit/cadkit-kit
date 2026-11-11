import { useEffect, useMemo, useState } from 'preact/hooks';
import { t } from './i18n';
import { ago } from './files/strings';
import type { RecentEntry } from './files/recent';
import { CategoryIcon } from './library/CategoryIcon';
import { AddLibrary, errText } from './library/AddLibrary';
import { LibRow, Thumb } from './library/LibraryBrowser';
import { entryKey, filterEntries, mapCategory, partEntries, sanitizeFilter, type LibEntry, type LibInfo, type WizardId } from './library/entries';
import { FilterBar } from './library/FilterBar';
import { effectiveLicence, type LibraryManifest } from './library/manifest';
import type { LibraryRecord, LibraryRegistry, PartData } from './library/registry';
import { loadFilter, saveFilter } from './library/state';
import './files/files.css';

export interface SampleEntry { id: string; title: string; url: string; detail?: string; category?: string; tags?: string[] }

/** A small picture that loads lazily and gives way to the category icon of `name` when there is none (or it fails to load). */
export function ThumbImg(p: { src?: string; name: string; class?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [p.src]);
  if (!p.src || bad) return <span class={`thumb-fallback ${p.class ?? ''}`} title={t('files.recent.noPreview')} data-fallback><CategoryIcon category={p.name} /></span>;
  return <img class={p.class} loading="lazy" decoding="async" alt="" src={p.src} onError={() => setBad(true)} />;
}

/** The id of the app's bundled samples in the library list: their parts come from the sample index, not from a manifest. */
export const SAMPLES_LIB_ID = 'samples';

interface ManState { manifest: LibraryManifest | null; loading: boolean; error: string; offline: boolean }

export interface LibraryDialogProps {
  samples: SampleEntry[];
  thumbBase: string;
  onPick(s: SampleEntry): void;
  onClose(): void;
  recent?: RecentEntry[];
  /** pictures of recent files, data URLs by file name */
  recentThumbs?: Record<string, string>;
  onPickRecent?(e: RecentEntry): void;
  /** The libraries on this device (the bundled samples and the ones the user added). Omitted: only the samples are listed. */
  registry?: LibraryRegistry;
  /** Open a part of an added library as a new document. */
  onOpenPart?(data: PartData, lib: LibraryRecord): void;
  /** Insert a part into the open document: the Catalog's click-then-pick-a-face placement (the app arms the part and closes this dialog). */
  onInsertPart?(entry: LibEntry): void;
  /** Whether a document is open to insert into (the Catalog panel's own test). Omitted or false: Insert is disabled. */
  canInsert?: boolean;
  /** Open the wizard that makes a kind of part (the filter bar's "Make one with a wizard" link; omitted: no link). The app closes this dialog. */
  onWizard?(id: WizardId): void;
}

/** Filterable Library picker: the Recent row, then the parts of every library that is switched on, grouped by library; "Manage libraries"
 *  switches to the list of libraries (add, disable or enable, refresh, remove). The filter text survives close and reopen (module state). */
let lastQuery = '';

export function LibraryDialog(p: LibraryDialogProps) {
  const [q, setQ] = useState(lastQuery);
  const [managing, setManaging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [, bump] = useState(0);
  const [mans, setMans] = useState<Record<string, ManState>>({});
  const [ask, setAsk] = useState<{ lib: LibraryRecord; part: string; licence: string | undefined; insert?: LibEntry } | null>(null);
  const [err, setErr] = useState('');
  const [fil, setFil] = useState(() => loadFilter('picker'));   // the last category and tags, remembered on this device
  const reg = p.registry;
  useEffect(() => { lastQuery = q; }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => (reg ? reg.subscribe(() => bump((n) => n + 1)) : undefined), [reg]);

  const all = reg ? reg.list() : [];
  const allIds = all.map((r) => r.id).join('\n');
  const load = (id: string, refresh: boolean) => {
    if (!reg) return;
    setMans((m) => ({ ...m, [id]: { manifest: m[id]?.manifest ?? null, loading: true, error: '', offline: false } }));
    (refresh ? reg.refresh(id) : reg.manifest(id)).then(
      (r) => setMans((m) => ({ ...m, [id]: { manifest: r.manifest, loading: false, error: '', offline: r.offline } })),
      (e) => setMans((m) => ({ ...m, [id]: { manifest: null, loading: false, error: errText(e), offline: false } })));
  };
  // the added libraries' lists are read (from the cache when there is one); the bundled samples come from the sample index
  useEffect(() => { for (const r of all) if (!mans[r.id] && (!r.builtin || p.onInsertPart)) load(r.id, false); }, [allIds]);

  const samplesOn = !reg || reg.enabled(SAMPLES_LIB_ID) || !reg.get(SAMPLES_LIB_ID);
  const samplesName = reg?.get(SAMPLES_LIB_ID)?.name ?? t('libraryPicker.samples');
  const addons = all.filter((r) => !r.builtin && reg!.enabled(r.id));
  // the bundled samples and the added libraries' parts as the same kind of entry the Catalog tab lists, so one filter covers both
  const sampleList = useMemo((): LibEntry[] => p.samples.map((s) => ({ key: entryKey(SAMPLES_LIB_ID, s.id), origin: 'included', libId: SAMPLES_LIB_ID, libName: samplesName, kind: 'part', id: s.id, title: s.title,
    category: s.category ?? 'other', group: mapCategory(s.category ?? 'other'), tags: s.tags ?? [], detail: s.detail })), [p.samples, samplesName]);
  const entries = [...(samplesOn ? sampleList : []), ...addons.flatMap((r) => (mans[r.id]?.manifest ? partEntries(r, mans[r.id].manifest!) : []))];
  const { category, tags } = sanitizeFilter(entries, { ...fil, source: 'all' });
  const setFilter = (c: string, tg: string[]) => { setFil({ category: c, tags: tg }); saveFilter('picker', { category: c, tags: tg }); };
  const list = filterEntries(entries, { q, source: 'all', category, tags });
  const filtering = q.trim() !== '' || category !== 'all' || tags.length > 0;
  const shown = list.filter((e) => e.libId === SAMPLES_LIB_ID);
  const groups = addons.map((r) => ({ rec: r, entries: list.filter((e) => e.libId === r.id) }));
  const wizards = p.onWizard && p.canInsert ? { screw: () => p.onWizard!('screw'), bearing: () => p.onWizard!('bearing') } : undefined;

  const open = async (rec: LibraryRecord, partId: string, licence: string | undefined, confirmed = false) => {
    if (!reg) return;
    setErr('');
    if (!confirmed && reg.needsConfirm(rec.id, licence, rec)) { setAsk({ lib: rec, part: partId, licence }); return; }
    try { const data = await reg.part(rec.id, partId); setAsk(null); p.onOpenPart?.(data, rec); } catch (e) { setErr(errText(e)); }
  };

  // Insert: the same placement as clicking the part in the Catalog's Libraries tab; a library whose licence is not confirmed yet asks first
  const insert = (e: LibEntry, confirmed = false) => {
    const rec = reg?.get(e.libId);
    if (!rec || !p.onInsertPart || !p.canInsert) return;
    setErr('');
    const licence = e.part ? effectiveLicence(mans[e.libId].manifest!, e.part) : undefined;
    if (!confirmed && reg!.needsConfirm(rec.id, licence, rec)) { setAsk({ lib: rec, part: e.id, licence, insert: e }); return; }
    setAsk(null); p.onInsertPart(e);
  };
  const entryOf = (libId: string, id: string): LibEntry | undefined => {
    const rec = reg?.get(libId), m = mans[libId]?.manifest;
    return rec && m ? partEntries(rec, m).find((e) => e.id === id) : undefined;
  };
  const insertBtn = (e: LibEntry | undefined) => (p.onInsertPart && e ? (
    <button class="dlg-insert" data-insert={e.id} disabled={!p.canInsert} title={p.canInsert ? t('libraryPicker.insert.tip') : t('libraryPicker.insert.needDoc')} onClick={() => insert(e)}>{t('libraryPicker.insert')}</button>
  ) : null);

  const infos: LibInfo[] = all.map((r) => ({ id: r.id, name: r.name, origin: r.builtin ? 'included' : 'addon', count: mans[r.id]?.manifest?.parts.length ?? (r.builtin ? p.samples.length : r.parts), licence: mans[r.id]?.manifest?.licence ?? r.licence, record: r, homepage: mans[r.id]?.manifest?.homepage ?? r.homepage, loading: mans[r.id]?.loading, error: mans[r.id]?.error, offline: mans[r.id]?.offline, enabled: reg!.enabled(r.id) }));

  const card = (e: LibEntry) => (
    <div key={e.key} class="dlg-card">
      <button class="dlg-item" data-lib={e.libId} data-part={e.id} title={e.title} onClick={() => void open(reg!.get(e.libId)!, e.id, effectiveLicence(mans[e.libId].manifest!, e.part!))}>
        <span class="dlg-thumb"><Thumb registry={reg!} entry={e} installed={false} /></span>
        <span>{e.title}</span>
      </button>
      {insertBtn(e)}
    </div>
  );

  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dlg" role="dialog" aria-label={t('libraryPicker.label')}>
        <div class="dlg-head">
          <b>{managing ? t('libraryPicker.manage') : t('libraryPicker.label')}</b>
          {reg ? <button class="rb-btn" data-testid="lib-manage-toggle" aria-pressed={managing} onClick={() => { setManaging(!managing); setAdding(false); }}>{managing ? t('libraryPicker.back') : t('libraryPicker.manage')}</button> : null}
          <button class="rb-btn" onClick={p.onClose}>{t('ui.close')}</button>
        </div>
        {managing && reg ? (
          <div class="dlg-body lib-manage-view" data-testid="lib-manage-view">
            <ul class="lib-manage-list">
              {infos.map((i) => <LibRow key={i.id} info={i} onToggle={() => reg.setEnabled(i.id, !reg.enabled(i.id))} onRefresh={() => load(i.id, true)} onRemove={() => { void reg.remove(i.id); setMans((m) => { const { [i.id]: _x, ...rest } = m; return rest; }); }} />)}
            </ul>
            <button class="lib-addbtn" onClick={() => setAdding(!adding)} aria-expanded={adding}>{t('library.add')}</button>
            {adding ? <AddLibrary registry={reg} onDone={() => setAdding(false)} /> : null}
          </div>
        ) : (<>
          <FilterBar entries={entries} q={q} onQ={setQ} category={category} tags={tags} onFilter={setFilter}
            placeholder={t('libraryPicker.filter')} autofocus wizards={wizards} />
          <div class="dlg-body">
            {p.recent && p.recent.length > 0 && !filtering ? (
              <div class="recent-block" aria-label={t('files.recent.title')}>
                <h4>{t('files.recent.title')}</h4>
                {p.recent.map((e) => (
                  <button key={`${e.kind}:${e.id}`} class="recent-row" onClick={() => p.onPickRecent?.(e)}>
                    <ThumbImg class="rthumb" name={e.name} src={e.kind === 'sample' ? `${p.thumbBase}samples/thumbs/${e.id}.webp` : p.recentThumbs?.[e.id]} />
                    <span class="rtxt">
                      <span class="rn">{e.name}</span>
                      <span class="rm"><span class="rk">{t(e.kind === 'sample' ? 'files.recent.sample' : 'files.recent.file')}</span> <span class="rt">{ago(e.at, Date.now(), t)}</span></span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {err ? <div class="lib-err" role="alert">{err}</div> : null}
            {ask ? (
              <div class="lib-warn" role="alertdialog" data-testid="lib-confirm">
                <div>{ask.licence ? t('library.licence.warn', { licence: ask.licence }) : t('library.licence.warnUnknown')}</div>
                <button onClick={() => { reg!.confirm(ask.lib.id, ask.licence); if (ask.insert) insert(ask.insert, true); else void open(ask.lib, ask.part, ask.licence, true); }}>{t('library.confirm')}</button>
                <button onClick={() => setAsk(null)}>{t('library.confirm.cancel')}</button>
              </div>
            ) : null}
            {samplesOn && (shown.length > 0 || !filtering) ? (
              <section class="dlg-group" data-lib={SAMPLES_LIB_ID} aria-label={samplesName}>
                {reg ? <h4>{samplesName}</h4> : null}
                <div class="dlg-list">
                  {shown.map((s) => (
                    <div key={s.id} class="dlg-card">
                      <button class="dlg-item" title={s.detail} onClick={() => p.onPick(p.samples.find((x) => x.id === s.id)!)}>
                        <ThumbImg name={s.title} src={`${p.thumbBase}samples/thumbs/${s.id}.webp`} />
                        <span>{s.title}</span>
                      </button>
                      {insertBtn(entryOf(SAMPLES_LIB_ID, s.id))}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {groups.map(({ rec, entries }) => (entries.length > 0 || (!filtering && mans[rec.id]?.loading) || (!filtering && mans[rec.id]?.error) ? (
              <section key={rec.id} class="dlg-group" data-lib={rec.id} aria-label={rec.name}>
                <h4>{rec.name}{mans[rec.id]?.offline ? <span class="lib-offline"> {t('library.offline')}</span> : null}</h4>
                {mans[rec.id]?.loading ? <div class="cat-sub" role="status">{t('library.loading')}</div> : null}
                {mans[rec.id]?.error ? <div class="lib-err" role="alert">{mans[rec.id].error}</div> : null}
                <div class="dlg-list">{entries.map(card)}</div>
              </section>
            ) : null))}
            {reg && !samplesOn && addons.length === 0 ? <div class="cat-sub dlg-empty">{t('libraryPicker.none')}</div> : null}
            {filtering && list.length === 0 ? <div class="cat-sub dlg-empty">{t('library.none')}</div> : null}
          </div>
        </>)}
      </div>
    </div>
  );
}

// The Frame panel: choose a skeleton sketch (its lines become members), a stock profile from the library, mitre or butt corners and
// the turn of the section. Every change goes to onDraft (the app previews the frame live); Create adds one `frame` feature (Update
// replaces it when the panel reopened one), Escape / the cross cancels. Rules and the cut list: frameLib.ts.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon, numberAttrs, textAttrs } from '@kit/ui';
import { t } from '../i18n';
import { clearStoredLibrary, exampleLibrary, importLibraryText, storedLibrary } from './frameUserLib';
import { CATALOGUE_REGIONS, FITTINGS, HW_PLACES, bom, defaultHardware, loadRegion, onRegionLoaded, profileById, profileGroups, profileMaterial, regionLoaded, regionOf, regionOfId, type Corner, type FrameParams, type FrameReport, type HwPlace, type Region } from './frameLib';

export interface FramePanelProps {
  params: FrameParams;
  /** the document's sketches that have lines */
  skeletons: Array<{ id: string; label: string; lines: string[] }>;
  onDraft(next: FrameParams): void;
  onApply(next: FrameParams): void;
  onCancel(): void;
  /** the live preview's failure, or null when it is current */
  hint?: string | null;
  /** the panel reopened an existing frame: Update replaces it */
  edit?: boolean;
  /** the kernel's report of the frame as drafted (joints, hardware placed); null until the first preview has come back */
  report?: FrameReport | null;
  /** the joint picked in the viewport or the list (`a/b`), its row is highlighted and scrolled to */
  focusJoint?: string | null;
  onFocusJoint?(key: string | null): void;
  /** the pointer is over a joint's row (null: left) */
  onHoverJoint?(key: string | null): void;
}

const sameJoint = (a: [string, string], b: [string, string]): boolean => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

export function FramePanel(p: FramePanelProps): JSX.Element {
  const [draft, setDraft] = useState<FrameParams>(() => (p.params.sketch || !p.skeletons.length ? p.params : { ...p.params, sketch: p.skeletons[p.skeletons.length - 1].id }));
  useEffect(() => { if (draft.sketch) p.onDraft(draft); }, []);
  const change = (patch: Partial<FrameParams>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (next.sketch) p.onDraft(next);
  };
  const sk = p.skeletons.find((s) => s.id === draft.sketch) ?? null;
  const blocked = !sk || !profileById(draft.profile);
  const apply = (): void => { if (!blocked) p.onApply(draft); };
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); apply(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };
  // the user's own stock and fittings: import a JSON file or pasted text, an example to start from, forget it again
  const [libMsg, setLibMsg] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [, bump] = useState(0);
  const [find, setFind] = useState('');
  const [paste, setPaste] = useState('');
  const libText = (text: string): void => {
    const r = importLibraryText(text);
    setLibMsg(r.ok ? { ok: true, lines: [t('frame.lib.ok', r.summary)] } : { ok: false, lines: [t('frame.lib.errors', { n: r.errors.length }), ...r.errors] });
    if (r.ok) { setPaste(''); bump((n) => n + 1); }
  };
  const libFile = async (e: Event): Promise<void> => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) libText(await f.text());
  };
  const libExample = (): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exampleLibrary(), null, 2) + '\n'], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'frame-library-example.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const stored = storedLibrary();
  const used = draft.segments ?? sk?.lines ?? [];
  const toggle = (id: string): void => {
    if (!sk) return;
    const set = new Set(used);
    if (set.has(id)) set.delete(id); else set.add(id);
    const list = sk.lines.filter((l) => set.has(l));
    change({ segments: list.length === sk.lines.length ? null : list });
  };
  const prof = profileById(draft.profile);
  // the regional stock is fetched when its region is picked (or when the frame being edited uses it), and listed once it is in
  const [region, setRegion] = useState<Region | 'generic' | 'all'>(() => regionOfId(p.params.profile) ?? 'generic');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const wanted: Region[] = region === 'all' ? CATALOGUE_REGIONS : region === 'generic' ? [] : [region];
  const loading = wanted.some((r) => !regionLoaded(r)) && !loadErr;
  useEffect(() => onRegionLoaded(() => bump((n) => n + 1)), []);
  useEffect(() => {
    setLoadErr(null);
    for (const r of wanted) if (!regionLoaded(r)) loadRegion(r).catch((e: unknown) => setLoadErr(String((e as Error)?.message ?? e)));
    const own = regionOfId(draft.profile);
    if (own && !regionLoaded(own)) loadRegion(own).catch(() => {});
  }, [region, tries]);
  const groups = profileGroups(find, draft.profile, region);
  const shown = find.trim() ? profileGroups(find, undefined, region).reduce((n, g) => n + g.profiles.length, 0) : 0;
  const groupLabel = (g: { region: string; standard: string; family: string }): string => [t('frame.region.' + g.region, undefined, g.region), g.standard, t('frame.family.' + g.family, undefined, g.family)].filter(Boolean).join(' / ');
  const setPlace = (place: HwPlace, id: string): void => change({ hardware: { ...draft.hardware, [place]: id || null } });
  const setJoint = (segments: [string, string], patch: { connector?: string; both?: boolean }): void => {
    const cur = draft.joints.find((j) => sameJoint(j.segments, segments));
    const next = { segments, connector: patch.connector ?? cur?.connector ?? 'default', both: patch.both ?? cur?.both ?? false };
    const rest = draft.joints.filter((j) => !sameJoint(j.segments, segments));
    change({ joints: next.connector === 'default' && !next.both ? rest : [...rest, { segments, connector: next.connector, ...(next.both ? { both: true } : {}) }] });
  };
  const focusRow = useRef<HTMLDivElement | null>(null);
  useEffect(() => { focusRow.current?.scrollIntoView?.({ block: 'nearest' }); }, [p.focusJoint]);
  const hw = p.report?.hardware;
  const rows = p.report ? bom([p.report]).filter((b) => b.kind === 'fitting') : [];
  const pieces = rows.reduce((n, b) => n + b.qty, 0);
  const hwBlock = (): JSX.Element | null => {
    const offered = HW_PLACES.filter((pl) => prof?.hardware?.[pl]?.length);
    if (!offered.length) return null;
    const label = (id: string): string => FITTINGS[id]?.label ?? id;
    return (
      <div class="frame-hw" data-testid="frame-hw">
        <div class="fedit-fld-label frame-hw-title">{t('frame.hw.title')}</div>
        {offered.map((pl) => (
          <label key={pl} class="fedit-fld" data-path={'hw-' + pl}>
            <span class="fedit-fld-label">{t('frame.hw.' + pl)}</span>
            <select value={draft.hardware[pl] ?? ''} aria-label={t('frame.hw.' + pl)} onChange={(e) => setPlace(pl, (e.currentTarget as HTMLSelectElement).value)}>
              <option value="">{t('frame.hw.none')}</option>
              {prof!.hardware![pl]!.map((id) => <option key={id} value={id}>{label(id)}</option>)}
            </select>
          </label>
        ))}
        {prof?.hardware?.joint?.length ? (
          <label class="frame-check" data-path="teeBoth"><input type="checkbox" checked={draft.teeBoth} onChange={(e) => change({ teeBoth: (e.currentTarget as HTMLInputElement).checked })} />{t('frame.hw.teeBoth')}</label>
        ) : null}
        {prof?.section.kind === 'rectTube' && prof.hardware?.joint?.some((id) => FITTINGS[id]?.part?.bolt) ? (
          <label class="frame-check" data-path="drill"><input type="checkbox" checked={draft.drill} onChange={(e) => change({ drill: (e.currentTarget as HTMLInputElement).checked })} />{t('frame.hw.drill')}</label>
        ) : null}
        {hw && hw.joints.length ? (
          <div class="frame-joints" data-testid="frame-joints">
            <div class="fedit-fld-label">{t('frame.hw.joints', { n: hw.joints.length })}</div>
            {hw.joints.map((j) => {
              const own = draft.joints.find((o) => sameJoint(o.segments, j.segments));
              const key = j.segments.join('/');
              const focus = p.focusJoint === key;
              return (
                <div key={key} class={'frame-joint' + (focus ? ' is-focus' : '')} data-joint={key} ref={focus ? focusRow : undefined} onClick={() => p.onFocusJoint?.(key)}
                  onPointerEnter={() => p.onHoverJoint?.(key)} onPointerLeave={() => p.onHoverJoint?.(null)}>
                  <span class="frame-joint-name" title={j.reason ? t('frame.hw.jointSkipped', { reason: j.reason }) : ''}>{t('frame.hw.jointRow', { a: j.segments[0], b: j.segments[1], angle: Math.round(j.angle * 10) / 10, corner: t('frame.corner.' + (j.corner === 'tee' ? 'tee' : j.corner === 'mitre' ? 'mitre.short' : 'butt.short')) })}</span>
                  <select value={own?.connector ?? 'default'} aria-label={`${j.segments[0]} / ${j.segments[1]}`} onChange={(e) => setJoint(j.segments, { connector: (e.currentTarget as HTMLSelectElement).value })}>
                    <option value="default">{t('frame.hw.default')}</option>
                    <option value="none">{t('frame.hw.none')}</option>
                    {(prof?.hardware?.joint ?? []).map((id) => <option key={id} value={id}>{label(id)}</option>)}
                  </select>
                  {j.corner === 'tee' ? <label class="frame-check"><input type="checkbox" checked={own?.both ?? draft.teeBoth} onChange={(e) => setJoint(j.segments, { both: (e.currentTarget as HTMLInputElement).checked })} />{t('frame.hw.bothSides')}</label> : null}
                  {j.reason ? <span class="frame-joint-why">{j.reason}</span> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div class="frame-bom" data-testid="frame-bom">
          <div class="fedit-fld-label">{t('frame.hw.bom', { n: pieces })}</div>
          {rows.length ? rows.map((b) => <div key={b.id} class="frame-bom-row"><span class="frame-bom-qty">{b.qty} x</span><span class="frame-bom-name">{b.label}</span></div>) : <div class="thread-hint">{t('frame.hw.bomEmpty')}</div>}
        </div>
      </div>
    );
  };
  return (
    <div class="fedit thread-editor prop-wizard frame-panel" tabIndex={0} onKeyDown={onKey} data-testid="frame-panel">
      <div class="fedit-head">
        <Icon name="add-frame" size={22} class="fedit-icon" />
        <div class="fedit-title">{t(p.edit ? 'frame.titleEdit' : 'frame.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        {!p.skeletons.length ? <div class="thread-fit bad" role="alert" data-testid="frame-no-skeleton">{t('frame.noSkeleton')}</div> : (
          <>
            <label class="fedit-fld" data-path="sketch">
              <span class="fedit-fld-label">{t('frame.skeleton')}</span>
              <select value={draft.sketch ?? ''} aria-label={t('frame.skeleton')} onChange={(e) => change({ sketch: (e.currentTarget as HTMLSelectElement).value, segments: null })}>
                {p.skeletons.map((s) => <option key={s.id} value={s.id}>{t('frame.skeletonOption', { name: s.label, n: s.lines.length })}</option>)}
              </select>
            </label>
            {sk && sk.lines.length > 1 ? (
              <div class="fedit-fld frame-segments" data-path="segments">
                <span class="fedit-fld-label">{t('frame.members', { n: used.length, of: sk.lines.length })}</span>
                <span class="frame-seg-list">
                  {sk.lines.map((l) => (
                    <label key={l} class="frame-seg"><input type="checkbox" checked={used.includes(l)} onChange={() => toggle(l)} aria-label={l} />{l}</label>
                  ))}
                </span>
              </div>
            ) : null}
            <label class="fedit-fld" data-path="profileFind">
              <span class="fedit-fld-label">{t('frame.profile.search')}</span>
              <input {...textAttrs} type="search" enterKeyHint="search" value={find} placeholder={t('frame.profile.searchHint')} aria-label={t('frame.profile.search')} data-testid="frame-profile-search"
                onInput={(e) => setFind((e.currentTarget as HTMLInputElement).value)} />
            </label>
            <label class="fedit-fld" data-path="region">
              <span class="fedit-fld-label">{t('frame.region')}</span>
              <select value={region} aria-label={t('frame.region')} data-testid="frame-region" onChange={(e) => setRegion((e.currentTarget as HTMLSelectElement).value as Region | 'generic' | 'all')}>
                {(['generic', ...CATALOGUE_REGIONS, 'all'] as const).map((r) => <option key={r} value={r}>{t('frame.region.' + r)}</option>)}
              </select>
            </label>
            {loading ? <div class="thread-hint" role="status" data-testid="frame-profile-loading">{t('frame.profile.loading', { region: region === 'all' ? t('frame.region.all') : t('frame.region.' + region) })}</div> : null}
            {loadErr ? <div class="fedit-hint" role="alert" data-testid="frame-profile-load-error">{t('frame.profile.loadFailed', { reason: loadErr })} <button type="button" class="fedit-card-btn" onClick={() => setTries((n) => n + 1)}>{t('frame.profile.retry')}</button></div> : null}
            <label class="fedit-fld" data-path="profile">
              <span class="fedit-fld-label">{t('frame.profile')}</span>
              <select value={draft.profile} aria-label={t('frame.profile')} onChange={(e) => {
                const id = (e.currentTarget as HTMLSelectElement).value;
                change({ profile: id, corner: profileById(id)?.corner ?? draft.corner, hardware: defaultHardware(id), joints: [] });
              }}>
                {groups.map((g) => (
                  <optgroup key={g.key} label={groupLabel(g)}>
                    {g.profiles.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            {find.trim() ? <div class="thread-hint" data-testid="frame-profile-count">{shown ? t('frame.profile.count', { n: shown }) : t('frame.profile.none')}</div> : null}
            {prof && (prof.standard || prof.mass_per_m_kg) ? (
              <div class="thread-hint frame-profile-info" data-testid="frame-profile-info" title={prof.source ? `${prof.source.document}${prof.source.table ? ', ' + prof.source.table : ''}` : undefined}>
                {[t('frame.region.' + regionOf(prof), undefined, regionOf(prof)), [prof.standard, prof.grade].filter(Boolean).join(' '), prof.mass_per_m_kg ? t('frame.profile.massPerM', { kg: prof.mass_per_m_kg }) : '', prof.source ? t(prof.source.verified ? 'frame.profile.checked' : 'frame.profile.unchecked') : ''].filter(Boolean).join(' · ')}
                {prof.source && !prof.source.verified ? <> <span class="frame-badge" data-testid="frame-profile-unverified" title={t('frame.profile.unverified.tip')}>{t('material.unverified')}</span></> : null}
                {profileMaterial(prof) ? <div data-testid="frame-profile-material">{t('frame.profile.material', { name: profileMaterial(prof)!.name })}{prof.material_default ? ` (${t('frame.profile.materialDefault')})` : ''}
                  {profileMaterial(prof)!.verified === false ? <> <span class="frame-badge" data-testid="frame-material-unverified" title={t('material.unverified.tip')}>{t('material.unverified')}</span></> : null}</div> : null}
                {prof.check_availability ? <div data-testid="frame-profile-availability">{t('frame.profile.availability')}</div> : null}
              </div>
            ) : null}
            <label class="fedit-fld" data-path="corner">
              <span class="fedit-fld-label">{t('frame.corner')}</span>
              <select value={draft.corner} aria-label={t('frame.corner')} onChange={(e) => change({ corner: (e.currentTarget as HTMLSelectElement).value as Corner })}>
                <option value="mitre">{t('frame.corner.mitre')}</option>
                <option value="butt">{t('frame.corner.butt')}</option>
              </select>
            </label>
            <label class="fedit-fld" data-path="rotate">
              <span class="fedit-fld-label">{t('frame.rotate')}</span>
              <span class="fedit-num">
                <input {...numberAttrs('signed')} type="number" step={15} value={String(draft.rotate)} aria-label={t('frame.rotate')}
                  onChange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(v)) change({ rotate: v }); }} />
                <span class="fedit-unit">deg</span>
              </span>
            </label>
            <div class="thread-hint" data-testid="frame-note">{t('frame.note')}</div>
            {hwBlock()}
            {p.hint ? <div class="fedit-hint" role="alert" data-testid="frame-hint">{p.hint}</div> : null}
          </>
        )}
      </div>
      <details class="frame-lib" data-testid="frame-lib">
        <summary>{t('frame.lib.title')}</summary>
        <div class="thread-hint">{t('frame.lib.note')}</div>
        <div class="frame-lib-actions">
          <label class="fedit-card-btn frame-lib-file">{t('frame.lib.import')}<input type="file" accept=".json,application/json" data-testid="frame-lib-file" onChange={libFile} /></label>
          <button type="button" class="fedit-card-btn" onClick={libExample}>{t('frame.lib.example')}</button>
          {(stored.profiles?.length || Object.keys(stored.fittings ?? {}).length) ? <button type="button" class="fedit-card-btn" data-testid="frame-lib-clear" onClick={() => { clearStoredLibrary(); setLibMsg({ ok: true, lines: [t('frame.lib.cleared')] }); bump((n) => n + 1); }}>{t('frame.lib.clear')}</button> : null}
        </div>
        <textarea class="frame-lib-paste" rows={4} value={paste} placeholder={t('frame.lib.paste')} aria-label={t('frame.lib.paste')} data-testid="frame-lib-paste" onInput={(e) => setPaste((e.currentTarget as HTMLTextAreaElement).value)} />
        <button type="button" class="fedit-card-btn" data-testid="frame-lib-apply" disabled={!paste.trim()} onClick={() => libText(paste)}>{t('frame.lib.apply')}</button>
        {stored.profiles?.length || Object.keys(stored.fittings ?? {}).length ? <div class="thread-hint">{t('frame.lib.stored', { profiles: stored.profiles?.length ?? 0, fittings: Object.keys(stored.fittings ?? {}).length })}</div> : null}
        {libMsg ? <div class={libMsg.ok ? 'thread-hint frame-lib-ok' : 'fedit-hint frame-lib-err'} role={libMsg.ok ? 'status' : 'alert'} data-testid="frame-lib-msg">{libMsg.lines.map((l, i) => <div key={i}>{l}</div>)}</div> : null}
      </details>
      <div class="prop-nav">
        <button type="button" class="fedit-card-btn" data-testid="frame-cancel" onClick={p.onCancel}>{t('ui.cancel', undefined, 'Cancel')}</button>
        <button type="button" class="fedit-card-btn prop-create" data-testid="frame-apply" disabled={blocked} aria-disabled={blocked} onClick={apply}>{t(p.edit ? 'frame.update' : 'frame.apply')}</button>
      </div>
    </div>
  );
}

// The Thread editor: the face as a chip, Standard, Size (quick chips and a searchable list, the sizes nearest to the
// face first), the fit line, the numbers that matter for a shaft or a hole, Class, Length (Full | Custom), Hand, Start
// (only when it matters) and the "model the thread" option with its cost. Same draft protocol as HoleEditor / FeatureEditor:
// every change goes to onDraft with the whole draft (null = remove the field), Enter / the tick confirm, Escape / the
// cross cancel. The tables come in through props (the controller caches the kernel's threadData); the amber line is the
// kernel's (threadDiameterMismatch with a one-click "Use M8", threadModelFallback).
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from '@kit/ui';
import type { FeatureWarning } from '@kit/store';
import { t } from './i18n';
import {
  NEAREST_MARKED, THREAD_HANDS, THREAD_STARTS, classOptions, clampLength, customLengthDefault, filterSizes, fitStatus, loadThreadPrefs, modelFallbackReason,
  groupChip, groupMisfits, nearestSizes, patchSize, patchStandard, quickSizes, suggestedSize, readoutRows, rememberSize, saveThreadPrefs, sizeLabel, startMatters,
  type FaceExtent, type ThreadRow, type ThreadStd,
} from './threadData';

type Wire = Record<string, unknown>;

export interface ThreadEditorProps {
  feature: Wire | null;
  onDraft(next: Wire): void;
  onConfirm(next: Wire): void;
  onCancel(): void;
  hint?: string | null;
  /** The thread standards (kernel threadData, cached by the controller). */
  loadStandards(): Promise<ThreadStd[]>;
  /** The sizes of a standard. */
  loadSizes(standard: string): Promise<ThreadRow[]>;
  /** Actual diameter of the face in mm (from its circular edges); null when unknown. */
  faceDiameter?: number | null;
  /** Internal (hole) / external (shaft), when known: from the kernel's threads entry or the hole-wall name. */
  internal?: boolean;
  /** The regen warnings of this feature (store.featureWarnings). */
  warning?: FeatureWarning | null;
  /** The face's length along its axis and which ends are open (from the view); the Length field is held to it, Start shows only when it matters. */
  extent?: FaceExtent | null;
  /** `modeled` of the kernel's thread entry for this feature (undefined: no entry yet). With `modeled` asked for and false here, the kernel kept it cosmetic. */
  entryModeled?: boolean;
  /** Milliseconds the last modeled-thread regeneration took (remembered by the controller), for the cost note. */
  modeledMs?: number | null;
  /** Several threads edited together (one Shift+T on several faces): each one's feature id, face, diameter and kind. The draft goes to all of them. */
  group?: Array<{ id: string; face: string; dia: number | null; internal?: boolean }>;
  /** The regen warnings by feature id (store.featureWarnings): the group's fit line reads every face's threadDiameterMismatch. */
  warnings?: Record<string, FeatureWarning | undefined>;
  /** A value from outside the form (the length handle on the part): applied to the draft each time `seq` changes. */
  inject?: { seq: number; patch: Wire } | null;
}

function Section(p: { id: string; title: string; children: ComponentChildren }): JSX.Element {
  const [closed, setClosed] = useState(false);
  const toggle = (): void => setClosed(!closed);
  return (
    <div class={'fedit-sec' + (closed ? ' closed' : '')} data-section={p.id}>
      <div class="fedit-sec-head" role="button" tabIndex={0} aria-expanded={!closed} onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); } }}>
        <span class="fedit-sec-title">{p.title}</span>
        <Icon name="chevron" size={14} class="fedit-chev" />
      </div>
      {closed ? null : <div class="fedit-sec-fields">{p.children}</div>}
    </div>
  );
}

export function Select(p: { name: string; label: string; value: string; onChange(v: string): void; children: ComponentChildren }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <select value={p.value} onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value)}>{p.children}</select>
    </label>
  );
}

/** A segmented control (radio group): arrow keys move the choice, Tab leaves the group. */
export function Seg<V extends string>(p: { name: string; label: string; value: V; options: Array<{ value: V; text: string; icon?: string; tip?: string }>; onChange(v: V): void }): JSX.Element {
  const move = (e: KeyboardEvent, i: number): void => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = p.options[(i + d + p.options.length) % p.options.length];
    p.onChange(next.value);
    ((e.currentTarget as HTMLElement).parentElement?.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label" id={`thread-${p.name}-label`}>{p.label}</span>
      <div class="thread-seg" role="radiogroup" aria-labelledby={`thread-${p.name}-label`}>
        {p.options.map((o, i) => (
          <button key={o.value} type="button" role="radio" aria-checked={p.value === o.value} data-value={o.value} title={o.tip ?? o.text}
            tabIndex={p.value === o.value ? 0 : -1} class={p.value === o.value ? 'on' : ''} onClick={() => p.onChange(o.value)} onKeyDown={(e) => move(e, i)}>
            {o.icon ? <Icon name={o.icon} size={16} /> : null}<span>{o.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type Item = { head: string } | { row: ThreadRow };
/** The size field: a combobox with a listbox. Type to filter (name or diameter), Up / Down move, Enter picks, Esc closes the list. */
export function SizePicker(p: { rows: ThreadRow[]; value: string; dia: number | null; internal?: boolean; standard: string; onPick(size: string): void }): JSX.Element {
  const [q, setQ] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const query = q ?? '';
  const matches = filterSizes(p.rows, query, p.dia, p.internal);
  const items: Item[] = [];
  if (!query.trim()) {
    const near = p.dia !== null ? nearestSizes(p.rows, p.dia, p.internal).slice(0, NEAREST_MARKED) : [];
    const nearSet = new Set(near.map((r) => r.size));
    if (near.length) { items.push({ head: t('thread.size.nearest', { d: fmt(p.dia!) }) }); for (const r of near) items.push({ row: r }); }
    const rest = matches.filter((r) => !nearSet.has(r.size));
    if (rest.length) { items.push({ head: t(p.standard === 'metric' ? 'thread.size.coarse' : p.standard === 'metric-fine' ? 'thread.size.fine' : 'thread.size.all') }); for (const r of rest) items.push({ row: r }); }
  } else for (const r of matches) items.push({ row: r });
  const opts = items.filter((x): x is { row: ThreadRow } => 'row' in x);
  const cur = Math.min(act, Math.max(0, opts.length - 1));
  useEffect(() => { (listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' }); }, [cur, open]);
  const pick = (r: ThreadRow): void => { setOpen(false); setQ(null); p.onPick(r.size); };
  const current = p.rows.find((r) => r.size === p.value);
  const shown = q ?? (current ? sizeLabel(current) : p.value);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (!open) { setOpen(true); setAct(0); return; }
      setAct((cur + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % Math.max(1, opts.length));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault(); e.stopPropagation();
      if (opts[cur]) pick(opts[cur].row);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault(); e.stopPropagation();
      setOpen(false); setQ(null);
    }
  };
  let oi = -1;
  return (
    <div class="fedit-fld" data-path="size">
      <label class="fedit-fld-label" for="thread-size-input">{t('thread.size')}</label>
      <div class="thread-combo">
        <input id="thread-size-input" type="text" role="combobox" aria-expanded={open} aria-controls="thread-size-list" aria-autocomplete="list" autocomplete="off"
          aria-activedescendant={open && opts.length ? `thread-size-opt-${cur}` : undefined} aria-label={t('thread.size')} title={t('thread.sizeSearch')}
          value={shown} spellcheck={false}
          onFocus={(e) => { (e.currentTarget as HTMLInputElement).select(); setOpen(true); setAct(0); }}
          onBlur={() => { setOpen(false); setQ(null); }}
          onInput={(e) => { setQ((e.currentTarget as HTMLInputElement).value); setOpen(true); setAct(0); }}
          onKeyDown={onKey} />
        {open ? (
          <ul id="thread-size-list" role="listbox" class="thread-list" ref={listRef} aria-label={t('thread.size')}>
            {opts.length === 0 ? <li class="thread-list-empty" role="presentation">{t('thread.size.none')}</li> : null}
            {items.map((it, i) => {
              if ('head' in it) return <li key={'h' + i} role="presentation" class="thread-list-head">{it.head}</li>;
              oi++;
              const k = oi;
              return (
                <li key={it.row.size} id={`thread-size-opt-${k}`} role="option" aria-selected={it.row.size === p.value} data-active={k === cur} data-size={it.row.size}
                  class={(k === cur ? 'active ' : '') + (it.row.size === p.value ? 'sel' : '')}
                  onMouseDown={(e) => { e.preventDefault(); pick(it.row); }} onMouseEnter={() => setAct(k)}>{sizeLabel(it.row)}</li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
export const stdLabel = (s: ThreadStd): string => t('thread.std.' + s.id, undefined, s.description);

export function ThreadEditor(p: ThreadEditorProps): JSX.Element {
  const [draft, setDraft] = useState<Wire>({});
  const [stds, setStds] = useState<ThreadStd[]>([]);
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const lastCustom = useRef<number | null>(null);
  const f = p.feature;
  const eff: Wire = { ...(f ?? {}), ...draft };
  for (const k of Object.keys(eff)) if (eff[k] === null) delete eff[k];
  const standard = String(eff.standard ?? 'metric');

  useEffect(() => { let on = true; void p.loadStandards().then((s) => { if (on) setStds(s); }).catch(() => {}); return () => { on = false; }; }, []);
  // the editor takes the keyboard when it opens (Enter confirms, Esc cancels without a click first)
  useEffect(() => { if (root.current && !root.current.contains(document.activeElement)) root.current.focus({ preventScroll: true }); }, []);
  const prevMajor = useRef<number | null>(null);
  useEffect(() => {
    let on = true;
    void p.loadSizes(standard).then((r) => {
      if (!on) return;
      setRows(r);
      // the standard was changed in this editor and the old size does not exist in it: pick the nearest size of the new one
      if (draft.standard !== undefined && r.length && !r.some((x) => x.size === String(eff.size ?? ''))) changeRef.current(patchStandard(standard, r, p.faceDiameter ?? prevMajor.current, p.internal));
    }).catch(() => { if (on) setRows([]); });
    return () => { on = false; };
  }, [standard]);
  const seen = useRef(p.inject?.seq ?? 0);
  useEffect(() => {
    if (p.inject && p.inject.seq !== seen.current) { seen.current = p.inject.seq; changeRef.current(p.inject.patch); }
  }, [p.inject?.seq]);

  const changeRef = useRef<(patch: Wire) => void>(() => {});
  if (!f) return <div class="fedit empty"><div class="fedit-hint">{t('ui.editor.empty', undefined, 'No feature selected.')}</div></div>;

  const change = (patch: Wire): void => {
    const real = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== null || eff[k] !== undefined));
    const next = { ...draft, ...real };
    setDraft(next);
    p.onDraft(next);
  };
  changeRef.current = change;
  const confirm = (): void => p.onConfirm(draft);
  const onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };

  const dia = p.faceDiameter ?? null;
  const size = String(eff.size ?? '');
  const row = rows.find((r) => r.size === size);
  const pickSize = (v: string): void => { rememberSize(standard, v); change(patchSize(rows.find((r) => r.size === v), v, p.internal)); };

  const maxLen = p.extent?.length ?? null;
  const lengthFull = eff.length === undefined || eff.length === 'full';
  const warns = (p.warning ? (p.warning.all ?? [p.warning]) : []).filter((w) => w.code !== 'threadDiameterMismatch' && w.code !== 'threadModelFallback');
  const fit = fitStatus(dia, p.internal, row, p.warning);
  const title = t('feature.thread') + (f.name ? ` — ${String(f.name)}` : '');
  const startValue = (THREAD_STARTS as readonly string[]).includes(String(eff.start)) ? String(eff.start) : 'open';
  const showStart = startMatters(p.extent ?? null) || startValue !== 'open';
  const grp = p.group && p.group.length > 1 ? p.group : null;
  const grpCyls = grp && grp.every((g) => g.dia !== null) ? grp.map((g) => ({ face: g.face, cyl: { radius: g.dia! / 2, axisPoint: [], axisDir: [], internal: g.internal } })) : null;
  const misfits = grp ? groupMisfits(grp, p.warnings ?? {}) : [];
  const faceName = grp ? grp.map((g) => g.face).join(', ') : String(eff.face ?? '');
  const gc = grpCyls ? groupChip(grpCyls) : null;
  const faceText = grp
    ? (gc ? t('thread.face.many.' + gc.key, { n: gc.n, d: gc.d }) : t('thread.face.many.faces', { n: grp.length, d: '?' }))
    : dia === null ? t('thread.face.plain') : t(p.internal === undefined ? 'thread.face.unknown' : p.internal ? 'thread.face.hole' : 'thread.face.shaft', { d: fmt(dia) });
  const last = loadThreadPrefs().lastSize?.[standard] ?? null;
  const chips = quickSizes(standard, rows, last);
  const modeled = Boolean(eff.modeled);
  const notBuilt = modelFallbackReason(modeled, p.entryModeled, p.warning);
  const sec = p.modeledMs ? Math.max(1, Math.round(p.modeledMs / 1000)) : null;

  return (
    <div class="fedit thread-editor" ref={root} data-feature={String(f.id ?? '')} tabIndex={0} onKeyDown={onKey}>
      <div class="fedit-head">
        <Icon name="add-thread" size={22} class="fedit-icon" />
        <div class="fedit-title">{title}</div>
        <button type="button" class="fedit-confirm" onClick={confirm} title={t('ui.editor.confirm', undefined, 'Confirm')} aria-label={t('ui.editor.confirm', undefined, 'Confirm')}><Icon name="check" size={20} /></button>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>

      <Section id="thread" title={t('thread.section.thread')}>
        <div class="fedit-fld" data-path="face">
          <span class="fedit-fld-label">{t('thread.face')}</span>
          <span class="thread-chip" data-testid="thread-face" title={faceName}>
            <span>{faceText}</span><span class="thread-chip-name">{grp ? `${grp[0].face} +${grp.length - 1}` : faceName}</span>
          </span>
        </div>
        <Select name="standard" label={t('thread.standard')} value={standard} onChange={(v) => { prevMajor.current = row?.major ?? null; change({ standard: v }); }}>
          {(stds.length ? stds : [{ id: standard, description: standard, count: 0 }]).map((s) => <option key={s.id} value={s.id}>{stdLabel(s)}</option>)}
        </Select>
        {chips.length ? (
          <div class="thread-chips" role="group" aria-label={t('thread.sizeQuick')} data-testid="thread-chips">
            {chips.map((c) => <button key={c} type="button" class={'thread-chipbtn' + (c === size ? ' on' : '')} aria-pressed={c === size} data-size={c} onClick={() => pickSize(c)}>{c}</button>)}
          </div>
        ) : null}
        <SizePicker rows={rows} value={size} dia={dia} internal={p.internal} standard={standard} onPick={pickSize} />
        {grp ? (
          misfits.length === 0
            ? (row && grp.every((g) => g.internal !== undefined && g.dia !== null)
              ? <div class="thread-fit ok" role="status" data-testid="thread-fit">{t(grp.every((g) => g.internal) ? 'thread.fit.group.hole' : 'thread.fit.group.shaft', { n: grp.length, size: row.size })}</div> : null)
            : (
              <div class="thread-fit warn" role="status" data-testid="thread-fit" data-warning="threadDiameterMismatch">
                <span>{t('thread.fit.group.bad', { k: misfits.length, n: grp.length, size, faces: misfits.join(', ') })}</span>
                {(() => { const w = grp.map((g) => p.warnings?.[g.id]).find((x) => x && (x.all ?? [x]).some((y) => y.code === 'threadDiameterMismatch')); const s2 = w ? suggestedSize((w.all ?? [w]).find((y) => y.code === 'threadDiameterMismatch')?.params) : null; return s2 && s2 !== size ? <button type="button" data-testid="thread-use" onClick={() => pickSize(s2)}>{t('thread.use', { size: s2 })}</button> : null; })()}
              </div>
            )
        ) : fit ? (
          fit.ok
            ? <div class="thread-fit ok" role="status" data-testid="thread-fit">{t(fit.kind === 'hole' ? 'thread.fit.hole' : 'thread.fit.shaft', { face: fmt(fit.face), size: fit.size })}</div>
            : (
              <div class="thread-fit warn" role="status" data-testid="thread-fit" data-warning="threadDiameterMismatch">
                <span>{fit.hint}</span>
                {fit.suggest && fit.suggest !== size ? <button type="button" data-testid="thread-use" onClick={() => pickSize(fit.suggest!)}>{t('thread.use', { size: fit.suggest })}</button> : null}
              </div>
            )
        ) : null}
        {row ? (
          <dl class="thread-readout" data-testid="thread-readout">
            {readoutRows(row, p.internal).map((r) => <Fragment key={r.key}><dt>{t(r.key === 'root' ? 'thread.root' : r.key === 'minor' && p.internal ? 'thread.minorD1' : 'thread.' + r.key)}</dt><dd data-k={r.key}>{r.value}</dd></Fragment>)}
          </dl>
        ) : <div class="thread-hint" data-testid="thread-readout">{rows.length ? t('thread.readout.none') : ''}</div>}
        <label class="fedit-fld" data-path="class">
          <span class="fedit-fld-label">{t('thread.class')}</span>
          <select value={String(eff.class ?? '')} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; change({ class: v === '' ? null : v }); }}>
            <option value="">-</option>
            {classOptions(row, eff.class === undefined ? undefined : String(eff.class), p.internal).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div class="thread-hint" data-testid="thread-class-note">{t('thread.class.note')}</div>
      </Section>

      <Section id="length" title={t('thread.section.length')}>
        <Seg name="lengthMode" label={t('thread.length')} value={lengthFull ? 'full' : 'custom'}
          options={[{ value: 'full', text: t('thread.length.full') }, { value: 'custom', text: t('thread.length.custom') }]}
          onChange={(v) => {
            if (v === 'full') { if (typeof eff.length === 'number') lastCustom.current = eff.length; change({ length: 'full' }); }
            else change({ length: lastCustom.current ?? customLengthDefault(row?.pitch, maxLen) });
          }} />
        {lengthFull && maxLen === null ? null : <label class="fedit-fld" data-path="length">
          <span class="fedit-fld-label" />
          <span class="fedit-num">
            <input type="number" step="any" min={row ? String(row.pitch) : '0'} max={maxLen !== null ? String(maxLen) : undefined} disabled={lengthFull} aria-label={t('thread.length')}
              title={maxLen !== null ? t('thread.length.max', { v: fmt(maxLen) }) : undefined}
              value={lengthFull ? (maxLen !== null ? fmt(maxLen) : '') : String(eff.length ?? '')}
              onChange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if ((e.currentTarget as HTMLInputElement).value.trim() !== '' && Number.isFinite(v) && v > 0) change({ length: clampLength(v, maxLen, row?.pitch) }); }} />
            <span class="fedit-unit">mm</span>
          </span>
        </label>}
        <Seg name="hand" label={t('thread.hand')} value={eff.hand === 'left' ? 'left' : 'right'}
          options={THREAD_HANDS.map((h) => ({ value: h, text: t('thread.hand.' + h), icon: h === 'left' ? 'helix-left' : 'helix-right', tip: t('thread.hand.' + h + 'Tip') }))}
          onChange={(v) => change({ hand: v })} />
        {showStart ? (
          <Seg name="start" label={t('thread.start')} value={startValue as 'open' | 'top' | 'bottom'}
            options={THREAD_STARTS.map((s) => ({ value: s, text: t('thread.start.' + s), icon: s === 'open' ? 'end-open' : s === 'top' ? 'arrow-up' : 'arrow-down', tip: t('thread.start.' + s + 'Tip') }))}
            onChange={(v) => change({ start: v === 'open' ? null : v })} />
        ) : null}
      </Section>

      <Section id="options" title={t('thread.section.options')}>
        <label class="fedit-fld bool" data-path="modeled">
          <input type="checkbox" checked={modeled} onChange={(e) => { const on = (e.currentTarget as HTMLInputElement).checked; saveThreadPrefs({ modeled: on }); change({ modeled: on }); }} />
          <span class="fedit-fld-label">{t('thread.modeled')}</span>
        </label>
        {modeled ? <div class="thread-hint" data-testid="thread-cost">{sec ? t('thread.modeled.cost', { n: sec }) : t('thread.modeled.costUnknown')}</div> : null}
        {modeled && p.entryModeled === false && f.modeled === true
          ? <div class="thread-fit warn" role="status" data-testid="thread-notbuilt" data-warning="threadModelFallback">{notBuilt ? t('thread.modeled.notBuilt', { reason: notBuilt }) : t('thread.modeled.notBuiltUnknown')}</div> : null}
      </Section>

      {warns.map((w, i) => <div key={i} class="fedit-warn" role="status" data-warning={w.code}>{w.hint}</div>)}
      {p.hint ? <div class="fedit-hint" role="alert">{p.hint}</div> : null}
    </div>
  );
}

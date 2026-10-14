// The Thread editor: Standard, Size (the sizes nearest to the face first, marked), the numbers of the size, Class,
// Length, Hand, Start and the "model the thread" option. Same draft protocol as HoleEditor / FeatureEditor: every change
// goes to onDraft with the whole draft (null = remove the field), Enter / the tick confirm, Escape / the cross cancel.
// The tables come in through props (the controller caches the kernel's threadData), the amber warning is the kernel's
// (threadDiameterMismatch with a one-click "Use M8", threadModelFallback).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from '@kit/ui';
import type { FeatureWarning } from '@kit/store';
import { t } from './i18n';
import {
  NEAREST_MARKED, THREAD_HANDS, THREAD_STARTS, nearestSizes, patchLength, patchSize, patchStandard, suggestedSize,
  type ThreadRow, type ThreadStd,
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
}

function Section(p: { id: string; title: string; children: ComponentChildren }): JSX.Element {
  const [closed, setClosed] = useState(false);
  return (
    <div class={'fedit-sec' + (closed ? ' closed' : '')} data-section={p.id}>
      <div class="fedit-sec-head" onClick={() => setClosed(!closed)}>
        <span class="fedit-sec-title">{p.title}</span>
        <Icon name="chevron" size={14} class="fedit-chev" />
      </div>
      {closed ? null : <div class="fedit-sec-fields">{p.children}</div>}
    </div>
  );
}

function Select(p: { name: string; label: string; value: string; onChange(v: string): void; children: ComponentChildren }): JSX.Element {
  return (
    <label class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <select value={p.value} onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value)}>{p.children}</select>
    </label>
  );
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
export const stdLabel = (s: ThreadStd): string => t('thread.std.' + s.id, undefined, s.description);

export function ThreadEditor(p: ThreadEditorProps): JSX.Element {
  const [draft, setDraft] = useState<Wire>({});
  const [stds, setStds] = useState<ThreadStd[]>([]);
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const f = p.feature;
  const eff: Wire = { ...(f ?? {}), ...draft };
  for (const k of Object.keys(eff)) if (eff[k] === null) delete eff[k];
  const standard = String(eff.standard ?? 'metric');

  useEffect(() => { let on = true; void p.loadStandards().then((s) => { if (on) setStds(s); }).catch(() => {}); return () => { on = false; }; }, []);
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
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'SELECT') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); p.onCancel(); }
  };

  const dia = p.faceDiameter ?? null;
  const size = String(eff.size ?? '');
  const row = rows.find((r) => r.size === size);
  const near = dia !== null ? nearestSizes(rows, dia, p.internal).slice(0, NEAREST_MARKED) : [];
  const nearSet = new Set(near.map((r) => r.size));
  const sizeOpts: JSX.Element[] = [];
  if (near.length) sizeOpts.push(<optgroup key="near" label={t('thread.size.nearest', { d: fmt(dia!) })}>{near.map((r) => <option key={r.size} value={r.size}>{t('thread.size.marked', { size: r.size })}</option>)}</optgroup>);
  const rest = rows.filter((r) => !nearSet.has(r.size));
  sizeOpts.push(<optgroup key="all" label={t('thread.size.all')}>{rest.map((r) => <option key={r.size} value={r.size}>{r.size}</option>)}</optgroup>);
  if (size && !rows.some((r) => r.size === size)) sizeOpts.unshift(<option key="cur" value={size}>{size}</option>);   // keep an unknown size visible (the kernel reports it)

  const lengthFull = eff.length === undefined || eff.length === 'full';
  const warns = p.warning ? (p.warning.all ?? [p.warning]) : [];
  const title = t('feature.thread') + (f.name ? ` — ${String(f.name)}` : '');
  const startValue = (THREAD_STARTS as readonly string[]).includes(String(eff.start)) ? String(eff.start) : 'open';

  return (
    <div class="fedit thread-editor" data-feature={String(f.id ?? '')} tabIndex={0} onKeyDown={onKey}>
      <div class="fedit-head">
        <Icon name="add-thread" size={22} class="fedit-icon" />
        <div class="fedit-title">{title}</div>
        <button type="button" class="fedit-confirm" onClick={confirm} title={t('ui.editor.confirm', undefined, 'Confirm')} aria-label={t('ui.editor.confirm', undefined, 'Confirm')}><Icon name="check" size={20} /></button>
        <button type="button" class="fedit-cancel" onClick={p.onCancel} title={t('ui.cancel', undefined, 'Cancel')} aria-label={t('ui.cancel', undefined, 'Cancel')}><Icon name="close" size={20} /></button>
      </div>

      <Section id="thread" title={t('thread.section.thread')}>
        <div class="fedit-fld" data-path="face">
          <span class="fedit-fld-label">{t('thread.face')}</span>
          <span class="thread-face" data-testid="thread-face">
            {String(eff.face ?? '')}{dia !== null ? ' · ' + t('thread.faceDia', { d: fmt(dia) }) : ''}{p.internal === undefined ? '' : ' · ' + t(p.internal ? 'thread.internal' : 'thread.external')}
          </span>
        </div>
        <Select name="standard" label={t('thread.standard')} value={standard} onChange={(v) => { prevMajor.current = row?.major ?? null; change({ standard: v }); }}>
          {(stds.length ? stds : [{ id: standard, description: standard, count: 0 }]).map((s) => <option key={s.id} value={s.id}>{stdLabel(s)}</option>)}
        </Select>
        <Select name="size" label={t('thread.size')} value={size} onChange={(v) => change(patchSize(rows.find((r) => r.size === v), v, p.internal))}>{sizeOpts}</Select>
        {row ? (
          <dl class="thread-readout" data-testid="thread-readout">
            <dt>{t('thread.pitch')}</dt><dd data-k="pitch">{fmt(row.pitch)} mm</dd>
            <dt>{t('thread.major')}</dt><dd data-k="major">{fmt(row.major)} mm</dd>
            <dt>{t('thread.minor')}</dt><dd data-k="minor">{fmt(p.internal === false ? row.minorExternal : row.minorInternal)} mm</dd>
            <dt>{t('thread.tapDrill')}</dt><dd data-k="tapDrill">{fmt(row.tapDrill)} mm{row.tapDrillName ? ` (${row.tapDrillName})` : ''}</dd>
          </dl>
        ) : <div class="fedit-hint" data-testid="thread-readout">{rows.length ? t('thread.readout.none') : ''}</div>}
        <label class="fedit-fld" data-path="class">
          <span class="fedit-fld-label">{t('thread.class')}</span>
          <input type="text" list="thread-classes" value={String(eff.class ?? '')} onChange={(e) => { const v = (e.currentTarget as HTMLInputElement).value.trim(); change({ class: v === '' ? null : v }); }} />
          <datalist id="thread-classes">{[...new Set(row ? [row.classInternal, row.classExternal] : [])].map((c) => <option key={c} value={c} />)}</datalist>
        </label>
      </Section>

      <Section id="length" title={t('thread.section.length')}>
        <div class="fedit-fld" data-path="length">
          <span class="fedit-fld-label">{t('thread.length')}</span>
          <span class="fedit-num">
            <label class="thread-full"><input type="checkbox" checked={lengthFull} onChange={(e) => change((e.currentTarget as HTMLInputElement).checked ? { length: 'full' } : { length: Math.max(1, Math.round((row?.pitch ?? 1) * 8 * 10) / 10) })} /> {t('thread.length.full')}</label>
            {lengthFull ? null : (
              <>
                <input type="number" min="0" value={String(eff.length ?? '')} onChange={(e) => { const patch = patchLength((e.currentTarget as HTMLInputElement).value); if (patch) change(patch); }} />
                <span class="fedit-unit">mm</span>
              </>
            )}
          </span>
        </div>
        <Select name="hand" label={t('thread.hand')} value={eff.hand === 'left' ? 'left' : 'right'} onChange={(v) => change({ hand: v })}>
          {THREAD_HANDS.map((h) => <option key={h} value={h}>{t('thread.hand.' + h)}</option>)}
        </Select>
        <Select name="start" label={t('thread.start')} value={startValue} onChange={(v) => change({ start: v === 'open' ? null : v })}>
          {THREAD_STARTS.map((s) => <option key={s} value={s}>{t('thread.start.' + s)}</option>)}
        </Select>
      </Section>

      <Section id="options" title={t('thread.section.options')}>
        <label class="fedit-fld bool" data-path="modeled">
          <input type="checkbox" checked={Boolean(eff.modeled)} onChange={(e) => change({ modeled: (e.currentTarget as HTMLInputElement).checked })} />
          <span class="fedit-fld-label">{t('thread.modeled')}</span>
        </label>
      </Section>

      {warns.map((w, i) => {
        const sug = w.code === 'threadDiameterMismatch' ? suggestedSize(w.params) : null;
        return (
          <div key={i} class="fedit-warn" role="status" data-warning={w.code}>
            {w.hint}
            {sug && sug !== size ? <button type="button" data-testid="thread-use" onClick={() => change(patchSize(rows.find((r) => r.size === sug), sug, p.internal))}>{t('thread.use', { size: sug })}</button> : null}
          </div>
        );
      })}
      {p.hint ? <div class="fedit-hint" role="alert">{p.hint}</div> : null}
    </div>
  );
}

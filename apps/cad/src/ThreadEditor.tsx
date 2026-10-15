// The Thread editor: the face as a chip, Standard, Size (quick chips and a searchable list, the sizes nearest to the
// face first), the fit line, the numbers that matter for a shaft or a hole, Class, Length (Full | Custom), Hand, Start
// (only when it matters) and the "model the thread" option with its cost. Same draft protocol as HoleEditor / FeatureEditor:
// every change goes to onDraft with the whole draft (null = remove the field), Enter / the tick confirm, Escape / the
// cross cancel. The tables come in through props (the controller caches the kernel's threadData); the amber line is the
// kernel's (threadDiameterMismatch with a one-click "Use M8", threadModelFallback).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { EditorSection as Section, Icon } from '@kit/ui';
import type { FeatureWarning } from '@kit/store';
import { t } from './i18n';
import { HandRow, LengthRow, ModelRow, ReadoutCard, Select, Seg, SizeChips, SizePicker, fmt, stdLabel } from './ThreadControls';

export { Select, Seg, SizePicker, stdLabel };
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
        <Select name="standard" stack label={t('thread.standard')} value={standard} onChange={(v) => { prevMajor.current = row?.major ?? null; change({ standard: v }); }}>
          {(stds.length ? stds : [{ id: standard, description: standard, count: 0 }]).map((s) => <option key={s.id} value={s.id}>{stdLabel(s)}</option>)}
        </Select>
        <SizeChips chips={chips} value={size} onPick={pickSize} />
        <SizePicker rows={rows} value={size} dia={dia} internal={p.internal} standard={standard} onPick={pickSize} />
        <label class="fedit-fld" data-path="class" title={t('thread.class.note')}>
          <span class="fedit-fld-label">{t('thread.class')}</span>
          <select value={String(eff.class ?? '')} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; change({ class: v === '' ? null : v }); }}>
            <option value="">-</option>
            {classOptions(row, eff.class === undefined ? undefined : String(eff.class), p.internal).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
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
        <ReadoutCard row={row} internal={p.internal} empty={rows.length ? t('thread.readout.none') : ''} />
      </Section>

      <Section id="length" title={t('thread.section.length')} summary={[lengthFull ? t('thread.length.full') : `${eff.length} mm`, t('thread.hand.' + (eff.hand === 'left' ? 'left' : 'right')), modeled ? t('thread.modeled.short') : ''].filter(Boolean).join(' · ')}>
        <LengthRow custom={!lengthFull} value={lengthFull ? null : Number(eff.length)} fullLength={maxLen} min={row?.pitch} max={maxLen}
          onMode={(custom) => {
            if (!custom) { if (typeof eff.length === 'number') lastCustom.current = eff.length; change({ length: 'full' }); }
            else change({ length: lastCustom.current ?? customLengthDefault(row?.pitch, maxLen) });
          }}
          onValue={(v) => change({ length: clampLength(v, maxLen, row?.pitch) })} />
        <HandRow value={eff.hand === 'left' ? 'left' : 'right'} onChange={(v) => change({ hand: v })} />
        {showStart ? (
          <Seg name="start" label={t('thread.start')} value={startValue as 'open' | 'top' | 'bottom'}
            options={THREAD_STARTS.map((s) => ({ value: s, text: t('thread.start.' + s), icon: s === 'open' ? 'end-open' : s === 'top' ? 'arrow-up' : 'arrow-down', tip: t('thread.start.' + s + 'Tip') }))}
            onChange={(v) => change({ start: v === 'open' ? null : v })} />
        ) : null}
        <ModelRow on={modeled} seconds={sec} onChange={(on) => { saveThreadPrefs({ modeled: on }); change({ modeled: on }); }} />
        {modeled && p.entryModeled === false && f.modeled === true
          ? <div class="thread-fit warn" role="status" data-testid="thread-notbuilt" data-warning="threadModelFallback">{notBuilt ? t('thread.modeled.notBuilt', { reason: notBuilt }) : t('thread.modeled.notBuiltUnknown')}</div> : null}
      </Section>

      {warns.map((w, i) => <div key={i} class="fedit-warn" role="status" data-warning={w.code}>{w.hint}</div>)}
      {p.hint ? <div class="fedit-hint" role="alert">{p.hint}</div> : null}
    </div>
  );
}

// The Thread section of the Hole editor: a "Threaded" checkbox and, when on, the same controls as the Thread editor (standard,
// size, class, length, hand, model the thread) acting on the thread feature that sits on the hole's wall. The hole follows
// the thread: tapped, it is drilled to the size's tap drill (holeThread.ts tapHolePatch), and the section tells the editor
// what to change in the hole and in the thread through onApply, so one draft carries both.
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { FeatureWarning } from '@kit/store';
import { t } from './i18n';
import { Select, Seg, SizePicker, stdLabel } from './ThreadEditor';
import { holeDiameter } from './holeData';
import {
  canThreadHole, defaultHoleThread, tapHolePatch, threadMaxLength, type HoleThread,
} from './holeThread';
import {
  THREAD_HANDS, classOptions, clampLength, customLengthDefault, defaultClass, loadThreadPrefs, modelFallbackReason, patchStandard,
  quickSizes, readoutRows, rememberSize, saveThreadPrefs, type ThreadRow, type ThreadStd,
} from './threadData';

type Wire = Record<string, unknown>;

/** What the Hole editor needs from the app to edit a thread: the kernel tables and what the part currently shows for this thread. */
export interface HoleThreadApi {
  loadStandards(): Promise<ThreadStd[]>;
  loadSizes(standard: string): Promise<ThreadRow[]>;
  /** Length of the hole wall in mm when the view knows it (a through hole's wall); a blind hole is capped by its depth instead. */
  wallLength?: number | null;
  /** `modeled` of the kernel's entry for this thread (undefined: none yet). */
  entryModeled?: boolean;
  modeledMs?: number | null;
  /** Regen warnings of the thread feature. */
  warning?: FeatureWarning | null;
}

const fmt = (v: number): string => String(Math.round(v * 1000) / 1000);

export function HoleThreadSection(p: {
  api: HoleThreadApi;
  hole: Wire;
  th: HoleThread | null;
  onApply(holePatch: Wire, th: HoleThread | null): void;
}): JSX.Element {
  const { api, hole, th } = p;
  const [stds, setStds] = useState<ThreadStd[]>([]);
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [busy, setBusy] = useState(false);
  const pre = useRef<Wire | null>(null);          // the hole's own size / fit / diameter before Threaded was ticked, put back when it is cleared
  const lastCustom = useRef<number | null>(null);
  const std = th?.standard ?? null;

  useEffect(() => { let on = true; void api.loadStandards().then((s) => { if (on) setStds(s); }).catch(() => {}); return () => { on = false; }; }, []);
  useEffect(() => {
    if (!std) return;
    let on = true;
    void api.loadSizes(std).then((r) => { if (on) setRows(r); }).catch(() => { if (on) setRows([]); });
    return () => { on = false; };
  }, [std]);

  const allowed = canThreadHole(hole);
  const dia = holeDiameter(hole);
  const row = th ? rows.find((r) => r.size === th.size) : undefined;
  const maxLen = threadMaxLength(hole, api.wallLength ?? null);

  const enable = async (): Promise<void> => {
    setBusy(true);
    try {
      const metric = await api.loadSizes('metric').catch(() => [] as ThreadRow[]);
      const d = defaultHoleThread(hole, metric);
      if (!d) return;
      pre.current = { size: hole.size ?? null, fit: hole.fit ?? null, diameter: hole.diameter ?? null };
      p.onApply(tapHolePatch(d.row), d.cfg);
    } finally { setBusy(false); }
  };
  const disable = (): void => {
    const b = pre.current;
    pre.current = null;
    p.onApply(b ? { size: b.size, fit: b.fit, diameter: b.diameter } : {}, null);
  };
  const pickSize = async (size: string): Promise<void> => {
    if (!th) return;
    const rs = rows.length ? rows : await api.loadSizes(th.standard).catch(() => [] as ThreadRow[]);   // a click before the table arrived
    const r = rs.find((x) => x.size === size);
    if (!r) return;
    rememberSize(th.standard, size);
    p.onApply(tapHolePatch(r), { ...th, size, class: defaultClass(r, true) ?? undefined });
  };
  const setStandard = async (v: string): Promise<void> => {
    if (!th) return;
    const rs = await api.loadSizes(v).catch(() => [] as ThreadRow[]);
    const pick = patchStandard(v, rs, dia, true);
    const r = rs.find((x) => x.size === pick.size);
    if (!r) return;
    setRows(rs);
    p.onApply(tapHolePatch(r), { ...th, standard: v, size: r.size, class: typeof pick.class === 'string' ? pick.class : undefined });
  };
  const upd = (patch: Partial<HoleThread>): void => { if (th) p.onApply({}, { ...th, ...patch }); };

  const check = (
    <label class="fedit-fld bool" data-path="threaded">
      <input type="checkbox" checked={th !== null} disabled={!allowed || busy} aria-label={t('hole.thread.on')}
        onChange={(e) => { if ((e.currentTarget as HTMLInputElement).checked) void enable(); else disable(); }} />
      <span class="fedit-fld-label">{t('hole.thread.on')}</span>
    </label>
  );
  if (!th) return <div class="hole-thread" data-testid="hole-thread">{check}{!allowed ? <div class="thread-hint" data-testid="hole-thread-simple">{t('hole.thread.needSimple')}</div> : null}</div>;

  const lengthFull = th.length === 'full';
  const chips = quickSizes(th.standard, rows, loadThreadPrefs().lastSize?.[th.standard] ?? null);
  const notBuilt = modelFallbackReason(th.modeled, api.entryModeled, api.warning);
  const sec = api.modeledMs ? Math.max(1, Math.round(api.modeledMs / 1000)) : null;
  const warns = (api.warning ? (api.warning.all ?? [api.warning]) : []).filter((w) => w.code !== 'threadModelFallback');

  return (
    <div class="hole-thread" data-testid="hole-thread">
      {check}
      <Select name="standard" label={t('thread.standard')} value={th.standard} onChange={(v) => void setStandard(v)}>
        {(stds.length ? stds : [{ id: th.standard, description: th.standard, count: 0 }]).map((s) => <option key={s.id} value={s.id}>{stdLabel(s)}</option>)}
      </Select>
      {chips.length ? (
        <div class="thread-chips" role="group" aria-label={t('thread.sizeQuick')} data-testid="thread-chips">
          {chips.map((c) => <button key={c} type="button" class={'thread-chipbtn' + (c === th.size ? ' on' : '')} aria-pressed={c === th.size} data-size={c} onClick={() => void pickSize(c)}>{c}</button>)}
        </div>
      ) : null}
      <SizePicker rows={rows} value={th.size} dia={dia} internal standard={th.standard} onPick={(v) => void pickSize(v)} />
      {row ? (
        <dl class="thread-readout" data-testid="thread-readout">
          {readoutRows(row, true).map((r) => <Fragment key={r.key}><dt>{t(r.key === 'minor' ? 'thread.minorD1' : 'thread.' + r.key)}</dt><dd data-k={r.key}>{r.value}</dd></Fragment>)}
        </dl>
      ) : <div class="thread-hint">{t('hole.thread.loading')}</div>}
      <label class="fedit-fld" data-path="class">
        <span class="fedit-fld-label">{t('thread.class')}</span>
        <select value={th.class ?? ''} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; upd({ class: v === '' ? undefined : v }); }}>
          <option value="">-</option>
          {classOptions(row, th.class, true).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <Seg name="lengthMode" label={t('thread.length')} value={lengthFull ? 'full' : 'custom'}
        options={[{ value: 'full', text: t('thread.length.full') }, { value: 'custom', text: t('thread.length.custom') }]}
        onChange={(v) => {
          if (v === 'full') { if (typeof th.length === 'number') lastCustom.current = th.length; upd({ length: 'full' }); }
          else upd({ length: lastCustom.current !== null ? clampLength(lastCustom.current, maxLen, row?.pitch) : customLengthDefault(row?.pitch, maxLen) });
        }} />
      <label class="fedit-fld" data-path="length">
        <span class="fedit-fld-label" />
        <span class="fedit-num">
          <input type="number" step="any" min={row ? String(row.pitch) : '0'} max={maxLen !== null ? String(maxLen) : undefined} disabled={lengthFull} aria-label={t('thread.length')}
            value={lengthFull ? (maxLen !== null ? fmt(maxLen) : '') : String(th.length)}
            onChange={(e) => { const raw = (e.currentTarget as HTMLInputElement).value; const v = Number(raw); if (raw.trim() !== '' && Number.isFinite(v) && v > 0) upd({ length: clampLength(v, maxLen, row?.pitch) }); }} />
          <span class="fedit-unit">mm</span>
        </span>
      </label>
      {hole.end === 'blind' && maxLen !== null ? <div class="thread-hint" data-testid="hole-thread-cap">{t('hole.thread.depthCap', { v: fmt(maxLen) })}</div> : null}
      <Seg name="hand" label={t('thread.hand')} value={th.hand}
        options={THREAD_HANDS.map((h) => ({ value: h, text: t('thread.hand.' + h), icon: h === 'left' ? 'helix-left' : 'helix-right', tip: t('thread.hand.' + h + 'Tip') }))}
        onChange={(v) => upd({ hand: v })} />
      <label class="fedit-fld bool" data-path="modeled">
        <input type="checkbox" checked={th.modeled} onChange={(e) => { const on = (e.currentTarget as HTMLInputElement).checked; saveThreadPrefs({ modeled: on }); upd({ modeled: on }); }} />
        <span class="fedit-fld-label">{t('thread.modeled')}</span>
      </label>
      {th.modeled ? <div class="thread-hint" data-testid="thread-cost">{sec ? t('thread.modeled.cost', { n: sec }) : t('thread.modeled.costUnknown')}</div> : null}
      {th.modeled && api.entryModeled === false
        ? <div class="thread-fit warn" role="status" data-testid="thread-notbuilt" data-warning="threadModelFallback">{notBuilt ? t('thread.modeled.notBuilt', { reason: notBuilt }) : t('thread.modeled.notBuiltUnknown')}</div> : null}
      {warns.map((w, i) => <div key={i} class="fedit-warn" role="status" data-warning={w.code}>{w.hint}</div>)}
    </div>
  );
}

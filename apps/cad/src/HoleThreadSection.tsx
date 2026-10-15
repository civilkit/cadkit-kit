// The thread blocks of the Hole editor. `useHoleThread` holds what both blocks share (tables, the size and the handlers);
// `HoleThreadPick` is the top of the Size section (the Threaded toggle and, when on, the thread picker: standard, common
// sizes, size, class, readout), `HoleThreadOptions` is the Thread options section (length, hand, model). They act on the
// thread feature that sits on the hole's wall. The hole follows the thread: tapped, it is drilled to the size's tap
// drill (holeThread.ts tapHolePatch), and the handlers tell the editor what to change in the hole and in the thread
// through onApply, so one draft carries both.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { FeatureWarning } from '@kit/store';
import { t } from './i18n';
import { Check, HandRow, LengthRow, ModelRow, ReadoutCard, Select, SizeChips, SizePicker, fmt, stdLabel } from './ThreadControls';
import { holeDiameter } from './holeData';
import {
  canThreadHole, defaultHoleThread, tapHolePatch, threadMaxLength, type HoleThread,
} from './holeThread';
import {
  classOptions, clampLength, customLengthDefault, defaultClass, loadThreadPrefs, modelFallbackReason, patchStandard,
  quickSizes, rememberSize, saveThreadPrefs, type ThreadRow, type ThreadStd,
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

export interface HoleThreadProps {
  api: HoleThreadApi;
  hole: Wire;
  th: HoleThread | null;
  onApply(holePatch: Wire, th: HoleThread | null): void;
}

export function useHoleThread(p: HoleThreadProps) {
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
  return { api, hole, th, stds, rows, busy, allowed, dia, row, maxLen, lastCustom, enable, disable, pickSize, setStandard, upd };
}
export type HoleThreadState = ReturnType<typeof useHoleThread>;

/** One-line summary of the thread options for the collapsed section header. */
export function threadOptionsSummary(th: HoleThread): string {
  return [th.length === 'full' ? t('thread.length.full') : `${th.length} mm`, t('thread.hand.' + th.hand), th.modeled ? t('thread.modeled.short') : ''].filter(Boolean).join(' · ');
}

/** The Threaded toggle (always) and, while on, the thread picker. */
export function HoleThreadPick(p: { s: HoleThreadState }): JSX.Element {
  const { s, } = p;
  const { th, row, rows, stds } = s;
  const check = (
    <Check name="threaded" strong label={t('hole.thread.on')} checked={th !== null} disabled={!s.allowed || s.busy}
      sub={!s.allowed && th === null ? <span data-testid="hole-thread-simple">{t('hole.thread.needSimple')}</span> : undefined}
      onChange={(on) => { if (on) void s.enable(); else s.disable(); }} />
  );
  if (!th) return <div class="hole-thread" data-testid="hole-thread">{check}</div>;
  const chips = quickSizes(th.standard, rows, loadThreadPrefs().lastSize?.[th.standard] ?? null);
  return (
    <div class="hole-thread" data-testid="hole-thread">
      {check}
      <Select name="standard" stack label={t('thread.standard')} value={th.standard} onChange={(v) => void s.setStandard(v)}>
        {(stds.length ? stds : [{ id: th.standard, description: th.standard, count: 0 }]).map((x) => <option key={x.id} value={x.id}>{stdLabel(x)}</option>)}
      </Select>
      <SizeChips chips={chips} value={th.size} onPick={(v) => void s.pickSize(v)} />
      <SizePicker rows={rows} value={th.size} dia={s.dia} internal standard={th.standard} onPick={(v) => void s.pickSize(v)} />
      <label class="fedit-fld" data-path="class" title={t('thread.class.note')}>
        <span class="fedit-fld-label">{t('thread.class')}</span>
        <select value={th.class ?? ''} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; s.upd({ class: v === '' ? undefined : v }); }}>
          <option value="">-</option>
          {classOptions(row, th.class, true).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      {row ? <ReadoutCard row={row} internal /> : <div class="thread-hint">{t('hole.thread.loading')}</div>}
    </div>
  );
}

/** Length, hand and model, for a hole that is threaded. */
export function HoleThreadOptions(p: { s: HoleThreadState }): JSX.Element | null {
  const { s } = p;
  const { th, api, row, maxLen, hole } = s;
  if (!th) return null;
  const lengthFull = th.length === 'full';
  const notBuilt = modelFallbackReason(th.modeled, api.entryModeled, api.warning);
  const sec = api.modeledMs ? Math.max(1, Math.round(api.modeledMs / 1000)) : null;
  const warns = (api.warning ? (api.warning.all ?? [api.warning]) : []).filter((w) => w.code !== 'threadModelFallback');
  return (
    <div class="hole-thread-opts" data-testid="hole-thread-options">
      <LengthRow custom={!lengthFull} value={typeof th.length === 'number' ? th.length : null} fullLength={maxLen} min={row?.pitch} max={maxLen}
        onMode={(custom) => {
          if (!custom) { if (typeof th.length === 'number') s.lastCustom.current = th.length; s.upd({ length: 'full' }); }
          else s.upd({ length: s.lastCustom.current !== null ? clampLength(s.lastCustom.current, maxLen, row?.pitch) : customLengthDefault(row?.pitch, maxLen) });
        }}
        onValue={(v) => s.upd({ length: clampLength(v, maxLen, row?.pitch) })} />
      {hole.end === 'blind' && maxLen !== null ? <div class="thread-hint fedit-note" data-testid="hole-thread-cap">{t('hole.thread.depthCap', { v: fmt(maxLen) })}</div> : null}
      <HandRow value={th.hand} onChange={(v) => s.upd({ hand: v })} />
      <ModelRow on={th.modeled} seconds={sec} onChange={(on) => { saveThreadPrefs({ modeled: on }); s.upd({ modeled: on }); }} />
      {th.modeled && api.entryModeled === false
        ? <div class="thread-fit warn" role="status" data-testid="thread-notbuilt" data-warning="threadModelFallback">{notBuilt ? t('thread.modeled.notBuilt', { reason: notBuilt }) : t('thread.modeled.notBuiltUnknown')}</div> : null}
      {warns.map((w, i) => <div key={i} class="fedit-warn" role="status" data-warning={w.code}>{w.hint}</div>)}
    </div>
  );
}

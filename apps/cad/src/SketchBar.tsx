import { useEffect, useRef, useState } from 'preact/hooks';
import type { SketchSolverStatus } from '@ck/part-model';
import { SNAP_KINDS, type SnapToggle } from '@kit/sketch';
import { Icon, Tip } from '@kit/ui';
import { t } from './i18n';
import type { SketchPrefs } from './sketchPrefs';

/** 'under' blue, 'full' dark, 'over' red: the same three colours the geometry takes on the canvas. */
export const defLevel = (s: SketchSolverStatus | null): 'under' | 'full' | 'over' | 'none' =>
  !s ? 'none' : s.state === 'over' || s.conflicts.length ? 'over' : !s.solved ? 'over' : s.state === 'full' || s.fullyDefined ? 'full' : 'under';

/** A menu that drops below its button. It is placed with `position: fixed` from the button's rectangle so the ribbon's
 *  `overflow: hidden` row cannot clip it. */
function Drop(p: { open: boolean; anchor: preact.RefObject<HTMLElement>; class?: string; label?: string; children: preact.ComponentChildren }) {
  if (!p.open) return null;
  const r = p.anchor.current?.getBoundingClientRect();
  const style = r ? { position: 'fixed', top: Math.round(r.bottom + 6) + 'px', left: Math.round(r.left) + 'px' } as const : undefined;
  return <div class={p.class ?? 'aux-menu'} role="group" aria-label={p.label} style={style}>{p.children}</div>;
}

function Popover(p: { label: string; tip: string; icon?: string; children: preact.ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key); };
  }, [open]);
  const btn = <button class="rb-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>{p.icon ? <Icon name={p.icon} size={16} /> : null}{p.label} <span class="caret" aria-hidden="true">▾</span></button>;
  return (
    <div class="aux-pop" ref={root}>
      {open ? btn : <Tip label={p.tip}>{btn}</Tip>}
      {open ? <Drop open anchor={root} label={p.label}>{p.children}</Drop> : null}
    </div>
  );
}

/** Everything the sketch controls need. The ribbon's Sketch tab draws them as groups; the floating bar (only when the ribbon is off) draws the same pieces as one pill. */
export interface SketchControls {
  name: string;
  plane: string;
  onOk(): void;
  onCancel(): void;
  /** Finish the sketch (as OK does) and open the Extrude card on it. Absent for a hole sketch. */
  onExtrude?: () => void;
  /** Finish the sketch and open the Revolve card on it. Absent for a hole sketch. */
  onRevolve?: () => void;
  construction: boolean;
  onConstruction(): void;
  /** Shown when geometry is selected: turn the selection into / out of construction. */
  onToggleSelected?: () => void;
  onLookNormal(): void;
  /** The camera is angled to the sketch plane (more than 5 degrees) on entry: the one Look normal (N) button is highlighted until used. */
  lookChip?: boolean;
  hint?: string | null;
  status: SketchSolverStatus | null;
  busy: boolean;
  prefs: SketchPrefs;
  onPrefs(patch: Partial<SketchPrefs>): void;
  onFullyDefine(): void;
  /** Open the Sketch Report (a window on a desktop, a sheet on a phone or tablet). Absent: no button. */
  onReport?: () => void;
  reportOpen?: boolean;
  selected: number;
  onClearSelection(): void;
  /** The full constraint list, drawn as a popover under the badge. */
  list?: preact.ComponentChildren;
}

/** OK and Cancel. */
export function SketchFinish(p: Pick<SketchControls, 'onOk' | 'onCancel'>) {
  return (
    <>
      <button class="rb-btn ok" data-action="sketch-ok" aria-label={t('app.sketch.confirm')} title={t('app.sketch.confirm')} onClick={p.onOk}>✓</button>
      <button class="rb-btn no" data-action="sketch-cancel" aria-label={t('app.sketch.cancel')} title={t('app.sketch.cancel')} onClick={p.onCancel}>✗</button>
    </>
  );
}

/** Extrude and Revolve: finish the sketch and open the feature on it. */
export function SketchMake(p: Pick<SketchControls, 'onExtrude' | 'onRevolve'>) {
  return (
    <>
      {p.onExtrude ? <button class="rb-btn" data-action="sketch-extrude" title={t('app.sketch.extrude.tip')} onClick={p.onExtrude}><Icon name="add-extrude" size={16} />{t('cmd.add-extrude')}</button> : null}
      {p.onRevolve ? <button class="rb-btn" data-action="sketch-revolve" title={t('app.sketch.revolve.tip')} onClick={p.onRevolve}><Icon name="add-revolve" size={16} />{t('cmd.add-revolve')}</button> : null}
    </>
  );
}

/** The Construction toggle (pressed while on) and, with geometry selected, Make construction. */
export function SketchConstruction(p: Pick<SketchControls, 'construction' | 'onConstruction' | 'onToggleSelected'>) {
  return (
    <>
      <button class="rb-btn" data-action="sketch-construction" aria-pressed={p.construction} title={t('app.sketch.constructionMode.tip')} onClick={p.onConstruction}>{t('app.sketch.constructionMode')}</button>
      {p.onToggleSelected ? <button class="rb-btn" data-action="sketch-make-construction" title={t('app.sketch.toggleConstruction.tip')} onClick={p.onToggleSelected}>{t('app.sketch.toggleConstruction')}</button> : null}
    </>
  );
}

/** The one Look normal button. While the view is angled to the plane (`lookChip`) it carries an accent until used. */
export function LookNormalButton(p: Pick<SketchControls, 'onLookNormal' | 'lookChip'>) {
  return (
    <button class={'rb-btn' + (p.lookChip ? ' look-hint' : '')} data-action="look-normal" title={p.lookChip ? t('app.sketch.lookNormalChip.tip') : t('app.sketch.lookNormal.tip')} onClick={p.onLookNormal}>{t('app.sketch.lookNormalChip')}</button>
  );
}

/** The definition badge (click for the constraint list; the list opens by itself on a conflict), Fully define, Snaps, Look normal. */
export function SketchStatus(p: Pick<SketchControls, 'status' | 'busy' | 'prefs' | 'onPrefs' | 'onFullyDefine' | 'list' | 'onLookNormal' | 'lookChip' | 'onReport' | 'reportOpen'>) {
  const level = defLevel(p.status);
  const [listOpen, setListOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const bad = (p.status?.conflicts.length ?? 0) + (p.status?.redundant.length ?? 0);
  const prevBad = useRef(0);
  // a conflict or an over-defined sketch opens the list so the culprit can be removed; it never reopens by itself while the problem lasts
  useEffect(() => {
    if ((bad > 0 || level === 'over') && prevBad.current === 0) setListOpen(true);
    prevBad.current = bad > 0 || level === 'over' ? 1 : 0;
  }, [bad, level]);
  useEffect(() => {
    if (!listOpen) return;
    const away = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setListOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setListOpen(false); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key); };
  }, [listOpen]);
  const snapOn = (k: SnapToggle) => (k === 'grid' ? p.prefs.gridSnap : p.prefs.snaps[k]);
  const setSnap = (k: SnapToggle, on: boolean) => (k === 'grid' ? p.onPrefs({ gridSnap: on }) : p.onPrefs({ snaps: { ...p.prefs.snaps, [k]: on } }));
  return (
    <>
      <span class="sk-badge" ref={wrap}>
        {p.status ? (
          <button class={`dof-chip ${level}`} data-level={level} aria-expanded={listOpen} aria-haspopup="true" onClick={() => setListOpen(!listOpen)}
            title={t('app.sketch.defstate.' + (level === 'none' ? 'under' : level)) + ' - ' + t('app.sketch.constraints')}>{badgeText(p.status)}</button>
        ) : null}
        <Drop open={listOpen && !!p.list && !!p.status} anchor={wrap} class="sb-list">{p.list}</Drop>
      </span>
      <Tip label={t('app.sketch.fullyDefine.tip')}>
        <button class="rb-btn" disabled={p.busy || level === 'full'} onClick={p.onFullyDefine} data-action="fully-define">{p.busy ? t('app.sketch.defining') : t('app.sketch.fullyDefine')}</button>
      </Tip>
      {p.onReport ? <Tip label={t('app.sketch.report.tip')}><button class="rb-btn" data-action="sketch-report" aria-pressed={!!p.reportOpen} onClick={p.onReport}>{t('app.sketch.report')}</button></Tip> : null}
      <Popover label={t('app.sketch.snaps')} tip={t('app.sketch.snaps.tip')}>
        <b class="aux-head">{t('app.sketch.snaps.title')}</b>
        {SNAP_KINDS.map((k) => (
          <label key={k} class="aux-row"><input type="checkbox" checked={snapOn(k)} onChange={(e) => setSnap(k, (e.currentTarget as HTMLInputElement).checked)} /><span>{t('app.sketch.snapkind.' + k)}</span></label>
        ))}
        <hr />
        <label class="aux-row"><input type="checkbox" checked={p.prefs.autoConstraints} onChange={(e) => p.onPrefs({ autoConstraints: (e.currentTarget as HTMLInputElement).checked })} /><span>{t('app.sketch.snaps.auto')}</span></label>
        <label class="aux-row"><input type="checkbox" data-pref="autoLookNormal" checked={p.prefs.autoLookNormal} onChange={(e) => p.onPrefs({ autoLookNormal: (e.currentTarget as HTMLInputElement).checked })} /><span>{t('settings.sketch.autoLookNormal')}</span></label>
        <label class="aux-row" title={t('app.sketch.snaps.guideTip')}><input type="checkbox" data-pref="guideConstraints" checked={p.prefs.guideConstraints} onChange={(e) => p.onPrefs({ guideConstraints: (e.currentTarget as HTMLInputElement).checked })} /><span>{t('app.sketch.snaps.guide')}</span></label>
      </Popover>
      <LookNormalButton onLookNormal={p.onLookNormal} lookChip={p.lookChip} />
    </>
  );
}

/** The hint line and the selection count with Clear. In the status bar when the ribbon carries the controls, under the pill otherwise. */
export function SketchNotes(p: Pick<SketchControls, 'hint' | 'selected' | 'onClearSelection'>) {
  return (
    <>
      {p.hint ? <span class="sketch-hint" role="status">{p.hint}</span> : null}
      {p.selected > 0 ? (
        <span class="aux-sel">{t('app.sketch.selected', { count: p.selected })} <button class="rb-btn" onClick={p.onClearSelection}>{t('app.sketch.clearSelection')}</button></span>
      ) : null}
    </>
  );
}

/** The fallback sketch bar: one pill at the top centre, drawn ONLY when the ribbon is off (otherwise the Sketch tab carries all of this).
 *  Make (Extrude, Revolve), the sketch name with OK and Cancel, Construction, then the status group. The Display toggles live in the viewport's Display menu. */
export function SketchBar(p: SketchControls) {
  return (
    <div class="sketch-bar-wrap">
      <div class="sketch-bar pill" role="toolbar" aria-label={t('app.sketch.editing', { name: p.name })}>
        <SketchMake onExtrude={p.onExtrude} onRevolve={p.onRevolve} />
        {p.onExtrude || p.onRevolve ? <span class="sb-sep" /> : null}
        <span class="sb-name" title={p.plane ? `${t('app.sketch.dialog.plane')}: ${p.plane}` : undefined}>{p.name}</span>
        <SketchFinish onOk={p.onOk} onCancel={p.onCancel} />
        <span class="sb-sep" />
        <SketchConstruction construction={p.construction} onConstruction={p.onConstruction} onToggleSelected={p.onToggleSelected} />
        <span class="sb-sep" />
        <SketchStatus status={p.status} busy={p.busy} prefs={p.prefs} onPrefs={p.onPrefs} onFullyDefine={p.onFullyDefine} list={p.list} onLookNormal={p.onLookNormal} lookChip={p.lookChip} onReport={p.onReport} reportOpen={p.reportOpen} />
        <SketchNotes hint={null} selected={p.selected} onClearSelection={p.onClearSelection} />
      </div>
      {p.hint ? <span class="sketch-hint" role="status">{p.hint}</span> : null}
    </div>
  );
}

/** The short badge text: 'Fully defined' or 'N DOF', 'Over-constrained' when it conflicts. */
export function badgeText(s: SketchSolverStatus | null): string {
  if (!s) return '';
  const l = defLevel(s);
  return l === 'full' ? t('app.sketch.status.full') : l === 'over' ? t('app.sketch.status.over') : t('app.sketch.badge.dof', { count: s.dof });
}

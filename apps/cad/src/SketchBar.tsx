import { useEffect, useRef, useState } from 'preact/hooks';
import type { SketchSolverStatus } from '@ck/part-model';
import { SNAP_KINDS, type SnapToggle } from '@kit/sketch';
import { Icon, Tip } from '@kit/ui';
import { t } from './i18n';
import type { SketchPrefs } from './sketchPrefs';
import { HelpButton } from './HelpButton';
import { popoverLayout } from './dofPopover';
import { statusAria, statusItems, statusMode, type StatusItem } from './statusGroup';

/** 'under' blue, 'full' dark, 'over' red: the same three colours the geometry takes on the canvas. */
export const defLevel = (s: SketchSolverStatus | null): 'under' | 'full' | 'over' | 'none' =>
  !s ? 'none' : s.state === 'over' || s.conflicts.length ? 'over' : !s.solved ? 'over' : s.state === 'full' || s.fullyDefined ? 'full' : 'under';

/** A menu that drops below its button. It is placed with `position: fixed` from the button's rectangle so the ribbon's
 *  `overflow: hidden` row cannot clip it. */
function Drop(p: { open: boolean; anchor: preact.RefObject<HTMLElement>; class?: string; label?: string; /** open upward (an anchor at the bottom of the window) */ up?: boolean; children: preact.ComponentChildren }) {
  if (!p.open) return null;
  const r = p.anchor.current?.getBoundingClientRect();
  // kept inside the window: a button at the far right of an overflowing ribbon must not push its list off screen
  const left = r ? Math.max(4, Math.min(Math.round(r.left), window.innerWidth - 260)) : 0;
  const style = r ? { position: 'fixed', ...(p.up ? { bottom: Math.round(window.innerHeight - r.top + 6) + 'px' } : { top: Math.round(r.bottom + 6) + 'px' }), left: left + 'px' } as const : undefined;
  return <div class={p.class ?? 'aux-menu'} role="group" aria-label={p.label} style={style}>{p.children}</div>;
}

function Popover(p: { label: string; tip: string; icon?: string; /** only the icon (and the caret): the name stays in the tooltip and aria-label */ iconOnly?: boolean; action?: string; children: preact.ComponentChildren }) {
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
  const btn = <button class={'rb-btn' + (p.iconOnly ? ' rb-ico' : '')} data-action={p.action} aria-haspopup="true" aria-expanded={open} aria-label={p.iconOnly ? p.label + ': ' + p.tip : undefined} onClick={() => setOpen(!open)}>{p.icon ? <Icon name={p.icon} size={p.iconOnly ? 18 : 16} /> : null}{p.iconOnly ? null : p.label} <span class="caret" aria-hidden="true">▾</span></button>;
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
  /** Draw a DXF / SVG file into this sketch (the ribbon's Import group). */
  onImportDxf?: () => void;
  onImportSvg?: () => void;
  /** put a picture on the sketch plane to trace (or show the panel of the one it has) */
  onUnderlay?: () => void;
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
  /** The active sketch tool's id (null while selecting): the help button explains it. */
  tool?: string | null;
  hint?: string | null;
  status: SketchSolverStatus | null;
  busy: boolean;
  prefs: SketchPrefs;
  onPrefs(patch: Partial<SketchPrefs>): void;
  onFullyDefine(): void;
  /** Show freedom: amber highlight of what can still move (pressed while on). */
  showFree?: boolean;
  onShowFree?: () => void;
  /** Show constraints: every glyph and dimension (pressed while on). */
  showConstraints?: boolean;
  onShowConstraints?: () => void;
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

/** The definition badge ("3 DOF", "Fully defined", "Over-constrained"): a click opens the constraint list. With `autoOpen` the list opens by
 *  itself on a conflict so the culprit can be removed. Shown once, in the ribbon's Status group (the status bar no longer repeats it). */
export function DofBadge(p: Pick<SketchControls, 'status' | 'list'> & { autoOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const level = defLevel(p.status);
  const [listOpen, setListOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const bad = (p.status?.conflicts.length ?? 0) + (p.status?.redundant.length ?? 0);
  const prevBad = useRef(0);
  // a conflict or an over-defined sketch opens the list so the culprit can be removed; it never reopens by itself while the problem lasts
  useEffect(() => {
    if (p.autoOpen && (bad > 0 || level === 'over') && prevBad.current === 0) setListOpen(true);
    prevBad.current = bad > 0 || level === 'over' ? 1 : 0;
  }, [bad, level]);
  const wasOpen = useRef(false);
  useEffect(() => { if (listOpen !== wasOpen.current) { wasOpen.current = listOpen; p.onOpenChange?.(listOpen); } }, [listOpen]);
  const chip = useRef<HTMLButtonElement>(null);
  const close = () => { setListOpen(false); chip.current?.focus(); };
  const [, resized] = useState(0);
  useEffect(() => {
    if (!listOpen) return;
    const away = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setListOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const size = () => resized((n) => n + 1);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', size);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key); window.removeEventListener('resize', size); };
  }, [listOpen]);
  const open = listOpen && !!p.list && !!p.status;
  const r = open ? chip.current?.getBoundingClientRect() : undefined;
  const lay = r ? popoverLayout(r.bottom, window.innerWidth, window.innerHeight) : null;
  const style = lay ? { position: 'fixed', top: lay.top + 'px', right: lay.right + 'px', left: lay.left === null ? 'auto' : lay.left + 'px', maxWidth: lay.maxWidth + 'px', maxHeight: lay.maxHeight + 'px' } as const : undefined;
  return (
    <span class="sk-badge" ref={wrap}>
      {p.status ? (
        <button ref={chip} class={`dof-chip ${level}`} data-level={level} aria-expanded={listOpen} aria-haspopup="true" onClick={() => setListOpen(!listOpen)}
          title={t('app.sketch.defstate.' + (level === 'none' ? 'under' : level)) + ' - ' + t('app.sketch.constraints')}>{badgeText(p.status)}</button>
      ) : null}
      {open ? (
        <div class={'dof-pop' + (lay?.sheet ? ' sheet' : '')} role="dialog" aria-label={t('app.sketch.constraints')} style={style}>
          <header class="dof-pop-head">
            <b>{level === 'under' && p.status ? t('app.sketch.dofPop.title', { count: p.status.dof }) : t('app.sketch.constraints')}</b>
            <button class="dof-pop-close" data-action="dof-close" aria-label={t('app.sketch.dofPop.close')} title={t('app.sketch.dofPop.close')} onClick={close}>×</button>
          </header>
          <div class="dof-pop-body">{p.list}</div>
        </div>
      ) : null}
    </span>
  );
}

/** The ribbon width the Status group is drawn for: the ribbon's own width (it is narrower than the window beside side panels), else the window's. */
function useStatusWidth(host: preact.RefObject<HTMLElement>, fixed?: number): number {
  const [w, setW] = useState(() => fixed ?? (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    if (fixed !== undefined) { setW(fixed); return; }
    const box = host.current?.closest('.ribbon-wrap') as HTMLElement | null;
    const read = () => setW(box?.clientWidth || window.innerWidth);
    read();
    if (box && typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(read); ro.observe(box); return () => ro.disconnect(); }
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [fixed]);
  return w;
}

/** One square icon button of the Status group: the name, shortcut and description live in the tooltip and the aria-label. */
function StatusButton(p: { it: StatusItem; labelled: boolean }) {
  const { it } = p;
  const showText = p.labelled && !!it.text;
  return (
    <Tip label={it.tip} keys={it.keys}>
      <button class={'rb-btn rb-ico' + (showText ? ' rb-ico-text' : '') + (it.cls ? ' ' + it.cls : '')} data-action={it.action} aria-label={statusAria(it)} aria-pressed={it.pressed} disabled={it.disabled} onClick={it.run}>
        <Icon name={it.icon} size={18} />{showText ? <span class="rb-ico-label">{it.text}</span> : null}
      </button>
    </Tip>
  );
}

/** What Snaps lists: the snap kinds and the three sketch preferences. Used by the Snaps popover and by the "..." menu. */
function SnapChecks(p: Pick<SketchControls, 'prefs' | 'onPrefs'>) {
  const snapOn = (k: SnapToggle) => (k === 'grid' ? p.prefs.gridSnap : p.prefs.snaps[k]);
  const setSnap = (k: SnapToggle, on: boolean) => (k === 'grid' ? p.onPrefs({ gridSnap: on }) : p.onPrefs({ snaps: { ...p.prefs.snaps, [k]: on } }));
  return (
    <>
      <b class="aux-head">{t('app.sketch.snaps.title')}</b>
      {SNAP_KINDS.map((k) => (
        <label key={k} class="aux-row"><input type="checkbox" checked={snapOn(k)} onChange={(e) => setSnap(k, (e.currentTarget as HTMLInputElement).checked)} /><span>{t('app.sketch.snapkind.' + k)}</span></label>
      ))}
      <hr />
      <label class="aux-row"><input type="checkbox" checked={p.prefs.autoConstraints} onChange={(e) => p.onPrefs({ autoConstraints: (e.currentTarget as HTMLInputElement).checked })} /><span>{t('app.sketch.snaps.auto')}</span></label>
      <label class="aux-row"><input type="checkbox" data-pref="autoLookNormal" checked={p.prefs.autoLookNormal} onChange={(e) => p.onPrefs({ autoLookNormal: (e.currentTarget as HTMLInputElement).checked })} /><span>{t('settings.sketch.autoLookNormal')}</span></label>
      <label class="aux-row" title={t('app.sketch.snaps.guideTip')}><input type="checkbox" data-pref="guideConstraints" checked={p.prefs.guideConstraints} onChange={(e) => p.onPrefs({ guideConstraints: (e.currentTarget as HTMLInputElement).checked })} /><span>{t('app.sketch.snaps.guide')}</span></label>
    </>
  );
}

/** The Status group: the definition badge (text, a small pill), then square icon buttons (Fully define with its name when there is room, Show freedom while
 *  under-defined, Show constraints, Sketch Report, Snaps, Look normal). Narrower than STATUS_MENU_BELOW it is the badge and one "..." menu with the same items. */
export function SketchStatus(p: Pick<SketchControls, 'status' | 'busy' | 'prefs' | 'onPrefs' | 'onFullyDefine' | 'showFree' | 'onShowFree' | 'showConstraints' | 'onShowConstraints' | 'list' | 'onLookNormal' | 'lookChip' | 'onReport' | 'reportOpen'> & { /** the width to lay out for (tests); default: measured */ width?: number }) {
  const level = defLevel(p.status);
  const host = useRef<HTMLSpanElement>(null);
  const mode = statusMode(useStatusWidth(host, p.width));
  const items = statusItems({ status: p.status, level, busy: p.busy, onFullyDefine: p.onFullyDefine, showFree: p.showFree, onShowFree: p.onShowFree, showConstraints: p.showConstraints, onShowConstraints: p.onShowConstraints, onReport: p.onReport, reportOpen: p.reportOpen, onLookNormal: p.onLookNormal, lookChip: p.lookChip });
  const badge = <DofBadge status={p.status} list={p.list} autoOpen onOpenChange={p.onShowFree ? (open) => { if (open !== !!p.showFree) p.onShowFree?.(); } : undefined} />;
  return (
    <span class={'sk-status ' + mode} data-mode={mode} ref={host}>
      {badge}
      {mode === 'menu' ? (
        <Popover label={t('app.sketch.statusMore')} tip={t('app.sketch.statusMore')} icon="more" iconOnly action="status-more">
          {items.map((it) => (
            <button key={it.id} class="aux-row aux-item" data-action={it.action} aria-label={statusAria(it)} title={it.tip} aria-pressed={it.pressed} disabled={it.disabled} onClick={it.run}><Icon name={it.icon} size={16} /><span>{it.label}</span></button>
          ))}
          <hr />
          <SnapChecks prefs={p.prefs} onPrefs={p.onPrefs} />
        </Popover>
      ) : (
        <>
          {items.slice(0, -1).map((it) => <StatusButton key={it.id} it={it} labelled={mode === 'labelled'} />)}
          <Popover label={t('app.sketch.snaps')} tip={t('app.sketch.snaps.tip')} icon="sketch-snaps" iconOnly action="snaps"><SnapChecks prefs={p.prefs} onPrefs={p.onPrefs} /></Popover>
          <StatusButton it={items[items.length - 1]} labelled={false} />
        </>
      )}
    </span>
  );
}

/** The hint line and the selection count with Clear. In the status bar when the ribbon carries the controls, under the pill otherwise. */
export function SketchNotes(p: Pick<SketchControls, 'hint' | 'selected' | 'onClearSelection'>) {
  return (
    <>
      {p.hint ? <span class="sketch-hint" role="status" title={p.hint}>{p.hint}</span> : null}
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
        <SketchStatus status={p.status} busy={p.busy} prefs={p.prefs} onPrefs={p.onPrefs} onFullyDefine={p.onFullyDefine} list={p.list} showFree={p.showFree} onShowFree={p.onShowFree} showConstraints={p.showConstraints} onShowConstraints={p.onShowConstraints} onLookNormal={p.onLookNormal} lookChip={p.lookChip} onReport={p.onReport} reportOpen={p.reportOpen} />
        <HelpButton topic={p.tool ? 'sketch:' + p.tool : 'sketch'} />
        <SketchNotes hint={null} selected={p.selected} onClearSelection={p.onClearSelection} />
      </div>
      {p.hint ? <span class="sketch-hint" role="status" title={p.hint}>{p.hint}</span> : null}
    </div>
  );
}

/** The short badge text: 'Fully defined' or 'N DOF', 'Over-constrained' when it conflicts. */
export function badgeText(s: SketchSolverStatus | null): string {
  if (!s) return '';
  const l = defLevel(s);
  return l === 'full' ? t('app.sketch.status.full') : l === 'over' ? t('app.sketch.status.over') : t('app.sketch.badge.dof', { count: s.dof });
}

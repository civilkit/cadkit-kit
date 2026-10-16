import { useEffect, useRef, useState } from 'preact/hooks';
import type { SketchSolverStatus } from '@ck/part-model';
import { SNAP_KINDS, type SnapToggle } from '@kit/sketch';
import { Icon, Tip } from '@kit/ui';
import { t } from './i18n';
import type { SketchPrefs, SketchShow } from './sketchPrefs';

/** 'under' blue, 'full' dark, 'over' red: the same three colours the geometry takes on the canvas. */
export const defLevel = (s: SketchSolverStatus | null): 'under' | 'full' | 'over' | 'none' =>
  !s ? 'none' : s.state === 'over' || s.conflicts.length ? 'over' : !s.solved ? 'over' : s.state === 'full' || s.fullyDefined ? 'full' : 'under';

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
      {open ? <div class="aux-menu" role="group" aria-label={p.label}>{p.children}</div> : null}
    </div>
  );
}

/** True under 900 px: the Snaps and Display menus fold into one View menu so the bar clears the view cube. */
export const NARROW_PX = 900;
function useNarrow(): boolean {
  const q = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(`(max-width: ${NARROW_PX}px)`) : null;
  const [narrow, setNarrow] = useState(() => q()?.matches ?? false);
  useEffect(() => {
    const m = q();
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** THE sketch bar: one pill at the top centre while a sketch is open. Left to right: the sketch name (the plane is its tooltip)
 *  with OK and Cancel, the sketch modes (Construction, Look normal), the definition badge (click for the constraint list; the list
 *  opens by itself on a conflict), Fully define, Snaps and Display (one View menu on narrow windows). */
export function SketchBar(p: {
  name: string;
  plane: string;
  onOk(): void;
  onCancel(): void;
  construction: boolean;
  onConstruction(): void;
  /** Shown when geometry is selected: turn the selection into / out of construction. */
  onToggleSelected?: () => void;
  onLookNormal(): void;
  hint?: string | null;
  status: SketchSolverStatus | null;
  busy: boolean;
  prefs: SketchPrefs;
  onPrefs(patch: Partial<SketchPrefs>): void;
  onFullyDefine(): void;
  selected: number;
  onClearSelection(): void;
  /** The full constraint list, drawn as a popover under the badge. */
  list?: preact.ComponentChildren;
}) {
  const level = defLevel(p.status);
  const narrow = useNarrow();
  const [listOpen, setListOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
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
  const setShow = (k: keyof SketchShow, on: boolean) => p.onPrefs({ show: { ...p.prefs.show, [k]: on } });
  const snaps = (
    <>
      <b class="aux-head">{t('app.sketch.snaps.title')}</b>
      {SNAP_KINDS.map((k) => (
        <label key={k} class="aux-row"><input type="checkbox" checked={snapOn(k)} onChange={(e) => setSnap(k, (e.currentTarget as HTMLInputElement).checked)} /><span>{t('app.sketch.snapkind.' + k)}</span></label>
      ))}
      <hr />
      <label class="aux-row"><input type="checkbox" checked={p.prefs.autoConstraints} onChange={(e) => p.onPrefs({ autoConstraints: (e.currentTarget as HTMLInputElement).checked })} /><span>{t('app.sketch.snaps.auto')}</span></label>
    </>
  );
  const display = (
    <>
      {narrow ? <><hr /><b class="aux-head">{t('app.sketch.show')}</b></> : null}
      {SHOW_KEYS.map((k) => (
        <label key={k} class="aux-row"><input type="checkbox" checked={p.prefs.show[k]} onChange={(e) => setShow(k, (e.currentTarget as HTMLInputElement).checked)} /><span>{t('app.sketch.show.' + k)}</span></label>
      ))}
    </>
  );
  return (
    <div class="sketch-bar-wrap" ref={wrap}>
      <div class="sketch-bar pill" role="toolbar" aria-label={t('app.sketch.editing', { name: p.name })}>
        <span class="sb-name" title={p.plane ? `${t('app.sketch.dialog.plane')}: ${p.plane}` : undefined}>{p.name}</span>
        <button class="rb-btn ok" aria-label={t('app.sketch.confirm')} title={t('app.sketch.confirm')} onClick={p.onOk}>✓</button>
        <button class="rb-btn no" aria-label={t('app.sketch.cancel')} title={t('app.sketch.cancel')} onClick={p.onCancel}>✗</button>
        <span class="sb-sep" />
        <button class="rb-btn" aria-pressed={p.construction} title={t('app.sketch.constructionMode.tip')} onClick={p.onConstruction}>{t('app.sketch.constructionMode')}</button>
        {p.onToggleSelected ? <button class="rb-btn" title={t('app.sketch.toggleConstruction.tip')} onClick={p.onToggleSelected}>{t('app.sketch.toggleConstruction')}</button> : null}
        <button class="rb-btn" onClick={p.onLookNormal}>{t('app.sketch.lookNormal')}</button>
        <span class="sb-sep" />
        {p.status ? (
          <button class={`dof-chip ${level}`} data-level={level} aria-expanded={listOpen} aria-haspopup="true" onClick={() => setListOpen(!listOpen)}
            title={t('app.sketch.defstate.' + (level === 'none' ? 'under' : level)) + ' - ' + t('app.sketch.constraints')}>{badgeText(p.status)}</button>
        ) : null}
        <Tip label={t('app.sketch.fullyDefine.tip')}>
          <button class="rb-btn" disabled={p.busy || level === 'full'} onClick={p.onFullyDefine} data-action="fully-define">{p.busy ? t('app.sketch.defining') : t('app.sketch.fullyDefine')}</button>
        </Tip>
        {narrow ? (
          <Popover label={t('app.sketch.view')} tip={t('app.sketch.view.tip')}>{snaps}{display}</Popover>
        ) : (
          <>
            <Popover label={t('app.sketch.snaps')} tip={t('app.sketch.snaps.tip')}>{snaps}</Popover>
            <Popover label={t('app.sketch.show')} tip={t('app.sketch.show.tip')}>{display}</Popover>
          </>
        )}
        {p.selected > 0 ? (
          <span class="aux-sel">{t('app.sketch.selected', { count: p.selected })} <button class="rb-btn" onClick={p.onClearSelection}>{t('app.sketch.clearSelection')}</button></span>
        ) : null}
      </div>
      {p.hint ? <span class="sketch-hint" role="status">{p.hint}</span> : null}
      {listOpen && p.list ? <div class="sb-list">{p.list}</div> : null}
    </div>
  );
}

const SHOW_KEYS: Array<keyof SketchShow> = ['dimensions', 'relations', 'reference', 'colours'];

/** The short badge text: 'Fully defined' or 'N DOF', 'Over-constrained' when it conflicts. */
export function badgeText(s: SketchSolverStatus | null): string {
  if (!s) return '';
  const l = defLevel(s);
  return l === 'full' ? t('app.sketch.status.full') : l === 'over' ? t('app.sketch.status.over') : t('app.sketch.badge.dof', { count: s.dof });
}

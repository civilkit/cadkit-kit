import { useEffect, useRef, useState } from 'preact/hooks';
import type { SketchSolverStatus } from '@ck/part-model';
import { SNAP_KINDS, type SnapToggle } from '@kit/sketch';
import { Icon, Tip } from '@kit/ui';
import { t } from './i18n';
import type { SketchPrefs, SketchShow } from './sketchPrefs';
import { statusText } from './SketchConstraintList';

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
  return (
    <div class="aux-pop" ref={root}>
      <Tip label={p.tip}>
        <button class="rb-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>{p.icon ? <Icon name={p.icon} size={16} /> : null}{p.label} <span class="caret" aria-hidden="true">▾</span></button>
      </Tip>
      {open ? <div class="aux-menu" role="group" aria-label={p.label}>{p.children}</div> : null}
    </div>
  );
}

/** The second row under the sketch banner: how defined the sketch is (with the conflict list), Fully define, the snaps
 *  popover, the display popover, and what is selected. */
export function SketchAuxBar(p: {
  status: SketchSolverStatus | null;
  busy: boolean;
  prefs: SketchPrefs;
  onPrefs(patch: Partial<SketchPrefs>): void;
  onFullyDefine(): void;
  selected: number;
  onClearSelection(): void;
  /** Constraint ids the solver blames, with a short name each, for the conflict list. */
  conflicts: Array<{ id: string; name: string }>;
  redundant: Array<{ id: string; name: string }>;
  onHover(id: string | null): void;
  onDelete(id: string): void;
}) {
  const level = defLevel(p.status);
  const snapOn = (k: SnapToggle) => (k === 'grid' ? p.prefs.gridSnap : p.prefs.snaps[k]);
  const setSnap = (k: SnapToggle, on: boolean) => (k === 'grid' ? p.onPrefs({ gridSnap: on }) : p.onPrefs({ snaps: { ...p.prefs.snaps, [k]: on } }));
  const setShow = (k: keyof SketchShow, on: boolean) => p.onPrefs({ show: { ...p.prefs.show, [k]: on } });
  const bad = [...p.conflicts, ...p.redundant];
  return (
    <div class="sketch-aux" role="toolbar" aria-label={t('app.sketch.constraints')}>
      {p.status ? <span class={`dof-chip ${level}`} role="status" data-level={level} title={t('app.sketch.defstate.' + (level === 'none' ? 'under' : level))}>{statusText(p.status)}</span> : null}
      <Tip label={t('app.sketch.fullyDefine.tip')}>
        <button class="rb-btn" disabled={p.busy || level === 'full'} onClick={p.onFullyDefine} data-action="fully-define"><Icon name="fully-define" size={16} />{p.busy ? t('app.sketch.defining') : t('app.sketch.fullyDefine')}</button>
      </Tip>
      <Popover label={t('app.sketch.snaps')} tip={t('app.sketch.snaps.tip')}>
        <b class="aux-head">{t('app.sketch.snaps.title')}</b>
        {SNAP_KINDS.map((k) => (
          <label key={k} class="aux-row"><input type="checkbox" checked={snapOn(k)} onChange={(e) => setSnap(k, (e.currentTarget as HTMLInputElement).checked)} /><span>{t('app.sketch.snapkind.' + k)}</span></label>
        ))}
        <hr />
        <label class="aux-row"><input type="checkbox" checked={p.prefs.autoConstraints} onChange={(e) => p.onPrefs({ autoConstraints: (e.currentTarget as HTMLInputElement).checked })} /><span>{t('app.sketch.snaps.auto')}</span></label>
      </Popover>
      <Popover label={t('app.sketch.show')} tip={t('app.sketch.show.tip')}>
        {(Object.keys(p.prefs.show) as Array<keyof SketchShow>).map((k) => (
          <label key={k} class="aux-row"><input type="checkbox" checked={p.prefs.show[k]} onChange={(e) => setShow(k, (e.currentTarget as HTMLInputElement).checked)} /><span>{t('app.sketch.show.' + k)}</span></label>
        ))}
      </Popover>
      {p.selected > 0 ? (
        <span class="aux-sel">{t('app.sketch.selected', { count: p.selected })} <button class="rb-btn" onClick={p.onClearSelection}>{t('app.sketch.clearSelection')}</button></span>
      ) : null}
      {bad.length ? (
        <div class="aux-conflicts" role="alert" title={t('app.sketch.dof.conflictsTip')}>
          {p.conflicts.length ? <b>{t('app.sketch.dof.conflicts')}:</b> : null}
          {p.conflicts.map((c) => (
            <span key={c.id} class="conf bad" onPointerEnter={() => p.onHover(c.id)} onPointerLeave={() => p.onHover(null)}>{c.name}<button aria-label={t('app.sketch.deleteConstraint')} onClick={() => p.onDelete(c.id)}>×</button></span>
          ))}
          {p.redundant.length ? <b>{t('app.sketch.dof.redundant')}:</b> : null}
          {p.redundant.map((c) => (
            <span key={c.id} class="conf warn" onPointerEnter={() => p.onHover(c.id)} onPointerLeave={() => p.onHover(null)}>{c.name}<button aria-label={t('app.sketch.deleteConstraint')} onClick={() => p.onDelete(c.id)}>×</button></span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

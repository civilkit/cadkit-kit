import type { SketchSolverStatus } from '@ck/part-model';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from './i18n';

export interface ConstraintRow {
  id: string; type: string; refs: string[]; value?: number;
  /** A reference dimension (not a constraint): measured, not driving. */
  driven?: boolean;
  /** The solver blames this constraint (`conflict`) or finds it implied by earlier ones (`redundant`). */
  blame?: 'conflict' | 'redundant';
  /** linked to a variable by this expression */
  expr?: string;
}

/** How constrained the sketch is, in words: fully defined, how many degrees of freedom remain, over-constrained, unsolved. */
export function statusText(s: SketchSolverStatus | null): string {
  if (!s) return '';
  if (!s.solved && s.state !== 'over') return t('app.sketch.status.unsolved');
  if (s.state === 'over') return t('app.sketch.status.over');
  if (s.state === 'full' || s.fullyDefined) return t('app.sketch.status.full');
  return t('app.sketch.status.under', { count: s.dof });
}

export function SketchConstraintList(p: {
  rows: ConstraintRow[];
  status: SketchSolverStatus | null;
  hot: string | null;
  /** the row picked by a click (Delete removes it; its geometry is selected) */
  selected?: string | null;
  onSelect?(id: string): void;
  onHover(id: string | null): void;
  onDelete(id: string): void;
  onEdit(id: string): void;
  onToggleDriven?(id: string, driven: boolean): void;
  /** start folded (the badge popover folds it while many parts are still free); a conflicting row keeps it open */
  collapsed?: boolean;
}) {
  const level = !p.status ? '' : p.status.state === 'over' || (!p.status.solved) ? 'bad' : p.status.state === 'full' ? 'ok' : 'warn';
  const mustShow = p.rows.some((r) => r.blame);
  const [open, setOpen] = useState(!p.collapsed || mustShow);
  const touched = useRef(false);
  // the free list arrives after the popover mounts: follow the default until the user has chosen
  useEffect(() => { if (!touched.current) setOpen(!p.collapsed || mustShow); }, [p.collapsed, mustShow]);
  return (
    <aside class="sketch-cons" aria-label={t('app.sketch.constraints')}>
      <header>
        <button class="cons-fold" data-action="constraints-fold" aria-expanded={open} onClick={() => { touched.current = true; setOpen(!open); }}>
          <span class="cons-chev" aria-hidden="true">{open ? '▾' : '▸'}</span><b>{t('app.sketch.constraints.count', { count: p.rows.length })}</b>
        </button>
        {p.status && p.status.state !== 'under' ? <span class={`chip ${level}`}>{statusText(p.status)}</span> : null}
      </header>
      {!open ? null : p.rows.length === 0 ? <p class="none">{t('app.sketch.constraints.none')}</p> : (
        <ul>
          {p.rows.map((r) => (
            <li
              key={r.id}
              class={[p.hot === r.id ? 'hot' : '', p.selected === r.id ? 'sel' : '', r.blame === 'conflict' ? 'bad' : r.blame === 'redundant' ? 'warn' : '', r.driven ? 'driven' : ''].filter(Boolean).join(' ')}
              onPointerEnter={() => p.onHover(r.id)}
              onPointerLeave={() => p.onHover(null)}
              onClick={() => p.onSelect?.(r.id)}
              data-id={r.id}
              onDblClick={() => { if (r.driven) p.onToggleDriven?.(r.id, true); else if (r.value !== undefined) p.onEdit(r.id); }}
            >
              <span class="ctype">{r.driven ? '(' : ''}{t('app.sketch.constraint.' + r.type, undefined, r.type)}{r.driven ? ')' : ''}</span>
              <span class="crefs">{r.refs.join(' · ')}</span>
              {r.value !== undefined ? <span class="cval" title={r.expr ? '=' + r.expr : r.driven ? undefined : t('app.sketch.dim.editTip')}>{r.expr ? <i class="annot-fx">fx</i> : null}{Math.round(r.value * 100) / 100}</span> : null}
              {r.value !== undefined || r.driven ? <button class="cdrv" title={r.driven ? t('app.sketch.driving.tip') : t('app.sketch.driven.tip')} aria-label={r.driven ? t('app.sketch.driving.tip') : t('app.sketch.driven.tip')} aria-pressed={!!r.driven} onClick={(e) => { e.stopPropagation(); p.onToggleDriven?.(r.id, !!r.driven); }}>⇄</button> : null}
              <button class="cdel" title={t('app.sketch.deleteConstraint')} aria-label={t('app.sketch.deleteConstraint')} onClick={(e) => { e.stopPropagation(); p.onDelete(r.id); }}>×</button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

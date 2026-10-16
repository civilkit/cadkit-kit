import { signal } from '@preact/signals-core';
import { useSignals } from './useSignals';
import { t } from './i18n';
import { formatCursor, formatDelta, formatSpacing, formatZoom, type DisplayUnit } from './sketchStatus';
import { parseSpacing } from '@kit/viewport';
import { useState } from 'preact/hooks';

/** What the status bar shows about the pointer while sketching. Signals, so only the readout redraws on each pointer move. */
export const readout = {
  /** The pointer on the sketch plane (raw) with the zoom and the grid's minor spacing. */
  cursor: signal<{ u: number; v: number; upp: number; grid: number } | null>(null),
  /** Where the active snap put the point, and its name (already translated). */
  snapAt: signal<{ x: number; y: number } | null>(null),
  snapName: signal<string | null>(null),
  /** The last placed point of the shape being drawn. */
  from: signal<{ x: number; y: number } | null>(null),
  unit: signal<DisplayUnit>('mm'),
};
export const clearReadout = () => { readout.cursor.value = null; readout.snapAt.value = null; readout.snapName.value = null; readout.from.value = null; };

export interface ReadoutControls { snapOn: boolean; gridOn: boolean; gridBase: number; onSnap(on: boolean): void; onGrid(on: boolean): void; onSpacing(mm: number): void }

/** The sketch part of the status bar: coordinates, delta, active snap, Snap and Grid toggles, zoom and the editable grid spacing. */
export function SketchReadout(p: ReadoutControls) {
  useSignals(() => { readout.cursor.value; readout.snapAt.value; readout.snapName.value; readout.from.value; readout.unit.value; });
  const [edit, setEdit] = useState<string | null>(null);
  const c = readout.cursor.value;
  const unit = readout.unit.value;
  const at = readout.snapAt.value ?? (c ? { x: c.u, y: c.v } : null);
  const from = readout.from.value;
  const commit = () => { if (edit === null) return; const v = edit.trim() === '' || edit.trim() === '0' ? 0 : parseSpacing(/[a-z]/i.test(edit) ? edit : `${edit} ${unit}`); if (v !== null) p.onSpacing(v); setEdit(null); };
  return (
    <span class="st-sketch">
      <span class="st-coords" aria-label={t('app.status.cursor')}>{at && c ? formatCursor(at.x, at.y, c.upp, unit) : ' '}</span>
      {at && from && c ? <span class="st-delta">{formatDelta(from, at, c.upp, unit)}</span> : null}
      {readout.snapName.value ? <span class="st-snap">{t('app.status.snapName', { name: readout.snapName.value })}</span> : null}
      <label class="st-toggle"><input type="checkbox" checked={p.snapOn} onChange={(e) => p.onSnap((e.currentTarget as HTMLInputElement).checked)} />{t('app.status.snap')}</label>
      <label class="st-toggle"><input type="checkbox" checked={p.gridOn} onChange={(e) => p.onGrid((e.currentTarget as HTMLInputElement).checked)} />{t('app.status.grid')}</label>
      {c ? <span class="st-item">{t('app.status.zoom')} <b>{formatZoom(c.upp)}</b></span> : null}
      {edit !== null
        ? <input class="st-spacing-input" aria-label={t('app.status.gridSpacing')} value={edit} autoFocus
            onInput={(e) => setEdit((e.currentTarget as HTMLInputElement).value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setEdit(null); e.stopPropagation(); }} />
        : <button class="st-item st-chip st-spacing" title={t('app.status.gridSpacing.tip')} onClick={() => setEdit(String(p.gridBase > 0 ? p.gridBase : c?.grid ?? 10))}>
            {t('app.status.grid')} <b>{c || p.gridBase > 0 ? formatSpacing(p.gridBase > 0 ? p.gridBase : c!.grid, unit) : t('app.status.gridAuto')}</b>
          </button>}
    </span>
  );
}

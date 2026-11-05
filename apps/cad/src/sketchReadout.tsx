import { signal } from '@preact/signals-core';
import { useSignals } from './useSignals';
import { t } from './i18n';
import { cursorLabel, formatCursor, formatPoint3, formatDelta, formatSpacing, formatZoom, zoomPercent, type DisplayUnit } from './sketchStatus';
import { parseSpacing } from '@kit/viewport';
import { useRef, useState } from 'preact/hooks';

/** What the status bar shows about the pointer while sketching. Signals, so only the readout redraws on each pointer move. */
export const readout = {
  /** The pointer on the sketch plane (raw) with the zoom and the grid's minor spacing. */
  cursor: signal<{ u: number; v: number; upp: number; grid: number; x?: number; y?: number; w?: number; h?: number; touch?: boolean } | null>(null),
  /** The sketch view's scale and grid minor spacing, kept while the pointer is off the canvas (null outside a sketch). */
  view: signal<{ upp: number; grid: number } | null>(null),
  /** Where the active snap put the point, and its name (already translated). */
  snapAt: signal<{ x: number; y: number } | null>(null),
  snapName: signal<string | null>(null),
  /** The last placed point of the shape being drawn. */
  from: signal<{ x: number; y: number } | null>(null),
  unit: signal<DisplayUnit>('mm'),
  /** In model mode: the world point under the pointer. */
  model: signal<[number, number, number] | null>(null),
};
export const clearReadout = () => { readout.cursor.value = null; readout.snapAt.value = null; readout.snapName.value = null; readout.from.value = null; };

export interface ReadoutControls { snapOn: boolean; gridOn: boolean; gridBase: number; onSnap(on: boolean): void; onGrid(on: boolean): void; onSpacing(mm: number): void; /** The Zoom % field was edited: the new percentage (100 = real size). */ onZoom?(percent: number): void }

/** Keys typed in a status bar field belong to the field: Enter must not confirm the sketch, digits must not switch the view, letters must not pick tools. */
const keepKeys = (e: Event) => e.stopPropagation();

/** A small editable status bar field: shows `display` until focused, then the text `edit` offers; Enter or leaving commits it, Escape drops it. */
function StatusField(p: { label: string; aria: string; testid: string; title?: string; display: string; edit: string; onCommit(text: string): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const skip = useRef(false);
  const done = (commit: boolean) => { const d = draft; setDraft(null); if (commit && d !== null) p.onCommit(d); };
  return (
    <label class="st-field" title={p.title}>
      {p.label}
      <input class="st-input" data-testid={p.testid} aria-label={p.aria} inputMode="decimal" autoComplete="off" spellcheck={false}
        value={draft ?? p.display}
        onFocus={(e) => { skip.current = false; setDraft(p.edit); const el = e.currentTarget as HTMLInputElement; setTimeout(() => el.select(), 0); }}
        onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        onBlur={() => { if (skip.current) { skip.current = false; setDraft(null); } else done(true); }}
        onKeyDown={(e) => {
          keepKeys(e);
          if (e.key === 'Enter') { e.preventDefault(); done(true); skip.current = true; (e.currentTarget as HTMLInputElement).blur(); }   // skip: the blur must not commit a second time
          else if (e.key === 'Escape') { e.preventDefault(); skip.current = true; setDraft(null); (e.currentTarget as HTMLInputElement).blur(); }
        }}
        onKeyUp={keepKeys} onKeyPress={keepKeys} />
    </label>
  );
}

/** The sketch part of the status bar. Fixed slots, left to right: Snap, Grid, Zoom %, Spacing, then the pointer text (position, delta, snap name) in fixed-width boxes, so nothing moves as the pointer comes and goes. */
export function SketchReadout(p: ReadoutControls) {
  useSignals(() => { readout.cursor.value; readout.view.value; readout.snapAt.value; readout.snapName.value; readout.from.value; readout.unit.value; });
  const c = readout.cursor.value;
  const view = c ? { upp: c.upp, grid: c.grid } : readout.view.value;
  const unit = readout.unit.value;
  const at = readout.snapAt.value ?? (c ? { x: c.u, y: c.v } : null);
  const from = readout.from.value;
  const spacingMm = p.gridBase > 0 ? p.gridBase : view?.grid ?? null;
  const commitSpacing = (text: string) => { const v = text.trim() === '' || text.trim() === '0' ? 0 : parseSpacing(/[a-z]/i.test(text) ? text : `${text} ${unit}`); if (v !== null) p.onSpacing(v); };
  const commitZoom = (text: string) => { const v = parseFloat(text.replace('%', '').trim()); if (Number.isFinite(v) && v > 0) p.onZoom?.(v); };
  return (
    <span class="st-sketch" data-testid="status-sketch">
      <label class="st-toggle"><input type="checkbox" data-testid="status-snap" aria-label={t('app.status.snap')} checked={p.snapOn} onChange={(e) => p.onSnap((e.currentTarget as HTMLInputElement).checked)} />{t('app.status.snap')}</label>
      <label class="st-toggle"><input type="checkbox" data-testid="status-grid" aria-label={t('app.status.grid')} checked={p.gridOn} onChange={(e) => p.onGrid((e.currentTarget as HTMLInputElement).checked)} />{t('app.status.grid')}</label>
      <StatusField label={t('app.status.zoom')} aria={t('app.status.zoom.aria')} testid="status-zoom" title={t('app.status.zoom.tip')}
        display={view ? formatZoom(view.upp) : ''} edit={view ? String(zoomPercent(view.upp)) : ''} onCommit={commitZoom} />
      <StatusField label={t('app.status.spacing')} aria={t('app.status.gridSpacing')} testid="status-spacing" title={t('app.status.gridSpacing.tip')}
        display={spacingMm !== null ? formatSpacing(spacingMm, unit) : t('app.status.gridAuto')} edit={String(spacingMm ?? 10)} onCommit={commitSpacing} />
      <span class="st-coords" data-testid="status-coords" aria-label={t('app.status.cursor')}>{at && c ? formatCursor(at.x, at.y, c.upp, unit) : ' '}</span>
      <span class="st-delta" data-testid="status-delta">{at && from && c ? formatDelta(from, at, c.upp, unit) : ' '}</span>
      <span class="st-snap" data-testid="status-snapname">{readout.snapName.value ? t('app.status.snapName', { name: readout.snapName.value }) : ' '}</span>
    </span>
  );
}

/** Model mode: the coordinates of the point under the pointer on a face or edge. */
export function ModelReadout() {
  useSignals(() => { readout.model.value; readout.unit.value; });
  const m = readout.model.value;
  if (!m) return null;
  const unit = readout.unit.value;
  return <span class="st-sketch"><span class="st-coords" aria-label={t('app.status.model.cursor')}>{formatPoint3(m, unit)}</span></span>;
}

/** The coordinates beside the pointer while sketching (the status bar keeps its own). Drawn in the viewport layer; a finger has no hover, so touch shows nothing. */
export function CursorLabel(p: { enabled: boolean }) {
  useSignals(() => { readout.cursor.value; readout.snapAt.value; readout.unit.value; });
  const l = cursorLabel(readout.cursor.value, readout.snapAt.value, readout.unit.value, p.enabled);
  if (!l) return null;
  return <div class="cursor-label" data-testid="cursor-label" aria-hidden="true" style={{ left: l.left + 'px', top: l.top + 'px' }}>{l.text}</div>;
}

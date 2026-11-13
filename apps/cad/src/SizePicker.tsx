// A small reusable "standard size or custom" picker: a Standard / Custom switch and, in Standard mode, a filter box over a scrollable list of rows. The caller owns
// the rows and what picking one does (Washer wizard: fills three numbers; the Screw and Nut wizards can adopt it the same way). Typing in the filter narrows the
// rows to those whose label contains every word typed ('m8', '8', '7089', 'iso 7093'); Enter picks the only row left.
import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { textAttrs } from '@kit/ui';

export interface SizeRow { id: string; label: string; /** a small second line or tag, e.g. the standard */ note?: string }
export type SizeMode = 'standard' | 'custom';

export interface SizePickerProps {
  rows: readonly SizeRow[];
  mode: SizeMode;
  onMode(next: SizeMode): void;
  /** the id of the row that matches the current numbers (highlighted), if any */
  selectedId?: string | null;
  onPick(id: string): void;
  filterPlaceholder: string;
  standardLabel: string;
  customLabel: string;
  emptyText: string;
  testId?: string;
}

/** The rows whose label (or id) contains every word of the query, case-insensitively. An empty query keeps all. */
export function filterRows<R extends SizeRow>(rows: readonly R[], query: string): R[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...rows];
  return rows.filter((r) => { const hay = `${r.label} ${r.id}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}

export function SizePicker(p: SizePickerProps): JSX.Element {
  const [q, setQ] = useState('');
  const id = p.testId ?? 'size-picker';
  const shown = filterRows(p.rows, q);
  return (
    <div class="size-picker" data-testid={id}>
      <div class="size-picker-mode" role="group">
        {(['standard', 'custom'] as const).map((m) => (
          <button type="button" key={m} class={'fedit-card-btn' + (p.mode === m ? ' on' : '')} aria-pressed={p.mode === m} data-mode={m} onClick={() => p.onMode(m)}>{m === 'standard' ? p.standardLabel : p.customLabel}</button>
        ))}
      </div>
      {p.mode === 'standard' ? (
        <>
          <input {...textAttrs} type="search" enterKeyHint="search" class="size-picker-filter" value={q} placeholder={p.filterPlaceholder} aria-label={p.filterPlaceholder} data-testid={id + '-filter'}
            onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (shown.length === 1) p.onPick(shown[0].id); } }} />
          <div class="size-picker-list" role="listbox" aria-label={p.filterPlaceholder} data-testid={id + '-list'}>
            {shown.length === 0 ? <div class="size-picker-empty">{p.emptyText}</div> : shown.map((r) => (
              <button type="button" key={r.id} role="option" aria-selected={p.selectedId === r.id} class={'size-picker-row' + (p.selectedId === r.id ? ' on' : '')} data-row={r.id} onClick={() => p.onPick(r.id)}>{r.label}</button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

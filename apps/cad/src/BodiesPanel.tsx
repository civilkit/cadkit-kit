import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { FINISHES, PICK_OPACITY } from '@kit/viewport';
import { t } from './i18n';
import { FINISH_LABEL_KEY, GLASS_PRESET, SWATCH_DEFAULT, type BodyLookSpec, type BodyRow, type Finish } from './bodies';

export interface BodiesPanelProps {
  rows: BodyRow[];
  /** keys of the bodies selected in the viewport or in this list */
  selected: string[];
  onSelect(key: string, additive: boolean): void;
  onToggleHidden(key: string): void;
  onSolo(key: string): void;
  onShowAll(): void;
  onHideOthers(): void;
  onRename(key: string, name: string): void;
  /** Edits of whole bodies (features): a copy in place, delete, and the first body combined with the others. Without them the buttons are not shown. */
  onCopy?(key: string): void;
  onRemove?(keys: string[]): void;
  onCombine?(op: 'union' | 'cut' | 'intersect', keys: string[]): void;
  onLook(key: string, patch: Partial<Record<keyof BodyLookSpec, BodyLookSpec[keyof BodyLookSpec] | undefined>>): void;
}

const fmtVol = (v: number | null): string => (v === null ? '' : v >= 1000 ? `${(v / 1000).toFixed(v >= 1e5 ? 0 : 1)} cm³` : `${v.toFixed(v >= 100 ? 0 : 1)} mm³`);

/** The Bodies list: one row per lump of the result. The eye and the solo button are view state (no feature, no undo step); the detail below the
 *  list edits the selected body's colour, opacity and finish. Keyboard: arrows move, Space shows or hides, Enter selects, F2 renames. */
export function BodiesPanel(p: BodiesPanelProps): JSX.Element {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const hiddenN = p.rows.filter((r) => r.hidden).length;
  const cur = p.rows.find((r) => r.key === p.selected[p.selected.length - 1]) ?? null;
  useEffect(() => { if (renaming && !p.rows.some((r) => r.key === renaming)) setRenaming(null); }, [p.rows, renaming]);
  const focusRow = (i: number): void => { (listRef.current?.querySelectorAll<HTMLElement>('li.body-row')[i])?.focus(); };
  const commit = (): void => { if (renaming) p.onRename(renaming, draft); setRenaming(null); };

  const hint = p.rows.length ? <div class="bodies-hint">{t('bodies.pick')}</div> : null;
  const detail = cur ? <LookEditor row={cur} onLook={(patch) => p.onLook(cur.key, patch)} /> : hint;
  return (
    <section class="bodies" aria-label={t('bodies.title')}>
      <header class="bodies-head">
        <span class="bodies-count" aria-live="polite">{t('bodies.count', { count: p.rows.length })}{hiddenN ? ' · ' + t('bodies.hiddenCount', { count: hiddenN }) : ''}</span>
        <span class="bodies-actions">
          <button type="button" class="bodies-btn" disabled={!hiddenN} onClick={p.onShowAll}>{t('bodies.showAll')}</button>
          <button type="button" class="bodies-btn" disabled={!p.selected.length || p.rows.length < 2} onClick={p.onHideOthers}>{t('bodies.hideOthers')}</button>
        </span>
      </header>
      {p.onCopy && p.onRemove && p.onCombine && p.rows.length ? (
        <div class="bodies-edit" role="group" aria-label={t('bodies.editGroup')}>
          <button type="button" class="bodies-btn" disabled={p.selected.length !== 1} title={t('bodies.copyTip')} onClick={() => p.onCopy!(p.selected[0])}>{t('bodies.copy')}</button>
          <button type="button" class="bodies-btn" disabled={!p.selected.length} title={t('bodies.removeTip')} onClick={() => p.onRemove!(p.selected)}>{t('bodies.remove')}</button>
          {(['union', 'cut', 'intersect'] as const).map((op) => (
            <button key={op} type="button" class="bodies-btn" disabled={p.selected.length < 2} title={t('bodies.combineTip')} onClick={() => p.onCombine!(op, p.selected)}>{t(op === 'union' ? 'bodies.join' : op === 'cut' ? 'bodies.cut' : 'bodies.intersect')}</button>
          ))}
        </div>
      ) : null}
      {p.rows.length === 0 ? <div class="empty">{t('bodies.empty')}</div> : (
        <ul class="body-list" role="listbox" aria-multiselectable="true" aria-label={t('bodies.list')} ref={listRef}>
          {p.rows.map((r, i) => {
            const sel = p.selected.includes(r.key);
            const sw = r.look.color ?? SWATCH_DEFAULT;
            return (
              <li key={r.key} class={'body-row' + (sel ? ' sel' : '') + (r.hidden ? ' off' : '')} role="option" aria-selected={sel} tabIndex={0} data-key={r.key}
                aria-label={r.name + (r.hidden ? ', ' + t('bodies.hidden') : '')}
                onClick={(e) => p.onSelect(r.key, e.shiftKey || e.ctrlKey || e.metaKey)}
                onDblClick={() => { setRenaming(r.key); setDraft(r.name); }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === ' ') { e.preventDefault(); p.onToggleHidden(r.key); }
                  else if (e.key === 'Enter') { e.preventDefault(); p.onSelect(r.key, e.shiftKey); }
                  else if (e.key === 'F2') { e.preventDefault(); setRenaming(r.key); setDraft(r.name); }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(Math.min(p.rows.length - 1, i + 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(Math.max(0, i - 1)); }
                }}>
                <button type="button" class="body-eye" aria-pressed={!r.hidden} aria-label={(r.hidden ? t('bodies.show') : t('bodies.hide')) + ': ' + r.name} title={r.hidden ? t('bodies.show') : t('bodies.hide')}
                  onClick={(e) => { e.stopPropagation(); p.onToggleHidden(r.key); }}><Icon name={r.hidden ? 'eye-off' : 'eye'} size={15} /></button>
                <span class="body-swatch" style={{ background: sw, opacity: Math.max(0.25, r.look.opacity ?? 1) }} aria-hidden="true" />
                {renaming === r.key ? (
                  <input class="body-name-edit" value={draft} aria-label={t('bodies.rename')} autoFocus spellcheck={false}
                    onClick={(e) => e.stopPropagation()} onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)} onBlur={commit}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setRenaming(null); }} />
                ) : <span class="body-name" title={r.name}>{r.name}</span>}
                <span class="body-vol">{fmtVol(r.volume)}</span>
                <button type="button" class="body-solo" aria-label={t('bodies.solo') + ': ' + r.name} title={t('bodies.solo')}
                  onClick={(e) => { e.stopPropagation(); p.onSolo(r.key); }}><Icon name="isolate" size={15} /></button>
              </li>
            );
          })}
        </ul>
      )}
      {detail}
    </section>
  );
}

function LookEditor(p: { row: BodyRow; onLook(patch: Partial<Record<keyof BodyLookSpec, BodyLookSpec[keyof BodyLookSpec] | undefined>>): void }): JSX.Element {
  const l = p.row.look;
  const op = Math.round((l.opacity ?? 1) * 100);
  const id = 'body-look-' + p.row.key.replace(/\W/g, '_');
  return (
    <div class="body-look" role="group" aria-label={t('bodies.appearance') + ': ' + p.row.name}>
      <div class="body-look-title">{t('bodies.appearance')}</div>
      <label class="body-field" for={id + '-c'}><span>{t('bodies.color')}</span>
        <input id={id + '-c'} type="color" value={l.color ?? SWATCH_DEFAULT} onInput={(e) => p.onLook({ color: (e.currentTarget as HTMLInputElement).value })} />
      </label>
      <label class="body-field" for={id + '-o'}><span>{t('bodies.opacity')}</span>
        <input id={id + '-o'} type="range" min={5} max={100} step={1} value={op} aria-valuetext={`${op}%`} onInput={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value) / 100; p.onLook({ opacity: v >= 1 ? undefined : v }); }} />
        <output>{op}%</output>
      </label>
      {op / 100 < PICK_OPACITY ? <div class="bodies-hint">{t('bodies.clear')}</div> : null}
      <label class="body-field" for={id + '-f'}><span>{t('bodies.finish')}</span>
        <select id={id + '-f'} value={l.finish ?? ''} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; p.onLook({ finish: v ? (v as Finish) : undefined }); }}>
          <option value="">{t('bodies.finish.default')}</option>
          {FINISHES.map((f) => <option key={f} value={f}>{t(FINISH_LABEL_KEY[f])}</option>)}
        </select>
      </label>
      <div class="body-presets">
        <button type="button" class="bodies-btn" onClick={() => p.onLook({ ...GLASS_PRESET })}>{t('bodies.preset.glass')}</button>
        <button type="button" class="bodies-btn" onClick={() => p.onLook({ color: '#e4e7ea', finish: 'chrome', opacity: undefined })}>{t('bodies.preset.chrome')}</button>
        <button type="button" class="bodies-btn" disabled={!Object.keys(l).length} onClick={() => p.onLook({ color: undefined, opacity: undefined, finish: undefined })}>{t('bodies.reset')}</button>
      </div>
    </div>
  );
}

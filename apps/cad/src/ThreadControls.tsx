// The controls the Thread editor and the Hole editor's thread blocks share, so the two look identical: the label/control
// rows (Select, Seg, Check), the size combobox, the one-row size chips, the readout card, and the Length / Hand / Model
// rows. No state of their own beyond the combobox; the editors own the draft.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import {
  CLEARANCE_MAX, NEAREST_MARKED, THREAD_CLEARANCES, THREAD_HANDS, filterSizes, nearestSizes, readoutRows, sizeLabel, type ThreadClearance, type ThreadRow, type ThreadStd,
} from './threadData';

export const fmt = (v: number): string => String(Math.round(v * 1000) / 1000);
export const stdLabel = (s: ThreadStd): string => t('thread.std.' + s.id, undefined, s.description);

export function Select(p: { name: string; label: string; value: string; stack?: boolean; onChange(v: string): void; children: ComponentChildren }): JSX.Element {
  return (
    <label class={'fedit-fld' + (p.stack ? ' stack' : '')} data-path={p.name}>
      <span class="fedit-fld-label">{p.label}</span>
      <select value={p.value} onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value)}>{p.children}</select>
    </label>
  );
}

/** A segmented control (radio group): arrow keys move the choice, Tab leaves the group. */
export function Seg<V extends string>(p: { name: string; label: string; value: V; options: Array<{ value: V; text: string; icon?: string; tip?: string }>; onChange(v: V): void; /** Shown to the right of the control, in the same row. */ trail?: ComponentChildren }): JSX.Element {
  const move = (e: KeyboardEvent, i: number): void => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = p.options[(i + d + p.options.length) % p.options.length];
    p.onChange(next.value);
    ((e.currentTarget as HTMLElement).parentElement?.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div class="fedit-fld" data-path={p.name}>
      <span class="fedit-fld-label" id={`thread-${p.name}-label`}>{p.label}</span>
      <div class="fedit-ctl">
      <div class="thread-seg" role="radiogroup" aria-labelledby={`thread-${p.name}-label`}>
        {p.options.map((o, i) => (
          <button key={o.value} type="button" role="radio" aria-checked={p.value === o.value} data-value={o.value} title={o.tip ?? o.text}
            tabIndex={p.value === o.value ? 0 : -1} class={p.value === o.value ? 'on' : ''} onClick={() => p.onChange(o.value)} onKeyDown={(e) => move(e, i)}>
            {o.icon ? <Icon name={o.icon} size={16} /> : null}<span>{o.text}</span>
          </button>
        ))}
      </div>
      {p.trail}
      </div>
    </div>
  );
}

type Item = { head: string } | { row: ThreadRow };
/** The size field: a combobox with a listbox. Type to filter (name or diameter), Up / Down move, Enter picks, Esc closes the list. */
export function SizePicker(p: { rows: ThreadRow[]; value: string; dia: number | null; internal?: boolean; standard: string; onPick(size: string): void }): JSX.Element {
  const [q, setQ] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const query = q ?? '';
  const matches = filterSizes(p.rows, query, p.dia, p.internal);
  const items: Item[] = [];
  if (!query.trim()) {
    const near = p.dia !== null ? nearestSizes(p.rows, p.dia, p.internal).slice(0, NEAREST_MARKED) : [];
    const nearSet = new Set(near.map((r) => r.size));
    if (near.length) { items.push({ head: t('thread.size.nearest', { d: fmt(p.dia!) }) }); for (const r of near) items.push({ row: r }); }
    const rest = matches.filter((r) => !nearSet.has(r.size));
    if (rest.length) { items.push({ head: t(p.standard === 'metric' ? 'thread.size.coarse' : p.standard === 'metric-fine' ? 'thread.size.fine' : 'thread.size.all') }); for (const r of rest) items.push({ row: r }); }
  } else for (const r of matches) items.push({ row: r });
  const opts = items.filter((x): x is { row: ThreadRow } => 'row' in x);
  const cur = Math.min(act, Math.max(0, opts.length - 1));
  useEffect(() => { (listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' }); }, [cur, open]);
  const pick = (r: ThreadRow): void => { setOpen(false); setQ(null); p.onPick(r.size); };
  const current = p.rows.find((r) => r.size === p.value);
  const shown = q ?? (current ? sizeLabel(current) : p.value);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (!open) { setOpen(true); setAct(0); return; }
      setAct((cur + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % Math.max(1, opts.length));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault(); e.stopPropagation();
      if (opts[cur]) pick(opts[cur].row);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault(); e.stopPropagation();
      setOpen(false); setQ(null);
    }
  };
  let oi = -1;
  return (
    <div class="fedit-fld" data-path="size">
      <label class="fedit-fld-label" for="thread-size-input">{t('thread.size')}</label>
      <div class="thread-combo">
        <input id="thread-size-input" type="text" role="combobox" aria-expanded={open} aria-controls="thread-size-list" aria-autocomplete="list" autocomplete="off"
          aria-activedescendant={open && opts.length ? `thread-size-opt-${cur}` : undefined} aria-label={t('thread.size')} title={t('thread.sizeSearch')}
          value={shown} spellcheck={false}
          onFocus={(e) => { (e.currentTarget as HTMLInputElement).select(); setOpen(true); setAct(0); }}
          onBlur={() => { setOpen(false); setQ(null); }}
          onInput={(e) => { setQ((e.currentTarget as HTMLInputElement).value); setOpen(true); setAct(0); }}
          onKeyDown={onKey} />
        {open ? (
          <ul id="thread-size-list" role="listbox" class="thread-list" ref={listRef} aria-label={t('thread.size')}>
            {opts.length === 0 ? <li class="thread-list-empty" role="presentation">{t('thread.size.none')}</li> : null}
            {items.map((it, i) => {
              if ('head' in it) return <li key={'h' + i} role="presentation" class="thread-list-head">{it.head}</li>;
              oi++;
              const k = oi;
              return (
                <li key={it.row.size} id={`thread-size-opt-${k}`} role="option" aria-selected={it.row.size === p.value} data-active={k === cur} data-size={it.row.size}
                  class={(k === cur ? 'active ' : '') + (it.row.size === p.value ? 'sel' : '')}
                  onMouseDown={(e) => { e.preventDefault(); pick(it.row); }} onMouseEnter={() => setAct(k)}>{sizeLabel(it.row)}</li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}


/** A checkbox row: the label, and under it a muted second line (a note or the cost) when there is one. */
export function Check(p: { name: string; label: string; checked: boolean; disabled?: boolean; sub?: ComponentChildren; subTestId?: string; strong?: boolean; onChange(v: boolean): void }): JSX.Element {
  return (
    <label class={'fedit-fld bool' + (p.strong ? ' strong' : '')} data-path={p.name}>
      <input type="checkbox" checked={p.checked} disabled={p.disabled} aria-label={p.label} onChange={(e) => p.onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span class="fedit-check-text">
        <span class="fedit-fld-label">{p.label}</span>
        {p.sub ? <span class="fedit-sub" data-testid={p.subTestId}>{p.sub}</span> : null}
      </span>
    </label>
  );
}

/** The common sizes in ONE row that scrolls sideways (the picked one is kept in view); the Size field below reaches the rest. */
export function SizeChips(p: { chips: string[]; value: string; onPick(size: string): void }): JSX.Element | null {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = box.current?.querySelector('.on') as HTMLElement | null;
    const el = box.current;
    if (on && el && on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth - 18) el.scrollLeft = Math.max(0, on.offsetLeft - 8);
  }, [p.value, p.chips.join()]);
  if (!p.chips.length) return null;
  return (
    <div class="thread-chips" ref={box} onWheel={(e) => { const el = e.currentTarget as HTMLElement; if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); } }} role="group" aria-label={t('thread.sizeQuick')} data-testid="thread-chips">
      {p.chips.map((c) => <button key={c} type="button" class={'thread-chipbtn' + (c === p.value ? ' on' : '')} aria-pressed={c === p.value} data-size={c} onClick={() => p.onPick(c)}>{c}</button>)}
    </div>
  );
}

/** What the size means in numbers, as a grid of label over value cells (tap drill, minor diameter, pitch ...). */
export function ReadoutCard(p: { row: ThreadRow | undefined; internal: boolean | undefined; empty?: string }): JSX.Element {
  const row = p.row;
  if (!row) return <div class="thread-hint" data-testid="thread-readout">{p.empty ?? ''}</div>;
  return (
    <div class="thread-card" data-testid="thread-card">
      <div class="thread-card-title">{sizeLabel(row)}</div>
      <dl class="thread-readout" data-testid="thread-readout">
        {readoutRows(row, p.internal).map((r) => (
          <div class="thread-cell" key={r.key}>
            <dt>{t(r.key === 'root' ? 'thread.root' : r.key === 'minor' && p.internal !== false ? (p.internal ? 'thread.minorD1' : 'thread.minor') : 'thread.' + r.key)}</dt>
            <dd data-k={r.key}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Length: Full | Custom, with the number to the right of the control while Custom (nothing else shows for Full). */
export function LengthRow(p: { custom: boolean; value: number | null; fullLength: number | null; min: number | undefined; max: number | null; onMode(custom: boolean): void; onValue(v: number): void }): JSX.Element {
  return (
    <Seg name="lengthMode" label={t('thread.length')} value={p.custom ? 'custom' : 'full'}
      options={[{ value: 'full', text: t('thread.length.full') }, { value: 'custom', text: t('thread.length.custom') }]}
      onChange={(v) => p.onMode(v === 'custom')}
      trail={p.custom ? (
        <span class="fedit-num fedit-inline" data-path="length">
          <input type="number" step="any" min={p.min !== undefined ? String(p.min) : '0'} max={p.max !== null ? String(p.max) : undefined} aria-label={t('thread.length')}
            title={p.max !== null ? t('thread.length.max', { v: fmt(p.max) }) : undefined} value={p.value === null ? '' : fmt(p.value)}
            onChange={(e) => { const raw = (e.currentTarget as HTMLInputElement).value; const v = Number(raw); if (raw.trim() !== '' && Number.isFinite(v) && v > 0) p.onValue(v); }} />
          <span class="fedit-unit">mm</span>
        </span>
      ) : p.fullLength !== null ? <span class="fedit-sub" data-testid="thread-fulllen">{fmt(p.fullLength)} mm</span> : null} />
  );
}

export function HandRow(p: { value: 'right' | 'left'; onChange(v: 'right' | 'left'): void }): JSX.Element {
  return (
    <Seg name="hand" label={t('thread.hand')} value={p.value}
      options={THREAD_HANDS.map((h) => ({ value: h, text: t('thread.hand.' + h), icon: h === 'left' ? 'helix-left' : 'helix-right', tip: t('thread.hand.' + h + 'Tip') }))}
      onChange={p.onChange} />
  );
}

/** Printed-thread clearance: None | Wider | Narrower, with the millimetres to the right once one is chosen. */
export function ClearanceRow(p: { dir: ThreadClearance; mm: number; onDir(d: ThreadClearance): void; onValue(v: number): void }): JSX.Element {
  return (
    <Seg name="clearance" label={t('thread.clearance')} value={p.dir}
      options={THREAD_CLEARANCES.map((c) => ({ value: c, text: t('thread.clearance.' + c), tip: t('thread.clearance.' + c + 'Tip') }))}
      onChange={p.onDir}
      trail={p.dir !== 'none' ? (
        <span class="fedit-num fedit-inline" data-path="clearanceValue">
          <input type="number" step="0.05" min="0.01" max={String(CLEARANCE_MAX)} aria-label={t('thread.clearance')} value={fmt(p.mm)}
            onChange={(e) => { const raw = (e.currentTarget as HTMLInputElement).value; const v = Number(raw); if (raw.trim() !== '' && Number.isFinite(v) && v > 0) p.onValue(v); }} />
          <span class="fedit-unit">mm</span>
        </span>
      ) : <span class="fedit-sub">{t('thread.clearance.sub')}</span>} />
  );
}

/** "Model the thread" with its cost as the muted second line. */
export function ModelRow(p: { on: boolean; seconds: number | null; onChange(v: boolean): void }): JSX.Element {
  return (
    <Check name="modeled" label={t('thread.modeled')} checked={p.on} onChange={p.onChange}
      sub={p.on ? (p.seconds ? t('thread.modeled.cost', { n: p.seconds }) : t('thread.modeled.costUnknown')) : t('thread.modeled.sub')}
      subTestId={p.on ? 'thread-cost' : undefined} />
  );
}

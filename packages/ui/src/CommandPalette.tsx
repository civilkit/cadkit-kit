import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Command } from './Ribbon';
import { t } from './i18n';
import { textAttrs } from './keypad';

/** Search popup over the single command registry. Enter runs the highlighted command, Esc closes. */
export function CommandPalette(p: { commands: Command[]; pinned?: string[]; onClose(): void; onRun?(c: Command): void }): JSX.Element {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const rows = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return p.commands.filter((c) => terms.every((term) => `${c.label} ${c.group} ${c.tab}`.toLowerCase().includes(term)));
  }, [q, p.commands]);
  const pinned = q ? [] : p.commands.filter((c) => p.pinned?.includes(c.id));
  const run = (c: Command | undefined) => {
    if (!c || (c.enabled && !c.enabled())) return;
    p.onClose();
    c.run();
    p.onRun?.(c);
  };
  return (
    <div class="pal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="pal" role="dialog" aria-label={t('ui.palette.label')}>
        <input {...textAttrs} type="search" enterKeyHint="search"
          ref={input}
          placeholder={t('ui.palette.search')}
          aria-label={t('ui.palette.search')}
          value={q}
          onInput={(e) => { setQ((e.currentTarget as HTMLInputElement).value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); p.onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(rows.length - 1, h + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); run(rows[hi]); }
          }}
        />
        {pinned.length ? (
          <div class="pgrid">
            {pinned.map((c) => <button key={c.id} title={c.label} onClick={() => run(c)}>{c.icon ?? c.label}</button>)}
          </div>
        ) : null}
        <div class="plbl">{t('ui.palette.heading')}</div>
        <div class="plist" role="listbox">
          {rows.map((c, i) => (
            <div
              key={c.id}
              role="option"
              aria-selected={i === hi}
              aria-disabled={c.enabled ? !c.enabled() : false}
              class={'it' + (i === hi ? ' on' : '') + (c.enabled && !c.enabled() ? ' dis' : '')}
              onClick={() => run(c)}
            >
              <span>{c.label}</span>
              {c.keys ? <kbd>{c.keys}</kbd> : null}
              <span class="grp-tag">{t('group.' + c.group, undefined, c.group)}</span>
            </div>
          ))}
          {rows.length === 0 ? <div class="empty">{t('ui.palette.none', { query: q })}</div> : null}
        </div>
      </div>
    </div>
  );
}

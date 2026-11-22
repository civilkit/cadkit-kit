import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Command } from '@kit/ui';
import { textAttrs } from '@kit/ui';
import { t } from './i18n';
import { shortcutRows, shortcutSections } from './shortcuts';

/** The keyboard shortcut cheat sheet: a searchable overlay of every key, read from the app's own tables (shortcuts.ts). Esc or a click outside closes it. */
export function ShortcutSheet(p: { commands: Command[]; onClose(): void }): JSX.Element {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); p.onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  const rows = useMemo(() => shortcutRows(p.commands), [p.commands]);
  const sections = useMemo(() => shortcutSections(rows, q), [rows, q]);
  return (
    <div class="pal-back" data-testid="shortcut-sheet" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="pal kbd-sheet" role="dialog" aria-label={t('shortcuts.title')}>
        <input {...textAttrs} type="search" ref={input} placeholder={t('shortcuts.search')} aria-label={t('shortcuts.search')} value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
        <div class="plist">
          {sections.map((s) => (
            <section key={s.group} data-group={s.group}>
              <div class="plbl">{s.title}</div>
              {s.rows.map((r) => (
                <div key={r.id} class="it" data-shortcut={r.id}><span>{r.label}</span><kbd>{r.keys}</kbd></div>
              ))}
            </section>
          ))}
          {sections.length === 0 ? <div class="empty">{t('shortcuts.none', { query: q })}</div> : null}
        </div>
        <div class="kbd-note">{t('shortcuts.note')}</div>
      </div>
    </div>
  );
}

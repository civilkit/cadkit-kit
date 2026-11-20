/** The freedom section of the definition badge's popover: what can still move, and chips that pin it. */
import { useState } from 'preact/hooks';
import type { FreeItem, Suggestion } from '@kit/sketch';
import { t } from './i18n';
import { freeText, freeParts, suggestionText } from './freedomText';
import { FREE_VISIBLE, freeVisibleCount } from './dofPopover';

export function SketchFreedomList(p: { items: FreeItem[] | null; suggestions: Suggestion[]; busy: boolean; onRun(s: Suggestion): void; onAnalyse(): void }) {
  const [all, setAll] = useState(false);
  if (!p.items) return <p class="free-none"><button class="rb-btn" data-action="analyse-freedom" onClick={p.onAnalyse}>{t('app.sketch.free.show')}</button></p>;
  if (!p.items.length) return null;
  const shown = p.items.slice(0, freeVisibleCount(p.items.length, all));
  return (
    <section class="sketch-free" aria-label={t('app.sketch.free.title')}>
      <b class="free-head">{t('app.sketch.free.title')}</b>
      <ul>
        {shown.map((it) => {
          const w = freeParts(it);
          return (
            <li key={it.key} data-key={it.key} title={freeText(it)}>
              <span class="free-line"><b class="free-name">{w.name}</b><span class="free-what"> - {w.meaning}</span></span>
              <span class="free-chips">
                {p.suggestions.filter((s) => s.itemKey === it.key).map((s) => (
                  <button key={s.type + s.refs.join(',')} class="free-chip" disabled={p.busy} title={t('app.sketch.free.sug.tip')} onClick={() => p.onRun(s)}>{suggestionText(s)}</button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      {p.items.length > FREE_VISIBLE ? (
        <button class="free-more" data-action="free-show-all" aria-expanded={all} onClick={() => setAll(!all)}>{all ? t('app.sketch.free.showFewer') : t('app.sketch.free.showAll', { count: p.items.length })}</button>
      ) : null}
    </section>
  );
}

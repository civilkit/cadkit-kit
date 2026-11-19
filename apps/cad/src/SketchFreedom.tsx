/** The freedom section of the definition badge's popover: what can still move, and chips that pin it. */
import type { FreeItem, Suggestion } from '@kit/sketch';
import { t } from './i18n';
import { freeText, suggestionText } from './freedomText';

export function SketchFreedomList(p: { items: FreeItem[] | null; suggestions: Suggestion[]; busy: boolean; onRun(s: Suggestion): void; onAnalyse(): void }) {
  if (!p.items) return <p class="free-none"><button class="rb-btn" data-action="analyse-freedom" onClick={p.onAnalyse}>{t('app.sketch.free.show')}</button></p>;
  if (!p.items.length) return null;
  return (
    <section class="sketch-free" aria-label={t('app.sketch.free.title')}>
      <b>{t('app.sketch.free.title')}</b>
      <ul>
        {p.items.map((it) => (
          <li key={it.key} data-key={it.key}>
            <span class="free-text">{freeText(it)}</span>
            <span class="free-chips">
              {p.suggestions.filter((s) => s.itemKey === it.key).map((s) => (
                <button key={s.type + s.refs.join(',')} class="free-chip" disabled={p.busy} title={t('app.sketch.free.sug.tip')} onClick={() => p.onRun(s)}>{suggestionText(s)}</button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

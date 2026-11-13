// The filter bar both Library surfaces share (the top-bar Library picker and the Catalog's Libraries tab): a search box, the source
// chips (where the surface has them), the category list with counts, the tags of the current results as chips (several = AND), a
// "clear filters" control and the "Make one with a wizard" link. It only shows and edits the filter; the surface owns the state
// and calls filterEntries (entries.ts) for the list.
import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { categoriesOf, categoryCounts, categoryLabel, tagCounts, wizardsFor, type LibEntry, type WizardId } from './entries';
import type { SourceFilter } from './state';
import { textAttrs } from '@kit/ui';

export const TAG_CHIPS = 12;

export interface FilterBarProps {
  /** all the entries the surface lists (unfiltered) */
  entries: LibEntry[];
  q: string; onQ(q: string): void;
  category: string; tags: string[];
  /** the category and tags together (one call, so a change never works from a stale half) */
  onFilter(category: string, tags: string[]): void;
  /** the source chips (omitted: the surface has none) */
  source?: SourceFilter; onSource?(s: SourceFilter): void;
  placeholder?: string;
  autofocus?: boolean;
  /** open the wizard that makes this kind of part (an id that is missing here shows no link) */
  wizards?: Partial<Record<WizardId, () => void>>;
}

export function FilterBar(p: FilterBarProps) {
  const [more, setMore] = useState(false);
  const source = p.source ?? 'all';
  const f = { q: p.q, source, category: p.category, tags: p.tags };
  const cats = categoriesOf(p.entries, source);
  const { total, counts } = categoryCounts(p.entries, f);
  const chips = tagCounts(p.entries, f);
  const shown = more ? chips : chips.filter((c, i) => i < TAG_CHIPS || p.tags.includes(c.tag));
  const active = p.category !== 'all' || p.tags.length > 0 || p.q.trim() !== '';
  const links = wizardsFor(p.category, p.tags).filter((id) => p.wizards?.[id]);
  const toggle = (tag: string) => p.onFilter(p.category, p.tags.includes(tag) ? p.tags.filter((x) => x !== tag) : [...p.tags, tag]);
  return (
    <div class="lf" data-testid="lib-filterbar">
      <input {...textAttrs} type="search" enterKeyHint="search" class="lf-search bosl-search" autofocus={p.autofocus} value={p.q} placeholder={p.placeholder ?? t('library.search')} aria-label={p.placeholder ?? t('library.search')}
        onInput={(e) => p.onQ((e.currentTarget as HTMLInputElement).value)} />
      <div class="lib-filters">
        {p.onSource ? (
          <div class="bosl-cats" role="tablist" aria-label={t('library.source')}>
            {(['all', 'included', 'addon'] as SourceFilter[]).map((s) => <button key={s} role="tab" aria-selected={source === s} class={'bosl-cat' + (source === s ? ' on' : '')} onClick={() => p.onSource!(s)}>{t('library.source.' + s)}</button>)}
          </div>
        ) : null}
        <select aria-label={t('library.category')} value={p.category} onChange={(e) => p.onFilter((e.currentTarget as HTMLSelectElement).value, p.tags)}>
          <option value="all">{`${categoryLabel('all')} (${total})`}</option>
          {cats.map((c) => <option key={c} value={c} disabled={!counts.get(c) && c !== p.category}>{`${categoryLabel(c)} (${counts.get(c) ?? 0})`}</option>)}
        </select>
        {active ? <button class="lf-clear" data-testid="lib-clear" onClick={() => { p.onQ(''); p.onFilter('all', []); }}>{t('library.filter.clear')}</button> : null}
      </div>
      {links.length ? (
        <div class="lf-wizards">
          {links.map((id) => <button key={id} class="lib-link" data-wizard={id} onClick={p.wizards![id]}>{t('library.wizard.' + id)}</button>)}
        </div>
      ) : null}
      {chips.length ? (
        <div class="lf-tags" role="group" aria-label={t('library.filter.tags')}>
          {shown.map((c) => <button key={c.tag} class={'lf-chip' + (p.tags.includes(c.tag) ? ' on' : '')} data-tag={c.tag} aria-pressed={p.tags.includes(c.tag)} onClick={() => toggle(c.tag)}>{c.tag}<span class="lf-n">{c.count}</span></button>)}
          {chips.length > shown.length || more ? <button class="lib-link lf-more" data-testid="lib-tags-more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? t('library.filter.fewer') : t('library.filter.more', { count: chips.length - shown.length })}</button> : null}
        </div>
      ) : null}
    </div>
  );
}

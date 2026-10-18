import { useEffect, useMemo, useState } from 'preact/hooks';
import { t } from './i18n';
import { ago } from './files/strings';
import type { RecentEntry } from './files/recent';
import { CategoryIcon } from './library/CategoryIcon';
import './files/files.css';

export interface SampleEntry { id: string; title: string; url: string }

/** A small picture that loads lazily and gives way to the category icon of `name` when there is none (or it fails to load). */
export function ThumbImg(p: { src?: string; name: string; class?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [p.src]);
  if (!p.src || bad) return <span class={`thumb-fallback ${p.class ?? ''}`} title={t('files.recent.noPreview')} data-fallback><CategoryIcon category={p.name} /></span>;
  return <img class={p.class} loading="lazy" decoding="async" alt="" src={p.src} onError={() => setBad(true)} />;
}

/** Filterable sample picker. The filter text survives close and reopen (module state), so it opens where you were. */
let lastQuery = '';

export function SamplesDialog(p: { samples: SampleEntry[]; thumbBase: string; onPick(s: SampleEntry): void; onClose(): void; recent?: RecentEntry[]; /** pictures of recent files, data URLs by file name */ recentThumbs?: Record<string, string>; onPickRecent?(e: RecentEntry): void }) {
  const [q, setQ] = useState(lastQuery);
  useEffect(() => { lastQuery = q; }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return p.samples.filter((s) => terms.every((t) => `${s.title} ${s.id}`.toLowerCase().includes(t)));
  }, [q, p.samples]);
  return (
    <div class="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div class="dlg" role="dialog" aria-label={t('samples.label')}>
        <div class="dlg-head">
          <input autofocus placeholder={t('samples.filter')} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          <button class="rb-btn" onClick={p.onClose}>{t('ui.close')}</button>
        </div>
        {p.recent && p.recent.length > 0 && !q ? (
          <div class="recent-block" aria-label={t('files.recent.title')}>
            <h4>{t('files.recent.title')}</h4>
            {p.recent.map((e) => (
              <button key={`${e.kind}:${e.id}`} class="recent-row" onClick={() => p.onPickRecent?.(e)}>
                <ThumbImg class="rthumb" name={e.name} src={e.kind === 'sample' ? `${p.thumbBase}samples/thumbs/${e.id}.webp` : p.recentThumbs?.[e.id]} />
                <span class="rtxt">
                  <span class="rn">{e.name}</span>
                  <span class="rm"><span class="rk">{t(e.kind === 'sample' ? 'files.recent.sample' : 'files.recent.file')}</span> <span class="rt">{ago(e.at, Date.now(), t)}</span></span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div class="dlg-list">
          {shown.map((s) => (
            <button key={s.id} class="dlg-item" onClick={() => p.onPick(s)}>
              <ThumbImg name={s.title} src={`${p.thumbBase}samples/thumbs/${s.id}.webp`} />
              <span>{s.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

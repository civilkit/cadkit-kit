import { useEffect, useMemo, useState } from 'preact/hooks';
import { t } from './i18n';

export interface SampleEntry { id: string; title: string; url: string }

/** Filterable sample picker. The filter text survives close and reopen (module state), so it opens where you were. */
let lastQuery = '';

export function SamplesDialog(p: { samples: SampleEntry[]; thumbBase: string; onPick(s: SampleEntry): void; onClose(): void }) {
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
        <div class="dlg-list">
          {shown.map((s) => (
            <button key={s.id} class="dlg-item" onClick={() => p.onPick(s)}>
              <img loading="lazy" alt="" src={`${p.thumbBase}samples/thumbs/${s.id}.webp`} onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
              <span>{s.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

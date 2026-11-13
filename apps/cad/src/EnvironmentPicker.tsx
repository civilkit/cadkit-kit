// Environment picker of the Display menu: the built-in studio light, or an HDRI from the online library for the reflections (see hdri.ts in the viewport).
// Same rules as the texture picker: nothing is contacted until the online libraries are allowed, and the credit stays under the choice.
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { SceneEnvironment } from '@kit/viewport';
import { t } from './i18n';
import { POLY, type HdriAsset } from './onlineLibrary';
import type { LibraryControls } from './SurfaceControls';
import { textAttrs } from '@kit/ui';

/** The environment a pick stands for (the credit is kept with it so it shows without the list). */
export const environmentOf = (a: HdriAsset): SceneEnvironment => ({ source: 'polyhaven', id: a.id, name: a.name, ...(a.authors.length ? { author: a.authors.join(', ') } : {}) });

export function EnvironmentPicker(p: { environment: SceneEnvironment | undefined; onEnvironment(e: SceneEnvironment | undefined): void; library: LibraryControls }): JSX.Element | null {
  const list = p.library.listHdris;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HdriAsset[] | null>(null);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState('');
  const env = p.environment;
  useEffect(() => {
    if (!open || !p.library.enabled || !list) return;
    let live = true; setErr(false);
    list().then((l) => { if (live) setItems(l); }, () => { if (live) setErr(true); });
    return () => { live = false; };
  }, [open, p.library.enabled]);
  if (!list) return null;
  const shown = (items ?? []).filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div class="surface-controls texture-picker env-picker" data-testid="environment-picker">
      <div class="tex-current" data-testid="environment-current">
        <b>{env ? env.name ?? env.id : t('env.studio')}</b>
        {env ? <div class="tb-note" data-testid="environment-credit">{t('env.credit', { author: env.author ?? 'Poly Haven' })} <a href={POLY.page(env.id)} target="_blank" rel="noopener noreferrer">{'polyhaven.com'}</a></div> : null}
      </div>
      <button type="button" class="display-reset" aria-expanded={open} onClick={() => setOpen(!open)}>{t('env.choose')}</button>
      {open ? (
        <div class="tex-pop" role="group" aria-label={t('env.title')}>
          <button type="button" class={'display-reset' + (env ? '' : ' on')} aria-pressed={!env} data-testid="environment-studio" onClick={() => p.onEnvironment(undefined)}>{t('env.studio')}</button>
          {!p.library.enabled ? (
            <div data-testid="environment-off">
              <div class="tb-note">{t('env.off')}</div>
              <button type="button" class="display-reset" onClick={p.library.onEnable}>{t('surface.texture.allow')}</button>
            </div>
          ) : (
            <>
              <input {...textAttrs} type="search" enterKeyHint="search" class="mat-search" value={q} placeholder={t('env.search')} aria-label={t('env.search')} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
              {err ? <div class="tb-note" role="alert">{t('env.failed')}</div> : items === null ? <div class="tb-note">{t('surface.texture.loading')}</div> : null}
              <div class="tex-grid" role="listbox" aria-label={t('env.title')}>
                {shown.map((a) => (
                  <button key={a.id} type="button" role="option" aria-selected={env?.id === a.id} class={'tex-item' + (env?.id === a.id ? ' on' : '')} title={`${a.name}${a.authors.length ? ' / ' + a.authors.join(', ') : ''}`} data-environment={a.id}
                    onClick={() => p.onEnvironment(environmentOf(a))}>
                    <img src={a.thumb} alt="" loading="lazy" width={64} height={64} /><span>{a.name}</span>
                  </button>
                ))}
              </div>
              <div class="tb-note">{t('env.licence')} <a href={POLY.license} target="_blank" rel="noopener noreferrer">{'polyhaven.com/license'}</a></div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

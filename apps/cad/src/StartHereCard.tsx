import { Icon } from '@kit/ui';
import { t } from './i18n';

const PLANES = ['front', 'top', 'right'] as const;
export type StartPlane = (typeof PLANES)[number];

/** The card over an empty part: pick a plane to sketch on, or close it. Whether it shows is `showStartCard` (startContent.ts). */
export function StartCard(p: { active: string | null; onHover: (id: StartPlane | null) => void; onSketch: (id: StartPlane) => void; onClose: () => void }) {
  return (
    <div class="start-card" role="region" aria-label={t('app.start.title')}>
      <button class="start-close" type="button" aria-label={t('app.start.close')} title={t('app.start.close')} onClick={p.onClose}><span aria-hidden="true">×</span></button>
      <b>{t('app.start.title')}</b>
      <span>{t('app.start.text')}</span>
      <div class="start-planes">
        {PLANES.map((id) => (
          <button key={id} class={'rb-btn' + (p.active === id ? ' on' : '')} onMouseEnter={() => p.onHover(id)} onMouseLeave={() => p.onHover(null)} onClick={() => p.onSketch(id)}>
            <Icon name={'sketch-new-' + id} size={18} /> {t('app.start.sketchOn', { plane: t('app.ref.' + id) })}
          </button>
        ))}
      </div>
      <span class="start-or">{t('app.start.or')}</span>
    </div>
  );
}

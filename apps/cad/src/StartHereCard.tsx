import { planeName, planeRole, viewPlaneIds, type PlaneId } from './planeNames';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { Icon } from '@kit/ui';
import { t } from './i18n';

export type StartPlane = PlaneId;

/** The card over an empty part: pick a plane to sketch on, or close it. Whether it shows is `showStartCard` (startContent.ts). */
export function StartCard(p: { centerX?: number | null; active: string | null; onHover: (id: StartPlane | null) => void; onSketch: (id: StartPlane) => void; onClose: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  // sit on the same vertical line as the origin and planes: the middle of the part of the canvas the floating panels leave free
  useLayoutEffect(() => {
    const card = el.current, region = card?.parentElement, vp = card?.closest<HTMLElement>('#vp');
    if (!card || !region || !vp) return;
    const place = () => {
      card.style.translate = '';
      if (p.centerX == null) return;
      const v = vp.getBoundingClientRect(), c = card.getBoundingClientRect(), half = c.width / 2;
      const want = Math.min(v.width - 8 - half, Math.max(8 + half, p.centerX)) + v.left;
      card.style.translate = `${Math.round(want - (c.left + half))}px 0`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(region); ro.observe(vp);
    return () => { ro.disconnect(); card.style.translate = ''; };
  }, [p.centerX]);
  return (
    <div class="start-card" ref={el} role="region" aria-label={t('app.start.title')}>
      <button class="start-close" type="button" aria-label={t('app.start.close')} title={t('app.start.close')} onClick={p.onClose}><span aria-hidden="true">×</span></button>
      <b>{t('app.start.title')}</b>
      <span>{t('app.start.text')}</span>
      <div class="start-planes">
        {viewPlaneIds().map((id) => (
          <button key={id} class={'rb-btn' + (p.active === id ? ' on' : '')} onMouseEnter={() => p.onHover(id)} onMouseLeave={() => p.onHover(null)} onClick={() => p.onSketch(id)}>
            <Icon name={'sketch-new-' + planeRole(id)} size={18} /> {t('app.start.sketchOn', { plane: planeName(id) })}
          </button>
        ))}
      </div>
      <span class="start-or">{t('app.start.or')}</span>
    </div>
  );
}

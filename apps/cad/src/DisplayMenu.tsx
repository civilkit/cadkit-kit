import { useEffect, useRef, useState } from 'preact/hooks';
import type { DisplayLayer, Display } from '@kit/store';
import { t } from './i18n';

export const DISPLAY_LAYERS: DisplayLayer[] = ['edges', 'sketches', 'curves', 'planes', 'axes', 'grid', 'relations', 'dimensions', 'threads', 'issues'];

/** A button on the viewport that opens a small checklist of display layers. Hiding a layer never changes the document. */
export function DisplayMenu(p: { display: Display; onToggle(layer: DisplayLayer, on: boolean): void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', away);
    addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div class="display-menu" ref={box}>
      <button class="display-btn" aria-haspopup="true" aria-expanded={open} title={t('display.title')} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" />
        </svg>
        {t('display.label')}
      </button>
      {open ? (
        <div class="display-pop" role="group" aria-label={t('display.label')}>
          {DISPLAY_LAYERS.map((layer) => (
            <label key={layer} class="display-row">
              <input type="checkbox" checked={p.display[layer]} onChange={(e) => p.onToggle(layer, (e.currentTarget as HTMLInputElement).checked)} />
              <span>{t('layer.' + layer)}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

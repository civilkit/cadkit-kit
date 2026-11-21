// The panel of the picture on the open sketch: where it is, how big, how see-through, and Calibrate (two points of the picture and the real
// distance between them, which sets its true size). Pure UI: main.tsx keeps the record, runs the clicks and draws the picture.
import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from './i18n';
import { parseField, type Underlay } from './underlay';

export type Calibration = { step: 'a' } | { step: 'b'; a: { x: number; y: number } } | { step: 'dist'; a: { x: number; y: number }; b: { x: number; y: number } };

export interface UnderlayPanelProps {
  u: Underlay;
  calibration: Calibration | null;
  /** the distance between the two calibration points on screen, mm (given with the `dist` step) */
  measured?: number;
  /** change fields; the owner keeps it as one undo step */
  onChange(patch: Partial<Underlay>): void;
  onCalibrate(): void;
  onCalibrateCancel(): void;
  /** the real distance between the two points, mm */
  onCalibrateApply(mm: number): void;
  onReplace(): void;
  onRemove(): void;
  onClose(): void;
}

const fmt = (v: number): string => String(Math.round(v * 1000) / 1000);

export function UnderlayPanel(p: UnderlayPanelProps): JSX.Element {
  const u = p.u;
  const [real, setReal] = useState('');
  useEffect(() => { if (p.calibration?.step !== 'dist') setReal(''); }, [p.calibration?.step]);
  const num = (k: 'w' | 'x' | 'y' | 'rot', label: string, unit: string, positive = false): JSX.Element => {
    // an edit applies on Enter or when the field is left: each is one undo step, not one per keystroke
    const commit = (el: HTMLInputElement): void => {
      const v = parseField(el.value);
      if (v === null || (positive && !(v > 0))) { el.value = fmt(u[k]); return; }
      if (v !== u[k]) p.onChange({ [k]: v });
    };
    return (
      <label class="fedit-fld ul-fld" data-path={k}>
        <span class="fedit-fld-label">{label}</span>
        <span class="fedit-num">
          <input type="text" inputMode="decimal" value={fmt(u[k])} key={k + fmt(u[k])} aria-label={label} data-testid={'ul-' + k} disabled={u.locked}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget as HTMLInputElement); } }} onBlur={(e) => commit(e.currentTarget as HTMLInputElement)} />
          <span class="fedit-unit">{unit}</span>
        </span>
      </label>
    );
  };
  const cal = p.calibration;
  const apply = (): void => { const v = parseField(real); if (v !== null && v > 0) p.onCalibrateApply(v); };
  return (
    <div class="fedit prop-wizard underlay-panel" data-testid="ul-panel" role="group" aria-label={t('ul.title')}>
      <div class="fedit-head">
        <Icon name="sketch-underlay" size={20} class="fedit-icon" />
        <div class="fedit-title">{t('ul.title')}</div>
        <button type="button" class="fedit-cancel" onClick={p.onClose} title={t('ul.close')} aria-label={t('ul.close')}><Icon name="close" size={18} /></button>
      </div>
      <div class="fedit-sec-fields prop-body">
        <div class="ul-name" data-testid="ul-name" title={u.name}>{u.name}</div>
        {cal ? (
          <div class="ul-cal" data-testid="ul-cal" role="status">
            {cal.step === 'a' ? <p>{t('ul.cal.a')}</p> : null}
            {cal.step === 'b' ? <p>{t('ul.cal.b')}</p> : null}
            {cal.step === 'dist' ? (
              <>
                <p>{t('ul.cal.dist', { now: fmt(p.measured ?? 0) })}</p>
                <label class="fedit-fld ul-fld">
                  <span class="fedit-fld-label">{t('ul.cal.real')}</span>
                  <span class="fedit-num">
                    <input type="text" inputMode="decimal" value={real} autofocus aria-label={t('ul.cal.real')} data-testid="ul-real" placeholder={fmt(p.measured ?? 0)}
                      onInput={(e) => setReal((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }} />
                    <span class="fedit-unit">mm</span>
                  </span>
                </label>
                <button type="button" class="fedit-card-btn prop-create" data-testid="ul-cal-apply" disabled={!(parseField(real) !== null && parseField(real)! > 0)} onClick={apply}>{t('ul.cal.apply')}</button>
              </>
            ) : null}
            <button type="button" class="fedit-card-btn" data-testid="ul-cal-cancel" onClick={p.onCalibrateCancel}>{t('ul.cal.cancel')}</button>
          </div>
        ) : (
          <>
            {num('w', t('ul.width'), 'mm', true)}
            {num('x', t('ul.x'), 'mm')}
            {num('y', t('ul.y'), 'mm')}
            {num('rot', t('ul.rot'), '°')}
            <label class="fedit-fld ul-fld" data-path="opacity">
              <span class="fedit-fld-label">{t('ul.opacity')}</span>
              <span class="fedit-num">
                <input type="range" min="5" max="100" step="5" value={Math.round(u.opacity * 100)} aria-label={t('ul.opacity')} data-testid="ul-opacity"
                  onChange={(e) => p.onChange({ opacity: Number((e.currentTarget as HTMLInputElement).value) / 100 })} />
                <span class="fedit-unit">{Math.round(u.opacity * 100)}%</span>
              </span>
            </label>
            <label class="fedit-fld sk3d-check" data-path="visible">
              <input type="checkbox" checked={u.visible} data-testid="ul-visible" aria-label={t('ul.show')} onChange={(e) => p.onChange({ visible: (e.currentTarget as HTMLInputElement).checked })} />
              <span>{t('ul.show')}</span>
            </label>
            <label class="fedit-fld sk3d-check" data-path="locked">
              <input type="checkbox" checked={u.locked} data-testid="ul-locked" aria-label={t('ul.lock')} onChange={(e) => p.onChange({ locked: (e.currentTarget as HTMLInputElement).checked })} />
              <span>{t('ul.lock')}</span>
            </label>
            <p class="m2s-note">{t('ul.note')}</p>
          </>
        )}
      </div>
      {cal ? null : (
        <div class="prop-nav ul-nav">
          <button type="button" class="fedit-card-btn prop-create" data-testid="ul-calibrate" disabled={u.locked || !u.visible} title={u.locked ? t('ul.locked.tip') : t('ul.calibrate.tip')} onClick={p.onCalibrate}>{t('ul.calibrate')}</button>
          <button type="button" class="fedit-card-btn" data-testid="ul-replace" onClick={p.onReplace}>{t('ul.replace')}</button>
          <button type="button" class="fedit-card-btn" data-testid="ul-remove" onClick={p.onRemove}>{t('ul.remove')}</button>
        </div>
      )}
    </div>
  );
}

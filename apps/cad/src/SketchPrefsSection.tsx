import { t } from './i18n';
import type { SketchPrefs } from './sketchPrefs';

/** The "Sketching" block of the settings dialog: how the sketch editor takes input. */
export function SketchPrefsSection(p: { prefs: SketchPrefs; onChange(patch: Partial<SketchPrefs>): void }) {
  const sel = <K extends 'arcSwitch' | 'onViewValues' | 'constraintMarkers'>(key: K, options: Array<SketchPrefs[K]>) => (
    <label class="set-row">
      <span>{t('settings.sketch.' + key)}</span>
      <select aria-label={t('settings.sketch.' + key)} value={p.prefs[key]} onChange={(e) => p.onChange({ [key]: (e.currentTarget as HTMLSelectElement).value } as Partial<SketchPrefs>)}>
        {options.map((v) => <option key={v} value={v}>{t(`settings.sketch.${key}.${v}`)}</option>)}
      </select>
    </label>
  );
  const chk = (key: 'autoConstraints' | 'gridSnap' | 'keepView' | 'autoLookNormal' | 'cursorLabel') => (
    <label class="set-row">
      <input type="checkbox" checked={p.prefs[key]} onChange={(e) => p.onChange({ [key]: (e.currentTarget as HTMLInputElement).checked })} />
      <span>{t('settings.sketch.' + key)}</span>
    </label>
  );
  return (
    <div class="set-section" role="group" aria-label={t('settings.sketch.title')}>
      <b class="set-head">{t('settings.sketch.title')}</b>
      {chk('autoConstraints')}
      {sel('arcSwitch', ['hover', 'keys', 'off'])}
      {sel('onViewValues', ['dimensions', 'both', 'off'])}
      {sel('constraintMarkers', ['hover', 'always', 'off'])}
      {chk('gridSnap')}
      {chk('keepView')}
      {chk('autoLookNormal')}
      {chk('cursorLabel')}
    </div>
  );
}

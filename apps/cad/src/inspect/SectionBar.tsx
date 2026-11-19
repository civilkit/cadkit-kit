// The viewport's Section control: a chip that cuts the part open while a feature panel is open (so a shell's wall thickness shows
// without the Inspect panel), with the plane, an offset slider and the flip. It drives the same cut as the Inspect panel's Section view.
import type { JSX } from 'preact';
import { numberAttrs } from '@kit/ui';
import { t } from '../i18n';
import type { SectionPlane, SectionState } from './InspectPanel';

export interface SectionBarProps {
  section: SectionState;
  range: [number, number] | null;
  /** The plane of the open feature's sketch, when it has one. */
  sketchPlane: { plane: SectionPlane; faceId?: string } | null;
  onToggle(): void;
  onPlane(p: SectionPlane, faceId?: string): void;
  onChange(patch: Partial<SectionState>): void;
}

export function SectionBar(p: SectionBarProps): JSX.Element {
  const s = p.section, r = p.range;
  const std: SectionPlane[] = ['front', 'top', 'right'];
  const sk = p.sketchPlane;
  const onSketch = !!sk && s.on && s.plane === sk.plane && (sk.plane !== 'face' || s.faceId === sk.faceId);
  return (
    <div class="section-bar" role="toolbar" aria-label={t('inspect.section')} data-testid="section-bar">
      <button class="btn" aria-pressed={s.on} title={t('section.toggle.tip')} onClick={p.onToggle}>{t('section.toggle')}</button>
      {s.on ? <>
        {std.map((k) => <button key={k} class="btn" aria-pressed={s.plane === k && !onSketch} onClick={() => p.onPlane(k)}>{t('inspect.section.' + k)}</button>)}
        {sk ? <button class="btn" aria-pressed={onSketch} onClick={() => p.onPlane(sk.plane, sk.faceId)}>{t('section.sketchPlane')}</button> : null}
        {r ? <>
          <input type="range" min={r[0]} max={r[1]} step={(r[1] - r[0]) / 200 || 1} value={Math.min(r[1], Math.max(r[0], s.offset))} aria-label={t('inspect.section.offset')} onInput={(e) => p.onChange({ offset: parseFloat((e.currentTarget as HTMLInputElement).value) })} />
          <input {...numberAttrs('signed')} type="number" step="any" value={+s.offset.toFixed(3)} aria-label={t('inspect.section.offsetValue')} onChange={(e) => { const v = parseFloat((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(v)) p.onChange({ offset: v }); }} />
        </> : null}
        <label class="insp-flag"><input type="checkbox" checked={s.flip} onChange={(e) => p.onChange({ flip: (e.currentTarget as HTMLInputElement).checked })} />{t('inspect.section.flip')}</label>
      </> : null}
    </div>
  );
}

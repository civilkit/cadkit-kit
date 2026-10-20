import { useEffect, useRef, useState } from 'preact/hooks';
import type { DisplayLayer, Display } from '@kit/store';
import { DISPLAY_STYLES, LIGHT_PRESETS, BACKGROUND_MODES, MATERIAL_PRESETS, EDGE_WIDTHS, PALETTE, type DisplayStyle, type LightPreset, type BackgroundMode, type MaterialPreset, type EdgeWidth, type Appearance } from '@kit/viewport';
import type { AnalysisOptions } from '@kit/viewport';
import { AnalysisSection } from './AnalysisControls';
import { t } from './i18n';
import { SKETCH_SHOW_KEYS, type SketchShow } from './sketchPrefs';

/** The look half of the popover: display style, appearance of the part, lighting and background (see look.ts). */
export interface LookControls {
  style: DisplayStyle; ghostOpacity: number; light: LightPreset; background: BackgroundMode;
  intensity: number; reflections: boolean; edgeWidth: EdgeWidth; silhouette: boolean;
  appearance: Appearance;
  /** the component an appearance change applies to (an assembly's selected component), if any */
  componentName?: string;
  onLook(patch: { style?: DisplayStyle; ghostOpacity?: number; light?: LightPreset; background?: BackgroundMode; intensity?: number; reflections?: boolean; edgeWidth?: EdgeWidth; silhouette?: boolean }): void;
  onAppearance(patch: Partial<Appearance>): void;
  anyHidden: boolean;
  onShowAll(): void;
}

export const DISPLAY_LAYERS: DisplayLayer[] = ['edges', 'sketches', 'curves', 'planes', 'axes', 'grid', 'relations', 'dimensions', 'threads', 'issues'];

/** A button on the viewport that opens a small checklist of display layers. Hiding a layer never changes the document. */
export function DisplayMenu(p: { display: Display; onToggle(layer: DisplayLayer, on: boolean): void; /** Given only while a sketch is open: the sketch's own show toggles, so there is one Display menu. */ sketch?: { show: SketchShow; onToggle(key: keyof SketchShow, on: boolean): void }; look?: LookControls; analysis?: { opts: AnalysisOptions; onChange(patch: Partial<AnalysisOptions>): void } }) {
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
          {p.look ? <LookSections look={p.look} /> : null}
          {p.analysis ? <AnalysisSection opts={p.analysis.opts} onChange={p.analysis.onChange} /> : null}
          {p.sketch ? (
            <div class="display-sketch" role="group" aria-label={t('display.sketch')}>
              <div class="display-head">{t('display.sketch')}</div>
              {SKETCH_SHOW_KEYS.map((k) => (
                <label key={k} class="display-row">
                  <input type="checkbox" data-sketch-show={k} checked={p.sketch!.show[k]} onChange={(e) => p.sketch!.onToggle(k, (e.currentTarget as HTMLInputElement).checked)} />
                  <span>{t('app.sketch.show.' + k)}</span>
                </label>
              ))}
            </div>
          ) : null}
          {p.look || p.analysis ? <div class="display-head">{t('display.layers')}</div> : null}
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

function LookSections({ look }: { look: LookControls }) {
  const pick = <T extends string>(label: string, id: string, values: readonly T[], value: T, prefix: string, set: (v: T) => void) => (
    <label class="display-field">
      <span>{label}</span>
      <select aria-label={label} id={id} value={value} onChange={(e) => set((e.currentTarget as HTMLSelectElement).value as T)}>
        {values.map((v) => <option key={v} value={v}>{t(prefix + v)}</option>)}
      </select>
    </label>
  );
  return (
    <>
      <div class="display-head">{t('display.style')}</div>
      {pick(t('display.style'), 'dm-style', DISPLAY_STYLES, look.style, 'style.', (v) => look.onLook({ style: v }))}
      {look.style === 'ghost' ? (
        <label class="display-field">
          <span>{t('display.opacity')}</span>
          <input type="range" aria-label={t('display.opacity')} min="0.05" max="1" step="0.05" value={look.ghostOpacity}
            onInput={(e) => look.onLook({ ghostOpacity: Number((e.currentTarget as HTMLInputElement).value) })} />
        </label>
      ) : null}
      <div class="display-head">{look.componentName ? t('display.appearanceOf', { name: look.componentName }) : t('display.appearance')}</div>
      <div class="swatches" role="group" aria-label={t('display.color')}>
        {PALETTE.map((c) => (
          <button key={c} type="button" class={'swatch' + (look.appearance.color === c ? ' on' : '')} style={{ background: c }}
            title={c} aria-label={c} aria-pressed={look.appearance.color === c} onClick={() => look.onAppearance({ color: c })} />
        ))}
      </div>
      {pick(t('display.material'), 'dm-material', MATERIAL_PRESETS as readonly MaterialPreset[], look.appearance.material, 'material.', (v) => look.onAppearance({ material: v }))}
      <div class="display-head">{t('display.scene')}</div>
      <div class="preset-row" role="group" aria-label={t('display.lighting')}>
        {LIGHT_PRESETS.map((l) => (
          <button key={l} type="button" class={'preset-thumb preset-' + l + (look.light === l ? ' on' : '')} aria-pressed={look.light === l}
            title={t('light.' + l)} onClick={() => look.onLook({ light: l })}>
            <span class="preset-ball" aria-hidden="true" />
            <span class="preset-name">{t('light.' + l)}</span>
          </button>
        ))}
      </div>
      <label class="display-field">
        <span>{t('display.intensity')}</span>
        <input type="range" aria-label={t('display.intensity')} min="0.3" max="2" step="0.05" value={look.intensity}
          onInput={(e) => look.onLook({ intensity: Number((e.currentTarget as HTMLInputElement).value) })} />
      </label>
      <label class="display-row">
        <input type="checkbox" checked={look.reflections} onChange={(e) => look.onLook({ reflections: (e.currentTarget as HTMLInputElement).checked })} />
        <span>{t('display.reflections')}</span>
      </label>
      {pick(t('display.edgeWidth'), 'dm-edge', EDGE_WIDTHS, look.edgeWidth, 'edge.', (v) => look.onLook({ edgeWidth: v }))}
      <label class="display-row">
        <input type="checkbox" checked={look.silhouette} onChange={(e) => look.onLook({ silhouette: (e.currentTarget as HTMLInputElement).checked })} />
        <span>{t('display.silhouette')}</span>
      </label>
      {pick(t('display.background'), 'dm-bg', BACKGROUND_MODES, look.background, 'bg.', (v) => look.onLook({ background: v }))}
      {look.anyHidden ? <button type="button" class="rb-btn display-showall" onClick={look.onShowAll}>{t('cmd.show-all')}</button> : null}
    </>
  );
}

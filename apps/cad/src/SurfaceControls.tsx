// Surface controls of the Display popover: roughness, metalness and clearcoat of the part's material, and (for woods, or when switched on)
// the procedural grain: ring spacing, contrast, tone and direction. Each change is a patch of the appearance's `pbr` / `look`; a value
// not touched is not stored, so a later change of material still brings its own values.
import type { JSX } from 'preact';
import { materialParams, type Appearance, type PbrParams, type ProceduralLook } from '@kit/viewport';
import { useEffect, useState } from 'preact/hooks';
import { t } from './i18n';
import { POLY, type TextureAsset } from './onlineLibrary';

const pct = (v: number): number => Math.round(v * 100);
export const GRAIN_DEFAULTS = { scale: 4, contrast: 0.5, tone: '#3a2616' } as const;

/** The appearance patch for one PBR slider: the value merged into the existing overrides. */
export function pbrPatch(a: Appearance, key: keyof PbrParams, value: number): Partial<Appearance> {
  const next: PbrParams = { ...(a.pbr ?? {}), [key]: value };
  return { pbr: next };
}
/** The patch for one grain field; switching the grain on starts from the wood defaults (or what was set before), off keeps the settings
 *  and marks the grain off, so the grain a wood material brings does not show through. */
type GrainChange = Partial<ProceduralLook>;
export function grainPatch(a: Appearance, change: GrainChange | null): Partial<Appearance> {
  const { off: _off, ...rest } = a.look ?? { kind: 'wood' as const };
  if (change === null) return { look: { ...rest, kind: 'wood', off: true } };
  return { look: { ...rest, kind: 'wood', ...change } };
}

/** What the texture picker needs from the online library (see onlineRuntime.ts). */
export interface LibraryControls { enabled: boolean; onEnable(): void; list(): Promise<TextureAsset[]> }

function TexturePicker(p: { appearance: Appearance; onAppearance(patch: Partial<Appearance>): void; library: LibraryControls }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TextureAsset[] | null>(null);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState('');
  const tx = p.appearance.texture;
  useEffect(() => {
    if (!open || !p.library.enabled) return;
    let live = true; setErr(false);
    p.library.list().then((l) => { if (live) setItems(l); }, () => { if (live) setErr(true); });
    return () => { live = false; };
  }, [open, p.library.enabled]);
  const shown = (items ?? []).filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div class="texture-picker" data-testid="texture-picker">
      {tx ? (
        <div class="tex-current" data-testid="texture-credit">
          <b>{tx.name ?? tx.id}</b>
          <div class="tb-note">{t('surface.texture.credit', { author: tx.author ?? 'Poly Haven' })} <a href={POLY.page(tx.id)} target="_blank" rel="noopener noreferrer">{'polyhaven.com'}</a></div>
          <label class="display-field"><span>{t('surface.texture.size')}</span>
            <input type="range" aria-label={t('surface.texture.size')} min={50} max={2000} step={10} value={tx.scale ?? 400} aria-valuetext={`${tx.scale ?? 400} mm`}
              onInput={(e) => p.onAppearance({ texture: { ...tx, scale: Number((e.currentTarget as HTMLInputElement).value) } })} /></label>
          <button type="button" class="display-reset" onClick={() => p.onAppearance({ texture: undefined })}>{t('surface.texture.remove')}</button>
        </div>
      ) : null}
      <button type="button" class="display-reset" aria-expanded={open} onClick={() => setOpen(!open)}>{t(tx ? 'surface.texture.change' : 'surface.texture.choose')}</button>
      {open ? (
        <div class="tex-pop" role="group" aria-label={t('surface.texture.title')}>
          {!p.library.enabled ? (
            <div data-testid="texture-off">
              <div class="tb-note">{t('surface.texture.off')}</div>
              <button type="button" class="display-reset" onClick={p.library.onEnable}>{t('surface.texture.allow')}</button>
            </div>
          ) : (
            <>
              <input type="search" class="mat-search" value={q} placeholder={t('surface.texture.search')} aria-label={t('surface.texture.search')} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
              {err ? <div class="tb-note" role="alert">{t('surface.texture.failed')}</div> : items === null ? <div class="tb-note">{t('surface.texture.loading')}</div> : null}
              <div class="tex-grid" role="listbox" aria-label={t('surface.texture.title')}>
                {shown.map((a) => (
                  <button key={a.id} type="button" role="option" aria-selected={tx?.id === a.id} class={'tex-item' + (tx?.id === a.id ? ' on' : '')} title={`${a.name}${a.authors.length ? ' / ' + a.authors.join(', ') : ''}`} data-texture={a.id}
                    onClick={() => p.onAppearance({ texture: { source: 'polyhaven', id: a.id, scale: a.scale, name: a.name, ...(a.authors.length ? { author: a.authors.join(', ') } : {}) } })}>
                    <img src={a.thumb} alt="" loading="lazy" width={64} height={64} /><span>{a.name}</span>
                  </button>
                ))}
              </div>
              <div class="tb-note">{t('surface.texture.licence')} <a href={POLY.license} target="_blank" rel="noopener noreferrer">{'polyhaven.com/license'}</a></div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function SurfaceControls(p: { appearance: Appearance; onAppearance(patch: Partial<Appearance>): void; library?: LibraryControls }): JSX.Element {
  const a = p.appearance;
  const base = materialParams(a.material);
  const rough = a.pbr?.roughness ?? base.roughness, metal = a.pbr?.metalness ?? base.metalness, coat = a.pbr?.clearcoat ?? 0;
  const g = a.look && !a.look.off ? a.look : undefined;
  const range = (id: string, label: string, v: number, min: number, max: number, step: number, set: (n: number) => void, text?: string): JSX.Element => (
    <label class="display-field">
      <span>{label}</span>
      <input type="range" id={id} aria-label={label} min={min} max={max} step={step} value={v} aria-valuetext={text ?? `${pct(v)}%`} onInput={(e) => set(Number((e.currentTarget as HTMLInputElement).value))} />
    </label>
  );
  const reset = (): void => p.onAppearance({ pbr: undefined, look: undefined, texture: undefined });
  return (
    <div class="surface-controls" role="group" aria-label={t('surface.title')} data-testid="surface-controls">
      {range('sc-rough', t('surface.roughness'), rough, 0, 1, 0.01, (n) => p.onAppearance(pbrPatch(a, 'roughness', n)))}
      {range('sc-metal', t('surface.metalness'), metal, 0, 1, 0.01, (n) => p.onAppearance(pbrPatch(a, 'metalness', n)))}
      {range('sc-coat', t('surface.clearcoat'), coat, 0, 1, 0.01, (n) => p.onAppearance(pbrPatch(a, 'clearcoat', n)))}
      <label class="display-row">
        <input type="checkbox" id="sc-grain" checked={!!g} onChange={(e) => p.onAppearance(grainPatch(a, (e.currentTarget as HTMLInputElement).checked ? {} : null))} />
        <span>{t('surface.grain')}</span>
      </label>
      {g ? (
        <div class="surface-grain" data-testid="grain-controls">
          {range('sc-scale', t('surface.grain.scale'), g.scale ?? GRAIN_DEFAULTS.scale, 0.5, 20, 0.5, (n) => p.onAppearance(grainPatch(a, { scale: n })), `${g.scale ?? GRAIN_DEFAULTS.scale} mm`)}
          {range('sc-contrast', t('surface.grain.contrast'), g.contrast ?? GRAIN_DEFAULTS.contrast, 0, 1, 0.01, (n) => p.onAppearance(grainPatch(a, { contrast: n })))}
          <label class="display-field">
            <span>{t('surface.grain.tone')}</span>
            <input type="color" id="sc-tone" aria-label={t('surface.grain.tone')} value={g.tone ?? GRAIN_DEFAULTS.tone} onInput={(e) => p.onAppearance(grainPatch(a, { tone: (e.currentTarget as HTMLInputElement).value }))} />
          </label>
          <label class="display-field">
            <span>{t('surface.grain.direction')}</span>
            <select id="sc-axis" aria-label={t('surface.grain.direction')} value={g.axis ?? ''} onChange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; p.onAppearance(grainPatch(a, { axis: v === '' ? undefined : (v as 'x' | 'y' | 'z') })); }}>
              <option value="">{t('surface.grain.auto')}</option>
              {(['x', 'y', 'z'] as const).map((v) => <option key={v} value={v}>{v.toUpperCase()}</option>)}
            </select>
          </label>
        </div>
      ) : null}
      {p.library ? <TexturePicker appearance={a} onAppearance={p.onAppearance} library={p.library} /> : null}
      <button type="button" class="display-reset" disabled={!a.pbr && !a.look && !a.texture} onClick={reset}>{t('surface.reset')}</button>
    </div>
  );
}

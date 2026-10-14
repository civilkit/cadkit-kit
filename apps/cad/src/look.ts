// Viewer-only look of the scene: display style, ghost opacity, lighting, background, the colour and material of each part,
// and what is hidden. The part file has no colour or appearance field (part-model carries none), so none of this is saved
// in the document: the look is kept in localStorage (`cad.look`, appearances keyed by part name), hidden objects only for
// the session.
import { signal } from '@preact/signals-core';
import {
  DISPLAY_STYLES, LIGHT_PRESETS, BACKGROUND_MODES, DEFAULT_APPEARANCE, clampOpacity, sanitizeAppearance,
  type DisplayStyle, type LightPreset, type BackgroundMode, type Appearance, type BodyLook,
} from '@kit/viewport';

export interface Look {
  style: DisplayStyle;
  ghostOpacity: number;
  light: LightPreset;
  background: BackgroundMode;
  /** by part name; a part not listed has the default look */
  appearances: Record<string, Appearance>;
}
export const DEFAULT_LOOK: Look = { style: 'shadedEdges', ghostOpacity: 0.35, light: 'studio', background: 'theme', appearances: {} };
export const LOOK_KEY = 'cad.look';

const oneOf = <T extends string>(v: unknown, ok: readonly T[], d: T): T => ((ok as readonly unknown[]).includes(v) ? (v as T) : d);

/** Read a stored look, dropping anything that is not valid (a stale or hand-edited value never breaks the viewer). */
export function sanitizeLook(raw: unknown): Look {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const appearances: Record<string, Appearance> = {};
  if (r.appearances && typeof r.appearances === 'object') {
    for (const [k, v] of Object.entries(r.appearances as Record<string, unknown>)) {
      const a = sanitizeAppearance(v);
      if (a.color !== DEFAULT_APPEARANCE.color || a.material !== 'default') appearances[k] = a;
    }
  }
  return {
    style: oneOf(r.style, DISPLAY_STYLES, DEFAULT_LOOK.style),
    ghostOpacity: clampOpacity(r.ghostOpacity, DEFAULT_LOOK.ghostOpacity),
    light: oneOf(r.light, LIGHT_PRESETS, DEFAULT_LOOK.light),
    background: oneOf(r.background, BACKGROUND_MODES, DEFAULT_LOOK.background),
    appearances,
  };
}

export const appearanceOf = (look: Look, part: string | undefined): Appearance => (part && look.appearances[part]) || DEFAULT_APPEARANCE;
export const bodyLook = (look: Look, part: string | undefined): BodyLook => ({ style: look.style, ghostOpacity: look.ghostOpacity, appearance: appearanceOf(look, part) });

export function withAppearance(look: Look, part: string, patch: Partial<Appearance>): Look {
  const a = sanitizeAppearance({ ...appearanceOf(look, part), ...patch });
  const appearances = { ...look.appearances };
  if (a.color === DEFAULT_APPEARANCE.color && a.material === 'default') delete appearances[part];
  else appearances[part] = a;
  return { ...look, appearances };
}

/** What is hidden in the view (never in the document): the body, and sketches / planes / curves by feature id. */
export interface Hidden { body: boolean; ids: string[] }
export const NOTHING_HIDDEN: Hidden = { body: false, ids: [] };
export const anyHidden = (h: Hidden): boolean => h.body || h.ids.length > 0;

/** What the H key hides: faces / edges / corners selected -> the body they belong to; otherwise the selected feature if it is
 *  a sketch, plane or curve. Returns the new state, or the same one when there is nothing to hide. */
export function hideSelection(h: Hidden, sel: { names: string[]; featureId?: string | null; featureType?: string | null }): Hidden {
  if (sel.names.length) return h.body ? h : { ...h, body: true };
  if (sel.featureId && sel.featureType && /^(sketch|plane|helix|curve|spiral|composite|projected)/.test(sel.featureType)) {
    return h.ids.includes(sel.featureId) ? h : { ...h, ids: [...h.ids, sel.featureId] };
  }
  return h;
}

/** The look as signals, so the popover, the commands and the viewport follow one value. */
export function createLookStore(initial?: unknown) {
  const look = signal<Look>(sanitizeLook(initial));
  const hidden = signal<Hidden>(NOTHING_HIDDEN);
  return {
    look, hidden,
    set(patch: Partial<Omit<Look, 'appearances'>>) { look.value = sanitizeLook({ ...look.value, ...patch }); },
    setAppearance(part: string, patch: Partial<Appearance>) { look.value = withAppearance(look.value, part, patch); },
    hide(sel: Parameters<typeof hideSelection>[1]) { hidden.value = hideSelection(hidden.value, sel); },
    showAll() { hidden.value = NOTHING_HIDDEN; },
  };
}
export type LookStore = ReturnType<typeof createLookStore>;

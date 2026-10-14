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

/** What the viewport and the tree swatch show for a part: the colour the user picked in Display > Appearance when there is one,
 *  otherwise the material's colour (when "Use material colour" is on), otherwise the default. */
export function effectiveAppearance(look: Look, part: string | undefined, materialColor: string | null | undefined, useMaterialColour = true): Appearance {
  const a = appearanceOf(look, part);
  return useMaterialColour && materialColor && a.color === DEFAULT_APPEARANCE.color ? { ...a, color: materialColor } : a;
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

/** What is hidden in the view (never in the document): the solid, and sketches / planes / curves / surface bodies by feature id. */
export interface Hidden { body: boolean; ids: string[] }
export const NOTHING_HIDDEN: Hidden = { body: false, ids: [] };
export const anyHidden = (h: Hidden): boolean => h.body || h.ids.length > 0;

/** What is under the cursor of the H key. `surfaceOf` names the surface body a face or edge belongs to (null: the solid);
 *  `surfaceIds` are the surface bodies on screen; `solid` is false when the part has no solid (a corner then hides nothing). */
export interface HideTarget {
  names: string[]; featureId?: string | null; featureType?: string | null;
  surfaceOf?: (name: string) => string | null; surfaceIds?: string[]; solid?: boolean;
}

/** What the H key hides: faces / edges / corners selected -> the body they belong to (the solid, or each surface body whose
 *  face or edge is selected); otherwise the selected feature if it is a sketch, plane or curve, or a surface body's feature.
 *  Returns the new state, or the same one when there is nothing to hide. */
export function hideSelection(h: Hidden, sel: HideTarget): Hidden {
  if (sel.names.length) {
    let next = h;
    for (const n of sel.names) {
      const owner = sel.surfaceOf?.(n) ?? null;
      if (owner) { if (!next.ids.includes(owner)) next = { ...next, ids: [...next.ids, owner] }; }
      else if (sel.solid !== false && !next.body) next = { ...next, body: true };
    }
    return next;
  }
  const id = sel.featureId;
  if (id && sel.featureType && /^(sketch|plane|helix|curve|spiral|composite|projected)/.test(sel.featureType)) {
    return h.ids.includes(id) ? h : { ...h, ids: [...h.ids, id] };
  }
  if (id && sel.surfaceIds?.includes(id)) return h.ids.includes(id) ? h : { ...h, ids: [...h.ids, id] };
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

// Viewer-only look of the scene: display style, ghost opacity, lighting, background, the colour and material of each part,
// and what is hidden. The part file has no colour or appearance field (part-model carries none), so none of this is saved
// in the document: the look is kept in localStorage (`cad.look`, appearances keyed by part name), hidden objects only for
// the session.
import { signal } from '@preact/signals-core';
import {
  DISPLAY_STYLES, LIGHT_PRESETS, BACKGROUND_MODES, EDGE_WIDTHS, DEFAULT_APPEARANCE, clampOpacity, clampIntensity, sanitizeAppearance, sanitizeEnvironment,
  type EdgeWidth, type DisplayStyle, type LightPreset, type BackgroundMode, type Appearance, type BodyLook, type SceneEnvironment,
} from '@kit/viewport';

export interface Look {
  style: DisplayStyle;
  ghostOpacity: number;
  light: LightPreset;
  background: BackgroundMode;
  /** lighting strength, 0.3 to 2 */
  intensity: number;
  /** an HDRI from the online library for the reflections; none: the built-in studio light */
  environment?: SceneEnvironment;
  /** studio reflections on metal */
  reflections: boolean;
  edgeWidth: EdgeWidth;
  /** dark outline around the silhouette */
  silhouette: boolean;
  /** by part name (or `part#component` for one component of an assembly); a key not listed has the default look */
  appearances: Record<string, Appearance>;
  /** storage version (see LOOK_VERSION) */
  v?: number;
}
export const DEFAULT_LOOK: Look = { style: 'shadedEdges', ghostOpacity: 0.35, light: 'studio', background: 'gradient', intensity: 1, reflections: true, edgeWidth: 'thin', silhouette: true, appearances: {}, v: 2 };
/** Bumped when the defaults of the scene change: a look stored by an older version gets the new lighting and background once. */
export const LOOK_VERSION = 2;
export const LOOK_KEY = 'cad.look';

const oneOf = <T extends string>(v: unknown, ok: readonly T[], d: T): T => ((ok as readonly unknown[]).includes(v) ? (v as T) : d);

/** Read a stored look, dropping anything that is not valid (a stale or hand-edited value never breaks the viewer). */
export function sanitizeLook(raw: unknown): Look {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const appearances: Record<string, Appearance> = {};
  if (r.appearances && typeof r.appearances === 'object') {
    for (const [k, v] of Object.entries(r.appearances as Record<string, unknown>)) {
      const a = sanitizeAppearance(v);
      if (a.color !== DEFAULT_APPEARANCE.color || a.material !== 'default' || a.pbr || a.look || a.texture) appearances[k] = a;
    }
  }
  const fresh = r.v === LOOK_VERSION;
  const environment = sanitizeEnvironment(r.environment);
  return {
    style: oneOf(r.style, DISPLAY_STYLES, DEFAULT_LOOK.style),
    ghostOpacity: clampOpacity(r.ghostOpacity, DEFAULT_LOOK.ghostOpacity),
    light: fresh ? oneOf(r.light, LIGHT_PRESETS, DEFAULT_LOOK.light) : DEFAULT_LOOK.light,
    background: fresh ? oneOf(r.background, BACKGROUND_MODES, DEFAULT_LOOK.background) : DEFAULT_LOOK.background,
    intensity: clampIntensity(r.intensity, DEFAULT_LOOK.intensity),
    reflections: typeof r.reflections === 'boolean' ? r.reflections : DEFAULT_LOOK.reflections,
    edgeWidth: oneOf(r.edgeWidth, EDGE_WIDTHS, DEFAULT_LOOK.edgeWidth),
    silhouette: typeof r.silhouette === 'boolean' ? r.silhouette : DEFAULT_LOOK.silhouette,
    ...(environment ? { environment } : {}),
    v: LOOK_VERSION,
    appearances,
  };
}

/** What the viewport and the tree swatch show for a part: the colour the user picked in Display > Appearance when there is one,
 *  otherwise the material's colour (when "Use material colour" is on), otherwise the default. */
export function effectiveAppearance(look: Look, part: string | undefined, materialColor: string | Appearance | null | undefined, useMaterialColour = true): Appearance {
  const a = appearanceOf(look, part);
  if (!useMaterialColour || !materialColor) return a;
  const m = typeof materialColor === 'string' ? { color: materialColor, material: a.material } : materialColor;
  const pbr = a.pbr ?? m.pbr, grain = a.look ?? m.look, texture = a.texture ?? m.texture;
  return {
    color: a.color === DEFAULT_APPEARANCE.color ? m.color : a.color,
    material: a.material === 'default' ? m.material : a.material,
    ...(pbr ? { pbr } : {}),
    ...(grain ? { look: grain } : {}),
    ...(texture ? { texture } : {}),
  };
}

/** Storage key of the look of one component of an assembly (the part's own look is keyed by the part name). */
export const componentKey = (part: string | undefined, comp: string): string => `${part || 'part'}#${comp}`;

/** What each component of an assembly looks like: the user's override of that component, else the colour and finish of its material
 *  (a gasket material is orange, brass warm, plastics glossy), else the assembly's own look. `parts` lists the components by id with their material name. */
export function componentAppearances(
  look: Look, part: string | undefined, parts: ReadonlyArray<{ id: string; material?: string | null }>,
  materialOf: (name: string | null | undefined) => Appearance | null, useMaterialColour = true,
): Map<string, Appearance> {
  const out = new Map<string, Appearance>();
  for (const p of parts) {
    const own = look.appearances[componentKey(part, p.id)];
    const mat = useMaterialColour ? materialOf(p.material) : null;
    const a = own ?? mat ?? appearanceOf(look, part);
    out.set(p.id, own && mat ? { color: own.color === DEFAULT_APPEARANCE.color ? mat.color : own.color, material: own.material === 'default' ? mat.material : own.material } : a);
  }
  return out;
}

export const appearanceOf = (look: Look, part: string | undefined): Appearance => (part && look.appearances[part]) || DEFAULT_APPEARANCE;
export const bodyLook = (look: Look, part: string | undefined): BodyLook => ({ style: look.style, ghostOpacity: look.ghostOpacity, appearance: appearanceOf(look, part) });

export function withAppearance(look: Look, part: string, patch: Partial<Appearance>): Look {
  const a = sanitizeAppearance({ ...appearanceOf(look, part), ...patch });
  const appearances = { ...look.appearances };
  if (a.color === DEFAULT_APPEARANCE.color && a.material === 'default' && !a.pbr && !a.look && !a.texture) delete appearances[part];
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

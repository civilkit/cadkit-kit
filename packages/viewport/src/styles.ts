// Display styles, appearance, lighting and background: pure data plus small factories for three.js objects that do not
// need WebGL (materials, colours). The Viewport applies them; the app stores them (see apps/cad/src/look.ts).
import * as THREE from 'three';

export type DisplayStyle = 'shaded' | 'shadedEdges' | 'wireframe' | 'hiddenLines' | 'ghost';
export const DISPLAY_STYLES: readonly DisplayStyle[] = ['shaded', 'shadedEdges', 'wireframe', 'hiddenLines', 'ghost'];

export type MaterialPreset = 'default' | 'plastic' | 'brushed' | 'glass';
export const MATERIAL_PRESETS: readonly MaterialPreset[] = ['default', 'plastic', 'brushed', 'glass'];

export type LightPreset = 'studio' | 'flat' | 'contrast';
export const LIGHT_PRESETS: readonly LightPreset[] = ['studio', 'flat', 'contrast'];

export type BackgroundMode = 'theme' | 'light' | 'dark' | 'gradient';
export const BACKGROUND_MODES: readonly BackgroundMode[] = ['theme', 'light', 'dark', 'gradient'];

/** What a style draws. `edges: 'layer'` follows the Edges layer toggle; 'always' ignores it (a wire view without edges is empty). */
export interface StyleSpec {
  faces: 'shaded' | 'white' | 'depthOnly' | 'translucent';
  edges: 'none' | 'layer' | 'always';
  /** faint edges drawn through the body (hidden lines) */
  hiddenEdges: boolean;
}

export function styleSpec(style: DisplayStyle): StyleSpec {
  switch (style) {
    case 'shaded': return { faces: 'shaded', edges: 'none', hiddenEdges: false };
    case 'wireframe': return { faces: 'depthOnly', edges: 'always', hiddenEdges: true };
    case 'hiddenLines': return { faces: 'white', edges: 'always', hiddenEdges: false };
    case 'ghost': return { faces: 'translucent', edges: 'layer', hiddenEdges: false };
    default: return { faces: 'shaded', edges: 'layer', hiddenEdges: false };
  }
}

export const clampOpacity = (v: unknown, fallback = 0.35): number => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0.05, v)) : fallback);

export interface Appearance { color: string; material: MaterialPreset }
export const DEFAULT_APPEARANCE: Appearance = { color: '#b8c4d6', material: 'default' };
/** The palette offered in the popover (hex). The first is the default body colour. */
export const PALETTE: readonly string[] = ['#b8c4d6', '#d9dde3', '#5b6573', '#e8730c', '#d0463b', '#3f8f5f', '#2f6fd0', '#e0b030'];

export interface MaterialParams { roughness: number; metalness: number; opacity: number }
export function materialParams(m: MaterialPreset): MaterialParams {
  switch (m) {
    case 'plastic': return { roughness: 0.85, metalness: 0, opacity: 1 };
    case 'brushed': return { roughness: 0.38, metalness: 0.9, opacity: 1 };
    case 'glass': return { roughness: 0.08, metalness: 0, opacity: 0.35 };
    default: return { roughness: 0.6, metalness: 0.1, opacity: 1 };
  }
}

export function isHex(v: unknown): v is string { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v); }
export function sanitizeAppearance(raw: unknown): Appearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    color: isHex(r.color) ? r.color.toLowerCase() : DEFAULT_APPEARANCE.color,
    material: (MATERIAL_PRESETS as readonly unknown[]).includes(r.material) ? (r.material as MaterialPreset) : 'default',
  };
}

export interface BodyLook { style: DisplayStyle; ghostOpacity: number; appearance: Appearance }

/** Apply a look to the body's material (`tinted`: the mesh has a per-vertex colour attribute, for surface bodies): the colour, roughness, metalness, opacity and which buffers it writes.
 *  `fade` (the sketch editor) caps the opacity and so composes with every style. */
export function applyBodyLook(mat: THREE.MeshStandardMaterial, look: BodyLook, fade = 1, tinted = false): void {
  const spec = styleSpec(look.style);
  const p = materialParams(look.appearance.material);
  let opacity = p.opacity;
  mat.color.set(look.appearance.color);
  mat.roughness = p.roughness; mat.metalness = p.metalness;
  mat.emissive.set(0x000000); mat.emissiveIntensity = 1;
  mat.colorWrite = true; mat.depthWrite = true;
  mat.vertexColors = tinted && spec.faces !== 'white';   // surface bodies carry a tint per vertex; hidden-line white stays plain
  if (spec.faces === 'white') {
    mat.color.set(0xffffff); mat.roughness = 1; mat.metalness = 0;
    mat.emissive.set(0xffffff); mat.emissiveIntensity = 0.55;   // flat paper white whatever the light
  } else if (spec.faces === 'depthOnly') {
    mat.colorWrite = false;   // still hides what is behind (and still picks), but draws nothing
  } else if (spec.faces === 'translucent') {
    opacity = Math.min(opacity, look.ghostOpacity);
  }
  opacity = Math.min(opacity, fade);
  mat.opacity = opacity;
  mat.transparent = opacity < 1;
  if (opacity < 1) mat.depthWrite = false;
  mat.needsUpdate = true;
}

export function makeBodyMaterial(look: BodyLook, fade = 1, tinted = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,   // faces sit a hair behind sketches and edges lying on them
  });
  applyBodyLook(m, look, fade, tinted);
  return m;
}

/** Edge colour per style (hidden-line white faces want black edges; a dark body on a dark background wants none of this). */
export function edgeColor(style: DisplayStyle): number { return style === 'hiddenLines' ? 0x000000 : 0x1c2129; }
export const HIDDEN_EDGE_OPACITY = 0.18;

export interface LightSpec { sky: number; ground: number; hemi: number; sun: number; fill: number }
export function lightSpec(p: LightPreset): LightSpec {
  switch (p) {
    case 'flat': return { sky: 0xffffff, ground: 0xffffff, hemi: 1.6, sun: 0, fill: 0 };
    case 'contrast': return { sky: 0xffffff, ground: 0x202428, hemi: 0.35, sun: 1.6, fill: 0 };
    default: return { sky: 0xffffff, ground: 0x556070, hemi: 0.9, sun: 0.8, fill: 0 };
  }
}

/** The two colours of the background (top, bottom) for a mode, given the theme's tokens (--vp-top, --vp-bottom). */
export function backgroundColors(mode: BackgroundMode, theme: { top: string; bottom: string }): { top: string; bottom: string } {
  switch (mode) {
    case 'light': return { top: '#f4f6f9', bottom: '#f4f6f9' };
    case 'dark': return { top: '#12171d', bottom: '#12171d' };
    case 'gradient': return { top: theme.top, bottom: theme.bottom };
    default: return { top: theme.bottom, bottom: theme.bottom };
  }
}

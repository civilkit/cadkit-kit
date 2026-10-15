// Display styles, appearance, lighting and background: pure data plus small factories for three.js objects that do not
// need WebGL (materials, colours). The Viewport applies them; the app stores them (see apps/cad/src/look.ts).
import * as THREE from 'three';

export type DisplayStyle = 'shaded' | 'shadedEdges' | 'wireframe' | 'hiddenLines' | 'ghost';
export const DISPLAY_STYLES: readonly DisplayStyle[] = ['shaded', 'shadedEdges', 'wireframe', 'hiddenLines', 'ghost'];

export type MaterialPreset = 'default' | 'plastic' | 'brushed' | 'glass' | 'matte';
export const MATERIAL_PRESETS: readonly MaterialPreset[] = ['default', 'plastic', 'brushed', 'glass', 'matte'];

export type LightPreset = 'studio' | 'flat' | 'contrast' | 'technical';
export const LIGHT_PRESETS: readonly LightPreset[] = ['studio', 'flat', 'contrast', 'technical'];

export type EdgeWidth = 'thin' | 'medium' | 'bold';
export const EDGE_WIDTHS: readonly EdgeWidth[] = ['thin', 'medium', 'bold'];
/** Line width in CSS pixels per option. */
export const edgePixels = (w: EdgeWidth): number => (w === 'bold' ? 2.2 : w === 'medium' ? 1.5 : 1.1);

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
export const DEFAULT_APPEARANCE: Appearance = { color: '#c3ccd8', material: 'default' };
/** The palette offered in the popover (hex). The first is the default body colour. */
export const PALETTE: readonly string[] = ['#c3ccd8', '#d9dde3', '#5b6573', '#e8730c', '#d0463b', '#3f8f5f', '#2f6fd0', '#e0b030'];

export interface MaterialParams { roughness: number; metalness: number; opacity: number }
export function materialParams(m: MaterialPreset): MaterialParams {
  switch (m) {
    case 'plastic': return { roughness: 0.42, metalness: 0, opacity: 1 };
    case 'matte': return { roughness: 0.85, metalness: 0, opacity: 1 };
    case 'brushed': return { roughness: 0.3, metalness: 0.9, opacity: 1 };
    case 'glass': return { roughness: 0.08, metalness: 0, opacity: 0.35 };
    default: return { roughness: 0.36, metalness: 0.5, opacity: 1 };   // satin metal: reads as steel under the studio light
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
export function edgeColor(style: DisplayStyle, preset: LightPreset = 'studio', dark = false): number {
  if (style === 'hiddenLines' || preset === 'technical') return 0x000000;
  return dark ? 0x0d1117 : 0x2b3542;   // darker than the face, not black
}
export const HIDDEN_EDGE_OPACITY = 0.18;

/** `env`: strength of the studio reflections (image based light); `sun` follows the camera; `white` paints every face matte white (technical). */
export interface LightSpec { sky: number; ground: number; hemi: number; sun: number; fill: number; env: number; exposure: number; white: boolean }
export function lightSpec(p: LightPreset): LightSpec {
  switch (p) {
    case 'flat': return { sky: 0xffffff, ground: 0xffffff, hemi: 1.6, sun: 0, fill: 0, env: 0, exposure: 1, white: false };
    case 'contrast': return { sky: 0xffffff, ground: 0x202428, hemi: 0.15, sun: 2.4, fill: 0, env: 0.45, exposure: 1, white: false };
    case 'technical': return { sky: 0xffffff, ground: 0xdfe3e8, hemi: 1.1, sun: 0.9, fill: 0, env: 0.35, exposure: 1, white: true };
    default: return { sky: 0xffffff, ground: 0xaab4c4, hemi: 0.45, sun: 1.1, fill: 0, env: 1.35, exposure: 1.05, white: false };
  }
}
/** The scene's light at a preset, scaled by the user's intensity slider; without reflections the studio light is replaced by sky light. */
export function effectiveLight(p: LightPreset, intensity: number, reflections: boolean): LightSpec {
  const l = lightSpec(p), k = clampIntensity(intensity);
  const env = reflections ? l.env * k : 0;
  const hemi = (l.hemi + (reflections || l.env === 0 ? 0 : 0.8 * l.env)) * k;
  return { ...l, env, hemi, sun: l.sun * k };
}
export const clampIntensity = (v: unknown, fallback = 1): number => (typeof v === 'number' && isFinite(v) ? Math.min(2, Math.max(0.3, v)) : fallback);

/** Display colour of a material colour: metals look flat when the base colour is dark, so lift it a little towards white. */
export function displayColor(hex: string, metalness: number): string {
  const c = new THREE.Color(hex), k = 0.22 * metalness;
  c.lerp(new THREE.Color(1, 1, 1), k);
  return '#' + c.getHexString();
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

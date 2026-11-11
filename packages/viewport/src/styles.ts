// Display styles, appearance, lighting and background: pure data plus small factories for three.js objects that do not
// need WebGL (materials, colours). The Viewport applies them; the app stores them (see apps/cad/src/look.ts).
import * as THREE from 'three';
import { makeLookUniforms, type LookUniforms } from './lookshader';
import { textureFor } from './textures';

export type DisplayStyle = 'shaded' | 'shadedEdges' | 'wireframe' | 'hiddenLines' | 'ghost';
export const DISPLAY_STYLES: readonly DisplayStyle[] = ['shaded', 'shadedEdges', 'wireframe', 'hiddenLines', 'ghost'];

export type MaterialPreset = 'default' | 'plastic' | 'brushed' | 'glass' | 'matte';
export const MATERIAL_PRESETS: readonly MaterialPreset[] = ['default', 'plastic', 'brushed', 'glass', 'matte'];

export type LightPreset = 'studio' | 'flat' | 'contrast' | 'technical';
export const LIGHT_PRESETS: readonly LightPreset[] = ['studio', 'flat', 'contrast', 'technical'];

export type EdgeWidth = 'thin' | 'medium' | 'bold';
export const EDGE_WIDTHS: readonly EdgeWidth[] = ['thin', 'medium', 'bold'];
/** Line width in CSS pixels per option. */
export const edgePixels = (w: EdgeWidth): number => (w === 'bold' ? 2 : w === 'medium' ? 1.4 : 0.9);

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

/** Optional physically based overrides on top of the finish preset; a missing key keeps the preset's value. All 0..1. */
export interface PbrParams { roughness?: number; metalness?: number; opacity?: number; clearcoat?: number; clearcoatRoughness?: number }
export const PBR_KEYS: readonly (keyof PbrParams)[] = ['roughness', 'metalness', 'opacity', 'clearcoat', 'clearcoatRoughness'];
/** A procedural look drawn over the colour: wood grain. `scale` is the spacing of the growth rings in mm, `contrast` 0..1, `tone` the colour of the dark rings,
 *  `axis` the grain direction in the part's own coordinates (default: the longest side of the body). */
export interface ProceduralLook { kind: 'wood'; scale?: number; contrast?: number; tone?: string; axis?: 'x' | 'y' | 'z'; /** the user turned the grain off (a wood material would otherwise bring its own) */ off?: boolean }
/** An image texture from an online library, drawn triplanar over the colour. `id` is the library's asset id, `scale` the size of one tile in mm
 *  (the asset's real-world size when the picker applied it), `name` and `author` the credit shown next to it. */
export interface SurfaceTexture { source: 'polyhaven'; id: string; scale?: number; name?: string; author?: string }
export interface Appearance { color: string; material: MaterialPreset; pbr?: PbrParams; look?: ProceduralLook; texture?: SurfaceTexture }
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
    default: return { roughness: 0.24, metalness: 0.45, opacity: 1 };   // satin metal: reads as steel under the studio light
  }
}

export function isHex(v: unknown): v is string { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v); }
/** The valid keys of a PBR record, each clamped to 0..1 (opacity not below 0.05); undefined when nothing valid is left. */
export function sanitizePbr(raw: unknown): PbrParams | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: PbrParams = {};
  for (const k of PBR_KEYS) {
    const v = r[k];
    if (typeof v === 'number' && isFinite(v)) out[k] = Math.min(1, Math.max(k === 'opacity' ? 0.05 : 0, v));
  }
  return Object.keys(out).length ? out : undefined;
}
export function sanitizeProceduralLook(raw: unknown): ProceduralLook | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'wood') return undefined;
  const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
  const scale = num(r.scale, 0.5, 50), contrast = num(r.contrast, 0, 1);
  return { kind: 'wood', ...(scale !== undefined ? { scale } : {}), ...(contrast !== undefined ? { contrast } : {}), ...(isHex(r.tone) ? { tone: r.tone.toLowerCase() } : {}), ...(r.axis === 'x' || r.axis === 'y' || r.axis === 'z' ? { axis: r.axis } : {}), ...(r.off === true ? { off: true } : {}) };
}
export function sanitizeTexture(raw: unknown): SurfaceTexture | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (r.source !== 'polyhaven' || typeof r.id !== 'string' || !/^[a-z0-9_]{1,80}$/.test(r.id)) return undefined;
  const txt = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined);
  const scale = typeof r.scale === 'number' && isFinite(r.scale) ? Math.min(5000, Math.max(10, r.scale)) : undefined;
  return { source: 'polyhaven', id: r.id, ...(scale !== undefined ? { scale } : {}), ...(txt(r.name) ? { name: txt(r.name)! } : {}), ...(txt(r.author) ? { author: txt(r.author)! } : {}) };
}
export function sanitizeAppearance(raw: unknown): Appearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pbr = sanitizePbr(r.pbr), look = sanitizeProceduralLook(r.look), texture = sanitizeTexture(r.texture);
  return {
    color: isHex(r.color) ? r.color.toLowerCase() : DEFAULT_APPEARANCE.color,
    material: (MATERIAL_PRESETS as readonly unknown[]).includes(r.material) ? (r.material as MaterialPreset) : 'default',
    ...(pbr ? { pbr } : {}),
    ...(look ? { look } : {}),
    ...(texture ? { texture } : {}),
  };
}

export interface BodyLook { style: DisplayStyle; ghostOpacity: number; appearance: Appearance; /** 0..1 factor on the metalness (no reflections, no metal) */ metalScale?: number }

/** Apply a look to the body's material (`tinted`: the mesh has a per-vertex colour attribute, for surface bodies): the colour, roughness, metalness, opacity and which buffers it writes.
 *  `fade` (the sketch editor) caps the opacity and so composes with every style. */
export function applyBodyLook(mat: THREE.MeshStandardMaterial, look: BodyLook, fade = 1, tinted = false): void {
  const spec = styleSpec(look.style);
  const preset = materialParams(look.appearance.material);
  const o = look.appearance.pbr ?? {};
  const p = { roughness: o.roughness ?? preset.roughness, metalness: o.metalness ?? preset.metalness, opacity: o.opacity ?? preset.opacity };
  let opacity = p.opacity;
  mat.color.set(look.appearance.color);
  mat.roughness = p.roughness; mat.metalness = p.metalness * (look.metalScale ?? 1);
  setLook(mat, spec.faces === 'white' ? undefined : look.appearance.look);
  setTexture(mat, spec.faces === 'white' ? undefined : look.appearance.texture);
  if (mat instanceof THREE.MeshPhysicalMaterial) { mat.clearcoat = spec.faces === 'white' ? 0 : o.clearcoat ?? 0; mat.clearcoatRoughness = o.clearcoatRoughness ?? 0.1; }
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

/** Write a procedural look into the uniforms the material carries (kind 0 when there is none). The axis falls back to the body's longest side (`userData.longAxis`, set by the viewport). */
function setLook(mat: THREE.MeshStandardMaterial, l: ProceduralLook | undefined): void {
  const u = mat.userData.lookU as LookUniforms | undefined;
  if (!u) return;
  u.uLookKind.value = l && !l.off ? 1 : 0;
  if (!l || l.off) return;
  u.uLookScale.value = l.scale ?? 4;
  u.uLookContrast.value = l.contrast ?? 0.5;
  u.uLookTone.value.set(l.tone ?? '#3a2616');
  const ax = l.axis ?? (mat.userData.longAxis as 'x' | 'y' | 'z' | undefined) ?? 'x';
  u.uLookAxis.value.set(ax === 'x' ? 1 : 0, ax === 'y' ? 1 : 0, ax === 'z' ? 1 : 0);
}

/** Show an image texture when its images are loaded (the load starts here and the viewport redraws when it is done); otherwise the plain colour. */
function setTexture(mat: THREE.MeshStandardMaterial, tx: SurfaceTexture | undefined): void {
  const u = mat.userData.lookU as LookUniforms | undefined;
  if (!u) return;
  const ready = tx ? textureFor(tx.id) : null;
  u.uTexOn.value = ready ? 1 : 0;
  if (!tx || !ready) return;
  u.uTexScale.value = tx.scale ?? 400;
  u.uTexMap.value = ready.map;
  u.uTexRough.value = ready.rough;
  u.uTexRoughOn.value = ready.rough ? 1 : 0;
}

export function makeBodyMaterial(look: BodyLook, fade = 1, tinted = false): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,   // faces sit a hair behind sketches and edges lying on them
  });
  m.userData.lookU = makeLookUniforms();   // the shader hook is added last by the viewport (installLook), after the analysis and knurl hooks
  applyBodyLook(m, look, fade, tinted);
  return m;
}

/** Edge colour per style (hidden-line white faces want black edges; a dark body on a dark background wants none of this). */
export function edgeColor(style: DisplayStyle, preset: LightPreset = 'studio', dark = false): number {
  if (style === 'hiddenLines' || preset === 'technical') return 0x000000;
  return dark ? 0x0d1117 : 0x4a5565;   // darker than the face, not black
}
export const HIDDEN_EDGE_OPACITY = 0.18;

/** `env`: strength of the studio reflections (image based light); `sun` follows the camera; `white` paints every face matte white (technical). */
export interface LightSpec { sky: number; ground: number; hemi: number; sun: number; fill: number; env: number; exposure: number; white: boolean }
export function lightSpec(p: LightPreset): LightSpec {
  switch (p) {
    case 'flat': return { sky: 0xffffff, ground: 0xffffff, hemi: 3.6, sun: 0, fill: 0, env: 0, exposure: 1, white: false };
    case 'contrast': return { sky: 0xffffff, ground: 0x202428, hemi: 0.5, sun: 5.2, fill: 0, env: 0.45, exposure: 1, white: false };
    case 'technical': return { sky: 0xffffff, ground: 0xdfe3e8, hemi: 2.6, sun: 1.8, fill: 0, env: 0.35, exposure: 1, white: true };
    default: return { sky: 0xffffff, ground: 0xaab4c4, hemi: 0.45, sun: 1.1, fill: 0, env: 1.5, exposure: 1.12, white: false };
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

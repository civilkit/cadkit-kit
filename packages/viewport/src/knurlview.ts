// Cosmetic knurls in the viewport: a shading effect on a cylinder, no geometry. The body material gets a fragment hook that finds the points lying on
// the cylinder of each record (axis, centre, radius, band) and, there, bends the normal as the grooves would (a bump map computed from the pattern's
// formula, so it is sharp at any zoom) and darkens the groove floors a little. Grooves smaller than a pixel fade out instead of aliasing.
// `grooveField` is the same formula in TypeScript: the tests check the numbers the shader is built from. Straight, diamond and pyramid share it.
import type * as THREE from 'three';

/** One cosmetic knurl as the viewport takes it (the same fields as the script package's CosmeticKnurl; all numbers resolved). */
export interface KnurlView {
  axis: 'x' | 'y' | 'z';
  center: [number, number];
  radius: number; from: number; to: number;
  pattern: 'straight' | 'diamond' | 'pyramid';
  count: number; depth: number;
  profile: 'v' | 'round';
  angle: number; width: number; helixAngle: number; ringPitch: number;
}

/** How many knurls one body draws (more are ignored). */
export const KNURL_MAX = 4;
const PATTERN_ID = { straight: 0, diamond: 1, pyramid: 2 } as const;

/** Half the groove width at the surface. */
export const halfWidth = (k: KnurlView): number => (k.profile === 'v' ? k.depth * Math.tan((k.angle * Math.PI) / 360) : k.width / 2);
/** The unit vector of the axis and the point where the axis crosses the plane through the origin across it. */
export function axisFrame(k: KnurlView): { dir: [number, number, number]; origin: [number, number, number] } {
  if (k.axis === 'z') return { dir: [0, 0, 1], origin: [k.center[0], k.center[1], 0] };
  if (k.axis === 'y') return { dir: [0, 1, 0], origin: [k.center[0], 0, k.center[1]] };
  return { dir: [1, 0, 0], origin: [0, k.center[0], k.center[1]] };
}
/** Ring spacing actually used: the band divided into whole rings of about ringPitch, like the cut does. */
export const ringStep = (k: KnurlView): number => { const len = k.to - k.from; return len / Math.max(1, Math.floor(len / k.ringPitch)); };

/** Sixteen floats per knurl, the layout the shader reads (4 vec4): [axis.xyz, R] [origin.xyz, depth] [from, to, count, pattern] [tan helix, ring step, profile, half width]. */
export function packKnurls(list: readonly KnurlView[]): { data: Float32Array; count: number } {
  const used = list.slice(0, KNURL_MAX);
  const data = new Float32Array(KNURL_MAX * 16);
  used.forEach((k, i) => {
    const { dir, origin } = axisFrame(k);
    data.set([...dir, k.radius, ...origin, k.depth, k.from, k.to, k.count, PATTERN_ID[k.pattern], Math.tan((k.helixAngle * Math.PI) / 180), ringStep(k), k.profile === 'v' ? 0 : 1, halfWidth(k)], i * 16);
  });
  return { data, count: used.length };
}

/** Height of the surface (0 on the land, -depth at the bottom of a groove) and its slope in the circumferential and axial directions at angle `theta` round the axis and axial position `a`. */
export function grooveField(k: KnurlView, a: number, theta: number): { h: number; gt: number; ga: number } {
  const P = (2 * Math.PI * k.radius) / k.count, hw = halfWidth(k), d = k.depth;
  const rho = (d * d + hw * hw) / (2 * d);
  let h = 0, gt = 0, ga = 0;
  const family = (p: number, pitch: number, gpT: number, gpA: number): void => {
    const f = p - Math.floor(p + 0.5);
    const dist = Math.abs(f) * pitch;
    if (dist >= hw) return;
    let hh: number, sl: number;
    if (k.profile === 'v') { hh = -d * (1 - dist / hw); sl = d / hw; }
    else { const s = Math.sqrt(Math.max(rho * rho - dist * dist, 1e-6)); hh = -(s - (rho - d)); sl = dist / s; }
    if (hh < h) { h = hh; const sg = f < 0 ? -1 : 1; gt = sl * sg * pitch * gpT; ga = sl * sg * pitch * gpA; }
  };
  const pt = (k.count * theta) / (2 * Math.PI), x = a - k.from, tn = Math.tan((k.helixAngle * Math.PI) / 180);
  if (k.pattern === 'diamond') {
    family(pt - (x * tn) / P, P, 1 / P, -tn / P);
    family(pt + (x * tn) / P, P, 1 / P, tn / P);
  } else {
    family(pt, P, 1 / P, 0);
    if (k.pattern === 'pyramid') { const rs = ringStep(k); family(x / rs - 0.5, rs, 0, 1 / rs); }
  }
  return { h, gt, ga };
}

const SHADER_DECL = `
#define KN_MAX ${KNURL_MAX}
uniform int uKCount;
uniform vec4 uK[KN_MAX * 4];
varying vec3 vKPos;
varying vec3 vKNrm;
void knProfile(float dist, float hw, float d, float rho, float prof, out float h, out float sl) {
  h = 0.0; sl = 0.0;
  if (dist >= hw) return;
  if (prof < 0.5) { h = -d * (1.0 - dist / hw); sl = d / hw; }
  else { float s = sqrt(max(rho * rho - dist * dist, 1e-6)); h = -(s - (rho - d)); sl = dist / s; }
}
void knFamily(float p, float pitch, vec2 gp, float hw, float d, float rho, float prof, inout float h, inout vec2 g) {
  float f = p - floor(p + 0.5);
  float hh, sl;
  knProfile(abs(f) * pitch, hw, d, rho, prof, hh, sl);
  if (hh < h) { h = hh; g = sl * (f < 0.0 ? -1.0 : 1.0) * pitch * gp; }
}
`;
const SHADER_BODY = `
{
  float kDark = 0.0;
  vec3 kN = vec3(0.0);
  bool kHit = false;
  float px = length(fwidth(vKPos));
  for (int i = 0; i < KN_MAX; i++) {
    if (i >= uKCount) break;
    vec4 a0 = uK[i * 4], a1 = uK[i * 4 + 1], a2 = uK[i * 4 + 2], a3 = uK[i * 4 + 3];
    vec3 ax = a0.xyz; float R = a0.w; float d = a1.w;
    float ak = dot(vKPos - a1.xyz, ax);
    if (ak < a2.x || ak > a2.y) continue;
    vec3 r = vKPos - a1.xyz - ax * ak;
    float rl = length(r);
    if (rl < 1e-5 || abs(rl - R) > 0.08 * R + 0.02) continue;
    vec3 rd = r / rl;
    if (dot(normalize(vKNrm), rd) < 0.9) continue;
    vec3 u = abs(ax.z) < 0.9 ? normalize(cross(ax, vec3(0.0, 0.0, 1.0))) : normalize(cross(ax, vec3(1.0, 0.0, 0.0)));
    vec3 v = cross(ax, u);
    float th = atan(dot(rd, v), dot(rd, u));
    float N = a2.z; float pat = a2.w; float tn = a3.x; float rs = a3.y; float prof = a3.z; float hw = a3.w;
    float P = 6.28318530718 * R / N;
    float rho = (d * d + hw * hw) / (2.0 * d);
    float pt = N * th / 6.28318530718; float x = ak - a2.x;
    float h = 0.0; vec2 g = vec2(0.0);
    if (pat > 0.5 && pat < 1.5) {
      knFamily(pt - x * tn / P, P, vec2(1.0 / P, -tn / P), hw, d, rho, prof, h, g);
      knFamily(pt + x * tn / P, P, vec2(1.0 / P, tn / P), hw, d, rho, prof, h, g);
    } else {
      knFamily(pt, P, vec2(1.0 / P, 0.0), hw, d, rho, prof, h, g);
      if (pat > 1.5) knFamily(x / rs - 0.5, rs, vec2(0.0, 1.0 / rs), hw, d, rho, prof, h, g);
    }
    float aa = 1.0 - smoothstep(0.15, 0.5, px / min(P, pat > 1.5 ? rs : P));
    vec3 tg = cross(ax, rd);
    kN = rd - (g.x * tg + g.y * ax) * aa;
    kDark = (-h / d) * aa;
    kHit = true;
    break;
  }
  if (kHit) {
    vec3 nv = normalize((viewMatrix * vec4(normalize(kN), 0.0)).xyz);
    #ifdef DOUBLE_SIDED
    normal = nv * faceDirection;
    #else
    normal = nv;
    #endif
    diffuseColor.rgb *= 1.0 - 0.4 * kDark;
  }
}
`;

/** Hooks a cosmetic-knurl shader into body materials and holds the uniforms they share, so a change of the list needs no recompile. */
export class KnurlLayer {
  private readonly uniforms = { uKCount: { value: 0 }, uK: { value: new Float32Array(KNURL_MAX * 16) } };
  /** The list now drawn. */
  list: KnurlView[] = [];

  /** Whether the list changed. */
  set(list: readonly KnurlView[]): boolean {
    if (JSON.stringify(list) === JSON.stringify(this.list)) return false;
    this.list = list.map((k) => ({ ...k, center: [...k.center] as [number, number] }));
    const p = packKnurls(this.list);
    this.uniforms.uK.value.set(p.data);
    this.uniforms.uKCount.value = p.count;
    return true;
  }

  /** Add the hook after any earlier one (the analysis layer's). Call once per material. */
  install(mat: THREE.MeshStandardMaterial): void {
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
    mat.onBeforeCompile = (sh, r) => {
      prev?.call(mat, sh, r);
      sh.uniforms.uKCount = this.uniforms.uKCount; sh.uniforms.uK = this.uniforms.uK;
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec3 vKPos;\nvarying vec3 vKNrm;\nvoid main() {\n  vKPos = position;\n  vKNrm = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', `${SHADER_DECL}\nvoid main() {`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${SHADER_BODY}`);
    };
    mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}+knurl-v1`;
    mat.needsUpdate = true;
  }
}

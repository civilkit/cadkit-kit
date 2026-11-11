// Procedural looks for the body material (wood grain first), computed in the fragment shader from the body's own object-space
// position, so they need no texture coordinates and work on every body, imported ones included. The values come from the appearance
// (styles.ts, `Appearance.look`); the uniforms live on the material (`userData.lookU`) and are set by applyBodyLook.
import * as THREE from 'three';

export interface LookUniforms {
  uLookKind: { value: number };
  uLookScale: { value: number };
  uLookContrast: { value: number };
  uLookTone: { value: THREE.Color };
  uLookAxis: { value: THREE.Vector3 };
}
export const makeLookUniforms = (): LookUniforms => ({
  uLookKind: { value: 0 }, uLookScale: { value: 4 }, uLookContrast: { value: 0.5 }, uLookTone: { value: new THREE.Color(0x000000) }, uLookAxis: { value: new THREE.Vector3(1, 0, 0) },
});

const DECL = /* glsl */ `
varying vec3 vLPos;
uniform int uLookKind;
uniform float uLookScale;
uniform float uLookContrast;
uniform vec3 uLookTone;
uniform vec3 uLookAxis;
float lhash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float lnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lhash(i), lhash(i + vec3(1, 0, 0)), f.x), mix(lhash(i + vec3(0, 1, 0)), lhash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(lhash(i + vec3(0, 0, 1)), lhash(i + vec3(1, 0, 1)), f.x), mix(lhash(i + vec3(0, 1, 1)), lhash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

/** Wood: growth rings around the grain axis (soft latewood bands with a slow wobble) and fine streaks along it. */
const BODY = /* glsl */ `
  if (uLookKind == 1) {
    vec3 a = normalize(uLookAxis);
    float along = dot(vLPos, a);
    vec3 q = vLPos - a * along;
    float wobble = lnoise(vLPos * (0.35 / uLookScale));
    float r = length(q) / uLookScale + wobble * 1.8;
    float ring = fract(r);
    float band = smoothstep(0.0, 0.6, ring) * (1.0 - smoothstep(0.6, 1.0, ring));
    float streak = lnoise(q * (3.0 / uLookScale) + a * (along * 0.06 / uLookScale));
    float t = clamp(band * 0.62 + streak * 0.38, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, uLookTone, t * uLookContrast);
  }
`;

/** Add the hook after any earlier one (the analysis layer's, the knurl layer's). Call once per material, last. */
export function installLook(mat: THREE.MeshStandardMaterial, u: LookUniforms): void {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec3 vLPos;\nvoid main() {\n  vLPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${DECL}\nvoid main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${BODY}`);
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}+look-v1`;
  mat.needsUpdate = true;
}

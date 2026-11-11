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
  uTexOn: { value: number };
  uTexScale: { value: number };
  uTexMap: { value: THREE.Texture | null };
  uTexRough: { value: THREE.Texture | null };
  uTexRoughOn: { value: number };
  uTexNormal: { value: THREE.Texture | null };
  uTexNormalOn: { value: number };
  uTexRelief: { value: number };
}
export const makeLookUniforms = (): LookUniforms => ({
  uLookKind: { value: 0 }, uLookScale: { value: 4 }, uLookContrast: { value: 0.5 }, uLookTone: { value: new THREE.Color(0x000000) }, uLookAxis: { value: new THREE.Vector3(1, 0, 0) },
  uTexOn: { value: 0 }, uTexScale: { value: 200 }, uTexMap: { value: null }, uTexRough: { value: null }, uTexRoughOn: { value: 0 }, uTexNormal: { value: null }, uTexNormalOn: { value: 0 }, uTexRelief: { value: 1 },
});

const DECL = /* glsl */ `
varying vec3 vLPos;
varying vec3 vLNrm;
uniform int uLookKind;
uniform int uTexOn;
uniform float uTexScale;
uniform sampler2D uTexMap;
uniform sampler2D uTexRough;
uniform int uTexRoughOn;
uniform sampler2D uTexNormal;
uniform int uTexNormalOn;
uniform float uTexRelief;
varying mat3 vLNMat;
vec4 triSample(sampler2D tex, vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-5);
  vec3 q = p / uTexScale;
  return texture2D(tex, q.yz) * w.x + texture2D(tex, q.xz) * w.y + texture2D(tex, q.xy) * w.z;
}
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
  if (uTexOn == 1) diffuseColor.rgb = triSample(uTexMap, vLPos, normalize(vLNrm)).rgb;
`;
const ROUGH = /* glsl */ `
  if (uTexOn == 1 && uTexRoughOn == 1) roughnessFactor = clamp(triSample(uTexRough, vLPos, normalize(vLNrm)).g, 0.04, 1.0);
`;

/** Normal map, triplanar with the whiteout blend: each projection's tangent-space normal is bent by the geometric normal, the three are blended in object
 *  space and moved to view space with the object's normal matrix (passed from the vertex shader). `faceDirection` flips the normal on a back face. */
const NORMAL = /* glsl */ `
  if (uTexOn == 1 && uTexNormalOn == 1) {
    vec3 gn = normalize(vLNrm) * faceDirection;
    vec3 bw = pow(abs(gn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z + 1e-5);
    vec3 tq = vLPos / uTexScale;
    vec3 nx = texture2D(uTexNormal, tq.yz).xyz * 2.0 - 1.0;
    vec3 ny = texture2D(uTexNormal, tq.xz).xyz * 2.0 - 1.0;
    vec3 nz = texture2D(uTexNormal, tq.xy).xyz * 2.0 - 1.0;
    nx.xy *= uTexRelief; ny.xy *= uTexRelief; nz.xy *= uTexRelief;
    nx = vec3(nx.xy + gn.zy, abs(nx.z) * gn.x);
    ny = vec3(ny.xy + gn.xz, abs(ny.z) * gn.y);
    nz = vec3(nz.xy + gn.xy, abs(nz.z) * gn.z);
    vec3 on = normalize(nx.zyx * bw.x + ny.xzy * bw.y + nz.xyz * bw.z);
    normal = normalize(vLNMat * on);
  }
`;

/** Add the hook after any earlier one (the analysis layer's, the knurl layer's). Call once per material, last. */
export function installLook(mat: THREE.MeshStandardMaterial, u: LookUniforms): void {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec3 vLPos;\nvarying vec3 vLNrm;\nvarying mat3 vLNMat;\nvoid main() {\n  vLPos = position;\n  vLNrm = normal;\n  vLNMat = normalMatrix;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${DECL}\nvoid main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${BODY}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${NORMAL}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGH}`);
  };
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}+look-v3`;
  mat.needsUpdate = true;
}

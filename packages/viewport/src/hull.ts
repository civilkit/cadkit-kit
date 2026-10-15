// Silhouette outline: the body's back faces drawn again, pushed outwards along their normals by a fixed number of pixels, in the
// edge colour. Only the rim that sticks out around the front faces survives the depth test, so the outline follows every
// silhouette, also on smooth surfaces where there is no feature edge. One extra draw of the body's own buffers.
import * as THREE from 'three';

const VERT = /* glsl */ `
uniform vec2 uInvSize;
uniform float uWidth;
void main() {
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vec2 d = (projectionMatrix * vec4(n, 0.0)).xy;
  float l = length(d);
  if (l > 1e-5) p.xy += d / l * uWidth * 0.5 * uInvSize * p.w;
  gl_Position = p;
}`;
const FRAG = /* glsl */ `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`;

export function makeHullMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(0x2b3542) }, uWidth: { value: 1.3 }, uInvSize: { value: new THREE.Vector2(0.002, 0.002) } },
    toneMapped: false,
  });
}

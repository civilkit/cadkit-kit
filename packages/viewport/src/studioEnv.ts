// The studio environment: a soft grey dome with a few bright soft boxes (two tall strips at the sides, a top light, a front
// fill and two rims), prefiltered once with PMREM. It gives metal something to reflect, so highlights and reflections read.
import * as THREE from 'three';

const FRAG = /* glsl */ `
varying vec3 vDir;
float softbox(vec3 d, vec3 c, vec3 up, float hw, float hh, float soft) {
  float t = dot(d, c);
  if (t <= 0.0) return 0.0;
  vec3 x = normalize(cross(up, c)), y = cross(c, x);
  vec3 p = d / t - c;
  float u = abs(dot(p, x)), v = abs(dot(p, y));
  float m = (1.0 - smoothstep(hw - soft, hw + soft, u)) * (1.0 - smoothstep(hh - soft, hh + soft, v));
  return m * (1.0 - 0.15 * (u * u / (hw * hw) + v * v / (hh * hh)));
}
vec3 studio(vec3 d) {
  float h = d.y;
  vec3 Y = vec3(0.0, 1.0, 0.0), Z = vec3(0.0, 0.0, 1.0);
  vec3 c = mix(vec3(0.34, 0.35, 0.37), vec3(0.72, 0.74, 0.78), smoothstep(0.05, 0.95, h));
  vec3 floorC = mix(vec3(0.2, 0.205, 0.21), vec3(0.4, 0.405, 0.41), smoothstep(-0.2, -1.0, h));
  c = mix(floorC, c, smoothstep(-0.05, 0.05, h));
  c *= 1.0 - 0.6 * exp(-h * h * 700.0);
  c += vec3(0.5, 0.51, 0.53) * softbox(d, normalize(vec3(0.25, 0.3, 1.0)), Y, 0.75, 0.5, 0.45);
  c += vec3(6.5) * softbox(d, normalize(vec3(-0.97, 0.08, -0.12)), Y, 0.075, 0.9, 0.02);
  c += vec3(4.8) * softbox(d, normalize(vec3(0.94, 0.14, -0.3)), Y, 0.06, 0.85, 0.02);
  c += vec3(4.2) * softbox(d, normalize(vec3(0.05, 0.97, 0.25)), Z, 0.6, 0.25, 0.04);
  c += vec3(2.0, 2.02, 2.1) * softbox(d, normalize(vec3(0.72, 0.28, 0.63)), Y, 0.28, 0.4, 0.05);
  c += vec3(2.6) * softbox(d, normalize(vec3(-0.2, 0.42, -0.88)), Y, 0.4, 0.22, 0.05);
  return c;
}
void main() { gl_FragColor = vec4(studio(normalize(vDir)), 1.0); }`;
const VERT = /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Build the studio environment map (call once per renderer; dispose with the renderer). */
export function buildStudioEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 32), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0, 0.1, 100);
  pm.dispose(); mat.dispose(); (scene.children[0] as THREE.Mesh).geometry.dispose();
  return rt.texture;
}

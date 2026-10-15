// The scene side of surface analysis (see analysis.ts for the numbers): zebra stripes as a fragment-shader hook on the body
// material, colour maps as a per-vertex colour attribute drawn unlit, and the curvature comb as line segments. The Viewport
// owns one of these; it calls `apply` whenever the body, the style or the options change.
import * as THREE from 'three';
import type { Grouped } from './meshgeom';
import {
  combSegments, curvatureColors, draftColors, gaussianOf, meanOf, vertexCurvatures,
  type AnalysisOptions, type Legend,
} from './analysis';

const MODE_ID = { off: 0, zebra: 1, gaussian: 2, mean: 2, draft: 2 } as const;

export class AnalysisLayer {
  private readonly uniforms = { uAnalysis: { value: 0 }, uDensity: { value: 12 }, uAxis: { value: new THREE.Vector3(0, 1, 0) } };
  private comb: THREE.LineSegments | null = null;
  /** The legend of what is drawn now (null when nothing is). */
  legend: Legend | null = null;
  private curv: { grouped: Grouped; k1: Float32Array; k2: Float32Array } | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly onLegend: (l: Legend | null) => void) {}

  /** Hook the shader of a body material. Safe to call once per material. */
  install(mat: THREE.MeshStandardMaterial): void {
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uAnalysis = u.uAnalysis; sh.uniforms.uDensity = u.uDensity; sh.uniforms.uAxis = u.uAxis;
      // per-face finish: the body's buffer carries (roughness, metalness) per vertex, or -1 to keep the material's own
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'attribute vec2 aSurf;\nvarying vec2 vSurf;\nvoid main() {\n  vSurf = aSurf;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  if (vSurf.x >= 0.0) roughnessFactor = vSurf.x;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  if (vSurf.y >= 0.0) metalnessFactor = vSurf.y;')
        .replace('void main() {', 'varying vec2 vSurf;\nuniform int uAnalysis;\nuniform float uDensity;\nuniform vec3 uAxis;\nvoid main() {')
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
  if (uAnalysis == 1) {
    vec3 vdir = normalize(vViewPosition);
    vec3 rw = inverseTransformDirection(reflect(-vdir, normal), viewMatrix);
    float x = dot(rw, normalize(uAxis)) * uDensity * 0.5;
    float tri = abs(fract(x) - 0.5) * 2.0;
    float w = fwidth(tri) * 0.8 + 0.002;
    float s = smoothstep(0.5 - w, 0.5 + w, tri);
    gl_FragColor = vec4(mix(vec3(0.97), vec3(0.06, 0.07, 0.09), s), diffuseColor.a);
  }
  #ifdef USE_COLOR
  if (uAnalysis == 2) {
    float shade = 0.72 + 0.28 * max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
    gl_FragColor = vec4(vColor * shade, diffuseColor.a);
  }
  #endif`);
    };
    mat.customProgramCacheKey = () => 'analysis-v2';
    mat.needsUpdate = true;
  }

  private setLegend(l: Legend | null): void {
    if (JSON.stringify(l) === JSON.stringify(this.legend)) return;   // a drag rebuilds the body many times a second
    this.legend = l;
    this.onLegend(l);
  }

  /**
   * Show `o` on the mesh. `faces` says whether the style draws the faces at all (hidden-line white and wireframe do not); `tints` is
   * the colour attribute the surface bodies carry without analysis (null when the mesh has none). `lines` are the polylines the
   * comb is drawn over and `size` the model size.
   */
  apply(p: { mesh: THREE.Mesh | null; grouped: Grouped | null; faces: boolean; tints: Float32Array | null; o: AnalysisOptions; lines: number[][][]; size: number; combVisible: boolean }): void {
    const { mesh, o } = p;
    this.dropComb();
    const mat = mesh?.material as THREE.MeshStandardMaterial | undefined;
    const geo = mesh?.geometry;
    let mode: AnalysisOptions['mode'] = p.faces ? o.mode : 'off';
    let legend: Legend | null = null;
    if (mesh && mat && geo && p.grouped) {
      const g = p.grouped;
      const nv = g.positions.length / 3;
      if (mode === 'gaussian' || mode === 'mean') {
        if (!this.curv || this.curv.grouped !== g) { const c = vertexCurvatures(g.positions, g.normals, g.ranges); this.curv = { grouped: g, k1: c.k1, k2: c.k2 }; }
        const v = mode === 'gaussian' ? gaussianOf(this.curv.k1, this.curv.k2) : meanOf(this.curv.k1, this.curv.k2);
        const r = curvatureColors(v, mode);
        geo.setAttribute('color', new THREE.BufferAttribute(r.colors, 3)); legend = r.legend;
      } else if (mode === 'draft') {
        const r = draftColors(g.normals, o.pull, o.draftMin);
        geo.setAttribute('color', new THREE.BufferAttribute(r.colors, 3)); legend = r.legend;
      } else if (p.tints && p.tints.length === nv * 3) geo.setAttribute('color', new THREE.BufferAttribute(p.tints, 3));
      else if (geo.getAttribute('color')) geo.deleteAttribute('color');
      const colored = mode === 'gaussian' || mode === 'mean' || mode === 'draft';
      if (p.faces) {
        const vc = colored || !!p.tints;   // the surface tint (or an analysis colour) is read per vertex; otherwise the plain material
        if (mat.vertexColors !== vc) { mat.vertexColors = vc; mat.needsUpdate = true; }
      }
      this.uniforms.uAnalysis.value = MODE_ID[mode];
      this.uniforms.uDensity.value = o.zebraDensity;
    }
    this.setLegend(legend);
    if (o.comb && p.combVisible && p.lines.length) {
      const { segments } = combSegments(p.lines, p.size || 1, o.combScale);
      if (segments.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(segments, 3));
        this.comb = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc2185b, depthTest: false, transparent: true, opacity: 0.9 }));
        this.comb.renderOrder = 5;
        this.scene.add(this.comb);
      }
    }
  }

  /** Forget cached curvature (a new body). */
  reset(): void { this.curv = null; }
  private dropComb(): void {
    if (!this.comb) return;
    this.scene.remove(this.comb); this.comb.geometry.dispose(); (this.comb.material as THREE.Material).dispose(); this.comb = null;
  }
  dispose(): void { this.dropComb(); this.curv = null; }
  /** The body went away: no legend. */
  clearLegend(): void { this.setLegend(null); }
}

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { installLook, makeLookUniforms } from './lookshader';

describe('look shader hook', () => {
  const run = () => {
    const m = new THREE.MeshPhysicalMaterial(), u = makeLookUniforms();
    installLook(m, u);
    const sh = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: 'void main() {\n}',
      fragmentShader: 'void main() {\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n}',
    };
    m.onBeforeCompile(sh as never, null as never);
    return { sh, u };
  };
  it('perturbs the normal after the normal map chunk, only when a normal map is on', () => {
    const { sh, u } = run();
    const i = sh.fragmentShader.indexOf('#include <normal_fragment_maps>');
    expect(sh.fragmentShader.slice(i)).toContain('uTexNormalOn == 1');
    expect(sh.fragmentShader).toContain('abs(nx.z) * gn.x');   // whiteout blend
    expect(sh.vertexShader).toContain('vLNMat = normalMatrix');
    expect(u.uTexNormalOn.value).toBe(0);   // without maps the shader changes nothing
    expect(sh.uniforms.uTexNormal).toBe(u.uTexNormal);
  });
  it('keeps a distinct program key so the old program is not reused', () => {
    expect(new THREE.MeshPhysicalMaterial().customProgramCacheKey()).not.toContain('look-v3');
    const m = new THREE.MeshPhysicalMaterial(); installLook(m, makeLookUniforms());
    expect(m.customProgramCacheKey()).toContain('look-v3');
  });
});

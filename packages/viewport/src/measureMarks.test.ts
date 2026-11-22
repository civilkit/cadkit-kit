import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { buildMeasureMarks, disposeMarks } from './measureMarks';

afterEach(() => vi.unstubAllGlobals());

describe('measure marks disposal', () => {
  it('frees the line and dot materials, the geometries and each label sprite material and texture, each once', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null, width: 0, height: 0 }) });
    const spies = [THREE.BufferGeometry, THREE.Material, THREE.Texture].map((c) => vi.spyOn(c.prototype as { dispose(): void }, 'dispose'));
    const g = buildMeasureMarks([{ a: [0, 0, 0], b: [1, 0, 0], text: '1' }, { a: [0, 1, 0], b: [0, 2, 0], text: '2' }], 10)!;
    disposeMarks(g);
    const [geo, mat, tex] = spies.map((s) => s.mock.calls.length);
    expect(geo).toBe(3);   // two lines and the one shared dot sphere
    expect(mat).toBe(4);   // line material, dot material, two sprite materials
    expect(tex).toBe(2);   // one canvas texture per label
    spies.forEach((s) => s.mockRestore());
  });
});

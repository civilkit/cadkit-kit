import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHullMaterial } from './hull';
import { makeBodyMaterial } from './styles';

describe('silhouette outline material', () => {
  // A sheet seen from behind: its own triangles are the outline's back faces, at the same depth as the shaded faces. The outline
  // must lose that tie (it painted surface bodies in dark hatched patches), so its polygon offset lies behind the body material's.
  it('is pushed further back than the body faces', () => {
    const hull = makeHullMaterial();
    const body = makeBodyMaterial({ style: 'shaded', appearance: { color: '#8899aa', material: 'steel' } } as never);
    expect(hull.side).toBe(THREE.BackSide);
    expect(body.polygonOffset).toBe(true);
    expect(hull.polygonOffset).toBe(true);
    expect(hull.polygonOffsetFactor).toBeGreaterThanOrEqual(body.polygonOffsetFactor + 2);   // + the sub-pixel sideways push
    expect(hull.polygonOffsetUnits).toBeGreaterThan(body.polygonOffsetUnits);
  });
});

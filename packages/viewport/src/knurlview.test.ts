import { describe, expect, it } from 'vitest';
import { KNURL_MAX, KnurlLayer, axisFrame, grooveField, halfWidth, packKnurls, ringStep, type KnurlView } from './knurlview';

const K = (o: Partial<KnurlView> = {}): KnurlView => ({ axis: 'z', center: [0, 0], radius: 10, from: 0, to: 12, pattern: 'straight', count: 24, depth: 0.6, profile: 'v', angle: 90, width: 1.2, helixAngle: 30, ringPitch: 2.6, ...o });
const PITCH = (2 * Math.PI * 10) / 24;

describe('cosmetic knurl data for the shader', () => {
  it('half width: a 90 degree V is as wide as it is deep; a round groove uses its width', () => {
    expect(halfWidth(K())).toBeCloseTo(0.6, 9);
    expect(halfWidth(K({ angle: 60 }))).toBeCloseTo(0.6 * Math.tan(Math.PI / 6), 9);
    expect(halfWidth(K({ profile: 'round', width: 1.5 }))).toBe(0.75);
  });
  it('the axis frame follows the document convention for the centre', () => {
    expect(axisFrame(K({ axis: 'z', center: [1, 2] }))).toEqual({ dir: [0, 0, 1], origin: [1, 2, 0] });
    expect(axisFrame(K({ axis: 'y', center: [1, 2] }))).toEqual({ dir: [0, 1, 0], origin: [1, 0, 2] });
    expect(axisFrame(K({ axis: 'x', center: [1, 2] }))).toEqual({ dir: [1, 0, 0], origin: [0, 1, 2] });
  });
  it('packs sixteen floats per knurl and ignores knurls past the limit', () => {
    const { data, count } = packKnurls([K({ axis: 'y', center: [3, 4], pattern: 'diamond', helixAngle: 45, profile: 'round', width: 2, from: 1, to: 9 })]);
    expect(count).toBe(1);
    const want = [0, 1, 0, 10, 3, 0, 4, 0.6, 1, 9, 24, 1, 1, 8 / 3, 1, 1];   // axis, R | origin, depth | from, to, count, pattern | tan helix, ring step, profile, half width
    const got = Array.from(data.slice(0, 16));
    want.forEach((w, i) => expect(got[i], `float ${i}`).toBeCloseTo(w, 5));
    expect(data.length).toBe(KNURL_MAX * 16);
    expect(packKnurls(Array.from({ length: KNURL_MAX + 3 }, () => K())).count).toBe(KNURL_MAX);
    expect(packKnurls([]).count).toBe(0);
  });
  it('rings divide the band into whole steps', () => {
    expect(ringStep(K({ from: 0, to: 12, ringPitch: 2.6 }))).toBeCloseTo(12 / 4, 9);
    expect(ringStep(K({ from: 0, to: 1, ringPitch: 5 }))).toBe(1);
  });
});

describe('grooveField: the formula the shader draws', () => {
  const at = (k: KnurlView, a: number, grooveFrac: number) => grooveField(k, a, (2 * Math.PI * grooveFrac) / k.count);
  it('straight: full depth at a groove centre, land between grooves, slope toward the land', () => {
    const k = K();
    expect(at(k, 5, 0).h).toBeCloseTo(-0.6, 9);
    expect(at(k, 5, 0.5).h).toBe(0);   // halfway: 1.3 mm from either centre, past the 0.6 mm half width
    const side = at(k, 5, 0.1);   // 0.1 pitch = 0.262 mm from the centre, on the + side
    expect(side.h).toBeCloseTo(-0.6 * (1 - (0.1 * PITCH) / 0.6), 9);
    expect(side.gt).toBeCloseTo(1, 9);   // d / hw = 1 for a 90 degree V
    expect(at(k, 5, -0.1).gt).toBeCloseTo(-1, 9);
    expect(side.ga).toBeCloseTo(0, 12);
  });
  it('round grooves reach their depth and meet the surface at the half width', () => {
    const k = K({ profile: 'round', width: 1.2 });
    expect(at(k, 5, 0).h).toBeCloseTo(-0.6, 9);
    expect(at(k, 5, 0.61 / PITCH).h).toBe(0);   // past the half width (0.6 mm)
    expect(at(k, 5, 0.3 / PITCH).gt).toBeGreaterThan(0);
  });
  it('diamond: two crossed helical families, the deeper one wins; the groove lines tilt with the helix angle', () => {
    const k = K({ pattern: 'diamond', helixAngle: 45 });
    // one family passes through (theta 0, a = from); a groove line moves one pitch round per pitch*cot(45) along the axis
    expect(at(k, 0, 0).h).toBeCloseTo(-0.6, 9);
    expect(grooveField(k, PITCH, 0).h).toBeCloseTo(-0.6, 6);   // after one pitch along the axis a family is back on a groove centre
    const g = grooveField(k, 0.1, 0);
    expect(Math.abs(g.ga)).toBeGreaterThan(0.5);   // the slope has an axial part: the grooves are not axial
    const crossing = grooveField(k, PITCH / 2, (2 * Math.PI * 0.5) / k.count);   // where both families cross, both centred
    expect(crossing.h).toBeCloseTo(-0.6, 6);
  });
  it('pyramid: axial grooves and rings; between both there is a flat top', () => {
    const k = K({ pattern: 'pyramid', ringPitch: 3, from: 0, to: 12 });
    const step = ringStep(k);
    const top = at(k, step, 0.5);   // a ring groove sits at step * (j + 0.5): step is halfway between two rings
    expect(top.h).toBe(0);
    expect(at(k, step * 0.5, 0.5).h).toBeCloseTo(-0.6, 9);   // on a ring, between axial grooves
    const flank = at(k, step * 0.5 + 0.1, 0.5);   // on the flank of a ring groove: the slope is axial only
    expect(flank.ga).toBeCloseTo(1, 9);
    expect(flank.gt).toBeCloseTo(0, 9);
  });
});

describe('KnurlLayer', () => {
  it('reports a change of the list once and keeps the uniforms', () => {
    const l = new KnurlLayer();
    expect(l.set([])).toBe(false);
    expect(l.set([K()])).toBe(true);
    expect(l.set([K()])).toBe(false);
    expect(l.set([])).toBe(true);
  });
  it('wraps an earlier shader hook and the cache key, and adds the knurl code after the normal map', () => {
    const l = new KnurlLayer();
    const calls: string[] = [];
    const mat = { onBeforeCompile: (sh: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> }) => { calls.push('prev'); sh.uniforms.uA = 1; }, customProgramCacheKey: () => 'analysis-v2', needsUpdate: false };
    l.install(mat as never);
    const sh = { vertexShader: 'void main() {\n}', fragmentShader: 'void main() {\n#include <normal_fragment_maps>\n}', uniforms: {} as Record<string, unknown> };
    (mat.onBeforeCompile as unknown as (s: typeof sh, r: unknown) => void)(sh, null);
    expect(calls).toEqual(['prev']);
    expect(Object.keys(sh.uniforms).sort()).toEqual(['uA', 'uK', 'uKCount']);
    expect(sh.vertexShader).toContain('vKPos = position;');
    expect(sh.fragmentShader.indexOf('#include <normal_fragment_maps>')).toBeLessThan(sh.fragmentShader.indexOf('kHit'));
    expect(mat.customProgramCacheKey()).toBe('analysis-v2+knurl-v1');
    expect(mat.needsUpdate).toBe(true);
  });
});

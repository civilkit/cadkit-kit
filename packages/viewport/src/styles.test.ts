import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { styleSpec, DISPLAY_STYLES, materialParams, sanitizeAppearance, clampOpacity, makeBodyMaterial, applyBodyLook, backgroundColors, lightSpec, edgeColor, DEFAULT_APPEARANCE, type BodyLook } from './styles';

const look = (over: Partial<BodyLook> = {}): BodyLook => ({ style: 'shadedEdges', ghostOpacity: 0.4, appearance: DEFAULT_APPEARANCE, ...over });

describe('style specs', () => {
  it('covers every style and only wireframe draws hidden edges', () => {
    for (const s of DISPLAY_STYLES) expect(styleSpec(s)).toBeTruthy();
    expect(DISPLAY_STYLES.filter((s) => styleSpec(s).hiddenEdges)).toEqual(['wireframe']);
    expect(styleSpec('shaded').edges).toBe('none');
    expect(styleSpec('wireframe').edges).toBe('always');
    expect(styleSpec('shadedEdges').edges).toBe('layer');
  });
});

describe('body material', () => {
  it('shaded with edges is opaque with the default look', () => {
    const m = makeBodyMaterial(look());
    expect(m.transparent).toBe(false);
    expect(m.opacity).toBe(1);
    expect(m.depthWrite).toBe(true);
  });
  it('wireframe writes depth but no colour (so it hides back edges and still picks)', () => {
    const m = makeBodyMaterial(look({ style: 'wireframe' }));
    expect(m.colorWrite).toBe(false);
    expect(m.depthWrite).toBe(true);
  });
  it('hidden lines is flat white', () => {
    const m = makeBodyMaterial(look({ style: 'hiddenLines' }));
    expect(m.color.getHex()).toBe(0xffffff);
    expect(m.emissive.getHex()).toBe(0xffffff);
    expect(edgeColor('hiddenLines')).toBe(0);
  });
  it('ghost takes the slider opacity and stops writing depth', () => {
    const m = makeBodyMaterial(look({ style: 'ghost', ghostOpacity: 0.3 }));
    expect(m.opacity).toBeCloseTo(0.3);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
  });
  it('the sketch fade caps every style and is undone by applying again without it', () => {
    for (const s of DISPLAY_STYLES) {
      const m = makeBodyMaterial(look({ style: s }), 0.25);
      expect(m.opacity).toBeLessThanOrEqual(0.25);
      expect(m.transparent).toBe(true);
      applyBodyLook(m, look({ style: s }));
      expect(m.opacity).toBe(s === 'ghost' ? 0.4 : 1);
    }
  });
  it('colour and material presets reach the material; glass is see-through', () => {
    const m = makeBodyMaterial(look({ appearance: { color: '#d0463b', material: 'brushed' } }));
    expect(m.color.getHexString()).toBe(new THREE.Color('#d0463b').getHexString());
    expect(m.metalness).toBeGreaterThan(0.8);
    const g = makeBodyMaterial(look({ appearance: { color: '#ffffff', material: 'glass' } }));
    expect(g.transparent).toBe(true);
    expect(materialParams('plastic').metalness).toBe(0);
    // ghost never makes glass more opaque than glass
    expect(makeBodyMaterial(look({ style: 'ghost', ghostOpacity: 0.9, appearance: { color: '#ffffff', material: 'glass' } })).opacity).toBeCloseTo(0.35);
  });
});

describe('sanitising', () => {
  it('keeps valid appearance and falls back otherwise', () => {
    expect(sanitizeAppearance({ color: '#ABCDEF', material: 'plastic' })).toEqual({ color: '#abcdef', material: 'plastic' });
    expect(sanitizeAppearance({ color: 'red', material: 'gold' })).toEqual(DEFAULT_APPEARANCE);
    expect(sanitizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });
  it('clamps opacity', () => {
    expect(clampOpacity(5)).toBe(1);
    expect(clampOpacity(-1)).toBe(0.05);
    expect(clampOpacity('x', 0.5)).toBe(0.5);
  });
});

describe('scene presets', () => {
  const theme = { top: '#111111', bottom: '#222222' };
  it('background modes', () => {
    expect(backgroundColors('theme', theme)).toEqual({ top: '#222222', bottom: '#222222' });
    expect(backgroundColors('gradient', theme)).toEqual(theme);
    expect(backgroundColors('dark', theme).top).toBe(backgroundColors('dark', theme).bottom);
  });
  it('flat lighting has no sun, contrast has a strong one', () => {
    expect(lightSpec('flat').sun).toBe(0);
    expect(lightSpec('contrast').sun).toBeGreaterThan(lightSpec('studio').sun);
  });
});

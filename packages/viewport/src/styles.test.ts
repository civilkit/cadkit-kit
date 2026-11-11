import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { effectiveLight, clampIntensity, displayColor, edgePixels, EDGE_WIDTHS, LIGHT_PRESETS, MATERIAL_PRESETS, styleSpec, DISPLAY_STYLES, materialParams, sanitizeAppearance, clampOpacity, makeBodyMaterial, applyBodyLook, backgroundColors, lightSpec, edgeColor, DEFAULT_APPEARANCE, type BodyLook } from './styles';

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

describe('studio look', () => {
  it('offers studio, flat, high contrast and technical', () => {
    expect(LIGHT_PRESETS).toEqual(['studio', 'flat', 'contrast', 'technical']);
    expect(lightSpec('studio').env).toBeGreaterThan(1);   // reflections on by default
    expect(lightSpec('flat').env).toBe(0);
    expect(lightSpec('technical').white).toBe(true);
    expect(lightSpec('studio').white).toBe(false);
  });
  it('the default body is a light cool metal that reflects', () => {
    expect(DEFAULT_APPEARANCE.color).toBe('#c3ccd8');
    const p = materialParams('default');
    expect(p.metalness).toBeGreaterThan(0.3);
    expect(p.roughness).toBeLessThan(0.5);
    expect(materialParams('plastic').metalness).toBe(0);
    expect(materialParams('matte').roughness).toBeGreaterThan(materialParams('plastic').roughness);
    expect(MATERIAL_PRESETS).toContain('matte');
  });
  it('intensity scales the lights and is clamped; reflections off swaps the studio light for sky light', () => {
    expect(clampIntensity(9)).toBe(2);
    expect(clampIntensity(0)).toBe(0.3);
    expect(clampIntensity('x')).toBe(1);
    const on = effectiveLight('studio', 1, true), half = effectiveLight('studio', 0.5, true);
    expect(half.env).toBeCloseTo(on.env / 2);
    expect(half.sun).toBeCloseTo(on.sun / 2);
    const off = effectiveLight('studio', 1, false);
    expect(off.env).toBe(0);
    expect(off.hemi).toBeGreaterThan(on.hemi);
    expect(effectiveLight('flat', 1, false).hemi).toBe(lightSpec('flat').hemi);   // flat has no reflections to lose
  });
  it('edge colour is darker than the faces but not black, except technical and hidden lines', () => {
    expect(edgeColor('shadedEdges')).not.toBe(0);
    expect(edgeColor('shadedEdges')).not.toBe(edgeColor('shadedEdges', 'studio', true));
    expect(edgeColor('shadedEdges', 'technical')).toBe(0);
  });
  it('edge widths grow from thin to bold', () => {
    const px = EDGE_WIDTHS.map(edgePixels);
    expect([...px].sort((a, b) => a - b)).toEqual(px);
    expect(px[0]).toBeGreaterThan(0.5);
  });
  it('metal colours are lifted towards white, plastics are not', () => {
    const lifted = new THREE.Color(displayColor('#8d97a5', 0.5)), base = new THREE.Color('#8d97a5');
    expect(lifted.r).toBeGreaterThan(base.r);
    expect(displayColor('#8d97a5', 0)).toBe('#8d97a5');
  });
});

describe('PBR overrides', () => {
  it('a missing pbr keeps the preset; the keys override it', () => {
    const base = makeBodyMaterial(look({ appearance: { color: '#c3ccd8', material: 'plastic' } }));
    expect(base.roughness).toBeCloseTo(0.42);
    expect(base.clearcoat).toBe(0);
    const tuned = makeBodyMaterial(look({ appearance: { color: '#c3ccd8', material: 'plastic', pbr: { roughness: 0.1, metalness: 0.5, clearcoat: 0.8 } } }));
    expect(tuned.roughness).toBeCloseTo(0.1);
    expect(tuned.metalness).toBeCloseTo(0.5);
    expect(tuned.clearcoat).toBeCloseTo(0.8);
  });
  it('an opacity override makes the body see-through; hidden lines stay flat paper', () => {
    const m = makeBodyMaterial(look({ appearance: { color: '#ffffff', material: 'default', pbr: { opacity: 0.4 } } }));
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBeCloseTo(0.4);
    const h = makeBodyMaterial(look({ style: 'hiddenLines', appearance: { color: '#c3ccd8', material: 'default', pbr: { clearcoat: 1, roughness: 0.1 } } }));
    expect(h.clearcoat).toBe(0);
    expect(h.roughness).toBe(1);
  });
  it('sanitising keeps the valid keys, clamps them and drops the rest', () => {
    expect(sanitizeAppearance({ color: '#abcdef', material: 'matte', pbr: { roughness: 2, metalness: -1, clearcoat: 0.5, opacity: 0, bogus: 1, clearcoatRoughness: 'x' } }))
      .toEqual({ color: '#abcdef', material: 'matte', pbr: { roughness: 1, metalness: 0, clearcoat: 0.5, opacity: 0.05 } });
    expect(sanitizeAppearance({ color: '#abcdef', material: 'matte', pbr: {} })).toEqual({ color: '#abcdef', material: 'matte' });
    expect(sanitizeAppearance({ color: '#abcdef', material: 'matte', pbr: 'rough' })).toEqual({ color: '#abcdef', material: 'matte' });
  });
});

describe('procedural looks', () => {
  it('sanitising keeps a valid wood look and drops anything else', () => {
    expect(sanitizeAppearance({ color: '#abcdef', material: 'matte', look: { kind: 'wood', scale: 99, contrast: 0.3, tone: '#ABC123', axis: 'y', junk: 1 } }).look)
      .toEqual({ kind: 'wood', scale: 50, contrast: 0.3, tone: '#abc123', axis: 'y' });
    expect(sanitizeAppearance({ color: '#abcdef', material: 'matte', look: { kind: 'marble' } }).look).toBeUndefined();
    expect(sanitizeAppearance({ color: '#abcdef', material: 'matte', look: 'wood' }).look).toBeUndefined();
  });
  it('a look reaches the shader uniforms; none switches it off; hidden lines never show it', () => {
    const w = look({ appearance: { color: '#b98b52', material: 'matte', look: { kind: 'wood', scale: 6, contrast: 0.8, tone: '#402010', axis: 'z' } } });
    const m = makeBodyMaterial(w);
    const u = m.userData.lookU as { uLookKind: { value: number }; uLookScale: { value: number }; uLookContrast: { value: number }; uLookAxis: { value: { z: number } } };
    expect(u.uLookKind.value).toBe(1);
    expect(u.uLookScale.value).toBe(6);
    expect(u.uLookContrast.value).toBeCloseTo(0.8);
    expect(u.uLookAxis.value.z).toBe(1);
    applyBodyLook(m, look({ appearance: { color: '#b98b52', material: 'matte' } }));
    expect(u.uLookKind.value).toBe(0);
    applyBodyLook(m, look({ style: 'hiddenLines', appearance: w.appearance }));
    expect(u.uLookKind.value).toBe(0);
  });
  it('the grain axis falls back to the longest side the viewport recorded', () => {
    const m = makeBodyMaterial(look({ appearance: { color: '#b98b52', material: 'matte', look: { kind: 'wood' } } }));
    m.userData.longAxis = 'y';
    applyBodyLook(m, look({ appearance: { color: '#b98b52', material: 'matte', look: { kind: 'wood' } } }));
    expect((m.userData.lookU as { uLookAxis: { value: { y: number } } }).uLookAxis.value.y).toBe(1);
  });
});

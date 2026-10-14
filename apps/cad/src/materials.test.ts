import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_MATERIALS, CATEGORIES, CUSTOM_KEY, densityGcm3, findMaterial, groupMaterials, loadCustom, loadUseColour, massGrams, removeCustom, saveUseColour, upsertCustom } from './materials';
import { densityOf } from './inspect/mass';

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { try { localStorage.clear(); } catch { /* none */ } });

describe('material catalogue', () => {
  it('covers the asked-for categories and materials with a density and a colour', () => {
    const names = BUILTIN_MATERIALS.map((m) => m.name);
    for (const n of ['Mild steel', 'Stainless steel 304', 'Stainless steel 316', 'Tool steel', 'Aluminium 6061', 'Aluminium 7075', 'Copper', 'Brass', 'Bronze', 'ABS', 'PLA', 'PETG', 'Nylon', 'Polycarbonate', 'Acetal (POM)', 'PEEK', 'Oak', 'Pine', 'MDF', 'Rubber', 'Glass', 'Concrete', 'Cast iron']) expect(names).toContain(n);
    expect(names.some((n) => n.startsWith('Titanium'))).toBe(true);
    for (const m of BUILTIN_MATERIALS) { expect(m.density).toBeGreaterThan(0); expect(m.color).toMatch(/^#[0-9a-f]{6}$/); expect(CATEGORIES).toContain(m.category); }
    expect(new Set(BUILTIN_MATERIALS.map((m) => m.id)).size).toBe(BUILTIN_MATERIALS.length);
  });
  it('resolves names, ids and the old part-file names ("steel", "aluminium")', () => {
    expect(findMaterial('steel')?.id).toBe('steel-mild');
    expect(findMaterial(' ALUMINIUM ')?.id).toBe('al-6061');
    expect(findMaterial('Aluminium 7075')?.density).toBe(2810);
    expect(findMaterial('unobtainium')).toBeNull();
    expect(findMaterial('')).toBeNull();
  });
  it('gives Inspect its default density in g/cm3 from the same lookup', () => {
    expect(densityGcm3('steel')).toBeCloseTo(7.85);
    expect(densityOf('Aluminium 7075')).toBeCloseTo(2.81);
    expect(densityOf('zinc')).toBe(7.14);   // the older table still answers for names the catalogue lacks
    expect(densityOf('mystery')).toBeNull();
  });
  it('computes mass: 1000 mm3 of 7850 kg/m3 is 7.85 g', () => {
    expect(massGrams(1000, 7850)).toBeCloseTo(7.85);
  });
  it('filters by name or category and groups in catalogue order', () => {
    const all = groupMaterials([...BUILTIN_MATERIALS], '');
    expect(all.map((g) => g.category)).toEqual(CATEGORIES.filter((c) => BUILTIN_MATERIALS.some((m) => m.category === c)));
    expect(groupMaterials([...BUILTIN_MATERIALS], 'stainless').flatMap((g) => g.items.map((i) => i.id))).toEqual(['steel-304', 'steel-316']);
    expect(groupMaterials([...BUILTIN_MATERIALS], 'plastics pe').flatMap((g) => g.items.map((i) => i.name))).toEqual(['PETG', 'PEEK']);
    expect(groupMaterials([...BUILTIN_MATERIALS], 'zzz')).toEqual([]);
  });
});

describe('custom materials in the browser', () => {
  it('stores, finds (for Inspect too), replaces and removes', () => {
    const list = upsertCustom({ name: 'My alloy', density: 4200, color: '#112233' });
    expect(list).toHaveLength(1);
    expect(loadCustom()[0]).toMatchObject({ name: 'My alloy', density: 4200, color: '#112233', category: 'Custom', custom: true });
    expect(findMaterial('my alloy')?.density).toBe(4200);
    expect(densityOf('My alloy')).toBeCloseTo(4.2);
    upsertCustom({ name: 'My alloy', density: 4300, color: '#112233' });
    expect(loadCustom()).toHaveLength(1);
    expect(loadCustom()[0].density).toBe(4300);
    expect(removeCustom('custom:my alloy')).toEqual([]);
  });
  it('drops bad entries and ones that shadow a built-in name', () => {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify([{ name: '', density: 5 }, { name: 'x', density: -1 }, { name: 'Brass', density: 1 }, { name: 'ok', density: 2, color: 'red' }, 7, null]));
    const l = loadCustom();
    expect(l.map((x) => x.name)).toEqual(['ok']);
    expect(l[0].color).toBe('#b8c4d6');
    localStorage.setItem(CUSTOM_KEY, '{not json');
    expect(loadCustom()).toEqual([]);
  });
  it('keeps working when storage throws', () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    try {
      expect(loadCustom()).toEqual([]);
      expect(() => upsertCustom({ name: 'a', density: 1 })).not.toThrow();
      expect(loadUseColour()).toBe(true);
      expect(() => saveUseColour(false)).not.toThrow();
    } finally { Object.defineProperty(globalThis, 'localStorage', real); }
  });
  it('remembers the Use material colour toggle', () => {
    expect(loadUseColour()).toBe(true);
    saveUseColour(false);
    expect(loadUseColour()).toBe(false);
  });
});

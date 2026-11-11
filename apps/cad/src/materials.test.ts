import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_MATERIALS, CATEGORIES, CUSTOM_KEY, densityGcm3, findMaterial, groupMaterials, loadCustom, loadUseColour, massGrams, removeCustom, saveUseColour, subgroups, upsertCustom } from './materials';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

import { finishOf, appearanceOfMaterial } from './materials';
describe('material looks', () => {
  it('finish follows the category: metals shine, plastics are glossy, rubber and wood are matte', () => {
    expect(finishOf(findMaterial('steel'))).toBe('default');
    expect(finishOf(findMaterial('brass'))).toBe('brushed');
    expect(finishOf(findMaterial('abs'))).toBe('plastic');
    expect(finishOf(findMaterial('rubber'))).toBe('matte');
    expect(finishOf(findMaterial('oak'))).toBe('matte');
    expect(finishOf(findMaterial('glass'))).toBe('glass');
    expect(finishOf(null)).toBe('default');
  });
  it('a gasket material is orange and matte; steel is lifted to a light metal', () => {
    expect(findMaterial('Gasket material')).toBeTruthy();
    expect(appearanceOfMaterial('Gasket material')).toEqual({ color: '#e8802a', material: 'matte' });
    const steel = appearanceOfMaterial('steel')!;
    expect(steel.material).toBe('default');
    expect(parseInt(steel.color.slice(1, 3), 16)).toBeGreaterThan(0x8d);
    expect(appearanceOfMaterial('unobtainium')).toBeNull();
  });
});

describe('steel grades from the standards', () => {
  const grades = BUILTIN_MATERIALS.filter((m) => m.standard);
  const byId = (id: string) => BUILTIN_MATERIALS.find((m) => m.id === id)!;
  it('holds the fifteen verified grades with every property', () => {
    expect(grades.map((m) => m.id).sort()).toEqual([
      'as-nzs-3679.1-300', 'as-nzs-3679.1-350', 'astm-a36', 'astm-a500-grb-round', 'astm-a500-grb-shaped', 'astm-a500-grc-round', 'astm-a500-grc-shaped', 'astm-a53-grb', 'astm-a572-gr50', 'astm-a992',
      'en-10025-2-s235', 'en-10025-2-s275', 'en-10025-2-s355', 'en-10210-s355j2h', 'en-10219-s355j2h',
    ]);
    for (const m of grades) {
      expect(m.category, m.id).toBe('Steel');
      expect(m.density, m.id).toBe(7850);
      for (const k of ['youngs', 'shear', 'poisson', 'yield', 'ultimate'] as const) expect(m[k], `${m.id}.${k}`).toBeGreaterThan(0);
      expect(['AU', 'US', 'EU']).toContain(m.region);
      expect(m.standard && m.grade && m.note, m.id).toBeTruthy();
      expect(typeof m.verified, m.id).toBe('boolean');
      expect(m.ultimate!, m.id).toBeGreaterThan(m.yield!);
      expect(Math.abs(m.shear! - m.youngs! / (2 * (1 + m.poisson!))) / m.shear!, `${m.id} G = E / 2(1+nu)`).toBeLessThan(0.04);
    }
    expect(new Set(BUILTIN_MATERIALS.map((m) => m.name.toLowerCase())).size).toBe(BUILTIN_MATERIALS.length);
  });
  it('carries the verified values: strengths in MPa, moduli in GPa, expansion in 1e-6/K', () => {
    expect(byId('en-10025-2-s355')).toMatchObject({ name: 'EN 10025-2 S355', region: 'EU', standard: 'EN 10025-2', grade: 'S355', yield: 355, ultimate: 470, youngs: 210, shear: 81, poisson: 0.3, expansion: 12, verified: true });
    expect(byId('astm-a992')).toMatchObject({ name: 'ASTM A992', region: 'US', yield: 345, ultimate: 450, youngs: 200, shear: 77.2, verified: true });
    expect(byId('astm-a36')).toMatchObject({ yield: 250, ultimate: 400 });
    expect(byId('astm-a572-gr50')).toMatchObject({ yield: 345, ultimate: 450, verified: true });
    expect(byId('en-10210-s355j2h')).toMatchObject({ yield: 355, ultimate: 470 });
    expect(byId('as-nzs-3679.1-300')).toMatchObject({ region: 'AU', yield: 280, ultimate: 440, shear: 80, expansion: 11.7, verified: false });
    expect(byId('as-nzs-3679.1-350')).toMatchObject({ yield: 330, ultimate: 480 });
    expect(byId('astm-a36').expansion).toBeUndefined();   // US thermal expansion is not in the record
  });
  it('A500 Gr C round keeps 46 ksi (315 MPa) with the 50 ksi (345 MPa) of the 2021 edition as an alternate; unverified grades are flagged', () => {
    expect(byId('astm-a500-grc-round')).toMatchObject({ yield: 315, yieldAlt: 345, verified: false });
    expect(byId('astm-a500-grc-shaped')).toMatchObject({ yield: 345, ultimate: 425, verified: true });
    expect(byId('astm-a500-grb-round')).toMatchObject({ yield: 290, ultimate: 400 });
    expect(byId('astm-a500-grb-shaped')).toMatchObject({ yield: 315 });
    expect(grades.filter((m) => m.verified === false).map((m) => m.id).sort()).toEqual(['as-nzs-3679.1-300', 'as-nzs-3679.1-350', 'astm-a500-grc-round', 'astm-a53-grb']);
    expect(grades.filter((m) => m.yieldAlt !== undefined).map((m) => m.id)).toEqual(['astm-a500-grc-round']);
  });
  it('the general materials keep their entries, ids and numbers; a part naming "Mild steel" or "steel" still resolves', () => {
    expect(findMaterial('Mild steel')).toMatchObject({ id: 'steel-mild', density: 7850, youngs: 205, yield: 250 });
    expect(findMaterial('steel')?.id).toBe('steel-mild');
    expect(findMaterial('Stainless steel 316')?.id).toBe('steel-316');
    expect(findMaterial('Aluminium 6061')?.density).toBe(2700);
    expect(findMaterial('Mild steel')!.standard).toBeUndefined();
    expect(BUILTIN_MATERIALS.slice(0, 4).map((m) => m.id)).toEqual(['steel-mild', 'steel-304', 'steel-316', 'steel-tool']);   // catalogue order unchanged, grades after the general steels
    // grades resolve by name, id (any case) and Inspect uses their density
    expect(findMaterial('ASTM A992')?.id).toBe('astm-a992');
    expect(findMaterial('en-10025-2-S355')?.id).toBe('en-10025-2-s355');
    expect(densityGcm3('EN 10025-2 S355')).toBeCloseTo(7.85);
  });
  it('an old saved part (material by name) reads the same density and colour as before', () => {
    const old = JSON.parse('{"format":"ck-part","version":1,"name":"P","material":"Mild steel","features":[]}') as { material: string };
    expect(findMaterial(old.material)).toMatchObject({ density: 7850, color: '#8d97a5' });
    expect(densityOf(old.material)).toBeCloseTo(7.85);
    expect(densityOf('steel')).toBeCloseTo(7.85);
  });
  it('searches by standard, grade and region, and splits Steel into general / region and standard', () => {
    const ids = (q: string) => groupMaterials([...BUILTIN_MATERIALS], q).flatMap((g) => g.items.map((i) => i.id));
    expect(ids('s355')).toEqual(['en-10025-2-s355', 'en-10210-s355j2h', 'en-10219-s355j2h']);
    expect(ids('astm a500')).toHaveLength(4);
    expect(ids('australia')).toEqual([]);   // regions are searched by code (AU), not their long name
    expect(ids('au')).toEqual(expect.arrayContaining(['as-nzs-3679.1-300']));
    const steel = groupMaterials([...BUILTIN_MATERIALS], '')[0];
    expect(steel.category).toBe('Steel');
    expect(subgroups(steel.items).map((g) => g.key)).toEqual(['general', 'AU|AS/NZS 3679.1', 'US|ASTM A36', 'US|ASTM A992', 'US|ASTM A572', 'US|ASTM A53', 'US|ASTM A500', 'EU|EN 10025-2', 'EU|EN 10210', 'EU|EN 10219']);
    expect(subgroups(steel.items)[0].items.map((m) => m.id)).toEqual(['steel-mild', 'steel-304', 'steel-316', 'steel-tool']);
  });
  it('the committed catalogue file is what the build script makes from the verified record', () => {
    expect(() => execFileSync('node', [join(dirname(fileURLToPath(import.meta.url)), '../../../tools/build_steel_materials.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
    expect(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'materials.steel.json'), 'utf8')).toContain('"astm-a992"');
  });
});

describe('wood and panel materials', () => {
  const SOLID = ['Birch', 'Cedar', 'Cherry', 'Douglas fir', 'Eucalyptus', 'Maple', 'Oak', 'Pine', 'Teak', 'Walnut'];
  const PANELS = ['Chipboard P5', 'MDF', 'OSB/3', 'Plywood - birch'];
  it('has ten solid woods and four panels in the Wood category, each with density and stiffness', () => {
    for (const n of [...SOLID, ...PANELS]) {
      const d = findMaterial(n);
      expect(d, n).toBeTruthy();
      expect(d!.category, n).toBe('Wood');
      expect(d!.density, n).toBeGreaterThan(300);
      expect(d!.density, n).toBeLessThan(900);
      expect(d!.youngs, n).toBeGreaterThan(1);
    }
  });
  it('keeps the earlier wood densities, so the mass of existing parts does not change', () => {
    expect(findMaterial('Oak')!.density).toBe(750);
    expect(findMaterial('Pine')!.density).toBe(500);
    expect(findMaterial('MDF')!.density).toBe(750);
  });
  it('solid woods carry their source, the panels are marked unverified', () => {
    expect(findMaterial('Walnut')!.note).toContain('wood-database.com');
    expect(findMaterial('Walnut')!.verified).toBe(true);
    expect(findMaterial('OSB/3')!.verified).toBe(false);
    expect(findMaterial('OSB/3')!.note).toContain('EN');
  });
  it('every wood has its own colour and a matte finish', () => {
    const colours = [...SOLID, ...PANELS].map((n) => appearanceOfMaterial(n)!.color);
    expect(new Set(colours).size).toBe(colours.length);
    for (const n of [...SOLID, ...PANELS]) expect(appearanceOfMaterial(n)!.material, n).toBe('matte');
  });
});

describe('wood appearance carries PBR values', () => {
  it('woods are a little more satin than the matte preset', () => {
    expect(appearanceOfMaterial('Walnut')!.pbr).toEqual({ roughness: 0.6 });
    expect(appearanceOfMaterial('Walnut')!.look).toEqual({ kind: 'wood', tone: '#32231a', contrast: 0.55 });
    expect(appearanceOfMaterial('MDF')!.look).toBeUndefined();
    expect(appearanceOfMaterial('steel')!.look).toBeUndefined();
    expect(appearanceOfMaterial('steel')!.pbr).toBeUndefined();
  });
});

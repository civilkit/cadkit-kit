// The regional stock is read on demand (one chunk per region): nothing is loaded until asked for, a document that names a regional profile loads its region
// on open, concurrent requests share one fetch, and the library code does not import the data files statically (that would put them in the main bundle).
// This file is the only one that sees the library before any region is loaded (modules are per test file).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PROFILES, CATALOGUE_REGIONS, DEFAULT_FRAME, PROFILES, bom, cutList, ensureForDocument, ensureProfiles, frameFeature, frameProfileIds, loadAllRegions, loadRegion, onRegionLoaded,
  paramsFromFeature, partMaterialFor, profileById, profileGroups, regionLoaded, regionLoading, regionOfId, type FrameReport,
} from './frameLib';

describe('lazy regional stock', () => {
  it('starts with the generic stock only', () => {
    expect(PROFILES.length).toBeLessThan(60);
    expect(PROFILES.every((p) => !p.region)).toBe(true);
    expect(profileById('us-w14x30')).toBeUndefined();
    expect(CATALOGUE_REGIONS.map((r) => regionLoaded(r))).toEqual([false, false, false]);
    expect(regionLoaded('generic')).toBe(true);
    expect(profileGroups('').every((g) => g.region === 'generic')).toBe(true);
  });

  it('knows a profile id\'s region from its prefix, and the profiles a document names', () => {
    expect(['au-ub-310ub40.4', 'us-w14x30', 'eu-ipe300', 'shs-40x40x2', 'tslot-2020', 'my-au-thing', undefined].map((i) => regionOfId(i))).toEqual(['AU', 'US', 'EU', null, null, null, null]);
    expect(frameProfileIds([{ type: 'sketch', id: 'F1' }, { type: 'frame', id: 'F2', profile: { id: 'eu-ipe300' } }, { type: 'frame', id: 'F3', profile: { id: 'shs-40x40x2' } }, { type: 'frame', id: 'F4' }])).toEqual(['eu-ipe300', 'shs-40x40x2']);
  });

  it('a document that names a regional profile loads that region, and only that one', async () => {
    const seen: number[] = [];
    const off = onRegionLoaded(() => seen.push(PROFILES.length));
    const doc = [{ type: 'sketch', id: 'F1' }, { type: 'frame', id: 'F2', profile: { id: 'eu-ipe300', kind: 'ibeam' } }];
    const a = ensureForDocument(doc), b = ensureForDocument(doc), c = loadRegion('EU');
    expect(regionLoading('EU')).toBe(true);
    expect(regionLoaded('EU')).toBe(false);
    await Promise.all([a, b, c]);
    expect(regionLoaded('EU')).toBe(true);
    expect(regionLoading('EU')).toBe(false);
    expect(regionLoaded('US')).toBe(false);
    expect(regionLoaded('AU')).toBe(false);
    expect(seen).toHaveLength(1);   // one load, one notification, however many requests
    expect(profileById('eu-ipe300')?.mass_per_m_kg).toBe(42.2);
    expect(profileById('us-w14x30')).toBeUndefined();
    expect(BUILTIN_PROFILES.has('eu-ipe300')).toBe(true);
    const n = PROFILES.length;
    await loadRegion('EU');
    expect(PROFILES).toHaveLength(n);   // loading again adds nothing
    off();
  });

  it('a frame saved before the regions were lazy still reads back, with its region loaded on demand', async () => {
    // a frame feature as the first US release wrote it: the profile section is inside the document, the library is not
    const old = { type: 'frame', id: 'F2', sketch: 'F1', corner: 'mitre', profile: { kind: 'rectTube', w: 101.6, h: 101.6, t: 6.35, r: 12.7, id: 'us-hss-4x4x0.250', label: 'HSS 4x4x1/4 (101.6 x 101.6 x 6.4 mm)' } };
    expect(paramsFromFeature(old)).toBeNull();   // the profile is not in the library until its region is
    await ensureForDocument([old]);
    expect(paramsFromFeature(old)).toMatchObject({ profile: 'us-hss-4x4x0.250', corner: 'mitre', sketch: 'F1' });
    expect(frameFeature('F2', { ...DEFAULT_FRAME, sketch: 'F1', profile: 'us-hss-4x4x0.250', corner: 'mitre' })!.profile).toEqual(old.profile);   // same section the old file holds
  });

  it('a report names profiles; the bill of materials and cut list use them once their region is in', async () => {
    const rep: FrameReport[] = [{ id: 'F2', members: [{ segment: 'e1', body: 'F2 M1', profile: 'au-ub-310ub40.4', label: '', length: 1000, angles: [0, 0], ends: ['free', 'free'], volume: 1 }] }];
    expect(cutList(rep)[0].massKg).toBeCloseTo(1 * 1e-6 * 0, 6);   // unknown profile: volume x density only
    await ensureProfiles(rep.flatMap((f) => f.members.map((m) => m.profile)));
    expect(regionLoaded('AU')).toBe(true);
    expect(cutList(rep)[0].massKg).toBeCloseTo(40.4, 6);
    expect(bom(rep)[0]).toMatchObject({ standard: 'AS/NZS 3679.1', grade: '300PLUS', material: 'AS/NZS 3679.1 300 (default, confirm)' });
  });

  it('loadAllRegions reads in the rest', async () => {
    await loadAllRegions();
    expect(CATALOGUE_REGIONS.every((r) => regionLoaded(r))).toBe(true);
    expect(PROFILES.filter((p) => p.region).length).toBe(381 + 1087 + 1086);
  });

  it('gives a new part the profile\'s grade only when the part has no material of its own', () => {
    expect(partMaterialFor('us-w14x30', undefined)).toBe('ASTM A992');
    expect(partMaterialFor('us-w14x30', 'steel')).toBe('ASTM A992');
    expect(partMaterialFor('us-w14x30', 'Mild steel')).toBe('ASTM A992');
    expect(partMaterialFor('us-w14x30', 'ASTM A992')).toBeNull();
    expect(partMaterialFor('us-w14x30', 'Aluminium 6061')).toBeNull();   // a deliberate choice stays
    expect(partMaterialFor('us-w14x30', 'My own alloy')).toBeNull();
    expect(partMaterialFor('shs-40x40x2', 'steel')).toBeNull();   // generic stock has no catalogue grade
    expect(partMaterialFor('au-shs-50x50x3-c350l0', 'steel')).toBeNull();   // AS/NZS 1163 grades have no verified record
    expect(partMaterialFor('eu-ipe300', 'steel')).toBe('EN 10025-2 S355');
  });
});

describe('the main bundle', () => {
  it('imports the regional data only dynamically', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'frameLib.ts'), 'utf8');
    expect(src).not.toMatch(/^import .* from '\.\/profiles\.(au|us|eu)\.json'/m);
    expect(src.match(/import\('\.\/profiles\.(au|us|eu)\.json'\)/g)).toHaveLength(3);
    for (const f of ['FramePanel.tsx', 'frameDrawing.ts', 'frameUserLib.ts']) expect(readFileSync(join(dirname(fileURLToPath(import.meta.url)), f), 'utf8'), f).not.toMatch(/profiles\.(au|us|eu)\.json/);
  });
});

// The regional stock libraries (profiles.au.json, profiles.us.json): every entry is well formed, its mass agrees with its outline, the
// sources are named, the files are what tools/build_frame_profiles.mjs builds from the committed data, and the picker groups and searches them.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FITTINGS, MATERIALS, PROFILES, bom, cutList, defaultHardware, frameFeature, loadAllRegions, profileById, profileGroups, profileMaterial, toCsv, DEFAULT_FRAME, type FrameReport, type ProfileDef } from './frameLib';
import { findMaterial } from '../materials';
import { MASS_EXCEPTIONS, massTolerance } from './massTolerance';

const here = dirname(fileURLToPath(import.meta.url));
const data = (f: string) => JSON.parse(readFileSync(join(here, 'data', f), 'utf8'));
let catalogue: ProfileDef[] = [];
beforeAll(async () => { await loadAllRegions(); catalogue = PROFILES.filter((p) => p.region); });
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Area of a section's outline (mm2), worked out from its dimensions alone; null for kinds with no closed formula here (T-slot). */
export function sectionArea(s: ProfileDef['section']): number | null {
  const n = (k: string): number => Number(s[k] ?? 0);
  const k = 1 - Math.PI / 4;
  switch (s.kind) {
    case 'rect': return n('w') * n('h');
    case 'roundBar': return Math.PI / 4 * n('d') ** 2;
    case 'roundTube': return Math.PI / 4 * (n('d') ** 2 - (n('d') - 2 * n('t')) ** 2);
    case 'rectTube': {
      const { w, h, t, r } = { w: n('w'), h: n('h'), t: n('t'), r: n('r') }, ri = Math.max(r - t, 0);
      return (w * h - 4 * k * r * r) - ((w - 2 * t) * (h - 2 * t) - 4 * k * ri * ri);
    }
    case 'angle': return n('t') * (n('w') + n('h') - n('t'));
    case 'channel': { const tf = n('tf') || n('t'), tw = n('tw') || n('t'); return 2 * n('w') * tf + (n('h') - 2 * tf) * tw + 2 * k * n('r') ** 2; }
    case 'ibeam': return 2 * n('w') * n('tf') + (n('h') - 2 * n('tf')) * n('tw') + 4 * k * n('r') ** 2;
    default: return null;
  }
}


type Sec = { id: string; region: string; form: string; designation: string; designation_imperial?: string; mass_per_m_kg: number; geometry_mm: Record<string, number>; gross_props: Record<string, number>; material_ref: string; material_options?: string[]; manufacturing?: string; provenance: { verified: boolean } };
const sections = (f: string): Sec[] => data(f).sections;

describe('regional stock libraries', () => {
  it('lists the Australian, US and European stock by family', () => {
    const count = (region: string) => Object.fromEntries([...new Set(catalogue.filter((p) => p.region === region).map((p) => p.family))].map((f) => [f, catalogue.filter((p) => p.region === region && p.family === f).length]));
    expect(count('AU')).toEqual({ shs: 90, rhs: 80, chs: 51, ub: 28, uc: 13, ubp: 4, pfc: 10, angle: 65, flat: 34, roundBar: 6 });
    expect(count('US')).toEqual({ w: 283, s: 28, c: 32, mc: 40, angle: 137, shs: 107, rhs: 281, chs: 128, pipe: 51 });
    expect(count('EU')).toEqual({ ipe: 18, ipea: 18, ipeo: 13, ipeaa: 14, hea: 24, heb: 24, hem: 24, heaa: 24, ipn: 21, upn: 18, shs: 242, rhs: 383, chs: 263 });
    expect(catalogue.filter((p) => p.region === 'EU' && p.family === 'shs').map((p) => p.standard)).toContain('EN 10219');
    expect(catalogue).toHaveLength(381 + 1087 + 1086);
  });

  it('every entry parses: ids are unique, sections are positive, materials, fittings and sources exist', () => {
    expect(new Set(PROFILES.map((p) => p.id)).size).toBe(PROFILES.length);
    const kinds = new Set(['rect', 'rectTube', 'roundTube', 'roundBar', 'angle', 'channel', 'ibeam', 'tslot']);
    const places: Record<string, string[]> = { joint: ['lbracket', 'gusset'], corner3: ['corner3'], cap: ['cap'], foot: ['foot'] };
    for (const p of catalogue) {
      expect(p.id, p.id).toMatch(/^(au|us|eu)-[a-z0-9][a-z0-9.x-]*$/);
      expect(p.id.startsWith(p.region!.toLowerCase() + '-'), p.id).toBe(true);
      expect(p.label && p.family && p.designation, p.id).toBeTruthy();
      expect(kinds.has(p.section.kind), p.id).toBe(true);
      for (const [k, v] of Object.entries(p.section)) if (k !== 'kind') { expect(num(v), `${p.id}.${k}`).toBe(true); if (k !== 'r') expect(v as number, `${p.id}.${k}`).toBeGreaterThan(0); else expect(v as number).toBeGreaterThanOrEqual(0); }
      expect(MATERIALS[p.material], p.id).toBeTruthy();
      expect(p.fittings.every((u) => FITTINGS[u.id]), p.id).toBe(true);
      expect(p.standard && p.grade, p.id).toBeTruthy();
      expect(p.mass_per_m_kg, p.id).toBeGreaterThan(0);
      expect(p.source?.document && p.source.table, p.id).toBeTruthy();
      expect(typeof p.source!.verified, p.id).toBe('boolean');
      for (const [place, ids] of Object.entries(p.hardware ?? {})) for (const id of ids ?? []) {
        expect(FITTINGS[id], `${p.id} ${place} ${id}`).toBeTruthy();
        expect(places[place]).toContain(String(FITTINGS[id].part?.kind));
      }
    }
  });

  it('US stock has one set: the first release\'s HSS ids are kept, every record is present once, with imperial and metric designations', () => {
    const us = catalogue.filter((p) => p.region === 'US');
    const src = sections('us-sections.json');
    expect(us).toHaveLength(src.length);
    expect(new Set(us.map((p) => p.designation)).size).toBe(us.length);   // no row twice (HSS and pipe included)
    expect(src.map((r) => r.designation_imperial).sort()).toEqual(us.map((p) => p.designation!).sort());
    for (const id of ['us-hss-2x2x0.125', 'us-hss-2x2x0.250', 'us-hss-4x4x0.250', 'us-hss-6x4x0.250', 'us-hss-2.375x0.250', 'us-hss-8.625x0.625']) expect(profileById(id), id).toBeTruthy();
    expect(profileById('us-w14x30')).toMatchObject({ designation: 'W14X30', designation_metric: 'W360X44', family: 'w', standard: 'ASTM A992', grade: '50', material_ref: 'astm-a992', material_default: true });
    for (const p of us) expect(p.designation_metric, p.id).toBeTruthy();
  });

  it('mass per metre is within 3 % of the outline area x 7850 kg/m3 (documented exceptions only)', () => {
    let worst = 0;
    for (const p of catalogue) {
      const a = sectionArea(p.section)!;
      const dev = Math.abs((a * 7850e-6) / p.mass_per_m_kg! - 1);
      worst = Math.max(worst, dev);
      expect(dev, `${p.id}: outline ${(a * 7850e-6).toFixed(3)} kg/m vs ${p.mass_per_m_kg}`).toBeLessThan(massTolerance(p.id));
    }
    expect(worst).toBeLessThan(0.05);
    // the exceptions are real (so the list does not hide nothing) and nothing else is near the bound
    for (const id of Object.keys(MASS_EXCEPTIONS)) { const p = profileById(id)!; expect(Math.abs(sectionArea(p.section)! * 7850e-6 / p.mass_per_m_kg! - 1), id).toBeGreaterThan(0.03); }
  });

  it('the published rows agree with themselves: mass x 1e6 / 7850 is the gross area of the table (hollow sections and pipe: nominal wall, see the guide)', () => {
    const atm = data('au-hollow-atm.json').rows as Array<{ kind: string; mass: number; area: number }>;
    expect(atm.length).toBeGreaterThan(280);
    for (const r of atm) expect(Math.abs(r.mass / (r.area * 7850e-6) - 1), JSON.stringify(r)).toBeLessThan(0.015);
    const au = data('au-sections.json').sections as Array<{ id: string; family: string; mass: number; pub: { A?: number; A_mass?: number }; verified?: boolean }>;
    for (const s of au.filter((x) => !['C', 'Z'].includes(x.family))) {   // cold-formed C and Z are not frame stock here
      const a = s.pub.A ?? s.pub.A_mass;
      if (a) expect(Math.abs(s.mass / (a * 7850e-6) - 1), s.id).toBeLessThan(0.03);
      if (['UB', 'UC', 'PFC', 'EA', 'UA', 'FL', 'ROD'].includes(s.family)) expect(s.verified, s.id).toBe(true);
    }
    // US: open shapes within 3 % of the gross area (C3X3.5 is the database's own 5.6 % outlier); HSS and pipe weigh the nominal wall but the tabulated area is on the design wall: 5 to 11 % under
    for (const r of sections('us-sections.json')) {
      const ratio = r.mass_per_m_kg / (r.gross_props.Ag_mm2 * 7850e-6);
      if (['RHS', 'SHS', 'CHS', 'PIPE'].includes(r.form)) { expect(ratio, r.id).toBeGreaterThan(1.0); expect(ratio, r.id).toBeLessThan(1.12); }
      else if (r.id === 'US-C3X3.5') expect(Math.abs(ratio - 1), r.id).toBeGreaterThan(0.03);
      else expect(Math.abs(ratio - 1), r.id).toBeLessThan(0.03);
    }
    // EU: every record within 1.5 % (open) or 1 % (hollow)
    for (const r of sections('eu-sections.json')) expect(Math.abs(r.mass_per_m_kg / (r.gross_props.Ag_mm2 * 7850e-6) - 1), r.id).toBeLessThan(['RHS', 'SHS', 'CHS'].includes(r.form) ? 0.01 : 0.015);
  });

  it('the source records are sound: unique ids, positive dimensions, a material that exists', () => {
    for (const f of ['us-sections.json', 'eu-sections.json']) {
      const rows = sections(f);
      expect(new Set(rows.map((r) => r.id)).size, f).toBe(rows.length);
      for (const r of rows) {
        expect(r.mass_per_m_kg, r.id).toBeGreaterThan(0);
        for (const [k, v] of Object.entries(r.geometry_mm)) expect(v, `${r.id}.${k}`).toBeGreaterThan(0);
        expect(findMaterial(r.material_ref), `${r.id} -> ${r.material_ref}`).toBeTruthy();
        for (const o of r.material_options ?? []) expect(findMaterial(o), `${r.id} option ${o}`).toBeTruthy();
        expect(r.provenance.verified, r.id).toBe(true);
      }
    }
  });

  it('the committed files are what the build scripts make from the committed data', () => {
    const root = join(here, '..', '..', '..', '..');
    expect(() => execFileSync('node', [join(root, 'tools/build_frame_profiles.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
    expect(() => execFileSync('node', [join(root, 'tools/build_steel_materials.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('keeps the standard, grade and region of each family', () => {
    expect(profileById('au-shs-50x50x3-c350l0')).toMatchObject({ region: 'AU', standard: 'AS/NZS 1163', grade: 'C350L0', mass_per_m_kg: 4.25, section: { kind: 'rectTube', w: 50, h: 50, t: 3, r: 6 } });
    expect(profileById('au-ub-310ub40.4')).toMatchObject({ standard: 'AS/NZS 3679.1', grade: '300PLUS', mass_per_m_kg: 40.4, section: { kind: 'ibeam', w: 165, h: 304, tf: 10.2, tw: 6.1, r: 11.4 } });
    expect(profileById('us-hss-2x2x0.250')).toMatchObject({ region: 'US', standard: 'ASTM A500', grade: 'Gr C', designation: 'HSS2X2X1/4', section: { kind: 'rectTube', w: 50.8, h: 50.8, t: 6.35, r: 12.7 } });
    expect(profileById('us-hss-2x2x0.250')!.mass_per_m_kg).toBeCloseTo(5.41 * 1.48816, 3);
    expect(profileById('us-hss-2.375x0.250')).toMatchObject({ family: 'chs', section: { kind: 'roundTube', d: 60.325, t: 6.35 } });
    expect(profileById('us-pipe26std')).toMatchObject({ family: 'pipe', standard: 'ASTM A53', grade: 'Gr B', designation: 'Pipe26STD', mass_per_m_kg: 153.28 });
    expect(profileById('us-l12x12x1-3-8')).toMatchObject({ family: 'angle', section: { kind: 'angle', w: 304.8, h: 304.8, t: 35.05 }, mass_per_m_kg: 156.26 });
    expect(profileById('us-c15x50')).toMatchObject({ section: { kind: 'channel', w: 94.49, h: 381, tf: 16.51, tw: 18.19 } });
    expect(profileById('eu-ipe300')).toMatchObject({ region: 'EU', family: 'ipe', standard: 'EN 10025-2', grade: 'S355', material_ref: 'en-10025-2-s355', section: { kind: 'ibeam' } });
    expect(profileById('eu-upn400')).toMatchObject({ family: 'upn', section: { kind: 'channel', h: 400 } });
    expect(profileById('eu-en10210-shs40x40x3')).toMatchObject({ standard: 'EN 10210', grade: 'S355J2H', manufacturing: 'hot-finished', material_ref: 'en-10210-s355j2h', check_availability: true, section: { kind: 'rectTube', w: 40, h: 40, t: 3, r: 4.5 } });
    expect(profileById('eu-en10219-chs33.7x3')).toMatchObject({ standard: 'EN 10219', manufacturing: 'cold-formed', material_ref: 'en-10219-s355j2h', section: { kind: 'roundTube', d: 33.7, t: 3 } });
  });

  it('default materials follow the decided families and are flagged as defaults to confirm', () => {
    const want: Record<string, string> = {
      'us:w': 'astm-a992', 'us:s': 'astm-a36', 'us:c': 'astm-a36', 'us:mc': 'astm-a36', 'us:angle': 'astm-a36', 'us:shs': 'astm-a500-grc-shaped', 'us:rhs': 'astm-a500-grc-shaped', 'us:chs': 'astm-a500-grc-round', 'us:pipe': 'astm-a53-grb',
    };
    for (const p of catalogue.filter((x) => x.region === 'US')) expect(p.material_ref, p.id).toBe(want['us:' + p.family]);
    for (const p of catalogue.filter((x) => x.region === 'EU')) expect(p.material_ref, p.id).toBe(p.manufacturing === 'hot-finished' ? 'en-10210-s355j2h' : p.manufacturing === 'cold-formed' ? 'en-10219-s355j2h' : 'en-10025-2-s355');
    for (const p of catalogue.filter((x) => x.region !== 'AU' || x.standard === 'AS/NZS 3679.1')) { expect(p.material_default, p.id).toBe(true); expect(profileMaterial(p), p.id).toBeTruthy(); }
    // AU: the catalogue grade 300PLUS is the material record's grade 300 (a conservative lower bound of yield); the AS/NZS 1163 hollow grades have no verified record
    for (const p of catalogue.filter((x) => x.region === 'AU')) expect(p.material_ref, p.id).toBe(p.standard === 'AS/NZS 3679.1' ? 'as-nzs-3679.1-300' : undefined);
    expect(profileMaterial(profileById('us-hss-2.375x0.250'))).toMatchObject({ yield: 315, yieldAlt: 345, verified: false });
  });

  it('open sections, angles and bars offer no hardware; hollow sections of frame size get gussets first, larger ones none', () => {
    let hollowWith = 0, hollowWithout = 0;
    for (const p of catalogue) {
      const closed = p.section.kind === 'rectTube' || p.section.kind === 'roundTube';
      if (!closed) { expect(p.hardware, p.id).toBeUndefined(); expect(defaultHardware(p.id), p.id).toEqual({ joint: null, corner3: null, cap: null, foot: null }); }
      else if (p.hardware) { hollowWith++; expect(p.hardware.joint![0], p.id).toMatch(/^gusset-/); expect(p.hardware.cap, p.id).toHaveLength(1); }
      else hollowWithout++;
    }
    expect(hollowWith).toBeGreaterThan(500);
    expect(hollowWithout).toBeGreaterThan(300);
    expect(profileById('eu-en10210-shs40x40x3')!.hardware).toBeTruthy();
    expect(profileById('us-hss-24x12x0.750')!.hardware).toBeUndefined();   // 609.6 x 304.8: structural size, no tube plugs and gussets offered
    const f = frameFeature('F2', { ...DEFAULT_FRAME, sketch: 'F1', profile: 'au-ub-310ub40.4', corner: 'butt', hardware: defaultHardware('au-ub-310ub40.4') })!;
    expect(f.hardware).toBeUndefined();
    expect(f.profile).toMatchObject({ kind: 'ibeam', id: 'au-ub-310ub40.4' });
  });
});

describe('picker groups and search', () => {
  it('groups by region, standard and family, generic stock first', () => {
    const g = profileGroups('');
    expect(g[0].region).toBe('generic');
    const order = ['generic', 'AU', 'US', 'EU'];
    expect(g.map((x) => x.region)).toEqual([...g.map((x) => x.region)].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(g.find((x) => x.region === 'AU' && x.standard === 'AS/NZS 1163' && x.family === 'shs')!.profiles).toHaveLength(90);
    expect(g.find((x) => x.region === 'US' && x.family === 'rhs')!.standard).toBe('ASTM A500');
    expect(g.find((x) => x.region === 'US' && x.family === 'w')!.profiles).toHaveLength(283);
    expect(g.find((x) => x.region === 'EU' && x.family === 'shs' && x.standard === 'EN 10210')!.profiles).toHaveLength(146);
    expect(g.find((x) => x.region === 'EU' && x.family === 'shs' && x.standard === 'EN 10219')!.profiles).toHaveLength(96);
    expect(g.reduce((n, x) => n + x.profiles.length, 0)).toBe(PROFILES.length);
  });
  it('every word of the search must match; the profile in use stays listed', () => {
    const ids = (q: string, keep?: string, only?: Parameters<typeof profileGroups>[2]) => profileGroups(q, keep, only).flatMap((x) => x.profiles.map((p) => p.id));
    expect(ids('shs 50x50x3 c350')).toEqual(['au-shs-50x50x3-c350l0']);
    expect(ids('a500 hss 4x4x1/4')).toEqual(expect.arrayContaining(['us-hss-4x4x0.250']));
    expect(ids('a500 hss 4x4x1/4 4x4x')).toEqual(expect.arrayContaining(['us-hss-4x4x0.250']));
    expect(ids('310ub')).toEqual(expect.arrayContaining(['au-ub-310ub32.0', 'au-ub-310ub40.4']));
    expect(ids('t-slot')).toEqual(['tslot-2020', 'tslot-3030', 'tslot-4040']);
    expect(ids('w14x30')).toEqual(['us-w14x30']);
    expect(ids('W360X44')).toEqual(expect.arrayContaining(['us-w14x30']));   // the metric designation finds it too
    expect(ids('ipe 300')).toContain('eu-ipe300');   // (and the 12 in pipe whose DN is 300: a plain text match)
    expect(ids('hem 300 s355')).toEqual(['eu-hem300']);
    expect(ids('shs 40x40x3 cold-formed')).toEqual(['eu-en10219-shs40x40x3']);
    expect(ids('nothing like this')).toEqual([]);
    expect(ids('nothing like this', 'rb-12')).toEqual(['rb-12']);
    expect(ids('hem 300', undefined, 'US')).toEqual([]);   // the region filter
    expect(ids('ipe 300', undefined, 'EU')).toEqual(['eu-ipe300', 'eu-ipea300', 'eu-ipeo300']);
    expect(ids('', 'tslot-2020', 'generic').every((id) => !/^(au|us|eu)-/.test(id))).toBe(true);
  });
});

describe('cut list and bill of materials with catalogue stock', () => {
  const m = (segment: string, length: number, profile: string, volume: number) => ({ segment, body: `F2 M${segment.slice(1)}`, profile, label: '', length, angles: [0, 0] as [number, number], ends: ['free', 'free'] as [string, string], volume });
  const rep: FrameReport[] = [{ id: 'F2', members: [m('e1', 1000, 'au-shs-50x50x3-c350l0', 541e3), m('e2', 1000, 'au-shs-50x50x3-c350l0', 541e3), m('e3', 2000, 'us-hss-2x2x0.250', 1e5), m('e4', 500, 'shs-40x40x2', 304 * 500), m('e5', 3000, 'eu-ipe300', 1), m('e6', 1000, 'us-pipe26std', 1)] }];
  it('uses the published mass per metre for catalogue stock and volume x density for the rest', () => {
    const cl = cutList(rep);
    expect(cl.find((l) => l.profile === 'au-shs-50x50x3-c350l0')!.massKg).toBeCloseTo(2 * 4.25, 6);
    expect(cl.find((l) => l.profile === 'us-hss-2x2x0.250')!.massKg).toBeCloseTo(2 * 5.41 * 1.48816, 3);
    expect(cl.find((l) => l.profile === 'eu-ipe300')!.massKg).toBeCloseTo(3 * profileById('eu-ipe300')!.mass_per_m_kg!, 6);
    expect(cl.find((l) => l.profile === 'us-pipe26std')!.massKg).toBeCloseTo(153.28, 6);   // catalogue mass on the nominal wall, not volume x density
    expect(cl.find((l) => l.profile === 'shs-40x40x2')!.massKg).toBeCloseTo(304 * 500 * 7.85e-6, 9);
  });
  it('gives the stock lines their standard, grade, material and total mass, and the CSV the columns', () => {
    const lines = bom(rep);
    expect(lines.find((b) => b.id === 'au-shs-50x50x3-c350l0')).toMatchObject({ qty: 2, standard: 'AS/NZS 1163', grade: 'C350L0', massKg: 8.5 });
    expect(lines.find((b) => b.id === 'us-hss-2x2x0.250')).toMatchObject({ standard: 'ASTM A500', grade: 'Gr C', material: 'ASTM A500 Gr C shaped (default, confirm)' });
    expect(lines.find((b) => b.id === 'eu-ipe300')).toMatchObject({ standard: 'EN 10025-2', grade: 'S355', material: 'EN 10025-2 S355 (default, confirm)' });
    expect(lines.find((b) => b.id === 'eu-ipe300')!.detail).toContain('EN 10025-2 S355 (default, confirm)');
    expect(lines.find((b) => b.id === 'us-pipe26std')).toMatchObject({ material: 'ASTM A53 Gr B (default, confirm)' });
    expect(lines.find((b) => b.id === 'shs-40x40x2')!.standard).toBeUndefined();
    expect(lines.find((b) => b.id === 'shs-40x40x2')).toMatchObject({ material: 'Mild steel' });
    expect(lines.find((b) => b.id === 'shs-40x40x2')!.massKg).toBeCloseTo(1.193, 3);
    const csv = toCsv(rep).split('\n');
    const head = csv.findIndex((l) => l.startsWith('Item,Part'));
    expect(csv[head]).toBe('Item,Part,Qty,Unit,Type,Standard,Grade,Material,Mass (kg),Detail');
    expect(csv[head + 1]).toContain(',AS/NZS 1163,C350L0,');
    expect(csv.find((l) => l.includes('IPE 300') && l.includes(',stock,'))).toContain(',EN 10025-2,S355,"EN 10025-2 S355 (default, confirm)",');   // the comma in the flag quotes the cell
  });
});

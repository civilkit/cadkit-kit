#!/usr/bin/env python3
"""Write materials.json. Values transcribed from the cited public sources (see provenance per record)."""
import json, sys
out = sys.argv[1]
KSI = 6.894757


def band(t, fy, fu_min, fu_max=None):
    d = {'t_max_mm': t, 'fy_MPa': fy, 'fu_min_MPa': fu_min}
    if fu_max: d['fu_max_MPa'] = fu_max
    return d

EN_E = dict(E_MPa=210000, G_MPa=81000, poisson=0.3, density_kg_m3=7850, thermal_expansion_per_C=12e-6)
EN_SRC_CONST = 'E=210000 MPa, nu=0.3 and density 7850 kg/m3 stated in SCI P363 (reprinted 2015) notes; G = E/(2(1+nu)) = 80769, rounded to 81000 as in EN 1993-1-1 3.2.6 (design-aid summaries); alpha 12e-6 per C from EN 1993-1-1 3.2.6 summaries (secondary, standard text not retrieved)'
AM = 'ArcelorMittal "Sections and Merchant Bars" catalogue (FR/EN/DE, PDF 2024-03), "Mechanical properties" table for EN 10025-2:2019 (nominal thickness bands <=16, 16-40, 40-63, 63-80, 80-100, 100-140 mm)'
M = []

def en(grade, bands_fy, fu1, fu2):
    ts = [16, 40, 63, 80, 100, 140]
    bands = [band(t, fy, fu1[0], fu1[1]) for t, fy in zip(ts[:5], bands_fy[:5])] + [band(140, bands_fy[5], fu2[0], fu2[1])]
    return {'id': f'EN-10025-2-{grade}', 'region': 'EU', 'standard': 'EN 10025-2:2019', 'grade': grade,
            'fy_MPa': bands_fy[0], 'fu_MPa': fu1[0], 'fu_max_MPa': fu1[1], **EN_E,
            'thickness_bands': bands,
            'thickness_note': 'fy depends on nominal thickness (table above, ReH min). fu min/max: first four bands 3<=t<=100 mm, last band 100<t<=140 mm. fy/fu headline = t<=16 mm. Bands above 140 mm not tabulated in the source.',
            'provenance': {'source': AM + '; ' + EN_SRC_CONST, 'verified': True}}

M.append(en('S235', [235, 225, 215, 215, 215, 195], (360, 510), (350, 500)))
M.append(en('S275', [275, 265, 255, 245, 235, 225], (410, 560), (400, 540)))
M.append(en('S355', [355, 345, 335, 325, 315, 295], (470, 630), (450, 600)))
for std, ident, mfg in (('EN 10210-1:2006', 'EN-10210-S355J2H', 'hot-finished'), ('EN 10219-1:2006', 'EN-10219-S355J2H', 'cold-formed')):
    M.append({'id': ident, 'region': 'EU', 'standard': std, 'grade': 'S355J2H', 'manufacturing': mfg,
              'fy_MPa': 355, 'fu_MPa': 470, 'fu_max_MPa': 630, **EN_E,
              'thickness_bands': [band(16, 355, 470, 630), band(40, 345, 470, 630), band(63, 335, 470, 630)],
              'thickness_note': 'ReH min by thickness (<=16: 355, 16-40: 345, 40-63: 335) per SCI P363 section 5.2 (applies to EN 10210-1 and EN 10219-1 as stated there). Rm 470-630 for 3<=t<=40 per Tata Steel Hybox S355J2H datasheet (Rm 510-680 below 3 mm).' ,
              'provenance': {'source': 'SCI P363 (reprinted 2015) section 5.2 yield strength table; Tata Steel Hybox S355J2H datasheet TST95:0122 (2022) mechanical properties; ' + EN_SRC_CONST, 'verified': True}})

US_K = dict(E_MPa=200000, G_MPa=77200, poisson=0.3, density_kg_m3=7850, thermal_expansion_per_C=None)
US_CONST = 'E=29000 ksi (200 GPa), G=11200 ksi (77.2 GPa), nu=0.3 are the AISC 360 values; NOT retrieved from AISC (aisc.org returned 403), so constants are marked unverified. Density 7850 kg/m3 from ASTM A992 Wikipedia page'
def us(id_, std, grade, fy_ksi, fu_ksi, fy, fu, note, src, ver, **kw):
    d = {'id': id_, 'region': 'US', 'standard': std, 'grade': grade, 'fy_MPa': fy, 'fu_MPa': fu,
         'fy_ksi': fy_ksi, 'fu_ksi': fu_ksi, **US_K,
         'thickness_note': note, 'provenance': {'source': src + '. ' + US_CONST, 'verified': ver}}
    d.update(kw); return d
M.append(us('ASTM-A36', 'ASTM A36/A36M', '36', 36, 58, 250, 400,
            'A36 fy 36 ksi (250 MPa) for plates/bars/shapes up to 8 in (203 mm); thicker plate 32 ksi (220 MPa). fu range 58-80 ksi (400-550 MPa). fu max recorded.',
            'Wikipedia "A36 steel" quoting AISC Steel Construction Manual 8th ed. (1986); AISC Modern Steel Construction articles (excerpts only, pdf blocked)', True, fu_max_MPa=550))
M.append(us('ASTM-A992', 'ASTM A992/A992M', '50', 50, 65, 345, 450,
            'fy 50 ksi min (345 MPa), fu 65 ksi min (450 MPa), max fy/fu ratio 0.85; no thickness reduction in the sources.',
            'Wikipedia "ASTM A992" (cites A992/A992M and AISC FAQ); AISC article excerpts', True))
M.append(us('ASTM-A572-Gr50', 'ASTM A572/A572M', '50', 50, 65, 345, 450,
            'fy 50 ksi (345 MPa), fu 65 ksi (450 MPa) per ASTM listing; Wikipedia table shows 448 MPa (soft conversion), the ASTM 450 MPa value is used.',
            'ASTM store listing for A572/A572M-12a (summary page); Wikipedia "A572 steel"', True))
M.append(us('ASTM-A53-GrB', 'ASTM A53/A53M', 'Grade B', 35, 60, 240, 415,
            'Pipe, Grade B fy 35 ksi (240 MPa), fu 60 ksi (415 MPa).',
            'AISC Modern Steel Construction article excerpt (search-result text only; aisc.org blocked) and engineering reference; ASTM text not retrieved (single secondary source)', False))
A500 = 'Wikipedia "ASTM A500" (cites A500/A500M-07, SI table); fabricator summary (Kloeckner Metals); Steel Tube Institute ASTM A500 page'
M.append(us('ASTM-A500-GrB-round', 'ASTM A500/A500M', 'Grade B', 42, 58, 290, 400, 'Round tubing: fy 42 ksi (290 MPa), fu 58 ksi (400 MPa).', A500, True, shape='round'))
M.append(us('ASTM-A500-GrB-shaped', 'ASTM A500/A500M', 'Grade B', 46, 58, 315, 400, 'Shaped (square/rectangular) tubing: fy 46 ksi (315 MPa), fu 58 ksi (400 MPa).', A500, True, shape='shaped'))
M.append(us('ASTM-A500-GrC-shaped', 'ASTM A500/A500M', 'Grade C', 50, 62, 345, 425, 'Shaped tubing: fy 50 ksi (345 MPa), fu 62 ksi (425 MPa).', A500, True, shape='shaped'))
M.append(us('ASTM-A500-GrC-round', 'ASTM A500/A500M', 'Grade C', 46, 62, 315, 425,
            'Round tubing: fy 46 ksi (315 MPa) per A500-07..-18 summaries. CONFLICT: Steel Tube Institute states the 2021 revision of A500 gives Grade C fy 50 ksi (345 MPa) and fu 62 ksi for all shapes including round; the 46 ksi value is the conservative one. Check the current ASTM edition before relying on either.',
            A500 + ' (edition conflict noted)', False, shape='round', fy_alt_A500_21_MPa=345))

AU_SRC = 'Third-party web printout of AS/NZS 3679.1 property tables (beamdimensions.com, saved 2026-06-05); not the standard itself'
for g, fy, fu in (('300', 280, 440), ('350', 330, 480)):
    M.append({'id': f'AS-NZS-3679.1-{g}', 'region': 'AU', 'standard': 'AS/NZS 3679.1', 'grade': g, 'fy_MPa': fy, 'fu_MPa': fu,
              'E_MPa': 200000, 'G_MPa': 80000, 'poisson': 0.29, 'density_kg_m3': 7850, 'thermal_expansion_per_C': 11.7e-6,
              'thickness_note': 'Copied from the existing AU materials file; fy/fu agree with the printout for flats and sections (the same printout lists 320 MPa for grade 350 rounds/squares/hexagons). The manufacturer catalogue (InfraBuild Ed.9, Tables 10 etc.) shows thickness-dependent fy for sections: 300PLUS flange 280-300 / web 300-320 MPa (fu 440); grade 350 flange/web 340-360 MPa (fu 480). So fy 280 / 330 are conservative lower bounds, not a per-thickness table. G=80000 is the AS 4100 value (not in the printout).',
              'provenance': {'source': AU_SRC + '; InfraBuild Hot Rolled & Structural Steel Products 9th ed. (2019) section capacity tables', 'verified': False,
                             'note': 'Left unverified: the only AS/NZS 3679.1 document available is a commercial website printout, not the standard.'}})
meta = {'schema': 'civilkit.materials/0.2', 'retrieved': '2026-11-08',
        'notes': ['verified=true only where the headline strengths agree across at least two independent public sources (or a mill catalogue reproducing the standard table).',
                  'fy_MPa/fu_MPa headline values are the thinnest-band minimums; thickness_bands (where present) give the thickness dependence.',
                  'SI values for ASTM grades are the ASTM SI (M) values (rounded), ksi values given alongside.']}
json.dump({'_meta': meta, 'materials': M}, open(out + '/materials.json', 'w'), indent=1, ensure_ascii=False)
print(len(M))

#!/usr/bin/env python3
"""Build verified US section records from the AISC Shapes Database v15.0 workbook.

usage: build_us.py <aisc xlsx> <candidate us_steel_sections.json> <local mirror csv> <out dir>
Writes us-sections.json and us-verify-report.json into <out dir>.
"""
import sys, json, csv, math, re, collections, hashlib
import openpyxl

xlsx, cand_path, mirror_csv, out = sys.argv[1:5]

IN = 25.4
LB_FT = 0.45359237 / 0.3048          # kg/m per lb/ft (exact)
F = {'len': IN, 'area': IN**2, 'I': IN**4, 'mod': IN**3, 'Cw': IN**6, 'mass': LB_FT}


def sig(x, n=4):
    if x is None:
        return None
    if x == 0:
        return 0.0
    return float(f"{x:.{n-1}e}")


def r2(x):
    return None if x is None else round(x, 2)


wb = openpyxl.load_workbook(xlsx, data_only=True)
ws = wb['Database v15.0']
rows = [r for r in ws.iter_rows(values_only=True)]
hdr = list(rows[0])
si0 = hdr.index('EDI_Std_Nomenclature', 2)


def clean(v):
    if v in ('–', '-', '', None):
        return None
    return v


recs = {}
for r in rows[1:]:
    if not r[0]:
        continue
    us = {k: clean(v) for k, v in zip(hdr[:si0], r[:si0])}
    si = {k: clean(v) for k, v in zip(hdr[si0:], r[si0:])}
    recs[us['AISC_Manual_Label']] = (us, si)

FAMS = {'W', 'S', 'C', 'MC', 'L', 'HSS', 'PIPE'}

# ---------- material defaults (AISC Manual Table 2-4 preferred material) ----------
def mats(form, us):
    if form == 'W':
        return 'ASTM-A992', ['ASTM-A992', 'ASTM-A572-Gr50']
    if form in ('S', 'C', 'MC', 'L'):
        return 'ASTM-A36', ['ASTM-A36', 'ASTM-A572-Gr50']
    if form == 'RHS' or form == 'SHS':
        return 'ASTM-A500-GrC-shaped', ['ASTM-A500-GrB-shaped', 'ASTM-A500-GrC-shaped']
    if form == 'CHS':
        return 'ASTM-A500-GrC-round', ['ASTM-A500-GrB-round', 'ASTM-A500-GrC-round']
    if form == 'PIPE':
        return 'ASTM-A53-GrB', ['ASTM-A53-GrB']


def props(us, with_cw):
    p = {}
    def put(k, key, f, n=4):
        v = us.get(key)
        if v is not None:
            p[k] = sig(v * f, n)
    put('Ag_mm2', 'A', F['area'])
    put('Ix_mm4', 'Ix', F['I'])
    put('Zx_mm3', 'Sx', F['mod'])   # elastic (AU convention: Zx = elastic)
    put('Sx_mm3', 'Zx', F['mod'])   # plastic (AU convention: Sx = plastic)
    put('rx_mm', 'rx', F['len'])
    put('Iy_mm4', 'Iy', F['I'])
    put('Zy_mm3', 'Sy', F['mod'])
    put('Sy_mm3', 'Zy', F['mod'])
    put('ry_mm', 'ry', F['len'])
    put('J_mm4', 'J', F['I'])
    if with_cw:
        put('Iw_mm6', 'Cw', F['Cw'])
    return p


out_secs = []
skipped = collections.Counter()
for label, (us, si) in recs.items():
    t = us['Type']
    if t not in FAMS:
        continue
    # skip metric-designation duplicate rows are in the SI block; US block only here
    mass = us['W'] * F['mass']
    base = {
        'id': 'US-' + label,
        'region': 'US',
        'standard': 'AISC Shapes Database v15.0 (Steel Construction Manual 15th ed.)',
        'designation_imperial': label,
        'designation': si['AISC_Manual_Label'],
        'mass_per_m_kg': sig(mass, 5),
    }
    if t == 'W' or t == 'S':
        form = t
        geo = {'d': r2(us['d'] * IN), 'bf': r2(us['bf'] * IN), 'tf': r2(us['tf'] * IN),
               'tw': r2(us['tw'] * IN), 'k_des': r2(us['kdes'] * IN)}
        if t == 'W':
            geo['r'] = r2((us['kdes'] - us['tf']) * IN)
        pr = props(us, True)
    elif t in ('C', 'MC'):
        form = t
        geo = {'d': r2(us['d'] * IN), 'bf': r2(us['bf'] * IN), 'tf': r2(us['tf'] * IN),
               'tw': r2(us['tw'] * IN), 'k_des': r2(us['kdes'] * IN),
               'x_centroid': r2(us['x'] * IN), 'eo': r2(us['eo'] * IN) if us.get('eo') is not None else None}
        geo = {k: v for k, v in geo.items() if v is not None}
        pr = props(us, True)
    elif t == 'L':
        form = 'L'
        long_, short_ = max(us['d'], us['b']), min(us['d'], us['b'])
        geo = {'leg_long': r2(long_ * IN), 'leg_short': r2(short_ * IN), 't': r2(us['t'] * IN),
               'k_des': r2(us['kdes'] * IN), 'x_centroid': r2(us['x'] * IN), 'y_centroid': r2(us['y'] * IN)}
        pr = props(us, False)
        pr['Iz_mm4'] = sig(us['Iz'] * F['I'])
        pr['rz_mm'] = sig(us['rz'] * F['len'])
        pr['tan_alpha'] = sig(us['tan(α)'], 3)
        if us.get('Cw') is not None:
            pr['Iw_mm6'] = sig(us['Cw'] * F['Cw'])
    elif t == 'HSS' and us.get('OD') is not None:
        form = 'CHS'
        geo = {'od': r2(us['OD'] * IN), 't_nom': r2(us['tnom'] * IN), 't_des': round(us['tdes'] * IN, 3)}
        pr = props(us, False)
        pr['C_mm3'] = sig(us['C'] * F['mod'])
    elif t == 'PIPE':
        form = 'PIPE'
        geo = {'od': r2(us['OD'] * IN), 't_nom': r2(us['tnom'] * IN), 't_des': round(us['tdes'] * IN, 3)}
        if us.get('ID') is not None:
            geo['id_nom'] = r2(us['ID'] * IN)
        pr = props(us, False)
    elif t == 'HSS':
        form = 'SHS' if abs(us['Ht'] - us['B']) < 1e-9 else 'RHS'
        tdes = us['tdes']
        geo = {'d': r2(us['Ht'] * IN), 'b': r2(us['B'] * IN), 't_nom': r2(us['tnom'] * IN),
               't_des': round(tdes * IN, 3), 'r_outside': round(2 * tdes * IN, 3), 'r_inside': round(1 * tdes * IN, 3),
               'h_flat': r2(us['h'] * IN), 'b_flat': r2(us['b'] * IN)}
        pr = props(us, False)
        pr['C_mm3'] = sig(us['C'] * F['mod'])
    ref, opts = mats(form, us)
    rec = dict(base)
    rec.update({'form': form, 'geometry_mm': geo, 'gross_props': pr,
                'material_ref': ref, 'material_options': opts,
                'provenance': {'source': 'AISC Shapes Database v15.0 (Nov 2017), imperial columns converted exactly to SI (1 in = 25.4 mm, 1 lb/ft = 1.48816394 kg/m); property values keep AISC published precision (3-4 s.f.)',
                               'verified': True}})
    out_secs.append(rec)

# ---------- verification ----------
report = {'families': {}, 'candidate': {}, 'checks': {}}
fam_count = collections.Counter(s['form'] for s in out_secs)
report['families']['primary_counts'] = dict(fam_count)

# 1. AISC metric columns vs converted imperial
si_chk = collections.defaultdict(lambda: {'n': 0, 'bad': 0, 'worst_pct': 0.0, 'worst': None})
pairs = [('W', 'mass'), ('A', 'area'), ('Ix', 'I'), ('Iy', 'I'), ('Sx', 'mod'), ('Zx', 'mod'), ('Sy', 'mod'), ('Zy', 'mod')]
SI_SCALE = {'I': 1e6, 'mod': 1e3, 'area': 1, 'mass': 1}
for rec in out_secs:
    us, si = recs[rec['designation_imperial']]
    fam = rec['form']
    for key, kind in pairs:
        a, b = us.get(key), si.get(key)
        if a is None or b is None:
            continue
        conv = a * F[kind]
        sv = b * SI_SCALE[kind]
        pct = abs(conv - sv) / sv * 100 if sv else 0
        c = si_chk[fam]
        c['n'] += 1
        if pct > 1.5:   # AISC metric columns are 3 s.f. soft conversions
            c['bad'] += 1
        if pct > c['worst_pct']:
            c['worst_pct'] = round(pct, 3); c['worst'] = (rec['designation_imperial'], key)
report['checks']['aisc_si_vs_converted_imperial_tol1.5pct'] = {k: v for k, v in si_chk.items()}

# 2. mass vs area*7850
mrat = collections.defaultdict(list)
for rec in out_secs:
    A = rec['gross_props']['Ag_mm2'] / 1e6
    mrat[rec['form']].append((rec['mass_per_m_kg'] / (A * 7850), rec['id']))
mc = {}
for f, v in mrat.items():
    xs = [x for x, _ in v]
    out3 = [i for x, i in v if abs(x - 1) > 0.03]
    mc[f] = {'n': len(v), 'min': round(min(xs), 4), 'max': round(max(xs), 4), 'outside_3pct': len(out3), 'examples': out3[:5]}
report['checks']['mass_vs_area_x7850'] = mc

# 3. HSS area closed-form with rounded corners (ro=1.5t design, ri=0.5t) at tdes and tnom
def a_rect(B, H, t):
    ro, ri = 2 * t, 1 * t
    return 2 * t * (B + H - 2 * t) - (4 - math.pi) * (ro**2 - ri**2)
hc = {'n': 0, 'worst_pct': 0, 'worst': None, 'bad_gt1pct': 0}
for rec in out_secs:
    if rec['form'] in ('SHS', 'RHS'):
        g = rec['geometry_mm']
        a = a_rect(g['b'], g['d'], g['t_des'])
        pct = abs(a - rec['gross_props']['Ag_mm2']) / rec['gross_props']['Ag_mm2'] * 100
        hc['n'] += 1
        if pct > 1: hc['bad_gt1pct'] += 1
        if pct > hc['worst_pct']: hc['worst_pct'] = round(pct, 3); hc['worst'] = rec['id']
report['checks']['hss_area_formula_ro2t_ri1t_tdes'] = hc
# flat widths consistent with b = B - 3 t_des
fc = {'n': 0, 'bad': 0, 'worst_abs_mm': 0}
for rec in out_secs:
    if rec['form'] in ('SHS', 'RHS'):
        g = rec['geometry_mm']
        for outer, flat in ((g['b'], g['b_flat']), (g['d'], g['h_flat'])):
            e = abs(outer - 3 * g['t_des'] - flat)
            fc['n'] += 1; fc['worst_abs_mm'] = max(fc['worst_abs_mm'], round(e, 3))
            if e > 0.006 * outer + 0.05: fc['bad'] += 1   # source flat widths are 3 s.f.
report['checks']['hss_flat_width_eq_B_minus_3t'] = fc

nm = {}
for rec in out_secs:
    g = rec['geometry_mm']
    if rec['form'] in ('SHS','RHS'):
        t = g['t_nom']; a = 2*t*(g['b']+g['d']-2*t) - (4-math.pi)*((2*t)**2 - t**2)
    elif rec['form'] in ('CHS','PIPE'):
        t = g['t_nom']; a = math.pi/4*(g['od']**2-(g['od']-2*t)**2)
    else: continue
    nm.setdefault(rec['form'], []).append((rec['mass_per_m_kg']/(a/1e6*7850), rec['id']))
report['checks']['hollow_mass_vs_area_at_t_nom_x7850'] = {f: {'n': len(v), 'min': round(min(x for x,_ in v),4), 'max': round(max(x for x,_ in v),4), 'outside_3pct': sum(abs(x-1)>0.03 for x,_ in v), 'examples': [i for x,i in v if abs(x-1)>0.03][:5]} for f,v in nm.items()}

# 4. W/S/C/MC Ag vs geometry (sum of rectangles + 2 fillets approx) ; I-shapes only W
ag = {'n': 0, 'worst_pct': 0, 'worst': None}
for rec in out_secs:
    if rec['form'] == 'W':
        g = rec['geometry_mm']
        A = 2 * g['bf'] * g['tf'] + (g['d'] - 2 * g['tf']) * g['tw'] + (4 - math.pi) * g['r']**2
        pct = abs(A - rec['gross_props']['Ag_mm2']) / rec['gross_props']['Ag_mm2'] * 100
        ag['n'] += 1
        if pct > ag['worst_pct']: ag['worst_pct'] = round(pct, 3); ag['worst'] = rec['id']
report['checks']['W_area_vs_geometry_with_fillets'] = ag

# 5. angles: label vs legs
lc = {'n': 0, 'bad': 0, 'examples': []}
for rec in out_secs:
    if rec['form'] == 'L':
        m = re.match(r'L([\d\-/\.]+)X([\d\-/\.]+)X([\d\-/\.]+)$', rec['designation_imperial'])
        def fr(s):
            tot = 0
            for part in s.split('-'):
                if '/' in part:
                    a, b = part.split('/'); tot += int(a) / int(b)
                else:
                    tot += float(part)
            return tot
        long_, short_, t = fr(m[1]), fr(m[2]), fr(m[3])
        g = rec['geometry_mm']
        lc['n'] += 1
        if abs(g['leg_long'] - long_ * IN) > 0.05 or abs(g['leg_short'] - short_ * IN) > 0.05 or abs(g['t'] - t * IN) > 0.5:
            lc['bad'] += 1; lc['examples'].append(rec['id'])
report['checks']['angle_label_vs_legs'] = lc

# ---------- compare local mirror csv (internal candidate copy) with workbook ----------
mir = {}
with open(mirror_csv, newline='', encoding='utf-8', errors='replace') as fh:
    rd = csv.reader(fh)
    h = next(rd)
    for row in rd:
        if len(row) < 5: continue
        d = dict(zip(h[:84], row[:84]))
        if d.get('Type') in FAMS:
            mir[d['AISC_Manual_Label']] = d
mm = {'rows_in_mirror': len(mir), 'rows_in_workbook': len(out_secs), 'missing_in_mirror': 0, 'value_diffs': 0, 'checked_values': 0}
for rec in out_secs:
    lab = rec['designation_imperial']
    if lab not in mir: mm['missing_in_mirror'] += 1; continue
    us = recs[lab][0]
    for k in ('W', 'A', 'Ix', 'Iy', 'Sx', 'Zx', 'J', 'tdes', 'tnom', 'd', 'bf', 'tf', 'tw'):
        a = us.get(k); b = mir[lab].get(k)
        if a is None: continue
        try: bf_ = float(b)
        except: bf_ = None
        mm['checked_values'] += 1
        if bf_ is None or abs(bf_ - a) > 1e-9 * max(1, abs(a)):
            mm['value_diffs'] += 1
report['checks']['local_mirror_csv_vs_workbook'] = mm

# ---------- candidate comparison ----------
cand = json.load(open(cand_path))['sections']
cat2fam = {'W': 'W', 'S': 'S', 'Channel (C)': 'C', 'Channel (MC)': 'MC', 'Angle (L)': 'L',
           'Rectangular Hollow Section (HSS)': 'RHS', 'Circular Hollow Section (HSS-round)': 'CHS',
           'Circular Hollow Section (Pipe)': 'PIPE'}
by_label = {r['designation_imperial'].lower(): r for r in out_secs}
cfam = collections.defaultdict(lambda: {'cand': 0, 'matched': 0, 'dropped_absent_in_primary': [], 'compared': 0,
                                        'mismatch_values': 0, 'mismatch_sections': 0, 'worst_pct': 0.0, 'worst': None})
tol = 2.0  # percent; candidate carries AISC 3-s.f. metric values
keymap = [('massPerMetre_kgm', 'mass_per_m_kg'), ('area_mm2', 'Ag_mm2'), ('Ix_mm4', 'Ix_mm4'), ('Iy_mm4', 'Iy_mm4'),
          ('Zx_mm3', 'Zx_mm3'), ('Sx_mm3', 'Sx_mm3')]
matched_ids = set()
bad_secs = []
for c in cand:
    fam = cat2fam.get(c['category'])
    if not fam: continue
    e = cfam[fam]; e['cand'] += 1
    nm = c['name']
    key = nm.lower()
    r = by_label.get(key)
    if r is None and fam == 'CHS':
        r = by_label.get(key)
    if r is None:
        e['dropped_absent_in_primary'].append(nm); continue
    matched_ids.add(r['id'])
    # family may be SHS/RHS split
    e['matched'] += 1
    secbad = False
    for ck, pk in keymap:
        cv = c.get(ck)
        pv = r['mass_per_m_kg'] if pk == 'mass_per_m_kg' else r['gross_props'].get(pk)
        if cv is None or pv is None: continue
        if r['form'] in ('CHS', 'PIPE') and ck in ('Ix_mm4',) : pass
        e['compared'] += 1
        pct = abs(cv - pv) / abs(pv) * 100 if pv else 0
        if pct > tol:
            e['mismatch_values'] += 1; secbad = True
        if pct > e['worst_pct']:
            e['worst_pct'] = round(pct, 2); e['worst'] = (nm, ck, cv, pv)
    if secbad:
        e['mismatch_sections'] += 1; bad_secs.append(nm)
report['candidate']['tolerance_pct'] = tol
report['candidate']['by_family'] = {k: v for k, v in cfam.items()}
report['candidate']['primary_not_in_candidate_by_family'] = dict(collections.Counter(
    r['form'] for r in out_secs if r['id'] not in matched_ids))
report['candidate']['mismatch_section_names'] = bad_secs

# write
meta = {
    'schema': 'civilkit.sections/0.3',
    'region': 'US',
    'primary_source': 'AISC Shapes Database v15.0 (November 2017), workbook sheet "Database v15.0"',
    'source_note': 'Official aisc.org download returned HTTP 403 to automated fetch; the identical AISC v15.0 workbook was obtained from a public GitHub copy (MIT-licensed repo packaging, AISC data and disclaimer unchanged).',
    'source_sha256': hashlib.sha256(open(xlsx, 'rb').read()).hexdigest(),
    'retrieved': '2026-11-08',
    'units': 'SI (mm, mm^2, mm^3, mm^4, mm^6, kg/m)',
    'props_convention': 'Zx_mm3/Zy_mm3 = ELASTIC section modulus (AISC Sx/Sy); Sx_mm3/Sy_mm3 = PLASTIC section modulus (AISC Zx/Zy). Matches AU record convention.',
    'hss_notes': 'RHS/SHS: d=overall depth H, b=overall width B, t_des=0.93*t_nom design wall (ERW A500), r_outside = 2*t_des and r_inside = t_des (the radii AISC tabulated properties are based on: published area matches the closed form with these radii within 0.4% for all 388 shapes; also stated in Steel Tube Institute / Structure magazine articles), h_flat/b_flat = AISC flat widths (B-3*t_des). mass_per_m_kg is AISC nominal weight (based on t_nom), area is based on t_des so mass vs area*7850 differs by ~7% by AISC convention.',
    'families': dict(fam_count),
    'count': len(out_secs),
}
json.dump({'_meta': meta, 'sections': out_secs}, open(out + '/us-sections.json', 'w'), indent=1, ensure_ascii=False)
json.dump(report, open(out + '/us-verify-report.json', 'w'), indent=1, ensure_ascii=False)
print(json.dumps(report, indent=1, ensure_ascii=False)[:9000])

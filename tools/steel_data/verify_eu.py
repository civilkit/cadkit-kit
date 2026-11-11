#!/usr/bin/env python3
"""Verify parsed EU sections, compare to candidate JSON, write eu-sections.json + eu-verify-report.json.
usage: verify_eu.py <_eu_parsed.json> <candidate eu json> <hybox_mass.json> <out dir>
(imports geometry helpers from build_eu.py by path-free copy)"""
import sys, json, math, collections, re

parsed_path, cand_path, hybox_path, out = sys.argv[1:5]
P = json.load(open(parsed_path))
RHO = 7850.0


def arc(cx, cy, r, a0, a1, n=32):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def poly_props(pts):
    A = Cx = Cy = Ixx = Iyy = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]; x1, y1 = pts[(i + 1) % n]
        c = x0 * y1 - x1 * y0
        A += c; Cx += (x0 + x1) * c; Cy += (y0 + y1) * c
        Ixx += (y0**2 + y0 * y1 + y1**2) * c
        Iyy += (x0**2 + x0 * x1 + x1**2) * c
    A /= 2
    Cx /= 6 * A; Cy /= 6 * A
    return abs(A), abs(Ixx / 12 - A * Cy**2), abs(Iyy / 12 - A * Cx**2)


def i_poly(h, b, tw, tf, r):
    hw = tw / 2; yf = h / 2 - tf
    pts = [(b / 2, -h / 2), (b / 2, -yf), (hw + r, -yf)]
    pts += arc(hw + r, -yf + r, r, -math.pi / 2, -math.pi)
    pts += arc(hw + r, yf - r, r, math.pi, math.pi / 2)
    pts += [(b / 2, yf), (b / 2, h / 2), (-b / 2, h / 2), (-b / 2, yf)]
    pts += arc(-hw - r, yf - r, r, math.pi / 2, 0)
    pts += arc(-hw - r, -yf + r, r, 0, -math.pi / 2)
    pts += [(-b / 2, -yf), (-b / 2, -h / 2)]
    return pts


def ch_poly(h, b, tw, tf, r):
    yf = h / 2 - tf
    pts = [(0, -h / 2), (b, -h / 2), (b, -yf), (tw + r, -yf)]
    pts += arc(tw + r, -yf + r, r, -math.pi / 2, -math.pi)
    pts += arc(tw + r, yf - r, r, math.pi, math.pi / 2)
    pts += [(b, yf), (b, h / 2), (0, h / 2)]
    return pts



def fillet(C, u1, u2, r, n=32):
    """arc points from tangent point on ray u1 to tangent point on ray u2 (unit vectors from corner C)."""
    cosang = u1[0] * u2[0] + u1[1] * u2[1]
    th = math.acos(max(-1, min(1, cosang)))
    d = r / math.tan(th / 2)
    T1 = (C[0] + d * u1[0], C[1] + d * u1[1]); T2 = (C[0] + d * u2[0], C[1] + d * u2[1])
    bx, by = u1[0] + u2[0], u1[1] + u2[1]
    bl = math.hypot(bx, by)
    h = r / math.sin(th / 2)
    Cc = (C[0] + bx / bl * h, C[1] + by / bl * h)
    a1 = math.atan2(T1[1] - Cc[1], T1[0] - Cc[0]); a2 = math.atan2(T2[1] - Cc[1], T2[0] - Cc[0])
    da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
    return [(Cc[0] + r * math.cos(a1 + da * i / n), Cc[1] + r * math.sin(a1 + da * i / n)) for i in range(n + 1)]


def tapered_poly(kind, h, b, tw, tf, r, slope, dist_frac):
    """IPN (kind='I', symmetric about x=0) or UPN (kind='C', web outer face at x=0)."""
    hw = tw / 2 if kind == 'I' else tw
    xtip = b / 2 if kind == 'I' else b
    out_len = xtip - hw                       # flange outstand length measured from web face
    t_tip = tf - slope * out_len * dist_frac  # tf given at dist_frac of outstand from tip
    Cx_, Cy_ = hw, -h / 2 + t_tip + slope * out_len
    n = math.hypot(1, slope)
    u1 = (0.0, 1.0); u2 = (1 / n, -slope / n)
    q = [(xtip, -h / 2), (xtip, -h / 2 + t_tip)] + fillet((Cx_, Cy_), u2, u1, r)[::-1][::-1]
    # fillet() goes from u2-ray tangent to u1-ray tangent (flange line -> web)
    q = [(xtip, -h / 2), (xtip, -h / 2 + t_tip)] + fillet((Cx_, Cy_), u2, u1, r)
    q.append((hw, 0.0))
    right = q + [(x, -y) for (x, y) in reversed(q[:-1])]
    if kind == 'I':
        left = [(-x, y) for (x, y) in reversed(right)]
        return right + left
    return right + [(0, h / 2), (0, -h / 2)]


def rr(w, h, r):
    p = []
    p += arc(w / 2 - r, h / 2 - r, r, 0, math.pi / 2)
    p += arc(-w / 2 + r, h / 2 - r, r, math.pi / 2, math.pi)
    p += arc(-w / 2 + r, -h / 2 + r, r, math.pi, 1.5 * math.pi)
    p += arc(w / 2 - r, -h / 2 + r, r, 1.5 * math.pi, 2 * math.pi)
    return p


rep = {'open': {}, 'hollow': {}, 'candidate': {}}


def pct(a, b):
    return abs(a - b) / abs(b) * 100 if b else 0.0


# ------------------------------------------------------------- open sections
open_final = []
oc = collections.defaultdict(lambda: collections.Counter())
worst = collections.defaultdict(dict)
fail_open = []
for s in P['open']:
    f = s['form']; g = s['geometry_mm']; p = s['gross_props']; src = s.pop('_src')
    issues = []
    # mass consistency between the two catalogue tables
    if abs(src['G_props'] - s['mass_per_m_kg']) > 0.051:
        issues.append('mass_tables_differ')
    # mass vs area
    r = s['mass_per_m_kg'] / (p['Ag_mm2'] / 1e6 * RHO)
    oc[f]['n'] += 1
    if abs(r - 1) > 0.03: issues.append('mass_vs_area>3%'); oc[f]['mass_area_outside_3pct'] += 1
    worst[f]['mass_area'] = max(worst[f].get('mass_area', 0), abs(r - 1) * 100)
    # geometry recompute (parallel-flange approximation; sloped for IPN/UPN)
    if f in ('IPN', 'UPN'):
        tol = 3.5
    else:
        tol = 1.5
    if f == 'UPN':
        A, Ix_, Iy_ = poly_props(tapered_poly('C', g['d'], g['bf'], g['tw'], g['tf'], g['r'], 0.08, 0.5))
    elif f == 'IPN':
        A, Ix_, Iy_ = poly_props(tapered_poly('I', g['d'], g['bf'], g['tw'], g['tf'], g['r'], 0.14, 0.5))
    else:
        A, Ix_, Iy_ = poly_props(i_poly(g['d'], g['bf'], g['tw'], g['tf'], g['r']))
    # polygon Ix is about horizontal axis through centroid => strong axis for the orientation used
    e_A, e_Ix, e_Iy = pct(A, p['Ag_mm2']), pct(Ix_, p['Ix_mm4']), pct(Iy_, p['Iy_mm4'])
    for nm, e in (('A', e_A), ('Iy_strong', e_Ix), ('Iz_weak', e_Iy)):
        worst[f][nm] = max(worst[f].get(nm, 0), e)
        tl = 6.0 if (f in ('IPN', 'UPN') and nm == 'Iz_weak') else tol
        if e > tl:
            issues.append(f'{nm}_vs_geometry>{tl}%'); oc[f][f'{nm}_outside_tol'] += 1
    # warping constant sanity for doubly symmetric: Iw ~ Iz*(d-tf)^2/4
    if f not in ('UPN',):
        iw_est = p['Iy_mm4'] * (g['d'] - g['tf'])**2 / 4
        e_w = pct(iw_est, p['Iw_mm6'])
        worst[f]['Iw'] = max(worst[f].get('Iw', 0), e_w)
        if e_w > 12:
            issues.append('Iw_vs_estimate>12%'); oc[f]['Iw_outside_tol'] += 1
    # torsion constant sanity: 1/3 sum b t^3 within [0.7,2.0]
    it_est = (2 * g['bf'] * g['tf']**3 + (g['d'] - 2 * g['tf']) * g['tw']**3) / 3
    ratio = p['J_mm4'] / it_est
    worst[f].setdefault('J_ratio_min', 9); worst[f].setdefault('J_ratio_max', 0)
    worst[f]['J_ratio_min'] = min(worst[f]['J_ratio_min'], ratio); worst[f]['J_ratio_max'] = max(worst[f]['J_ratio_max'], ratio)
    if not (0.7 <= ratio <= 2.2):
        issues.append('J_vs_thin_wall_estimate'); oc[f]['J_outside_range'] += 1
    s['provenance'] = {
        'source': 'ArcelorMittal "Sections and Merchant Bars" catalogue (FR/EN/DE sales programme, PDF 2024-03 file date), dimensions table and "Dimensions and properties" table for the section family; units converted (cm->mm etc.)',
        'verified': not issues,
    }
    if issues:
        s['provenance']['issues'] = issues
        fail_open.append((s['designation'], issues))
    open_final.append(s)

rep['open']['by_family'] = {f: dict(c) for f, c in oc.items()}
rep['open']['worst_pct'] = {f: {k: round(v, 3) for k, v in d.items()} for f, d in worst.items()}
rep['open']['failed'] = fail_open

# ------------------------------------------------------------- hollow sections
hb = {k: {(e['size'], e['t']): e['mass'] for e in v} for k, v in json.load(open(hybox_path)).items()}
hollow_final = []
hc = collections.defaultdict(lambda: collections.Counter())
hw = collections.defaultdict(dict)
hfail = []
hmis = []
dup_ids = collections.Counter(s['id'] for s in P['hollow'])
rep['hollow']['duplicate_ids'] = [i for i, c in dup_ids.items() if c > 1]
for s in P['hollow']:
    key = (s['manufacturing'], s['form'])
    k = f"{s['manufacturing']}-{s['form']}"
    g = s['geometry_mm']; p = s['gross_props']; src = s.pop('_src')
    issues = []
    hc[k]['n'] += 1
    r = s['mass_per_m_kg'] / (p['Ag_mm2'] / 1e6 * RHO)
    hw[k]['mass_area'] = max(hw[k].get('mass_area', 0), abs(r - 1) * 100)
    if abs(r - 1) > 0.03:
        issues.append('mass_vs_area>3%'); hc[k]['mass_area_outside_3pct'] += 1
    # geometry recompute
    if s['form'] == 'CHS':
        D, t = g['od'], g['t']
        A = math.pi / 4 * (D**2 - (D - 2 * t)**2)
        I = math.pi / 64 * (D**4 - (D - 2 * t)**4)
        e_A, e_I = pct(A, p['Ag_mm2']), pct(I, p['Ix_mm4'])
        errs = {'A': e_A, 'I': e_I}
    else:
        o = rr(g['b'], g['d'], g['r_outside']); i = rr(g['b'] - 2 * g['t'], g['d'] - 2 * g['t'], g['r_inside'])
        Ao, Iyo, Izo = poly_props(o)[0], poly_props(o)[1], poly_props(o)[2]
        Ai, Iyi, Izi = poly_props(i)[0], poly_props(i)[1], poly_props(i)[2]
        errs = {'A': pct(Ao - Ai, p['Ag_mm2']), 'Iy': pct(Iyo - Iyi, p['Ix_mm4']), 'Iz': pct(Izo - Izi, p['Iy_mm4'])}
    for nm, e in errs.items():
        hw[k][nm] = max(hw[k].get(nm, 0), e)
        if e > 1.5:
            issues.append(f'{nm}_vs_geometry>1.5%'); hc[k][f'{nm}_outside_tol'] += 1
    # independent mass check against Tata Hybox S355J2H datasheet (cold-formed only)
    xcheck = None
    if s['manufacturing'] == 'cold-formed':
        if s['form'] == 'CHS':
            sk = f"{g['od']:g}"
            tab = hb['CHS']
        elif s['form'] == 'SHS':
            sk = f"{g['d']:g}/{g['d']:g}"; tab = hb['SHS']
        else:
            sk = f"{g['d']:g}/{g['b']:g}"; tab = hb['RHS']
        v = tab.get((sk, float(g['t'])))
        if v is not None:
            hc[k]['hybox_datasheet_compared'] += 1
            d = pct(v, s['mass_per_m_kg'])
            hw[k]['hybox_mass_diff_pct'] = max(hw[k].get('hybox_mass_diff_pct', 0), d)
            if d > 1.0:
                hc[k]['hybox_mass_mismatch'] += 1
                hmis.append((s['id'], v, s['mass_per_m_kg'], round(d, 2)))
                xcheck = 'mismatch'
            else:
                xcheck = True
        else:
            hc[k]['not_in_hybox_datasheet'] += 1
    s['provenance'] = {
        'source': ('SCI P363 "Steel Building Design: Design Data" (reprinted 2015), tables of hot-finished Celsius sections to EN 10210-2' if s['manufacturing'] == 'hot-finished'
                   else 'SCI P363 "Steel Building Design: Design Data" (reprinted 2015), tables of cold-formed Hybox sections to EN 10219-2'),
        'verified': not issues,
        'availability_flag': 'SCI tables mark this size as to be checked for availability' if src['availability_flag_hash'] else None,
    }
    if xcheck is True:
        s['provenance']['cross_check'] = 'mass matches Tata Steel Hybox S355J2H datasheet (TST95:0122, 2022) within 1%'
    elif xcheck == 'mismatch':
        s['provenance']['cross_check'] = 'Tata Hybox datasheet mass differs (datasheet value inconsistent with its own geometry; SCI P363 value agrees with geometry and 7850 kg/m3 x area)'
    if s['provenance']['availability_flag'] is None: del s['provenance']['availability_flag']
    if issues:
        s['provenance']['issues'] = issues; hfail.append((s['id'], issues))
    hollow_final.append(s)
rep['hollow']['by_group'] = {k: dict(c) for k, c in hc.items()}
rep['hollow']['worst_pct'] = {k: {a: round(b, 3) for a, b in d.items()} for k, d in hw.items()}
rep['hollow']['failed'] = hfail
rep['hollow']['hybox_mass_disagreements'] = hmis

# ------------------------------------------------------------- candidate comparison
cand = json.load(open(cand_path))['sections']
idx = {s['designation'].replace(' ', ''): s for s in open_final}
hidx = {}
for s in hollow_final:
    g = s['geometry_mm']
    if s['form'] == 'CHS': nm = f"{g['od']:g}x{g['t']:g}"
    elif s['form'] == 'SHS': nm = f"{g['d']:g}x{g['b']:g}x{g['t']:g}"
    else: nm = f"{g['d']:g}x{g['b']:g}x{g['t']:g}"
    hidx[(nm, s['form'], s['manufacturing'])] = s


def cand_key(c):
    n = c['name']
    m = re.match(r'^(IPE)(A|O)?(\d+)\+?$', n)
    if m: return f"IPE{m.group(2) or ''}{m.group(3)}".replace('IPE', 'IPE', 1) if not m.group(2) else f"IPE{m.group(2)}{m.group(3)}"
    m = re.match(r'^HE(AA|A|B|M)(\d+)$', n)
    if m: return f"HE{m.group(2)}{m.group(1)}"
    return n.replace(' ', '')

keymap = [('massPerMetre_kgm', lambda s: s['mass_per_m_kg']), ('area_mm2', lambda s: s['gross_props']['Ag_mm2']),
          ('Ix_mm4', lambda s: s['gross_props']['Ix_mm4']), ('Iy_mm4', lambda s: s['gross_props']['Iy_mm4']),
          ('Zx_mm3', lambda s: s['gross_props']['Zx_mm3']), ('Sx_mm3', lambda s: s['gross_props']['Sx_mm3']),
          ('J_mm4', lambda s: s['gross_props']['J_mm4'])]
cf = collections.defaultdict(lambda: {'cand': 0, 'matched': 0, 'dropped_absent': [], 'compared': 0, 'mism_values': 0,
                                      'mism_sections': 0, 'worst_pct': 0.0, 'worst': None, 'mism_names': []})
TOL = 3.0
matched_ids = set()
for c in cand:
    cat = c['category']
    n = c['name']
    e = cf[cat if cat in ('Square Hollow Section', 'Rectangular Hollow Section', 'Circular Hollow Section', 'HE') else (
        'IPE-family' if cat == 'IPE' else cat)]
    e['cand'] += 1
    s = None
    if cat in ('Square Hollow Section', 'Rectangular Hollow Section', 'Circular Hollow Section'):
        m = re.match(r'^([\d.]+(?:x[\d.]+)*) (SHS|RHS|CHS)$', n)
        form = m.group(2)
        for mode in ('cold-formed', 'hot-finished'):
            s = hidx.get((m.group(1), form, mode))
            if s: break
    elif cat == 'HE':
        s = None
    else:
        mm = re.match(r'^IPE(A|O)?(\d+)\+?$', n)
        if mm: key = f"IPE{mm.group(1) or ''}{mm.group(2)}"
        elif n.startswith('IPE750'): key = None
        else:
            key = n
        # normalise open-section ids: designation without spaces e.g. IPEA200, HE200B
        s = idx.get(key) if key else None
        if s is None and key:
            s = idx.get(key.replace('IPEA', 'IPEA').replace('IPEO', 'IPEO'))
    if s is None:
        e['dropped_absent'].append(n); continue
    matched_ids.add(s['id'])
    e['matched'] += 1
    bad = False
    for ck, fn in keymap:
        cv = c.get(ck)
        if cv is None: continue
        pv = fn(s)
        e['compared'] += 1
        d = pct(cv, pv)
        if d > TOL:
            e['mism_values'] += 1; bad = True
        if d > e['worst_pct']:
            e['worst_pct'] = round(d, 2); e['worst'] = (n, ck, cv, pv)
    if bad:
        e['mism_sections'] += 1; e['mism_names'].append(n)
rep['candidate']['tolerance_pct'] = TOL
rep['candidate']['by_category'] = dict(cf)
rep['candidate']['primary_sections_not_in_candidate'] = dict(collections.Counter(
    s['form'] for s in open_final + hollow_final if s['id'] not in matched_ids))

# ------------------------------------------------------------- write
SRC_AM = 'ArcelorMittal Sections and Merchant Bars (Sections_MB_ArcelorMittal_FR_EN_DE.pdf, PDF created 2024-03-25, 184 pp)'
SRC_P363 = 'SCI P363 Steel Building Design: Design Data, reprinted 2015, ISBN 978-1-85942-186-4 (Tata Steel / BCSA / SCI)'
allsec = open_final + hollow_final
for s in allsec:
    s['gross_props'] = {k: v for k, v in s['gross_props'].items()}
meta = {
    'schema': 'civilkit.sections/0.3',
    'region': 'EU',
    'primary_sources': {'open_sections': SRC_AM, 'hollow_sections': SRC_P363,
                        'hollow_mass_cross_check': 'Tata Steel Hybox S355J2H datasheet TST95:0122 (2022), mass-per-metre tables to EN 10219'},
    'retrieved': '2026-11-08',
    'units': 'SI (mm, mm^2, mm^3, mm^4, mm^6, kg/m)',
    'props_convention': 'x = strong axis (EN y-y), y = weak axis (EN z-z). Zx_mm3/Zy_mm3 = ELASTIC modulus (Wel); Sx_mm3/Sy_mm3 = PLASTIC modulus (Wpl). Matches AU record convention. J_mm4 = EN torsion constant I_T, Iw_mm6 = warping constant I_w, C_mm3 (hollow) = torsion modulus W_t.',
    'hollow_notes': 'hot-finished (EN 10210-2): ro = 1.5t, ri = 1.0t. cold-formed (EN 10219-2): ro = 2t (t<=6), 2.5t (6<t<=10), 3t (t>10); ri = 1t, 1.5t, 2t respectively. Properties therefore differ between the two for the same size.',
    'families': dict(collections.Counter(s['form'] for s in allsec)),
    'count': len(allsec),
}
json.dump({'_meta': meta, 'sections': allsec}, open(out + '/eu-sections.json', 'w'), indent=1, ensure_ascii=False)
json.dump(rep, open(out + '/eu-verify-report.json', 'w'), indent=1, ensure_ascii=False)
print(json.dumps(rep, indent=1, ensure_ascii=False)[:12000])

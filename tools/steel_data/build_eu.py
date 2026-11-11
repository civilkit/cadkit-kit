#!/usr/bin/env python3
"""Build EU section records.

Open sections (IPE, HEA, HEB, HEM, HEAA, UPN, IPN): ArcelorMittal 'Sections and Merchant Bars' catalogue text.
Hollow sections: SCI P363 'Steel Building Design: Design Data' (Reprinted 2015) tables for hot-finished (EN 10210-2)
and cold-formed (EN 10219-2) CHS/SHS/RHS.

usage: build_eu.py <am_sales.txt> <p363.txt> <candidate eu json> <out dir>
"""
import sys, re, json, math, collections

am_txt, p363_txt, cand_path, out = sys.argv[1:5]
RHO = 7850.0


def num(tok):
    return float(tok.replace(',', '.'))


NUMRE = re.compile(r'^-?\d+(?:[.,]\d+)?$')


def tokens_after(line, start, maxn=40):
    rest = line[start:].replace(')', ' ').replace('^', ' ').replace(';', ',').replace('#', ' ')
    toks = []
    for t in rest.split():
        if NUMRE.match(t):
            toks.append(t)
        else:
            break
    return toks[:maxn]


# ---------------------------------------------------------------- geometry helpers
def poly_props(pts):
    """area, centroid, Ix, Iy about centroid for polygon (CCW)."""
    A = Cx = Cy = Ixx = Iyy = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]; x1, y1 = pts[(i + 1) % n]
        c = x0 * y1 - x1 * y0
        A += c
        Cx += (x0 + x1) * c
        Cy += (y0 + y1) * c
        Ixx += (y0**2 + y0 * y1 + y1**2) * c
        Iyy += (x0**2 + x0 * x1 + x1**2) * c
    A /= 2
    Cx /= 6 * A; Cy /= 6 * A
    Ixx = Ixx / 12 - A * Cy**2
    Iyy = Iyy / 12 - A * Cx**2
    return A, Cx, Cy, abs(Ixx), abs(Iyy)


def arc(cx, cy, r, a0, a1, n=24):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def i_section_poly(h, b, tw, tf, r):
    """doubly symmetric I with root fillets, origin at centre."""
    pts = []
    hw = tw / 2
    yf = h / 2 - tf
    # go CCW starting bottom-right flange tip
    pts += [(b / 2, -h / 2), (b / 2, -yf)]
    # bottom-right fillet (between flange top face and web right face): centre (hw+r, -yf-r)
    pts += arc(hw + r, -yf - r, r, math.pi / 2, math.pi, 24)
    pts += arc(hw + r, yf + r, r, math.pi, 1.5 * math.pi, 24)
    pts += [(b / 2, yf), (b / 2, h / 2), (-b / 2, h / 2), (-b / 2, yf)]
    pts += arc(-hw - r, yf + r, r, 1.5 * math.pi, 2 * math.pi, 24)
    pts += arc(-hw - r, -yf - r, r, 0, 0.5 * math.pi, 24)
    pts += [(-b / 2, -yf), (-b / 2, -h / 2)]
    return pts


def channel_poly(h, b, tw, tf, r):
    """channel, web on left x in [0,tw], flanges to x=b; parallel-flange approximation."""
    yf = h / 2 - tf
    pts = [(0, -h / 2), (b, -h / 2), (b, -yf)]
    pts += arc(tw + r, -yf - r, r, math.pi / 2, math.pi, 24)
    pts += arc(tw + r, yf + r, r, math.pi, 1.5 * math.pi, 24)
    pts += [(b, yf), (b, h / 2), (0, h / 2)]
    return pts


def rect_hollow_poly(B, H, t, ro, ri):
    def rr(w, h, r):
        p = []
        p += arc(w / 2 - r, h / 2 - r, r, 0, math.pi / 2, 24)
        p += arc(-w / 2 + r, h / 2 - r, r, math.pi / 2, math.pi, 24)
        p += arc(-w / 2 + r, -h / 2 + r, r, math.pi, 1.5 * math.pi, 24)
        p += arc(w / 2 - r, -h / 2 + r, r, 1.5 * math.pi, 2 * math.pi, 24)
        return p
    return rr(B, H, ro), rr(B - 2 * t, H - 2 * t, ri)


def hollow_props(B, H, t, ro, ri):
    o, i = rect_hollow_poly(B, H, t, ro, ri)
    Ao, _, _, Ixo, Iyo = poly_props(o)
    Ai, _, _, Ixi, Iyi = poly_props(i)
    return Ao - Ai, Ixo - Ixi, Iyo - Iyi


# ------------------------------------------------------------------ open sections
lines = open(am_txt, encoding='utf-8').read().split('\n')

NAME = re.compile(r'^\s*(IPE(?: (?:AA|A|O))? \d+|HE \d+ (?:AA|A|B|M)|IPN \d+|UPN \d+)(?=\s)')
dims, props = {}, {}
for ln_no, ln in enumerate(lines):
    m = NAME.match(ln)
    if not m:
        continue
    name = m.group(1)
    toks = tokens_after(ln, m.end())
    has_check = '√' in ln
    if has_check and name not in dims:
        if len(toks) == 12:
            toks = toks[1:]
        if len(toks) >= 11:
            dims[name] = (toks[:11], ln_no + 1)
    elif not has_check and len(toks) >= 14 and name not in props:
        props[name] = (toks[:13], ln_no + 1)

secs = []
fam_of = lambda n: ('IPEAA' if n.startswith('IPE AA') else 'IPEA' if n.startswith('IPE A') else 'IPEO' if n.startswith('IPE O') else 'IPE' if n.startswith('IPE')
                    else 'HEAA' if n.endswith(' AA') else 'HEA' if n.endswith(' A') else 'HEB' if n.endswith(' B') else 'HEM' if n.endswith(' M')
                    else 'IPN' if n.startswith('IPN') else 'UPN')
dropped_no_props = []
for name, (d, dl) in dims.items():
    if name not in props:
        dropped_no_props.append(name); continue
    p, pl = props[name]
    fam = fam_of(name)
    G, h, b, tw, tf, r = [num(x) for x in d[:6]]
    if fam in ('IPN', 'UPN'):
        r1, r2, dd, A_cm2 = num(d[5]), num(d[6]), num(d[7]), num(d[8])
        r = r1
    else:
        dd, A_cm2 = num(d[7]), num(d[8])
        r2 = None
    pv = [num(x) for x in p]
    Gp = pv[0]
    Iy, Wely, Wply, iy, Avz, Iz, Welz, Wplz, iz, ss, It, Iw = pv[1:13]
    geo = {'d': h, 'bf': b, 'tf': tf, 'tw': tw, 'r': r}
    if r2 is not None:
        geo['r2'] = r2
        geo['web_clear_d'] = dd
    else:
        geo['web_clear_d'] = dd
    if name.startswith('HE '):
        name = f"{fam} {name.split()[1]}"
    rec = {
        'id': 'EU-' + name.replace(' ', ''),
        'region': 'EU',
        'standard': 'EN 10365 dimensions; ArcelorMittal Sections and Merchant Bars catalogue',
        'form': fam,
        'designation': name,
        'mass_per_m_kg': G,
        'geometry_mm': geo,
        'gross_props': {
            'Ag_mm2': round(A_cm2 * 100, 1),
            'Ix_mm4': round(Iy * 1e4, 0),          # EN strong axis y-y -> AU/AISC 'x'
            'Zx_mm3': round(Wely * 1e3, 0),        # elastic
            'Sx_mm3': round(Wply * 1e3, 0),        # plastic
            'rx_mm': round(iy * 10, 1),
            'Iy_mm4': round(Iz * 1e4, 0),
            'Zy_mm3': round(Welz * 1e3, 0),
            'Sy_mm3': round(Wplz * 1e3, 0),
            'ry_mm': round(iz * 10, 1),
            'J_mm4': round(It * 1e4, 0),
            'Iw_mm6': round(Iw * 1e9, 0),
        },
        'material_ref': 'EN-10025-2-S355',
        'material_options': ['EN-10025-2-S235', 'EN-10025-2-S275', 'EN-10025-2-S355'],
        '_src': {'dims_line': dl, 'props_line': pl, 'G_props': Gp},
    }
    secs.append(rec)
# Iw units: 10^3 cm^6 -> 1 cm^6 = 1e6 mm^6 -> value*1e3*1e6 = value*1e9 mm^6 (verified numerically below)

# --------------------------------------------------------------- hollow sections (P363)
pl_lines = open(p363_txt, encoding='utf-8').read().split('\n')
mode = None; shape = None
hollow = []
ROW_START = re.compile(r'^\s*(\d+(?:\.\d+)?(?:\s*x\s*\d+(?:\.\d+)?)?)\s+(\d+(?:\.\d+)?)\s*#?\s+(\d.*)$')
CONT = re.compile(r'^\s{5,}(\d+(?:\.\d+)?)\s*#?\s+(\d.*)$')
cur_size = None
for ln_no in range(3900, 5700):
    ln = pl_lines[ln_no]
    if 'HOT-FINISHED' in ln: mode = 'hot'; cur_size = None
    if 'COLD-FORMED' in ln or 'COLD FORMED' in ln: mode = 'cold'; cur_size = None
    if 'ELLIPTICAL HOLLOW' in ln: shape = 'ELL'
    elif 'CIRCULAR HOLLOW SECTIONS' in ln: shape = 'CHS'
    elif 'SQUARE HOLLOW SECTIONS' in ln: shape = 'SHS'
    elif 'RECTANGULAR HOLLOW SECTIONS' in ln: shape = 'RHS'
    if shape in (None, 'ELL') or mode is None:
        continue
    # strip a trailing page-note junk
    m = ROW_START.match(ln)
    size = t = None
    if m and re.match(r'^\s*\d+(?:\.\d+)?(?:\s*x\s*\d+(?:\.\d+)?)?\s+\d+(?:\.\d+)?\s*#?\s+\d', ln):
        # ambiguous: either "size t rest" or "t mass rest"; decide by number of numeric tokens
        toks = ln.replace('#', ' ').replace(' x ', 'x').split()
        want = 11 if shape in ('CHS', 'SHS') else 16
        nums = [x for x in toks if NUMRE.match(x) or re.match(r'^\d+(\.\d+)?x\d+(\.\d+)?$', x)]
        if len(toks) == want + 2 and all(NUMRE.match(x) or 'x' in x for x in toks):
            cur_size = toks[0]; t = toks[1]; vals = toks[2:]
        elif len(toks) == want + 1 and all(NUMRE.match(x) for x in toks):
            t = toks[0]; vals = toks[1:]
        else:
            continue
        if cur_size is None: continue
        vals = [float(v) for v in vals]
        hollow.append((mode, shape, cur_size, float(t), vals, ln_no + 1, '#' in ln))
    else:
        # lines like "50x30       3.0 #  ..." handled by ROW_START; and "50x30" w/o space handled by split
        toks = ln.replace('#', ' ').replace(' x ', 'x').split()
        want = 11 if shape in ('CHS', 'SHS') else 16
        if len(toks) == want + 2 and re.match(r'^\d+(\.\d+)?(x\d+(\.\d+)?)?$', toks[0]) and all(NUMRE.match(x) for x in toks[1:]):
            cur_size = toks[0]; t = toks[1]; vals = [float(v) for v in toks[2:]]
            hollow.append((mode, shape, cur_size, float(t), vals, ln_no + 1, '#' in ln))
        elif len(toks) == want + 1 and cur_size and all(NUMRE.match(x) for x in toks):
            hollow.append((mode, shape, cur_size, float(toks[0]), [float(v) for v in toks[1:]], ln_no + 1, '#' in ln))

hsecs = []
seen = set()
for mode, shape, size, t, v, ln_no, flag in hollow:
    std = 'EN 10210-2' if mode == 'hot' else 'EN 10219-2'
    prefix = 'EN10210' if mode == 'hot' else 'EN10219'
    trade = 'Celsius' if mode == 'hot' else 'Hybox'
    if shape == 'CHS':
        D = float(size)
        mass, A, dt, I, i, Wel, Wpl, IT, Wt, Am, AmT = v
        geo = {'od': D, 't': t}
        pr = {'Ag_mm2': round(A * 100, 1), 'Ix_mm4': round(I * 1e4), 'Zx_mm3': round(Wel * 1e3), 'Sx_mm3': round(Wpl * 1e3),
              'rx_mm': round(i * 10, 1), 'Iy_mm4': round(I * 1e4), 'Zy_mm3': round(Wel * 1e3), 'Sy_mm3': round(Wpl * 1e3),
              'ry_mm': round(i * 10, 1), 'J_mm4': round(IT * 1e4), 'C_mm3': round(Wt * 1e3)}
        des = f'CHS {D:g}x{t:g}'
    elif shape == 'SHS':
        H = float(size.split('x')[0])
        mass, A, ct, I, i, Wel, Wpl, IT, Wt, Am, AmT = v
        if mode == 'hot': ro, ri = 1.5 * t, 1.0 * t
        else:
            ro = 2 * t if t <= 6 else 2.5 * t if t <= 10 else 3 * t
            ri = 1.0 * t if t <= 6 else 1.5 * t if t <= 10 else 2 * t
        geo = {'d': H, 'b': H, 't': t, 'r_outside': round(ro, 2), 'r_inside': round(ri, 2)}
        pr = {'Ag_mm2': round(A * 100, 1), 'Ix_mm4': round(I * 1e4), 'Zx_mm3': round(Wel * 1e3), 'Sx_mm3': round(Wpl * 1e3),
              'rx_mm': round(i * 10, 1), 'Iy_mm4': round(I * 1e4), 'Zy_mm3': round(Wel * 1e3), 'Sy_mm3': round(Wpl * 1e3),
              'ry_mm': round(i * 10, 1), 'J_mm4': round(IT * 1e4), 'C_mm3': round(Wt * 1e3)}
        des = f'SHS {H:g}x{H:g}x{t:g}'
    else:
        Hh, Bb = [float(x) for x in size.split('x')]
        mass, A, cw, cf, Iy_, Iz_, iy_, iz_, Wey, Wez, Wpy, Wpz, IT, Wt, Am, AmT = v
        if mode == 'hot': ro, ri = 1.5 * t, 1.0 * t
        else:
            ro = 2 * t if t <= 6 else 2.5 * t if t <= 10 else 3 * t
            ri = 1.0 * t if t <= 6 else 1.5 * t if t <= 10 else 2 * t
        geo = {'d': Hh, 'b': Bb, 't': t, 'r_outside': round(ro, 2), 'r_inside': round(ri, 2)}
        pr = {'Ag_mm2': round(A * 100, 1), 'Ix_mm4': round(Iy_ * 1e4), 'Zx_mm3': round(Wey * 1e3), 'Sx_mm3': round(Wpy * 1e3),
              'rx_mm': round(iy_ * 10, 1), 'Iy_mm4': round(Iz_ * 1e4), 'Zy_mm3': round(Wez * 1e3), 'Sy_mm3': round(Wpz * 1e3),
              'ry_mm': round(iz_ * 10, 1), 'J_mm4': round(IT * 1e4), 'C_mm3': round(Wt * 1e3)}
        des = f'RHS {Hh:g}x{Bb:g}x{t:g}'
    mat = ('EN-10210-S355J2H', ['EN-10210-S355J2H']) if mode == 'hot' else ('EN-10219-S355J2H', ['EN-10219-S355J2H'])
    sid = f'EU-{prefix}-{des.replace(" ", "")}'
    key = (sid)
    if key in seen:
        continue
    seen.add(key)
    hsecs.append({
        'id': sid, 'region': 'EU', 'standard': std, 'form': shape, 'designation': des,
        'mass_per_m_kg': mass, 'geometry_mm': geo, 'gross_props': pr,
        'material_ref': mat[0], 'material_options': mat[1],
        'manufacturing': 'hot-finished' if mode == 'hot' else 'cold-formed',
        '_src': {'p363_line': ln_no, 'availability_flag_hash': flag, 'tabulated_rows': v},
    })

json.dump({'open': secs, 'hollow': hsecs, 'dropped_no_props': dropped_no_props}, open(out + '/_eu_parsed.json', 'w'), indent=1)
print(len(secs), collections.Counter(s['form'] for s in secs))
print(len(hsecs), collections.Counter((s['manufacturing'], s['form']) for s in hsecs))
print(dropped_no_props)

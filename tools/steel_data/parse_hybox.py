#!/usr/bin/env python3
"""Parse Tata Steel Hybox S355J2H datasheet (mass per metre tables, EN 10219) via pdftotext -bbox output.
usage: parse_hybox.py <bbox.html> <out.json>"""
import re, sys, json
h = open(sys.argv[1]).read()
p = h.split('<page ')[2]
ws = [(float(a), float(b), float(c), float(d), t) for a, b, c, d, t in
      re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', p)]
mm = sorted([w for w in ws if w[4] == 'mm'], key=lambda w: (w[0], w[1]))
tables = []
num = re.compile(r'^\d+(\.\d+)?$')
out = {'CHS': [], 'SHS': [], 'RHS': []}
# identify header rows: 'mm' followed on same y by thickness numbers
for m in mm:
    row = sorted([w for w in ws if abs(w[1] - m[1]) < 2 and w[0] >= m[0]], key=lambda w: w[0])
    cols = [(w[0], w[2], float(w[4])) for w in row[1:] if num.match(w[4])]
    if len(cols) < 5:
        continue
    x0 = m[0]
    tables.append((m[1], x0, cols))
# decide table type by x/y
for y, x0, cols in tables:
    kind = 'RHS' if x0 > 300 else ('CHS' if y < 300 else 'SHS')
    xr = 1e9 if x0 > 300 else 300
    ymax = 1e9
    # next header below on same side
    below = [t[0] for t in tables if (t[1] > 300) == (x0 > 300) and t[0] > y]
    if below: ymax = min(below)
    rows = {}
    for w in ws:
        if w[1] > y + 3 and w[1] < ymax and ((w[0] >= x0 - 1 and w[0] < 400) if x0 < 300 else w[0] >= x0 - 1):
            rows.setdefault(round(w[1] / 2.0), []).append(w)
    for k, r in sorted(rows.items()):
        r.sort(key=lambda w: w[0])
        if not r or abs(r[0][0] - x0) > 3 or not re.match(r'^[\d.]+(/[\d.]+)?$', r[0][4]):
            continue
        size = r[0][4]
        for w in r[1:]:
            if not num.match(w[4]):
                continue
            xc = (w[0] + w[2]) / 2
            best = min(cols, key=lambda c: abs((c[0] + c[1]) / 2 - xc))
            out[kind].append({'size': size, 't': best[2], 'mass': float(w[4]), 'dx': round(abs((best[0] + best[1]) / 2 - xc), 1)})
json.dump(out, open(sys.argv[2], 'w'), indent=1)
print({k: len(v) for k, v in out.items()}, 'max dx', max((e['dx'] for v in out.values() for e in v), default=None))

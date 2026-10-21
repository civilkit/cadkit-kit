#!/usr/bin/env python3
"""Analytic volume of the vented louvre case: every feature is a prism along the sketch normal, so the volume is a
sum of (profile area x layer height). Areas: rounded rectangles in closed form, vents/slots by shoelace (arcs sampled
densely, ~1e-9 relative). Layers derived by hand from the feature list (see bench-solidcraft.md)."""
import json, math, collections, sys
d = json.load(open(sys.argv[1]))
fs = {f['id']: f for f in d['features']}
rr = lambda hx, hy, r: 4*hx*hy - (4 - math.pi)*r*r
O, C, O2 = rr(62.4, 42.4, 4), rr(60, 40, 1.6), rr(62.1, 42.1, 3.7)
def loops_area(f):
    P = {p['id']: (p['x'], p['y']) for p in f['points']}
    ents = [e for e in f['entities'] if e['type'] != 'circle']
    circ = sum(math.pi*e['r']**2 for e in f['entities'] if e['type'] == 'circle')
    byp = collections.defaultdict(list)
    for i, e in enumerate(ents): byp[e['p1']].append(i); byp[e['p2']].append(i)
    seen = set(); tot = 0.0; n = 0
    for i in range(len(ents)):
        if i in seen: continue
        comp = []; st = [i]
        while st:
            j = st.pop()
            if j in seen: continue
            seen.add(j); comp.append(j); st += byp[ents[j]['p1']] + byp[ents[j]['p2']]
        # walk in order
        order = [comp[0]]; e0 = ents[comp[0]]; cur = e0['p2']; pts = []
        def emit(e, fwd):
            a, b = (e['p1'], e['p2']) if fwd else (e['p2'], e['p1'])
            if e['type'] == 'line': pts.append(P[a])
            else:
                c = P[e['c']]; r = math.dist(c, P[e['p1']])
                a1 = math.atan2(P[e['p1']][1]-c[1], P[e['p1']][0]-c[0]); a2 = math.atan2(P[e['p2']][1]-c[1], P[e['p2']][0]-c[0])
                while a2 < a1: a2 += 2*math.pi
                N = 20000
                seq = [(c[0]+r*math.cos(a1+(a2-a1)*k/N), c[1]+r*math.sin(a1+(a2-a1)*k/N)) for k in range(N+1)]
                pts.extend(seq[:-1] if fwd else seq[:0:-1])
        emit(e0, True); used = {comp[0]}
        while len(used) < len(comp):
            nxt = [j for j in byp[cur] if j in comp and j not in used][0]; used.add(nxt); e = ents[nxt]
            fwd = e['p1'] == cur; emit(e, fwd); cur = e['p2'] if fwd else e['p1']
        s = sum(pts[k][0]*pts[(k+1) % len(pts)][1] - pts[(k+1) % len(pts)][0]*pts[k][1] for k in range(len(pts)))/2
        tot += abs(s); n += 1
    return tot + circ, n
H, nh = loops_area(fs['F12']); S, ns = loops_area(fs['F21'])
case = 2*(O - H) + 26*(O - C) + 5*(O2 - C)
lid = 5.3*(O - O2) + 4.7*(O - C) + 2*(O - S)
print(f"vent area H={H:.6f} ({nh} loops) slot area S={S:.6f} ({ns} loops)")
print(f"case {case:.4f}  lid {lid:.4f}  total {case+lid:.4f}")

#!/usr/bin/env python3
"""Convert brepjs-vented_louvre_case.ckpart to a SolidCraft command script (same features, same order).
usage: gen_louvre.py <in.ckpart> <out.json>
Mapping: ckpart 'top' plane -> SolidCraft XY (a proper rotation of our Y-up frame); ckpart cut 'flip:true' = along +normal
(the cavity cuts only make sense that way; checked by volume against our kernel); offset planes -> sketch.create offset."""
import json, sys, collections
d = json.load(open(sys.argv[1]))
feats = d['features']
planes = {}  # id -> offset
cmds = []
extr_n = 0
bodies = 0
for f in feats:
    t = f['type']
    if t == 'plane':
        assert f['base']['id'] == 'top'
        planes[f['id']] = f['offset']
    elif t == 'sketch':
        pl = f['plane']
        off = 0 if pl['kind'] == 'std' else planes[pl['id']]
        P = {p['id']: [p['x'], p['y']] for p in f['points']}
        cmds.append({"command": "sketch.create", "params": {"plane": "XY", "offset": off, "name": f['id']}})
        ents = f['entities']
        # group consecutive line entities into closed polylines (loops by connectivity)
        lines = [e for e in ents if e['type'] == 'line']
        used = set()
        byp = collections.defaultdict(list)
        for i, e in enumerate(lines):
            byp[e['p1']].append(i); byp[e['p2']].append(i)
        arcs = [e for e in ents if e['type'] == 'arc']
        if arcs:
            # rounded outlines: emit lines and arcs individually (connect:true joins coincident ends)
            for e in ents:
                if e['type'] == 'line':
                    cmds.append({"command": "sketch.line", "params": {"points": [P[e['p1']], P[e['p2']]]}})
                elif e['type'] == 'arc':
                    cmds.append({"command": "sketch.arc.center_point", "params": {"center": P[e['c']], "start": P[e['p1']], "end": P[e['p2']]}})
                elif e['type'] == 'circle':
                    cmds.append({"command": "sketch.circle.center", "params": {"center": P[e['c']], "radius": e['r']}})
        else:
            seen = set()
            for i in range(len(lines)):
                if i in seen: continue
                # walk the loop
                loop = [i]; seen.add(i)
                cur = lines[i]['p2']; first = lines[i]['p1']
                pts = [P[first], P[cur]]
                while cur != first:
                    nxt = [j for j in byp[cur] if j not in seen][0]
                    seen.add(nxt)
                    e = lines[nxt]
                    cur = e['p2'] if e['p1'] == cur else e['p1']
                    pts.append(P[cur])
                cmds.append({"command": "sketch.line", "params": {"points": pts[:-1], "closed": True}})
            for e in ents:
                if e['type'] == 'circle':
                    cmds.append({"command": "sketch.circle.center", "params": {"center": P[e['c']], "radius": e['r']}})
        cmds.append({"command": "sketch.finish", "params": {}})
    elif t == 'extrude':
        extr_n += 1
        p = {"distance": f['depth'], "direction": "positive", "name": f['id']}
        if f['op'] == 'add':
            if bodies == 0:
                p["operation"] = "new"; p["body_name"] = "Case"; bodies = 1
            elif f['id'] == 'F16':
                p["operation"] = "new"; p["body_name"] = "Lid"
            else:
                p["operation"] = "join"
        else:
            p["operation"] = "cut"
            assert f.get('flip') is True
        cmds.append({"command": "solid.extrude", "params": p})
    else:
        raise SystemExit(f"unsupported feature {t}")
json.dump({"description": "vented louvre case (hex vents + slots + lid), converted from brepjs-vented_louvre_case.ckpart by gen_louvre.py", "commands": cmds}, open(sys.argv[2], 'w'), indent=1)
print(len(cmds), "commands")

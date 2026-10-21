#!/usr/bin/env python3
"""Generate the two SolidCraft scripts from our two .ckpart files (hand-converted geometry, values read from the parts).
usage: gen_scripts.py <fillet_issue.ckpart> <failing_fillets_lofts.ckpart> <outdir> [thicken_sign_1] [thicken_sign_2]
Frame: ours is Y-up, sketch (x,y) on 'top' = world (x, h, -y). SolidCraft is Z-up: sketch (x,y) on XY at height h = (x, y, h).
So our world point (X,Y,Z) -> SolidCraft (X, -Z, Y)  (a proper rotation, volumes and topology unchanged)."""
import json, sys, math
I = lambda p: json.load(open(p))
def sc(p): return [round(p[0], 9), round(-p[2], 9) + 0.0, round(p[1], 9)]
def cmd(c, **p): return {"command": c, "params": p}

def plate(sk, depth, name):
    # one outer rounded outline (lines+tangent arcs of our sketch == rounded rectangle) and the circles inside it
    pts = {p["id"]: (p["x"], p["y"]) for p in sk["points"]}
    xs = [v[0] for v in pts.values()]; ys = [v[1] for v in pts.values()]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    arc = [e for e in sk["entities"] if e["type"] == "arc"][0]
    r = math.dist(pts[arc["c"]], pts[arc["p1"]])
    out = [cmd("sketch.create", plane="XY", name=name),
           cmd("sketch.rectangle.rounded", p0=[x0, y0], p1=[x1, y1], radius=round(r, 9))]
    for e in sk["entities"]:
        if e["type"] == "circle":
            c = pts[e["c"]]
            out.append(cmd("sketch.circle.center", center=[round(c[0], 9), round(c[1], 9)], radius=round(e["r"], 6)))
    # the circles are holes of the outline: pick only the plate region (the ring-shaped profile) by a point inside it, otherwise
    # "all profiles" also extrudes the discs inside the circles and fills the holes
    ex = dict(distance=depth, body_name="Plate", name="PlateExtrude")
    if any(e["type"] == "circle" for e in sk["entities"]): ex["profiles"] = [{"point": [x0 + 1.0, 0]}]
    out += [cmd("sketch.finish"), cmd("solid.extrude", **ex)]
    return out, r

def disc_sketch(name, offset, r):
    return [cmd("sketch.create", plane="XY", offset=offset, name=name),
            cmd("sketch.circle.center", center=[0, 0], radius=r), cmd("sketch.finish")]

def fillet_issue(part, sign):
    F = {f["id"]: f for f in part["features"]}
    cmds, r = plate(F["F1"], F["F2"]["depth"], "Plate")
    top = F["F2"]["depth"]
    h = F["F5"]
    cmds += [cmd("sketch.create", plane="XY", offset=top, name="HolePoints")]
    for p in F["F4"]["points"]:
        if p["id"] != "O": cmds.append(cmd("sketch.point", point=[round(p["x"], 6), round(p["y"], 6)]))
    cmds += [cmd("sketch.finish"),
             cmd("solid.hole", sketch="HolePoints", clearance=h["size"], fit=h["fit"], type="counterbore",
                 cb_diameter=h["cboreDiameter"], cb_depth=h["cboreDepth"], name="Hole")]
    cmds += disc_sketch("LoftBase", top, F["F6"]["entities"][0]["r"])
    cmds += disc_sketch("LoftTop", F["F7"]["offset"], F["F8"]["entities"][0]["r"])
    cmds += [cmd("surface.loft", sections=[{"sketch": "LoftBase"}, {"sketch": "LoftTop"}], body_name="ConeSurface", name="ConeLoft"),
             cmd("surface.thicken", bodies=["ConeSurface"], thickness=sign * F["F10"]["thickness"], operation="join", targets=["Plate"], name="ConeThicken")]
    for fid in ("F11", "F12"):
        f = F[fid]; cmds.append(cmd("solid.fillet", edges=[sc(e["at"]) for e in f["edges"]], radius=f["radius"], name="Fillet " + fid))
    f = F["F13"]; cmds.append(cmd("solid.fillet", edges=[sc(e["at"]) for e in f["edges"]], radius=f["radius"], name="Fillet F13 (plate top edges)"))
    return cmds

def failing(part, sign, fillet):
    F = {f["id"]: f for f in part["features"]}
    cmds, r = plate(F["F1"], F["F2"]["depth"], "Plate")
    top = F["F2"]["depth"]
    cmds += disc_sketch("LoftTop", top + F["F5"]["offset"], F["F9"]["entities"][0]["r"])   # F9: plane 15 above the plate top
    cmds += disc_sketch("LoftBase", top, F["F10"]["entities"][0]["r"])                      # F10: on the plate top
    cmds += [cmd("surface.loft", sections=[{"sketch": "LoftTop"}, {"sketch": "LoftBase"}], body_name="ConeSurface", name="ConeLoft"),
             cmd("surface.thicken", bodies=["ConeSurface"], thickness=sign * F["F15"]["thickness"], operation="join", targets=["Plate"], name="ConeThicken")]
    if fillet:
        f = F["F19"]; cmds.append(cmd("solid.fillet", edges=[sc(e["at"]) for e in f["edges"]], radius=f["radius"], name="Fillet F19 (suppressed in our file)"))
    return cmds

if __name__ == "__main__":
    a = sys.argv[1:]
    p1, p2, out = I(a[0]), I(a[1]), a[2]
    s1 = float(a[3]) if len(a) > 3 else 1.0
    s2 = float(a[4]) if len(a) > 4 else -1.0
    import os
    skip = [x for x in os.environ.get("SKIP", "").split(",") if x]
    def w(name, cmds, desc):
        cmds = [c for c in cmds if not any(c["params"].get("name", "").startswith(k) for k in skip)]
        json.dump({"description": desc, "commands": cmds}, open(f"{out}/{name}.json", "w"), indent=1)
    w("fillet_issue", fillet_issue(p1, s1), "fillet_issue.ckpart converted; Z-up, sketch coords unchanged, our +Y is SolidCraft +Z")
    w("failing_fillets_lofts", failing(p2, s2, False), "failing_fillets_lofts.ckpart: F19 fillet is suppressed in the source file, so omitted here")
    w("failing_fillets_lofts_fillet_on", failing(p2, s2, True), "failing_fillets_lofts.ckpart with the suppressed F19 fillet switched on")

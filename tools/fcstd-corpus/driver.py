# Corpus driver. Runs under freecadcmd (headless); configured by environment variables:
#   FCC_MODE    generate | reopen
#   FCC_MODELS  directory with the model scripts (NN_name.py)
#   FCC_OUT     output directory (generate: .FCStd + .dump.json; reopen: .reopen.json)
#   FCC_NAMES   comma separated model names (file stem) to process
# One line "FCC_RESULT {json}" per model goes to stdout for the runner.
# Own code, no third-party content.
import os, sys, json, math, traceback, re, hashlib
import FreeCAD as App
import Part

FORMAT = 1
MODE = os.environ.get("FCC_MODE", "generate")
MODELS = os.environ["FCC_MODELS"]
OUT = os.environ["FCC_OUT"]
NAMES = [n for n in os.environ.get("FCC_NAMES", "").split(",") if n]
sys.path.insert(0, MODELS)

# Properties that change between runs or hold machine specific text. They are dropped from the
# dump and their names are listed under "stripped" so nothing disappears silently.
VOLATILE_DOC = {"Uid", "Id", "CreationDate", "LastModifiedDate", "FileName", "TransientDir",
                "CreatedBy", "LastModifiedBy", "Comment", "Company", "License", "LicenseURL"}
VOLATILE_OBJ = {"Uid", "_LinkOwner", "_ElementMapVersion", "_ExternalGeoVersion", "ShapeMaterial", "Proxy", "ViewObject"}
# Held in dedicated sections instead of "properties"
SECTION_OBJ = {"Shape", "InternalShape", "Geometry", "Constraints", "ExternalGeo", "cells"}
DATUMS = {"PartDesign::Plane", "PartDesign::Line", "PartDesign::Point", "PartDesign::CoordinateSystem", "Part::DatumPlane", "Part::DatumLine", "Part::DatumPoint"}
ORIGIN_FEATURES = {"App::Line", "App::Plane", "App::Point"}
stripped = set()
enum_lists = {}
prop_types = {}   # typeId -> {property: property type}
SCHEMA = {"enumLists": {}, "propertyTypes": {}}   # shared by all dumps of one run, written to schema.json


def num(x):
    x = float(x)
    if math.isnan(x):
        return "nan"
    if math.isinf(x):
        return "inf" if x > 0 else "-inf"
    return x


def vec(v):
    return [num(v.x), num(v.y), num(v.z)]


def rot(r):
    q = r.Q
    return [num(q[0]), num(q[1]), num(q[2]), num(q[3])]


def plc(p):
    return {"pos": vec(p.Base), "rot": rot(p.Rotation)}


def conv(v):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return num(v)
    if isinstance(v, App.Units.Quantity):
        t = v.Unit.Type
        return {"value": num(v.Value), "unit": t} if t else {"value": num(v.Value), "unit": "", "signature": list(v.Unit.Signature)}
    if isinstance(v, App.Vector):
        return vec(v)
    if isinstance(v, App.Placement):
        return plc(v)
    if isinstance(v, App.Rotation):
        return {"rot": rot(v)}
    if isinstance(v, App.Matrix):
        return [num(x) for x in v.A]
    if isinstance(v, App.DocumentObject):
        return v.Name
    if isinstance(v, dict):
        return {str(k): conv(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [conv(x) for x in v]
    if isinstance(v, Part.Shape):
        return None
    try:
        return str(v)
    except Exception:
        return None


def box(b):
    return {"min": [num(b.XMin), num(b.YMin), num(b.ZMin)], "max": [num(b.XMax), num(b.YMax), num(b.ZMax)]}


def shape_info(s):
    if s.isNull():
        return {"null": True}
    d = {"null": False, "shapeType": s.ShapeType}
    def g(key, fn):
        try:
            d[key] = fn()
        except Exception as e:
            d[key] = None
            d.setdefault("errors", {})[key] = str(e)[:80]
    g("valid", lambda: bool(s.isValid()))
    g("volume", lambda: num(s.Volume))
    g("area", lambda: num(s.Area))
    g("length", lambda: num(s.Length))
    def com():
        try:
            return vec(s.CenterOfMass)
        except Exception:
            sol = s.Solids  # compound of several solids: volume weighted
            tv = sum(x.Volume for x in sol)
            return vec(sum((x.CenterOfMass * x.Volume for x in sol), App.Vector()) * (1.0 / tv))
    g("centerOfMass", com)
    g("boundBox", lambda: box(s.BoundBox))
    g("solids", lambda: len(s.Solids))
    g("shells", lambda: len(s.Shells))
    g("faces", lambda: len(s.Faces))
    g("edges", lambda: len(s.Edges))
    g("vertices", lambda: len(s.Vertexes))
    g("placement", lambda: plc(s.Placement))
    return d


def geo_info(i, g, sk):
    t = type(g).__name__
    d = {"index": i, "type": t, "construction": bool(sk.getConstruction(i))}
    def a(name, fn):
        try:
            d[name] = fn()
        except Exception:
            pass
    if t == "LineSegment":
        a("start", lambda: vec(g.StartPoint)); a("end", lambda: vec(g.EndPoint))
    elif t == "Point":
        a("point", lambda: [num(g.X), num(g.Y), num(g.Z)])
    elif t in ("Circle", "ArcOfCircle"):
        a("center", lambda: vec(g.Center)); a("radius", lambda: num(g.Radius)); a("axis", lambda: vec(g.Axis))
        if t == "ArcOfCircle":
            a("firstParameter", lambda: num(g.FirstParameter)); a("lastParameter", lambda: num(g.LastParameter))
            a("start", lambda: vec(g.StartPoint)); a("end", lambda: vec(g.EndPoint))
    elif t in ("Ellipse", "ArcOfEllipse"):
        a("center", lambda: vec(g.Center)); a("majorRadius", lambda: num(g.MajorRadius)); a("minorRadius", lambda: num(g.MinorRadius))
        a("axis", lambda: vec(g.Axis)); a("majorAxisDir", lambda: vec(g.XAxis))
        if t == "ArcOfEllipse":
            a("firstParameter", lambda: num(g.FirstParameter)); a("lastParameter", lambda: num(g.LastParameter))
            a("start", lambda: vec(g.StartPoint)); a("end", lambda: vec(g.EndPoint))
    elif t in ("ArcOfHyperbola", "ArcOfParabola"):
        a("center", lambda: vec(g.Center)); a("axis", lambda: vec(g.Axis))
        if t == "ArcOfHyperbola":
            a("majorRadius", lambda: num(g.MajorRadius)); a("minorRadius", lambda: num(g.MinorRadius))
        else:
            a("focal", lambda: num(g.Focal))
        a("firstParameter", lambda: num(g.FirstParameter)); a("lastParameter", lambda: num(g.LastParameter))
        a("start", lambda: vec(g.StartPoint)); a("end", lambda: vec(g.EndPoint))
    elif t == "BSplineCurve":
        a("degree", lambda: g.Degree); a("periodic", lambda: bool(g.isPeriodic()))
        a("poles", lambda: [vec(p) for p in g.getPoles()]); a("knots", lambda: [num(k) for k in g.getKnots()])
        a("multiplicities", lambda: list(g.getMultiplicities())); a("weights", lambda: [num(w) for w in g.getWeights()])
        a("start", lambda: vec(g.StartPoint)); a("end", lambda: vec(g.EndPoint))
    return d


def sketch_info(o):
    geos = [geo_info(i, g, o) for i, g in enumerate(o.Geometry)]
    cons = []
    for i, c in enumerate(o.Constraints):
        d = {"index": i, "type": c.Type, "value": num(c.Value)}
        # keys left out when they hold the default: name "", second/third = -2000 (GeoUndef) with pos 0,
        # driving true, active true, virtualSpace false
        if c.Name:
            d["name"] = c.Name
        d["first"], d["firstPos"] = c.First, c.FirstPos
        if c.Second != -2000 or c.SecondPos:
            d["second"], d["secondPos"] = c.Second, c.SecondPos
        if c.Third != -2000 or c.ThirdPos:
            d["third"], d["thirdPos"] = c.Third, c.ThirdPos
        if not c.Driving:
            d["driving"] = False
        if not c.IsActive:
            d["active"] = False
        if c.InVirtualSpace:
            d["virtualSpace"] = True
        cons.append(d)
    ext = []
    try:
        ext = conv(list(o.ExternalGeometry))
    except Exception:
        pass
    s = {"geometry": geos, "constraints": cons, "externalGeometry": ext, "fullyConstrained": bool(o.FullyConstrained)}
    try:
        s["solve"] = o.solve()
        s["dof"] = o.DoF
        s["conflicting"] = list(o.ConflictingConstraints)
        s["redundant"] = list(o.RedundantConstraints)
        s["partiallyRedundant"] = list(o.PartiallyRedundantConstraints)
        s["malformed"] = list(o.MalformedConstraints)
    except Exception as e:
        s["solverError"] = str(e)[:100]
    return s


def sheet_info(o):
    cells = []
    for addr in sorted(o.getNonEmptyCells(), key=lambda a: (int(re.sub(r"\D", "", a)), a)):
        c = {"address": addr, "content": o.getContents(addr), "alias": o.getAlias(addr)}
        try:
            c["value"] = conv(o.get(addr))
        except Exception as e:
            c["value"] = None
            c["error"] = str(e)[:80]
        cells.append(c)
    return {"cells": cells}


def prop_value(o, name):
    t = o.getTypeIdOfProperty(name)
    v = getattr(o, name)
    if t == "App::PropertyEnumeration":
        items = list(o.getEnumerationsOfProperty(name))
        s = str(v)
        key = "e" + hashlib.sha1(json.dumps(items).encode()).hexdigest()[:8]
        enum_lists[key] = items
        return {"enum": s, "index": items.index(s) if s in items else None, "items": key}
    if t == "App::PropertyExpressionEngine":
        return [[p, e] for p, e in v]
    return conv(v)


def obj_info(o, doc):
    d = {"name": o.Name, "label": o.Label, "typeId": o.TypeId}
    d["status"] = o.getStatusString()
    props = {}
    for n in o.PropertiesList:
        if n in SECTION_OBJ:
            continue
        if o.TypeId in ORIGIN_FEATURES and n not in ("Label", "Role", "Placement"):
            continue   # origin axes/planes/point: reduced to label, role and placement (keeps the dumps small)
        if n in VOLATILE_OBJ or o.getTypeIdOfProperty(n) == "Part::PropertyShapeCache":
            stripped.add(n)   # runtime caches and material objects: not part of the model
            continue
        t = o.getTypeIdOfProperty(n)
        prop_types.setdefault(o.TypeId, {})[n] = t
        try:
            v = prop_value(o, n)
        except Exception as e:
            v = {"error": str(e)[:80]}
        if n == "ExpressionEngine" and not v:
            continue   # the "expressions" section lists bound expressions; an empty engine is omitted
        if n == "Label2" and v == "":
            continue
        props[n] = v
    d["properties"] = props
    d["outList"] = sorted(x.Name for x in o.OutList)   # sorted: FreeCAD's order differs after a reload
    pg = None
    try:
        p = o.getParentGeoFeatureGroup()
        pg = p.Name if p else None
    except Exception:
        pass
    d["parentGeoGroup"] = pg
    try:
        ex = []
        for path, e in o.ExpressionEngine:
            try:
                val = conv(o.evalExpression(e))
            except Exception as err:
                val = {"error": str(err)[:80]}
            ex.append({"path": path, "expression": e, "value": val})
        d["expressions"] = ex
    except Exception:
        d["expressions"] = []
    try:
        gp = plc(o.getGlobalPlacement())
        local = props.get("Placement")
        def same(a, b):
            return all(abs(x - y) < 1e-9 for x, y in zip(a["pos"] + a["rot"], b["pos"] + b["rot"]))
        if local is None or not same(local, gp):   # only listed when it differs from the Placement property (or there is none)
            d["globalPlacement"] = gp
    except Exception:
        pass
    # App::Plane/Line/Point of the Origin are infinite: their Shape has no meaningful measures
    if o.TypeId in DATUMS:
        d["shape"] = {"null": False, "datum": True, "note": "infinite or unit-less datum shape, measures not meaningful", "placement": plc(o.Placement)}
    elif not o.TypeId.startswith("App::") and hasattr(o, "Shape") and isinstance(getattr(o, "Shape", None), Part.Shape):
        d["shape"] = shape_info(o.Shape)
        extra = {}
        for n in o.PropertiesList:
            if n != "Shape" and n != "InternalShape" and o.getTypeIdOfProperty(n) == "Part::PropertyPartShape":
                sh = getattr(o, n)
                if not sh.isNull():
                    extra[n] = shape_info(sh)
        if extra:
            d["extraShapes"] = extra
    if o.TypeId == "Sketcher::SketchObject":
        d["sketch"] = sketch_info(o)
    if o.TypeId == "Spreadsheet::Sheet":
        d["sheet"] = sheet_info(o)
    return d


def doc_dump(doc, name, variant=None):
    stripped.clear()
    enum_lists.clear()
    prop_types.clear()
    v = App.Version()
    out = {"format": FORMAT, "model": name, "variant": variant,
           "freecad": {"version": ".".join(v[0:3]), "build": v[3], "revision": v[7], "raw": list(v)}}
    dp = {}
    for n in doc.PropertiesList:
        if n in VOLATILE_DOC:
            stripped.add(n)
            continue
        prop_types.setdefault("App::Document", {})[n] = doc.getTypeIdOfProperty(n)
        try:
            dp[n] = prop_value(doc, n)
        except Exception as e:
            dp[n] = {"error": str(e)[:80]}
    out["document"] = {"label": doc.Label, "properties": dp}
    objs = [obj_info(o, doc) for o in doc.Objects]
    out["objects"] = objs
    bodies, parts, links = [], [], []
    for o in doc.Objects:
        if o.TypeId == "PartDesign::Body":
            chain, f = [], o.Tip
            while f is not None:
                chain.append(f.Name)
                f = getattr(f, "BaseFeature", None)
            bodies.append({"name": o.Name, "group": [x.Name for x in o.Group], "tip": o.Tip.Name if o.Tip else None,
                           "tipChain": chain, "placement": plc(o.Placement)})
        elif o.TypeId in ("App::Part", "App::DocumentObjectGroup", "Part::Compound"):
            parts.append({"name": o.Name, "typeId": o.TypeId, "group": [x.Name for x in getattr(o, "Group", [])],
                          "placement": plc(o.Placement) if hasattr(o, "Placement") else None})
        elif o.TypeId in ("App::Link", "App::LinkElement", "App::LinkGroup"):
            l = {"name": o.Name, "typeId": o.TypeId,
                 "linkedObject": o.LinkedObject.Name if getattr(o, "LinkedObject", None) else None,
                 "placement": plc(o.Placement) if hasattr(o, "Placement") else None}
            for k in ("Scale", "ScaleVector", "ElementCount", "LinkTransform", "ShowElement"):
                if hasattr(o, k):
                    l[k[0].lower() + k[1:]] = conv(getattr(o, k))
            try:
                l["globalPlacement"] = plc(o.getGlobalPlacement())
            except Exception:
                pass
            links.append(l)
    out["bodies"], out["parts"], out["links"] = bodies, parts, links
    out["stripped"] = sorted(stripped)
    SCHEMA["enumLists"].update(enum_lists)
    for k, v in prop_types.items():
        SCHEMA["propertyTypes"].setdefault(k, {}).update(v)
    return out


def write_json(path, data):
    # compact JSON, one top-level key per line and one object per line (keeps diffs readable and the files small)
    enc = lambda x: json.dumps(x, separators=(",", ":"), ensure_ascii=False)
    with open(path, "w") as f:
        f.write("{\n")
        keys = list(data.keys())
        for i, k in enumerate(keys):
            sep = "," if i < len(keys) - 1 else ""
            if k == "objects":
                f.write('"objects":[\n' + ",\n".join(enc(o) for o in data[k]) + "\n]" + sep + "\n")
            else:
                f.write(enc(k) + ":" + enc(data[k]) + sep + "\n")
        f.write("}\n")


def problems(doc):
    bad = []
    for o in doc.Objects:
        s = o.getStatusString()
        if s != "Valid":
            bad.append("%s: %s" % (o.Name, s))
        elif o.TypeId == "Sketcher::SketchObject" and (o.ConflictingConstraints or o.RedundantConstraints or o.MalformedConstraints):
            bad.append("%s: sketch conflicts %s redundant %s" % (o.Name, list(o.ConflictingConstraints), list(o.RedundantConstraints)))
        elif hasattr(o, "Shape") and isinstance(o.Shape, Part.Shape) and not o.Shape.isNull() and not o.Shape.isValid():
            bad.append("%s: shape not valid" % o.Name)
    return bad


def set_compression():
    try:
        pg = App.ParamGet("User parameter:BaseApp/Preferences/Document")
        pg.SetInt("CompressionLevel", 9)
        pg.SetBool("CreateBackupFiles", False)
    except Exception:
        pass


def generate(name):
    set_compression()
    path = os.path.join(MODELS, name + ".py")
    ns = {"__name__": "corpus_model_" + name, "__file__": path}
    exec(compile(open(path).read(), path, "exec"), ns)
    doc = App.newDocument(name)
    doc.Label = name
    doc.UnitSystem = doc.getEnumerationsOfProperty("UnitSystem")[0]  # Standard (mm, kg, s, deg)
    ns["build"](doc)
    doc.recompute()
    res = {"model": name, "ok": True, "variant": None}
    bad = problems(doc)
    allowed = ns.get("EXPECT_ERRORS", False)
    if bad and not allowed:
        res["ok"] = False
        res["error"] = "; ".join(bad)[:400]
    base = os.path.join(OUT, name)
    doc.saveAs(base + ".FCStd")
    write_json(base + ".dump.json", doc_dump(doc, name))
    res["objects"] = len(doc.Objects)
    if "variant" in ns:
        desc = ns["variant"](doc)
        doc.recompute()
        vb = problems(doc)
        doc.saveAs(base + ".v1.FCStd")
        write_json(base + ".v1.dump.json", doc_dump(doc, name, desc or "variant"))
        res["variant"] = {"ok": not vb or allowed, "description": desc, "error": "; ".join(vb)[:300] if vb else None}
    App.closeDocument(doc.Name)
    return res


def reopen(name):
    res = {"model": name, "ok": True}
    for suffix in ("", ".v1"):
        p = os.path.join(OUT, name + suffix + ".FCStd")
        if not os.path.exists(p):
            continue
        doc = App.openDocument(p)
        write_json(os.path.join(OUT, "_reopen", name + suffix + ".dump.json"), doc_dump(doc, name, None if not suffix else _variant_desc(name)))
        App.closeDocument(doc.Name)
    return res


def _variant_desc(name):
    try:
        return json.load(open(os.path.join(OUT, name + ".v1.dump.json")))["variant"]
    except Exception:
        return None


def write_schema():
    path = os.path.join(OUT, "schema.part.%d.json" % os.getpid())
    with open(path, "w") as f:
        json.dump(SCHEMA, f, sort_keys=True)


for name in NAMES:
    try:
        r = generate(name) if MODE == "generate" else reopen(name)
    except Exception:
        r = {"model": name, "ok": False, "error": traceback.format_exc()[-600:]}
        for d in list(App.listDocuments().values()):
            try:
                App.closeDocument(d.Name)
            except Exception:
                pass
    print("FCC_RESULT " + json.dumps(r), flush=True)
if MODE == "generate":
    write_schema()

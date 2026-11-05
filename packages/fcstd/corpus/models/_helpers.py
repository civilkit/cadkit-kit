"""Helpers shared by the corpus models. Own code (FreeCAD Python API only)."""
import math
import FreeCAD as App
import Part
import Sketcher

V = App.Vector
DEG = math.pi / 180.0
PLANES = {"XY": "XY_Plane", "XZ": "XZ_Plane", "YZ": "YZ_Plane"}


def body(doc, name="Body"):
    return doc.addObject("PartDesign::Body", name)


def origin_plane(bd, which="XY"):
    role = PLANES[which]
    for f in bd.Origin.OriginFeatures:
        if f.Role == role:
            return f
    raise KeyError(role)


def origin_axis(bd, which="X"):
    role = which + "_Axis"
    for f in bd.Origin.OriginFeatures:
        if f.Role == role:
            return f
    raise KeyError(role)


def sketch(doc, bd, name, plane="XY", offset=None):
    """Sketch in a Body, attached FlatFace to an origin plane (or any object/face given as `plane`)."""
    sk = bd.newObject("Sketcher::SketchObject", name)
    sk.AttacherEngine = "Engine Plane"  # what is stored in the file; keeps the live state equal to the reopened state
    attach(sk, origin_plane(bd, plane) if isinstance(plane, str) else plane)
    if offset is not None:
        sk.AttachmentOffset = offset
    return sk


ENGINES = {"PartDesign::Plane": "Engine Plane", "PartDesign::Line": "Engine Line", "PartDesign::Point": "Engine Point",
           "Sketcher::SketchObject": "Engine Plane", "PartDesign::CoordinateSystem": "Engine 3D"}


def attach(sk, support, sub="", mode="FlatFace"):
    if sk.TypeId in ENGINES:
        sk.AttacherEngine = ENGINES[sk.TypeId]  # the value FreeCAD stores; keeps live and reopened state equal
    sk.AttachmentSupport = [(support, sub)]
    sk.MapMode = mode


def rect(sk, x0, y0, x1, y1, dims=True):
    """Closed rectangle, constrained (coincident, horizontal, vertical, optional width/height)."""
    i = sk.GeometryCount
    pts = [V(x0, y0, 0), V(x1, y0, 0), V(x1, y1, 0), V(x0, y1, 0)]
    for k in range(4):
        sk.addGeometry(Part.LineSegment(pts[k], pts[(k + 1) % 4]), False)
    for k in range(4):
        sk.addConstraint(Sketcher.Constraint("Coincident", i + k, 2, i + (k + 1) % 4, 1))
    sk.addConstraint(Sketcher.Constraint("Horizontal", i))
    sk.addConstraint(Sketcher.Constraint("Horizontal", i + 2))
    sk.addConstraint(Sketcher.Constraint("Vertical", i + 1))
    sk.addConstraint(Sketcher.Constraint("Vertical", i + 3))
    if dims:
        sk.addConstraint(Sketcher.Constraint("DistanceX", i, 1, i, 2, x1 - x0))
        sk.addConstraint(Sketcher.Constraint("DistanceY", i + 1, 1, i + 1, 2, y1 - y0))
    return i


def rect_origin(sk, w, h, name_w="Width", name_h="Height"):
    """Rectangle with corner on the origin, named dimensions Width/Height and the corner fixed."""
    i = rect(sk, 0, 0, w, h, dims=False)
    sk.addConstraint(Sketcher.Constraint("Coincident", i, 1, -1, 1))
    c = sk.addConstraint(Sketcher.Constraint("DistanceX", i, 1, i, 2, w))
    sk.renameConstraint(c, name_w)
    c = sk.addConstraint(Sketcher.Constraint("DistanceY", i + 1, 1, i + 1, 2, h))
    sk.renameConstraint(c, name_h)
    return i


def circle(sk, cx, cy, r, name=None, at_origin=False):
    i = sk.addGeometry(Part.Circle(V(cx, cy, 0), V(0, 0, 1), r), False)
    if at_origin:
        sk.addConstraint(Sketcher.Constraint("Coincident", i, 3, -1, 1))
    c = sk.addConstraint(Sketcher.Constraint("Radius", i, r))
    if name:
        sk.renameConstraint(c, name)
    return i


def polygon(sk, pts, close=True):
    n = len(pts)
    i = sk.GeometryCount
    m = n if close else n - 1
    for k in range(m):
        sk.addGeometry(Part.LineSegment(V(pts[k][0], pts[k][1], 0), V(pts[(k + 1) % n][0], pts[(k + 1) % n][1], 0)), False)
    for k in range(m - 1):
        sk.addConstraint(Sketcher.Constraint("Coincident", i + k, 2, i + k + 1, 1))
    if close:
        sk.addConstraint(Sketcher.Constraint("Coincident", i + m - 1, 2, i, 1))
    return i


def named(sk, constraint, name):
    c = sk.addConstraint(constraint)
    sk.renameConstraint(c, name)
    return c


def feat(bd, typ, name, **props):
    f = bd.newObject(typ, name)
    for k, v in props.items():
        setattr(f, k, v)
    return f


def pad_box(doc, bd, w=20, h=30, l=10, plane="XY", name="Pad"):
    """Quick base solid: rectangle w x h from the origin, padded l."""
    sk = sketch(doc, bd, name + "Sketch", plane)
    rect_origin(sk, w, h)
    return feat(bd, "PartDesign::Pad", name, Profile=sk, Length=l)


def find_face(feature, normal, offset, tol=1e-6):
    """Name ('FaceN') of the planar face of feature.Shape with the given normal whose plane is at `offset` along it."""
    n = normal.normalize() if hasattr(normal, "normalize") else normal
    n = V(normal.x, normal.y, normal.z)
    n.normalize()
    for i, f in enumerate(feature.Shape.Faces):
        try:
            fn = f.normalAt(0, 0)
        except Exception:
            continue
        if fn.getAngle(n) < 1e-6 and abs(f.CenterOfMass.dot(n) - offset) < tol and f.Surface.__class__.__name__ == "Plane":
            return "Face%d" % (i + 1)
    raise KeyError("no face with normal %s at %s" % (normal, offset))


def find_edge(feature, p0, p1, tol=1e-6):
    """Name ('EdgeN') of the straight edge of feature.Shape between points p0 and p1 (either direction)."""
    for i, e in enumerate(feature.Shape.Edges):
        a, b = e.Vertexes[0].Point, e.Vertexes[-1].Point
        if (a.distanceToPoint(p0) < tol and b.distanceToPoint(p1) < tol) or (a.distanceToPoint(p1) < tol and b.distanceToPoint(p0) < tol):
            return "Edge%d" % (i + 1)
    raise KeyError("no edge")


def edges_where(feature, pred):
    return ["Edge%d" % (i + 1) for i, e in enumerate(feature.Shape.Edges) if pred(e)]

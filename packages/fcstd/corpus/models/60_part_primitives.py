# Part workbench primitives (no Body): Box, Cylinder, Sphere, Cone, Torus, Wedge, Prism, Ellipsoid, Plane, Helix, Line, Circle.
#  Box 10x20x30 = 6000; Cylinder R5 H10 = 785.398; Sphere R6 = 904.779; Cone R1 10 R2 5 H10 = 1832.596; Torus 10/3 = 1776.529;
#  Wedge value from FreeCAD; Prism hexagon circumradius 6 H10 = 935.307; Ellipsoid = 4/3 pi 3 4 5 = 251.327 (FreeCAD's number differs a little).
from _helpers import *

def pl(x):
    return App.Placement(V(x, 0, 0), App.Rotation(V(0, 0, 1), 15))

def build(doc):
    n = 0
    def add(typ, name, **kw):
        nonlocal n
        o = doc.addObject(typ, name)
        for k, v in kw.items():
            setattr(o, k, v)
        o.Placement = pl(40 * n)
        n += 1
        return o
    add("Part::Box", "Box", Length=10, Width=20, Height=30)
    add("Part::Cylinder", "Cylinder", Radius=5, Height=10)
    add("Part::Cylinder", "CylinderPart", Radius=5, Height=10, Angle=120)
    add("Part::Sphere", "Sphere", Radius=6)
    add("Part::Cone", "Cone", Radius1=10, Radius2=5, Height=10)
    add("Part::Torus", "Torus", Radius1=10, Radius2=3)
    add("Part::Wedge", "Wedge", Xmin=0, Xmax=10, Ymin=0, Ymax=10, Zmin=0, Zmax=10, X2min=2, X2max=8, Z2min=2, Z2max=8)
    add("Part::Prism", "Prism", Polygon=6, Circumradius=6, Height=10)
    add("Part::Ellipsoid", "Ellipsoid", Radius1=3, Radius2=4, Radius3=5)
    add("Part::Plane", "Plane", Length=10, Width=20)
    add("Part::Helix", "Helix", Pitch=5, Height=20, Radius=4)
    add("Part::Circle", "Circle", Radius=7)

def variant(doc):
    doc.Box.Length = 25
    doc.Cylinder.Radius = 8
    doc.CylinderPart.Angle = 270
    return "Box.Length 10 -> 25 (15000); Cylinder.Radius 5 -> 8; CylinderPart.Angle 120 -> 270"

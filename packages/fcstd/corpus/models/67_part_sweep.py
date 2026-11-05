# Part::Sweep of a circle R3 (XY plane) along a spine: straight line of 30 along Z (848.230), quarter arc radius 20
# in the XZ plane (Pappus 888.264, Frenet True and False), and a helix spine (Frenet).
from _helpers import *

def build(doc):
    prof = doc.addObject("Sketcher::SketchObject", "Profile")
    prof.AttacherEngine = "Engine Plane"
    circle(prof, 0, 0, 3, "R", at_origin=True)
    line = doc.addObject("Sketcher::SketchObject", "SpineLine")
    line.AttacherEngine = "Engine Plane"
    line.MapMode = "Deactivated"
    line.Placement = App.Placement(V(0, 0, 0), App.Rotation(V(1, 0, 0), 90))
    line.addGeometry(Part.LineSegment(V(0, 0, 0), V(0, 30, 0)), False)
    arc = doc.addObject("Sketcher::SketchObject", "SpineArc")
    arc.AttacherEngine = "Engine Plane"
    arc.Placement = App.Placement(V(0, 0, 0), App.Rotation(V(1, 0, 0), 90))
    arc.addGeometry(Part.ArcOfCircle(Part.Circle(V(20, 0, 0), V(0, 0, 1), 20), math.pi / 2, math.pi), False)
    hx = doc.addObject("Part::Helix", "SpineHelix")
    hx.Pitch, hx.Height, hx.Radius = 10, 20, 8
    hprof = doc.addObject("Sketcher::SketchObject", "HelixProfile")
    hprof.AttacherEngine = "Engine Plane"
    hprof.Placement = App.Placement(V(8, 0, 0), App.Rotation(V(1, 0, 0), 90))
    circle(hprof, 0, 0, 1.5, "R", at_origin=True)
    doc.recompute()
    def sw(name, p, spine, frenet=False):
        s = doc.addObject("Part::Sweep", name)
        s.Sections = [p]
        s.Spine = (spine, ["Edge1"])
        s.Solid = True
        s.Frenet = frenet
        return s
    sw("SweepLine", prof, line)
    sw("SweepArc", prof, arc)
    sw("SweepArcFrenet", prof, arc, True)
    sw("SweepHelix", hprof, hx, True)

def variant(doc):
    doc.Profile.setDatum("R", App.Units.Quantity("4 mm"))
    return "Profile R 3 -> 4 (SweepLine 1507.96, SweepArc 1579.14)"

# Part boolean objects on a 20 x 20 x 20 box and a cylinder R6 x 30 at (10,10,-5): Cut, Fuse, Common, MultiFuse, MultiCommon, Section.
#  Cut: 8000 - pi*36*20 = 5738.053; Fuse: 8000 + pi*36*10 = 9130.973 (cylinder sticks out 5 below and 5 above: +10 of length);
#  Common: 2261.947. MultiFuse of box + two cylinders (second at x=3: partially overlapping).
from _helpers import *

def build(doc):
    bx = doc.addObject("Part::Box", "Box")
    bx.Length = bx.Width = bx.Height = 20
    cy = doc.addObject("Part::Cylinder", "Cyl")
    cy.Radius, cy.Height = 6, 30
    cy.Placement = App.Placement(V(10, 10, -5), App.Rotation())
    cy2 = doc.addObject("Part::Cylinder", "Cyl2")
    cy2.Radius, cy2.Height = 3, 30
    cy2.Placement = App.Placement(V(16, 10, -5), App.Rotation())
    c = doc.addObject("Part::Cut", "Cut"); c.Base, c.Tool = bx, cy
    f = doc.addObject("Part::Fuse", "Fuse"); f.Base, f.Tool = bx, cy
    m = doc.addObject("Part::Common", "Common"); m.Base, m.Tool = bx, cy
    mf = doc.addObject("Part::MultiFuse", "MultiFuse"); mf.Shapes = [bx, cy, cy2]
    mc = doc.addObject("Part::MultiCommon", "MultiCommon"); mc.Shapes = [bx, cy, cy2]
    s = doc.addObject("Part::Section", "Section"); s.Base, s.Tool = bx, cy

def variant(doc):
    doc.Cyl.Radius = 8
    doc.Box.Height = 30
    return "Cyl.Radius 6 -> 8, Box.Height 20 -> 30"

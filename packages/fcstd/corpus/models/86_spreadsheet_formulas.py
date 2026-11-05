# Spreadsheet content kinds: plain numbers, quantities, text, formulas, functions (sum, max, sin, if), aliases,
# cross-sheet references and a formula using another alias. Sheet "Data" and sheet "Derived" (reads Data).
# Cells (Data): A1 'a' B1 3; A2 'len' B2 =B1 * 10 mm (30 mm); B3 20 mm; B4 =sum(B2:B3) (50 mm); B5 =max(B2; B3);
# B6 =sin(30 deg) (0.5); B7 =B1 > 2 ? 1 : 0; B8 'text'. Derived: B1 =Data.B4 / 2 (25 mm), B2 =Data.len + 5 mm (35 mm).
from _helpers import *

def build(doc):
    d = doc.addObject("Spreadsheet::Sheet", "Data")
    d.set("A1", "a"); d.set("B1", "3"); d.setAlias("B1", "a")
    d.set("A2", "len"); d.set("B2", "=a * 10 mm"); d.setAlias("B2", "len")
    d.set("A3", "w"); d.set("B3", "20 mm"); d.setAlias("B3", "w")
    d.set("A4", "total"); d.set("B4", "=sum(B2:B3)"); d.setAlias("B4", "total")
    d.set("B5", "=max(B2; B3)")
    d.set("B6", "=sin(30 deg)")
    d.set("B7", "=a > 2 ? 1 : 0")
    d.set("B8", "text")
    doc.recompute()
    r = doc.addObject("Spreadsheet::Sheet", "Derived")
    r.set("B1", "=Data.total / 2"); r.setAlias("B1", "half")
    r.set("B2", "=Data.len + 5 mm"); r.setAlias("B2", "plus")
    doc.recompute()
    bx = doc.addObject("Part::Box", "Box")
    bx.setExpression("Length", "Derived.half")
    bx.setExpression("Width", "Derived.plus")
    bx.setExpression("Height", "Data.w / 4")

def variant(doc):
    doc.Data.set("B1", "5")
    doc.Data.set("B3", "30 mm")
    return "a 3 -> 5, w 20 -> 30 mm: total 80 mm, Box 40 x 55 x 7.5"

# Notice

The model scripts in `models/` (and `models/_helpers.py`), the driver, runner and comparison tools in `tools/fcstd-corpus/` are our own
code, written from knowledge of FreeCAD's public Python API. They contain no code, documents, example files or data taken from FreeCAD,
from MitCad or from any other third-party project. The numbers in their headers were derived analytically (or are marked as
"value from FreeCAD" when no closed form exists).

The `.FCStd` files in `generated/` were produced by running those scripts in the headless FreeCAD command-line program (`freecadcmd`).
FreeCAD is LGPL-2.1-or-later software; it is used here only as a tool and none of it is distributed in this repository. The files
contain only what our scripts created (the objects, properties and BRep shapes of our own models, in FreeCAD's file format); they
contain no model data authored by the FreeCAD project. The `.dump.json` files and `schema.json` are our own measurements of those
documents (property names, enumeration lists and numbers read back from FreeCAD).

Versions used to produce the committed files (exact `App.Version()`):

- FreeCAD 1.1.4, build 20260928 (Git shallow), revision 4fd3bf320d9566a27e60069fc8387448aaa3a094, macOS arm64 (the committed corpus).
- FreeCAD 1.1.3 was used for the comparison in `VERSION-DIFFS.md` only; its output is not committed.

Nothing was downloaded or installed for this work.

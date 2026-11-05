## What FreeCAD refused, and what is not covered

Things FreeCAD 1.1.4 rejected while the models were written (each was changed so that the model builds; the message is FreeCAD's):

| attempt | FreeCAD's answer | what the model does instead |
|---|---|---|
| Pad `ReferenceAxis` = sketch V_Axis (an axis in the sketch plane) | `Creation failed because direction is orthogonal to sketch's normal vector` | a tilted PartDesign datum line (23_pad_custom_direction) |
| Tapered Hole with `DepthType=ThroughAll` | `Hole error: Could not revolve sketch` | taper with a finite depth (46_hole_tapered) |
| Tapered Hole of 70 deg at depth 10 (cone closes before the depth) | same message | 76 deg in the variant |
| two redundant sketch constraints (Horizontal between arc centres that the tangent chain already fixes) | solver reports the redundant constraint, `setDatum` refuses (`Datum ... is invalid`) | the redundant constraint was removed; the driver treats conflicting/redundant constraints as a model failure |
| the same tool Body in the `Group` of three `PartDesign::Boolean` | `Object can only be in a single GeoFeatureGroup` | one tool Body per Boolean (57_boolean_feature) |
| expression `Vars.W`, `.H`, `.N`, `.A` on a VarSet | `Failed to parse expression` (single letters are unit names: W, H, N, A) | property names Wd, Ht, Cnt, Ang (81_varset_params) |
| spreadsheet aliases `h`, `t`, `d`, `ch`, `cd` | `Invalid alias` (unit names or cell-like names) | `plate_h`, `hole_d`, ... (88_config_table) |
| a Body feature referring to its own Body in an expression | `cyclic reference` | the custom properties live on an `App::DocumentObjectGroup` (82_custom_property_refs) |
| datum plane/line attached to `Vertex2` of a pad whose length was changed in the variant | `AttachEngine3D: subshape not found` (the element name is not stable after the change: FreeCAD 1.1's own topological naming) | the datum variant only changes offsets (59_datum_features) |
| Hole thread size index 0 right after setting `ThreadType=ISOTyre` | the saved file reloads as index 2 (FreeCAD quirk, live value and stored value disagree) | index 1 is used (44_hole_thread_tyre) |

Not in the corpus, with the reason:

- Variable radius fillet in PartDesign: `PartDesign::Fillet` has a single `Radius`; variable radii exist only in `Part::Fillet` (64_part_fillet_chamfer).
- Revolution / Groove `Type` up to first / last / face: the properties exist but FreeCAD 1.1 does not compute them (not attempted).
- Thumbnails and `GuiDocument.xml` (visibility, colours): FreeCAD writes them only in GUI mode; the corpus is headless by design, so visibility and colours are not part of the oracle.
- Draft / Python feature objects, Assembly joints, CAM, FEM, TechDraw, Mesh and Surface workbenches: out of scope for the importer for now.
- Sketch geometry edited by the GUI only (internal alignment constraints of ellipses and B-splines are added by the GUI, not by the Python API; the Python-built conics and splines have free degrees of freedom, recorded as `dof`).

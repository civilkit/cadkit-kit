# File formats at a glance

This chapter lists every file type the app reads and writes, what each carries and what is lost, and then describes the part file itself.

## What the app opens

All lengths are millimetres inside the app. Formats that carry other units are converted on the way in.

| Format | Extension | How to open | You get | What is lost |
|---|---|---|---|---|
| CadKit part | `.ckpart`, `.json`, `.ckpart.gz` | Open, drop | The full editable part | Nothing |
| STEP | `.step`, `.stp` | Open, drop, More file actions | A view-only solid | The history; colours, names, assembly structure |
| SolidWorks part | `.sldprt` | Open, drop, More file actions | An editable imported body (view-only if it cannot be built) | The feature tree, sketches, configurations, annotations |
| SketchUp | `.skp` | Open, drop, More file actions | A view-only surface model, with its colours | Scenes, text, dimensions, curves as true arcs |
| FreeCAD | `.FCStd` | Open, drop | An editable part for the features that map | Features that do not map; the rest of the document |
| SolidCraft | `.solidcraft` | Open, drop | An editable part for the features that map | Features that do not map are kept as suppressed placeholders |
| DXF | `.dxf` | Home > Sketch group, or drop | Sketch geometry (lines, arcs, circles, splines, points) | Text, hatches, dimensions, blocks, 3D entities |

STL and OBJ cannot be imported yet, and neither can DWG. "View only" means you can look at the body and turn the model, but it is not a feature, it is not saved with the part and the next edit replaces it. [Importing](import.md) has the details and limits of each.

## What the app writes

| Format | Extension | Where | Carries | What is lost |
|---|---|---|---|---|
| CadKit part | `.ckpart`, `.ckpart.gz` | Save, Save as | The recipe and the app's own data | Nothing |
| STEP | `.step` | Export | The exact solid | Colours, history |
| STL (binary or ASCII) | `.stl` | Export | A triangle mesh | The exact surfaces, colours, history |
| OBJ | `.obj` | Export | A triangle mesh | The exact surfaces, colours, history |
| DXF, sketch | `.dxf` | Export | One sketch as R12 2D geometry | Constraints, dimensions |
| DXF, three views | `.dxf` | Export | Front, top and right views of the edges | Hidden lines, dimensions |
| Drawing | `.pdf`, `.svg`, `.dxf` | Drawing view | The sheet as drawn | The link to the part |
| Bill of materials | `.csv` | Assembly > Bill of materials | The table | Nothing |

[Exporting](export.md) describes each one and its options.

## The part file

A part file is one JSON document in a text file, and is what **Save** writes. You can open it in any text editor, keep it in version control and diff it. Its main parts are:

| Field | Meaning |
|---|---|
| `format` and `version` | Tell the reader what it is looking at. The format string is `ck-part`. |
| `name` | The part name shown in the top bar. |
| `features` | The ordered list of features: sketches, planes, extrudes, fillets and so on, with all their settings. The kernel replays them from first to last to build the model. |
| `variables` | The equations and variables of the part. |
| `material` | The name of the material, such as "Aluminium 6061". Density and colour are looked up by name. |

The file does not store the model's faces. It stores how to rebuild them, which is why parametric edits work after you reopen a file, and why a file of a few kilobytes can describe a detailed part. For the complete field list, the feature types and how references to faces stay stable, see the kernel book chapter [Overview of the part format](/docs/cad/kernel/format/overview.html).

Other data the app keeps in the same file when you use it:

- A **preview picture** (a small PNG of the part in the isometric view), used for the recent list. It is refreshed when you save and is never read as part of the model.
- The **stored view** if you chose Save geometry in file (see [Saving and opening](files.md)). It is a cache; removing it is always safe. The MCP `export` tool can also write it (`cache: true`), and the app tells you when it ignores one that does not match the file or this build.
- **Drawings**, the **exploded view** of an assembly, the **colours, opacity and finish of bodies** and body names, an embedded **script** and the **fonts** used by text.
- Configurations and variables that you defined.

Fields that the app does not know are left alone and written back, so a file edited elsewhere does not lose data.

### Files from earlier versions

Files saved by earlier versions of the app still open. They are converted to the current format when read, and the next save writes the current format. A file that was made by a newer version still opens, with a notice that some features may be missing or wrong. See [Versions and earlier files](/docs/cad/kernel/format/versions.html) in the kernel book.

### Compressed and plain

`.ckpart.gz` is the same file compressed with gzip. The app reads it without any extra step. A program that wants the text must decompress it first.

### Units

A part has no unit setting. Everything is millimetres, in the file and in the interface, and this is also what Measure, Mass properties and the exports use.

## Where the model comes from

The kernel does the geometry. Its own book covers the part format, the checks that decide whether a model is valid, and the import and export readers at a deeper level than this guide: start at [the kernel book](/docs/cad/kernel/format/overview.html), and see [Validation](/docs/cad/kernel/validation/overview.html) for what makes a solid valid.

## Next

- [Saving and opening](files.md)
- [Importing](import.md)
- [Exporting](export.md)
- [Limits and known gaps](../reference/limits.md)

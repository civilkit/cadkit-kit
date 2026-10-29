# Troubleshooting

This chapter is a task list of common problems with their causes and fixes. The messages quoted here are the ones the app shows.

## A feature failed

A failed feature shows in red in the feature tree, and the status bar counts the errors. The app sorts the failures into a **cause** and its **consequences**. One broken feature usually breaks everything built on it, so fix the cause first.

1. Read the summary: "The edit broke the model at *feature*: *reason*." It adds how many later features could not be built because of it.
2. Under **What to try** the app gives advice for the cause.
3. Choose **Undo this change** to go back, or **Cancel edit** if you are still in the feature's editor. **Select** with a feature id selects that feature.
4. **Show consequences** lists the later failures marked "blocked by *id*". They should clear once the cause is fixed.

If an edit would break the model, it is not applied: "This edit was not applied; your model is unchanged."

| Reason shown | What it means and what to do |
| --- | --- |
| it removes nothing / it cuts nothing | The cut no longer touches the body. Move the profile so it overlaps the body, or flip the cut direction. |
| a face or edge it uses no longer exists | The feature was built on a face or edge that is gone. Pick it again, or undo the change that removed it. |
| the combine failed | Two bodies could not be joined. Make sure they overlap in a volume, not just along a face, or nudge one by a small amount. |
| the rounding failed / does not fit | Use a smaller radius, fewer edges at once, or round them in a different order. |
| the rounding runs off the faces beside it | The radius is wider than the faces next to it. Use a smaller radius, keep **Tangent chain** on, or round fewer edges. |
| the radius is too large for these edges | Use a smaller radius. |
| this edge or corner shape cannot be rounded yet | Round fewer edges at once, use a chamfer instead, or leave the rounding to the end. |
| the corner needs exactly three edges | A corner chamfer needs a corner with exactly three edges. Pick another corner, or chamfer the edges. |
| the wall is thicker than the part allows / the shell could not be made | Use a thinner wall, or open a different face. |
| the sketch is not a closed outline | Close the gaps in the sketch, then try again. |
| the sweep failed | Check that the profile sits at the start of the path and that the path has no sharp kinks. |
| the loft failed / makes an invalid solid | Check the profiles have the same number of segments, run in the same order, follow each other along one direction, and do not cross. A point profile must be first or last. |
| the profile crosses the axis | Move the profile to one side of the revolve axis. |
| the fill boundary is not valid | The edges around the hole no longer form one closed loop. Pick the edges again. |
| the surfaces do not cut each other | The trim tool no longer crosses the surface. Move the tool. |

When none of these fits, the generic advice is: undo the last change, or adjust the values of the feature until it builds again.

See also [Checks and diagnostics](../analysis/checks.md).

## A command is greyed out

Hover the button to see the reason. Common ones:

- "Open or create a part first": there is no document.
- "Select edges, or two or more faces, to round": **Fillet** and **Chamfer** need edges, or two or more faces.
- "Select a second face (or select edges) to round": you have one face selected.
- "Switch to edge selection to round edges": you have edge-shaped picks while the pick mode is **Face**. Press **E**.
- "Select one or more faces to leave open": **Shell** needs faces.
- "Draw a construction line for the axis": **Revolve** needs a construction line in the sketch.
- "Add a feature to repeat first": a pattern needs something to repeat.
- "Nothing to build this feature from: pick what it needs first": the command needs a selection or a sketch of the right kind.

The [Commands and shortcuts](commands.md) chapter lists what each command needs.

## "These faces do not share an edge"

You selected two or more faces to round but none of them meet along an edge. Select faces that touch, or select the edges directly.

## Rebuilds are slow

- A **Rebuilding model...** panel with a timer appears for slow work, with a **Cancel** button. **Cancel** stops the rebuild.
- The status bar shows **Last rebuild** with the time of the latest one.
- When you open a saved part, a **Cached view** chip shows the stored picture while the model rebuilds. Edits wait for the rebuild to finish; picking is available a moment later.
- Heavy features cost the most: modelled threads (the thread editor shows "About n s to rebuild, many more triangles"), long patterns, gears with many teeth, propellers and impellers, and free-form lofts. Use cosmetic threads while you design, and switch to modelled threads at the end.
- Suppress features you do not need while you work. See [The feature tree and history](../modelling/history.md).
- Very large parts (over 150 features) get a smaller memory cache, which trades some speed for memory.
- The [local kernel service](../automation/local-kernel.md) runs the kernel natively on your own computer and is faster on large parts.
- Close other busy tabs. The browser kernel shares your computer's memory with them.

## A variable change was refused

"The part would not rebuild with that change, so nothing was changed." The new value breaks a feature (for example a hole bigger than its plate). Try a value nearer the old one, or fix the feature the value feeds.

## Imports fail

Drop or open a file, or use **Import STEP / SolidWorks / SketchUp** in the **More file actions** menu. The messages:

| Message | Fix |
| --- | --- |
| "Cannot open *name*: only .ckpart, .json, .step, .stp, .sldprt, .skp, .dxf, .FCStd and .solidcraft files are supported." | Convert the file to a supported format. |
| "STL files cannot be imported yet (mesh import is not available). Use a STEP file instead." | Ask for or export a STEP file from the source program. |
| "Drop one file at a time." | Drop the files one after another. |
| "Open or create a part first, then import the STEP file." | Use **New part**, then import. |
| "Could not import *name*: *message*" | The message names the cause. See [Importing](../files/import.md). |
| "Imported bodies are view only and are not saved with the part." | This is a notice, not an error. STEP and SketchUp imports appear as view-only bodies, and so does a SolidWorks part that could not be built as an editable body. |
| "SketchUp surface model: n open edges; solids operations may not apply." | The file is a surface model, not a closed solid. |
| "n hidden faces were left out." | Choose **Show hidden geometry** or **Import SketchUp with hidden geometry** to include them. |

DXF import into a sketch:

| Message | Fix |
| --- | --- |
| "Open a sketch first (or use New sketch from DXF)" | Open a sketch, or use **New sketch from DXF**. |
| "Binary DXF is not supported. Save the drawing as ASCII DXF" and "That file is not an ASCII DXF" | Re-save the drawing as ASCII DXF. |
| "The DXF has *n* entities; the limit is *max*." | Simplify the drawing. The limit is 20,000 entities. |
| "The DXF has coordinates beyond *max* mm from the origin; move the drawing near the origin and try again" | Move the drawing close to the origin in your drawing program. |
| "Nothing to import: the DXF has no lines, arcs, circles, polylines or splines" | The file has only entities the importer does not read, such as text or dimensions. |
| "The DXF uses a unit code (*n*) that is not converted; read as millimetres" | Check the size, and scale if needed. |
| "The imported geometry could not be solved" | Check the drawing for overlapping or contradictory geometry. |

For FreeCAD files, the message says how many features were mapped and lists the first warning. Features that the app cannot convert are listed. See [File formats at a glance](../files/formats.md).

## Exports fail or look wrong

| Message | Fix |
| --- | --- |
| "There is no solid to export yet" | Build a solid first. |
| "Open a sketch or select one in the feature tree to export it" | A sketch DXF export needs a sketch. |
| "The sketch has no geometry to export" | Draw something first. |
| "*name* is not watertight (n open edges, n non-manifold edges): a slicer may need to repair it" | The mesh has gaps. Use **Check** to find the cause, or export STEP for a clean solid. |
| "n sketch entities could not be written to the DXF" | Those entities have no DXF form. The rest is written. |
| "Could not export: *message*" | The message names the cause. |

See [Exporting](../files/export.md).

## Saving problems

- **"Could not save: *message*".** The browser refused to write the file. Check the folder's permissions and free disk space, then try **Save as**.
- **Save downloads a new copy every time.** Your browser does not support saving over the same file. Each save is a new download. Move the newest one over the old one yourself.
- **"This part is too large for automatic backup in the browser. Save it to a file to be safe."** Autosave skips documents over about 3 MB of text. Save to a file regularly.
- **"The browser has no room left for the automatic backup. Save to a file to be safe."** Browser storage is full. Clear other site data or save to a file.
- **"Automatic backup is not available in this browser."** Storage is blocked, for example in a private window. Save to files.
- **A recent file does not reopen.** "*name* can only be reopened with Open" or "The browser did not give access to *name* again": use **Open** and pick the file again.
- **You closed the tab before saving.** On the next start, "Restore your last session?" offers **Restore** or **Start new**. Choose **Earlier versions...** to open the rolling snapshots, or use **Recover earlier versions...** from the **More file actions** menu. Snapshots are kept for the open part: up to ten.

Your parts are not stored anywhere but on your device. See [Install as an app and work offline](pwa.md).

## Unsaved changes

The "Unsaved changes" dialog ("Save changes to *name* before you continue?") appears before you open another part, run a script, or reload for an update. Choose **Save**, **Don't save**, or **Cancel**.

## The 3D view is blank or very slow

The viewport is drawn with WebGL. If it stays blank:

- Make sure hardware acceleration is on in your browser's settings.
- Update your graphics driver and the browser.
- Try another browser.

## The library

Messages from the Libraries tab and what to do:

| Message | Fix |
| --- | --- |
| "Only https addresses are accepted." | Use an `https` address or `github:owner/repo`. |
| "That is not a library address." | Check the address. |
| "The library could not be reached." | You may be offline. The saved copy keeps working. |
| "The downloaded part does not match its checksum and was refused." / "does not have the size the library lists" | The file changed or was damaged. Do not use it. Refresh the library. |
| "This part is not saved on this device and there is no network." | Install the part while online. |
| "That library is already in the list." | Nothing to do. |
| "Parts library shapes need a flat face" | Drop on a flat face. Primitives work on curved faces. |
| "Nothing to cut yet: drop a block first" | Cuts and edge rounders need a body. |

See [The library and samples](../library/library.md).

## Scripts

A script error shows as "Line *n*: *message*". Click it to select the line. If the script builds no part, it says "the script builds no part: start with part("Name")". See [Scripting](../automation/scripting.md) for limits (40,000 characters, 2,000 steps, 100,000 loop turns).

## Wizards

- **Propeller, marine:** "The hub fuse failed at *n* degrees; built with a section spacing of *m* degrees." is not an error. The wizard retried and succeeded. If nothing builds, try a section spacing of 6 or 7 degrees, or a pitch/diameter ratio above 0.8.
- **Impeller:** "Built with *n* sections per blade instead of *m*" likewise.
- **Gear:** a warning about undercut offers **Use shift**. See [Parametric wizards](../library/wizards.md).

## The local kernel service

"The local kernel service is not used" and "stopped" notices give the reason: no answer from the service, token missing or refused, a different build than the app, or a timeout. The app falls back to the built-in kernel. See [The local kernel service](../automation/local-kernel.md).

## The app will not update or start offline

- A **New version is available** notice means you have an older tab open. Choose **Refresh**.
- To start offline, you must have opened the app once online. See [Install as an app and work offline](pwa.md).
- If the app misbehaves after an update, reload the page. If that does not help, clear the site's data in the browser. Save your work to files first, as this removes settings, snapshots and autosave.

## Still stuck

Save your part to a file, note the message you see and the steps that led to it, and compare with [Limits and known gaps](limits.md), which lists what the app does not do.

## Next

- [Limits and known gaps](limits.md)
- [Checks and diagnostics](../analysis/checks.md)
- [When a sketch will not solve](../sketching/troubleshooting.md)
- [Glossary](glossary.md)

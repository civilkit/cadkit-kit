# Materials and appearance

This chapter covers how a part is made of a material, how it is coloured and finished on screen, the display styles and the Display menu, lighting and background, hiding things, and the Bodies list where each body gets its own colour, opacity and finish.

Two things are easy to confuse, so here is the rule up front:

- The **material** is part of the file. It sets the density used for mass, and it sets the colour and finish of the part unless you override them.
- A **colour or finish you pick in the Display menu** is a viewing choice kept in your browser, not in the part file. **Colours set in the Bodies list** are saved with the part.

## The material

The first row of the feature tree reads "Material: steel" (or whatever the part uses), with a colour chip. Click it, press Enter or F2 on it, or use the pencil that shows when you point at it. The Material editor opens in the left panel, with **OK** and **Cancel**. Enter applies and Escape cancels.

1. Type in the search box, or scroll the list. Materials are grouped as Steel, Aluminium, Copper alloys, Titanium, Cast iron, Plastics, Wood, Rubber, Glass, Concrete and Custom. Search matches a word of the name or of the category.
2. Click a material. The editor shows a swatch, its density, a default colour and, where usual, Young's modulus, Poisson's ratio and yield strength, and the mass of the current part at that density ("was ..." shows the mass it has now).
3. Press **OK** to apply it.

The values are textbook figures that are good for estimating mass. They are not for certifying a design.

**Custom material...** takes a name, a density and a colour. Custom materials are stored in your browser and listed under Custom with a remove button. A custom name cannot be the same as a built-in one. A file that names a custom material keeps the name when you open it on another computer, but there the material is unknown: Mass properties then asks for a density.

**Use material colour** (on by default) lets the material colour the part. Turn it off and bodies take the default colour.

Changing the material is one undo step. It does not appear as a row in the History log, but Ctrl+Z undoes it in order with your other edits. The material is saved in the file, so Save and autosave pick it up.

## What the material changes on screen

The part is drawn in the colour and finish of its material: steel as a light cool grey with a satin metal look, brass warm and metallic, plastics glossy, rubber and gasket material matte, glass translucent. A colour you pick in Display > Appearance wins over the material colour. Choosing the default grey does not count as an override.

In an assembly each component carries its own material, so each is drawn in its own colour and finish. To override one component, select a face of it, then open the Display menu: the Appearance heading names the component ("Appearance of &lt;name&gt;"), and the change applies to that component only.

## The Display menu

The **Display** button sits on the viewport. It holds, from the top:

| Section | Controls |
|---|---|
| Style | Display style (see below). For Ghost, an Opacity slider from 5 to 100 percent. |
| Appearance | Eight colour swatches and a Material finish list: Default, Plastic, Brushed metal, Glass, Matte. |
| Scene | Four lighting presets, a Light strength slider (0.3 to 2), a Reflections switch, Edge width (Thin, Medium, Bold), a Silhouette outline switch and the Background list (Theme, Light, Dark, Gradient). |
| Analysis | Surface analysis modes (zebra stripes, curvature, draft). |
| Show | Switches for Edges, Sketches, Curves, Planes, Axes, Grid, Relations, Overall size, Threads and Design issues. While a sketch is open the sketch's own show switches appear here too. |

A **Show all** button appears when something is hidden. Layers you switch off in Show are only hidden from view; the model is not changed.

![The Display popover open on a part, showing Style, Appearance swatches, Scene presets and the Show list.](../img/display-menu.png)

The View ribbon tab has the same style, lighting and background choices as commands, so they can be reached from the command search too.

### Display styles

| Style | Shortcut | What you see |
|---|---|---|
| Shaded | Alt+1 | Lit faces, no edge lines. |
| Shaded with edges | Alt+2 | Lit faces and edge lines (default). The Edges layer controls the lines. |
| Wireframe | Alt+3 | Edge lines only; hidden edges are drawn faint. You can still pick faces. |
| Hidden lines removed | Alt+4 | Flat white faces with black edges. |
| Ghost | Alt+5 | Translucent faces; set how transparent with the Opacity slider. |

Picking and hover highlights work in every style. While you edit a sketch, the body is faded to a quarter of its opacity and comes back when the sketch closes.

### Lighting and background

| Preset | Look |
|---|---|
| Studio (default) | Soft highlights and reflections on metal. The highlights stay fixed to the screen as you turn the part. |
| Flat | Even light, no reflections. |
| High contrast | One strong light, little fill. |
| Technical | Every face matte white with black edges and soft light, close to a drawing. Per-component colours are not shown. |

Light strength scales every light. With Reflections off, metals lose their metal look, and the Flat and Technical presets never have it. The default background is the gradient, which follows the light or dark theme.

### Edges and silhouette

Edge lines are drawn at a fixed pixel width (Thin by default) in a colour darker than the faces. The **Silhouette outline** (on by default) also outlines the rim of curved faces where no edge line lies. It is switched off in a section view, in Wireframe and Ghost, and for translucent bodies.

## Hide and show

Press **H** to hide the body of the selected faces, or the selected sketch, plane or curve. Press **Alt+H**, or the **Show all** button, to show everything again. A hidden body cannot be picked. Hiding is for the session only and is not saved.

The eye on a row in the feature tree hides exactly what that feature made, in the view only. The row dims and shows a closed eye; click it again to restore. Nothing is rebuilt. Suppress is a separate button on the row and does rebuild the model.

## The Bodies list

A part can hold several bodies. The **Bodies** tab of the left panel lists them, one row per body, ordered by the feature that made it. Each row shows an eye, a colour swatch, the name and the volume.

| Control | What it does |
|---|---|
| Eye (or Space on a focused row) | Hides or shows the body. |
| Row click | Selects the body. Shift or Ctrl adds to the selection. Clicking a face in the model selects its body row. |
| Double-click or F2 | Renames the body. |
| Isolate button | Hides every other body. Press it again to show all. |
| Show all / Hide others | Show everything, or keep only the selected bodies. |
| Copy, Delete, Join, Cut, Intersect | Edit the bodies themselves. See [Bodies and combining](../modelling/bodies.md). |

Below the list, the selected body has an **Appearance** group:

| Control | What it does |
|---|---|
| Colour | The body's colour. |
| Opacity | 5 to 100 percent. A body below 100 percent is drawn in a separate transparent pass. |
| Finish | Part material (no override), Matte, Plastic, Chrome, Glass or Brushed metal. |
| Metallic, Roughness | Fine control over the finish. |
| Glass, Chrome, Reset | Presets, and a button that removes the override. |

Appearance set here is saved with the part and is not an undo step. Very clear bodies (below about a third opaque) are skipped by a click when something lies behind them, so you can pick what you see through the glass.

![The Bodies tab with several bodies listed and one body selected after choosing the Glass preset, with its Appearance group visible.](../img/bodies-glass.png)

## Limits

- Appearance changes, hiding and the Display menu are not undo steps.
- Per-face colours cannot be set in the Bodies list; scripts can set them (see [Scripting](../automation/scripting.md)).
- Colour and finish are not written to STEP, STL or DXF exports. See [Exporting](../files/export.md).
- A section view cuts opaque bodies only. Translucent bodies are not cut, and two translucent bodies that overlap are blended by the distance of their centres.
- Zebra and curvature analysis colour opaque bodies only.
- There are no cast shadows, ambient occlusion or textures.
- Each browser keeps its own Display choices and custom materials.

## Next

- [Assemblies and mates](assemblies.md): materials of components.
- [Measure and inspect](../analysis/measure.md): mass from the density of the material.
- [Bodies and combining](../modelling/bodies.md)
- [Saving and opening](../files/files.md)

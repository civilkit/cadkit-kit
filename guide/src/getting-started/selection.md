# Selecting things

Most modelling commands act on what you have selected: a fillet needs edges, a shell needs faces, a hole needs a face. This chapter covers the four kinds of thing you can select (faces, edges, corners and bodies), how hovering and clicking work, how to select several things at once, how to select more of a kind with one command, and how a selection feeds a command.

## What you can select

| Kind | What it is | Key |
| --- | --- | --- |
| **Face** | A flat or curved surface of a body. | `Q` |
| **Edge** | A line, arc or curve where two faces meet. | `E` |
| **Corner** | A point where edges end. | `V` |
| **Body** | A whole connected solid or surface body. | `B` |

A body is a connected set of faces. Two solids that do not touch are two bodies, and a surface body is its own body. Bodies are named in the selection list as **Body 1**, **Body 2** and so on, or **Surface body 1**; a body that has a name from a script or from the **Bodies** tab uses it.

## Auto pick, and picking one kind

By default CivilKit CAD is in **Auto** mode: as you move the pointer, the corner, edge or face nearest to it lights up, and a click selects it. The selection takes the kind of what you clicked, and does not mix kinds.

To pick only one kind, press its key or choose it on the **Select** tab in the **Pick** group: **Face**, **Edge**, **Corner** or **Body**. Choosing a kind turns Auto off. The pick buttons are also on the optional **Selection mode bar**, together with an **Auto** button, a **Box select** button and a filter button. Turn the bar on in **Settings > Layout**.

## Hover and click

- Hover over something to light it up. The status bar shows its name.
- Click to select it. The previous selection is replaced.
- `Shift`-click or `Ctrl`-click (`Cmd`-click on a Mac) adds to the selection. To take something out again, click its **Remove from selection** button in the selection list.
- Click empty space to clear the selection and close any properties panel.
- `Esc` clears the selection. **Deselect all** (`Ctrl+Shift+A`) does the same.
- `Alt`-click selects the whole body. The **Select body** command does the same without the mouse.
- Double-click a face to select the feature that made it and open that feature's editor.

A very transparent body is not picked by a click when something lies behind it.

## Selecting several things

### Box select

Press `X`, or click **Box select**, and drag a box in the viewport instead of orbiting. You can also hold `Shift` and drag from empty space without turning the mode on. Press `Shift` to add to the current selection.

- Drag to the **right** for a **window** box (solid blue): it selects only what is fully inside.
- Drag to the **left** for a **crossing** box (dashed green): it selects everything the box touches.

Box select works through the model, so faces hidden behind others are picked too. In Face mode it picks faces, in Edge mode edges, in Corner mode corners, and in Body mode whole bodies.

### Select all, invert and none

| Command | Shortcut | What it does |
| --- | --- | --- |
| **Select all** | `Ctrl+A` | Everything of the current kind. |
| **Invert selection** | `Ctrl+I` | Everything of the current kind that is not selected. |
| **Deselect all** | `Ctrl+Shift+A` | Clears the selection. |

### Select more

The **Expand** group of the **Select** tab, command search and the right-click menu all offer commands that add to the selection. They work on faces and edges. If one cannot run, its tooltip says why: **Select something first** or **Works on faces and edges**.

| Command | Faces | Edges |
| --- | --- | --- |
| **Select tangent** | Faces joined across an edge where they meet smoothly, such as a fillet chain. | Edges that continue each other with a smooth turn. |
| **Select parallel** | Planes facing the same way (either way round), and cylinders with parallel axes. | Straight edges with the same direction, and circles with parallel axes. |
| **Select similar** | The same kind of face with the same area (a cylinder also needs the same radius). | The same kind of edge with the same length (a circle or arc also needs the same radius). |
| **Select loop** | Switches to Edge mode and selects the edges around the selected faces. | The edges that join end to end around the neighbouring face. |
| **Select connected** | Every face of the body. | Every edge reachable through shared corners. |
| **Select same size** | Every cylinder of the same diameter and kind as the selected cylinders. | |

A toast tells you how many items were added.

## Filters

The funnel button on the Selection mode bar opens switches for **Faces**, **Edges**, **Corners**, **Bodies**, **Sketches** and **Planes**. A kind that is off cannot be picked: its mode button is disabled, a box ignores it, and with **Planes** off a reference plane cannot be picked in the view. A badge shows how many kinds are off. **Sketches** is in the list but does nothing yet: sketches are chosen from the feature tree.

## The selection list

When something is selected, a list appears at the bottom right of the viewport. It shows a count and one chip per item (**Face** name, **Edge** number, **Corner** position, **Body** number), each with a **Remove from selection** button. **Clear** empties it, and the arrow folds the list away. Hovering a chip lights that item in amber. Click a chip's name to **Show in tree**.

The status bar summarises the selection, for example `3 faces, 12.4 cm²`, `2 edges, 14 mm` or `1 body`. Areas and lengths come from the displayed mesh, so they are exact for flat faces and close for curved ones. For exact numbers use [Measure and inspect](../analysis/measure.md).

## How a selection feeds a command

Commands read the selection when you run them. Greyed commands tell you what they are missing.

| Command | What it needs |
| --- | --- |
| **Fillet**, **Chamfer** | One or more edges, or two or more faces (then the edges the faces share). Corners count as the edges that end there. |
| **Shell** | One or more faces to leave open (Face mode). |
| **Hole** | One face, or an earlier sketch of points. |
| **Thread** | One or more cylindrical faces, such as the wall of a hole. |
| **Sketch on selected face or plane** (`S`) | One face, a reference plane, or a plane feature. |
| **Draft**, **Delete face**, **Delete body** | Faces. |
| **Pipe cut** | Edges, or faces whose rim is cut. |
| **Move / rotate ball** | A body, a face, or a move feature. Edges and corners cannot be moved. |
| **Linear pattern**, **Circular pattern**, **Mirror** | The feature selected in the tree, or else the last feature. |
| **Measure** | One or two faces, edges or corners. |

With **Tangent chain** on in a fillet or chamfer, edges that continue the selected edges smoothly are rounded too, and the editor says how many were added.

The right-click menu changes with the selection. With a face selected it offers **Sketch on selected face**, **Hole**, **Shell**, **Fillet**, **Chamfer**, the patterns and the select-more commands. With edges it offers **Fillet**, **Chamfer** and the select-more commands. With a body it offers **Select body**, **Move body**, the patterns and **Shell**.

### Faces from the tree

Hovering a row in the feature tree tints what that feature made. The row's **Select in viewport** button picks those faces, and a folder's **Select all faces of this group** picks every face its features made. In the other direction, hovering a face in the viewport marks the row of the feature that made it.

## Next

- [Moving around the model](navigation.md)
- [Fillets, chamfers, shells and drafts](../modelling/edges.md)
- [Holes and threads](../modelling/holes.md)
- [Commands and shortcuts](../reference/commands.md)

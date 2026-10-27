# Units and settings

This chapter explains the units CadKit works in and every setting in the settings dialog: theme and language, the layout of the window, sketching, navigation, the move ball and the geometry kernel. It also covers automatic backup, which has no setting.

Open the dialog by clicking **Settings** (the gear) at the right of the top bar, by choosing **Workspace settings** in command search, or from the **Workspace** group of the **View** tab. Changes apply at once. The dialog remembers the tab you used last.

All settings are kept in your browser, for this site only. They are not saved in part files, and they do not follow you to another browser or computer. Clearing the site's data in your browser resets them.

## Units

CadKit works in **millimetres** and **degrees**. There is no unit setting. Part files store millimetres, and sizes in editors and on the status bar are shown in millimetres.

You can still type a value in another unit. A number field accepts a unit after the number: `mm`, `cm`, `m`, `in` for lengths, and `deg` or `°` for angles. CadKit converts it to millimetres. For example `2 in` becomes 50.8 mm, and `1.5 cm` becomes 15 mm. A field also accepts simple arithmetic and variable names, such as `=width*2+3`. See [Equations and variables](../modelling/equations.md).

The grid **Spacing** field in the status bar accepts units in the same way, for example `0.25 in`.

## General tab

| Setting | Choices | Default |
| --- | --- | --- |
| **Theme** | **Match system**, **Light**, **Dark** | **Match system** |
| **Language** | The languages installed. | Shown only when more than one language is available. At present English is the only one. |

The theme changes the colours of the whole application, including the viewport background when the background is set to **Theme**. See [Languages](../reference/languages.md).

## Layout tab

The layout tab controls which parts of the window are shown. Start with a preset, then adjust.

| Setting | Choices | What it does |
| --- | --- | --- |
| **Preset** | **Plasticity-style**, **Classic ribbon**, **Minimal**, **Custom (your own mix)** | Applies a whole set of the settings below at once. It shows **Custom** when your settings match no preset. |
| **Panel sizes** | **Reset layout** | Restores the default widths and heights and unfolds a folded left panel. |
| **Ribbon** | **Off (command search)**, **Compact**, **Full** | **Off** hides the ribbon and relies on command search and the tool column. |
| **Left panel** | **Docked**, **Floating**, **Hidden** | Where the feature tree and its tabs sit. |
| **Inspector panel** | **Off**, **Docked right**, **Floating** | The property panel for the selected feature. |
| **Button labels** | **Icons and text**, **Icons only (label on hover)** | How ribbon and palette buttons look. |
| **Left panel tabs (Outliner, Features, Assets, Editor)** | on / off | One list, or tabs. With tabs on, the left panel offers **Outliner**, **Features**, **Editor**, **Catalog**, **Variables**, **Script** and **Bodies**. |
| **Tool rail** | on / off | A column of modelling tools down the left edge. |
| **Tool palette in sketches** | on / off | A floating palette of sketch tools on the right edge while sketching. Off: the **Sketch** tab carries the tools. |
| **Selection mode bar** | on / off | The bar with **Auto**, **Face**, **Edge**, **Corner**, **Body**, **Box select** and the filters. |
| **Bottom drawer open** | on / off | Whether the drawer is open. |
| **Direct-manipulation handles on the canvas** | on / off | The arrows and dots you drag to change a depth, radius, thickness or diameter. |
| **Floating panel opacity** | 15 % to 100 % | How see-through floating panels are. |
| **Highlight line thickness** | 1 to 8 | The width of selection and hover lines. |
| **Backdrop blur** | 0 to 30 | Blur behind floating panels. |

The presets set the following:

| | **Plasticity-style** | **Classic ribbon** | **Minimal** |
| --- | --- | --- | --- |
| Ribbon | Off | Full | Off |
| Left panel | Docked, tabs on | Docked, tabs on | Floating, tabs off |
| Inspector panel | Off | Docked right | Off |
| Tool rail | On | Off | Off |
| Selection mode bar | On | Off | Off |
| Bottom drawer | Open | Closed | Closed |

A first visit starts with a mix of these: the full ribbon, a floating left panel with tabs, the inspector docked right, no tool rail, no selection mode bar and a closed drawer. Because it matches no preset, the dialog shows **Custom (your own mix)**.

Drag the handles between panels to resize them. The sizes are remembered. Drag a panel below its minimum and it folds away; the keyboard works too: focus a handle and use the arrow keys, `Home` and `End`, and `Enter` to reset. `[` shows or hides the left panel and `\` the drawer.

## Sketching tab

How the sketch editor takes input. See [Sketch tools](../sketching/tools.md) and [Constraints and dimensions](../sketching/constraints.md).

| Setting | Choices | Default |
| --- | --- | --- |
| **Infer constraints while drawing (Shift at a click turns it off)** | on / off | On |
| **Line to tangent arc** | **Rest the pointer on the end**, **Keys and drag only**, **Off** | **Rest the pointer on the end** |
| **Values beside the pointer** | **Dimensions**, **Dimensions and positions**, **Off** | **Dimensions** |
| **Snap to the grid** | on / off | On |
| **Keep the view when entering a sketch (Look normal squares it up)** | on / off | On |
| **Auto look normal for new sketches** | on / off | Off |

The **Snaps** menu in the **Status** group of the sketch tab holds the rest: which kinds of snap are on (**End points**, **Centres**, **Midpoints**, **Quadrants**, **Intersections**, **Perpendicular**, **Tangent**, **On curve**, the model snaps, **Alignment guides** and **Grid**), **Add constraints from snaps**, and **Auto-constrain from guides**.

## Navigation tab

The **Up axis**, **Orbit mode** and **Orbit around** settings. See [Moving around the model](navigation.md).

## Positioning tab

Settings for the **Move / rotate ball**. See [Moving things: the move / rotate ball and handles](../modelling/transforms.md).

| Setting | Default |
| --- | --- |
| **Snap distance (mm)** | 10 |
| **Snap angle (degrees)** | 15 |

Hold `Ctrl` while dragging a handle of the ball to move in whole steps of these sizes.

## Kernel tab

The geometry kernel is the part of CadKit that builds solids. By default it runs inside your browser. See [The local kernel service](../automation/local-kernel.md) for how to run the faster service.

| Setting | What it does |
| --- | --- |
| **Kernel to use** | **Built-in (runs in this browser)** or **Local service (faster, runs on this computer)**. |
| **Service address** | Where the local service listens. Shown with the local service. |
| **Access token** | The token the service printed or saved when it started. It stays in this browser only. |
| **Test connection** | Checks the address and token, and reports the kernel version, the protocol and the number of cores, or why it cannot be used. |
| **Try the service again** | Appears after a failure. |

Switching kernels reopens the open part on the other kernel. If the service stops or turns out to be a different build from the app, the built-in kernel takes over and a notice tells you. While the local service is selected, the status bar shows a **Kernel** chip: **Local** with a version, **Connecting**, or **Built-in (service off)**. Click the chip to come back to this tab.

## Backup and saving

There is no autosave setting. A moment after you change a part, CadKit writes a backup of every changed part to the browser's storage, and again when the page is hidden. After a crash or reload the app offers **Restore your last session**, with **Restore**, **Start new** and **Earlier versions…**. Each changed part returns in its own tab.

The backup has limits you may meet:

- It is capped at about 3 MB. A part larger than that is not backed up, and a notice says so.
- If the browser has no room left, or does not allow storage, the notice says that too.
- The undo history is not part of the backup.

Save to a file for anything that matters. **More file actions > Recover earlier versions…** lists versions kept in the browser from a few minutes ago.

## Next

- [Moving around the model](navigation.md)
- [Starting a sketch](../sketching/start.md)
- [Languages](../reference/languages.md)
- [Install as an app and work offline](../reference/pwa.md)

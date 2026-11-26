# Plugins

A plugin adds a **generator**: a form that builds a part for you, such as a case, a spring or a cabinet. Two are built in: **Enclosures** (Case) and **Springs**. You fill in the fields, watch the preview, and
**Add** it. It goes into the tree as ordinary features in one folder, and one **Undo** removes it.

## Use a generator

1. Open the **Features** tab and choose **Plugins** (or press the Features tab's gear menu to pick a generator directly).
2. Pick a generator, change the fields and watch the preview. A field left empty shows *auto*: the generator chooses.
3. Choose **Add**. **Position** moves the result before it is built.

**Back to the list** and **Cancel** leave the model untouched.

**In a sketch.** The **Plugins** tile in the **Reference** group of the sketch tab opens a plugin form on the open sketch. While the form is open, the curves it would add (the hexagons of Honeycomb, for example) show in the sketch in amber and update as you change a value; arcs preview as chords. **Add** draws them as one undo step; **Back** or **Cancel** clears the preview. Plugins see the curves you picked: Honeycomb fills only the selected outline.

## Change or move a generated part

Right-click its folder in the tree:

- **Edit parameters…** opens the same form with the values you used. **Update** rebuilds the folder in place, as one undo step. It is refused if
  something outside the folder depends on its faces.
- **Move folder (drag with the ball)** shows the move ball: drag an arrow to slide the whole part, or type a distance and press Enter.
- **Move folder by distance…** asks for X, Y and Z.

## Install a plugin made by someone else

Installed plugins are **off by default**. In **Plugins**, switch on **Allow plugins from other people**, then add one from a packed zip file, from
`github:owner/repo@tag`, or from a link to a zip. The app shows what the package contains, its hash and anything it could not check, and installs
only after you confirm. Use a tag or a commit, not a branch, so the package cannot change later. Remove a plugin from the same panel.

A SolidCraft plugin zip installs the same way. It is converted in your browser at install time, and its form is built from its parameters (dropdowns, a SolidCraft-style layout) with a live preview. A field that asks for a selection is picked in the 3D view like any other pick. If an installed plugin asks for one, a **Plugins** tab appears in the ribbon; the Woodwork **Cut list** runs from it, shows a table and offers a CSV download. Files a plugin saves are offered as downloads, never written to disk.

A plugin with compiled code runs in a sandbox: it cannot reach the network, your files or your document, and it is stopped if it runs too long. Only
install plugins from people you trust; the sandbox limits what a plugin can do, not whether its geometry is any good.

## SolidCraft's Woodwork

The app can run the SolidCraft **Woodwork** plugin (cabinets in sheet goods) by TomasDJo, MIT licence, once it is packed for this app. Its Cabinet form
builds the boards, shelves, holes and colours from the material library. Doors and drawers do not swing, and its joinery and cut list entries are not
available yet.

## With an agent

An agent connected through the bridge can list the installed generators and run one on the open document with `app_plugin_list` and
`app_plugin_run`. Running one changes the document, so it needs the box that lets the agent change it, and it is one undo step.

## Limits

- The sandbox has been checked in Chrome and Safari. Firefox is not checked yet.
- In the Mac app, installing from `github:` works; links to other websites do not. The sandbox has not yet been checked inside the Mac app itself.

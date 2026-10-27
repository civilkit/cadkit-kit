# Parametric wizards

This chapter covers the commands that build a whole part from a few parameters: gears (spur, ring, helical, herringbone and rack), propellers (airfoil and marine), turbo impellers, and corner holes on a plate. Each one produces ordinary features that you can inspect and edit afterwards.

All of these are about geometry only. The app does not calculate strength, lubrication, or aerodynamic or hydrodynamic performance.

## What the wizards have in common

- They live on the **Features** tab, **Create** group. The Gear button is a family: **Gear** (default, shortcut **Shift+Y**), **Gear pair**, **Propeller** and **Impeller** share one ribbon button, and the button shows the one you used last. You can also search for them with command search (**F**).
- You need an open document. The commands are greyed out without one.
- A live preview shows in the viewport while you change values.
- A readout and checks show the derived numbers. Errors stop the build. Warnings do not.
- The settings are stored on the part, so you can reopen the wizard later and change them. The features are regenerated from the settings, keeping their ids, so later features that refer to them keep working.

Parts built by a wizard are not locked. You can add fillets, cuts and patterns on top. What you cannot do is edit the generated profile sketch by hand while it is still tied to its wizard (see each section).

![The Propeller wizard open in the left panel on its Blade step, with the live preview of a three-blade propeller in the viewport.](../img/wizard-propeller.png)

## Gears

**Gear** builds a parametric gear from a true involute tooth profile. **Gear pair** builds two meshing gears at the right centre distance. Both are one undo step, and the Gear editor opens on the result with a live preview. Press **Enter** or the tick to keep it, or **Esc** or the cross to cancel.

### Where the gear goes

- With one face selected, the gear is built on that face.
- With a plane feature selected in the tree, it is built on that plane.
- Otherwise it is built on the Top plane.

A new gear starts as a spur gear: module 2, 20 teeth, 20 degree pressure angle, face width 10, bore 8, no hub. **Gear pair** starts with the same gear plus a 40-tooth mate with a 10 mm bore and a backlash of 0.06 of the module.

### Gear types

| Type | What you get |
| --- | --- |
| **Spur** | External straight-toothed gear. |
| **Ring** | Internal gear: a rim with the teeth cut on the inside. No keyway or hub. Root fillet is not applied. |
| **Helical** | External gear whose teeth twist, built as a real twisted extrude. Has helix angle and hand. |
| **Herringbone** | Double-helical gear: two opposed helices, with an optional groove between them. |
| **Rack** | A straight rack of the given number of teeth. No bore, hub or mate. |

Bevel and worm gears are not built by the Gear command. The sample list includes a bevel gear and a worm screw that were modelled by hand.

### Parameters

| Parameter | What it does | Default | Range and notes |
| --- | --- | --- | --- |
| Sizing | Choose **Module** or **Diametral pitch**. | Module | Diametral pitch converts as module = 25.4 / pitch. |
| Module | Tooth size in mm. | 2 | 0.1 or more. |
| Diametral pitch | Teeth per inch, when sizing is by pitch. | 12.7 | 0.5 or more. |
| Teeth | Number of teeth. | 20 | 6 or more. For a rack it is the number of teeth along it, 1 or more. |
| Pressure angle | Flank angle. | 20 deg | 10 to 30. |
| Face width | Thickness of the gear. For a herringbone, the total. | 10 mm | 0.1 or more. |
| Helix angle | Tooth twist (helical and herringbone). | 15 deg | 1 to 45. A herringbone starts at 30 and warns outside 15 to 45. |
| Hand | Helical: **Right** or **Left**. Herringbone: **Apex leading** or **Apex trailing**. | Right | A mating gear takes the opposite hand. |
| Centre groove | Herringbone: width of the groove between the two chevrons. 0 means none. | About 3 x module when you switch to herringbone | The groove leaves a web at the root, so the two halves stay joined. |
| Rim thickness | Ring gear: radial thickness beyond the tooth roots. | 0, meaning 2.5 x module | 0 or more. |
| Bore diameter | Shaft hole through the gear. | 8 mm | 0 means no bore. |
| Keyway | Cuts a keyway in the bore. | Off | Needs a bore. |
| Key width and depth | Keyway size. | 0, meaning "by shaft size" | The default follows the common DIN 6885 table for the bore size. Type your own values to override. |
| Hub diameter and length | Optional boss on the gear. | 0 (no hub) | Length is measured from the front face. For a herringbone, the hub is centred on the mid plane. |
| Addendum | Tooth height above the pitch circle, as a multiple of the module. | 1 | 0.2 or more. |
| Dedendum | Tooth depth below the pitch circle, as a multiple of the module. | 1.25 | 0.2 or more. |
| Root fillet | Radius at the tooth root, as a multiple of the module. | 0.3 | 0 to 0.6. 0 gives a sharp root. |
| Profile shift | Shifts the cutter. Positive thickens the tooth and raises the tip. | 0 | -1 to 1.5. |
| Backlash | Tooth thickness removed at the pitch circle by this gear, in mm. | 0 | 0 or more. |

Helical and herringbone gears use the module and pressure angle as normal values; the app converts them to the profile in the plane of rotation.

### Adding a mating gear

For spur, helical and herringbone gears, tick **Add a mating gear** in the **Mating gear** section. It takes the module, pressure angle, width, profile shift and backlash from the first gear and has its own tooth count, bore and hub. The editor shows the centre distance and the gear ratio.

Ticking the box starts the mate at twice the teeth and, if the backlash was 0, sets it to 0.06 of the module so the flanks do not touch. The two gears are separate solids in one part, not an assembly.

### The readout and its warnings

The **Readout** section shows the pitch, outside, root and base diameters (a rack shows circular pitch and length), the contact ratio, and the minimum number of teeth that avoids undercut.

The contact ratio is measured against the mating gear. With no mate, it uses a gear with the same number of teeth. A value of 1.2 or more runs smoothly. For helical and herringbone gears the total includes overlap.

| Warning | What to do |
| --- | --- |
| Fewer teeth than the minimum for no undercut (18 at 20 degrees and a standard addendum) | Add teeth, or press **Use shift** to apply the profile shift that avoids undercut. |
| Teeth come to a point | Raise the module or tooth count, or lower the addendum or profile shift. |
| Tip lowered to keep a land | Same remedy as above. |
| Teeth touch at the root | Reduce backlash, profile shift or dedendum. |
| Ring tip circle below base circle | The ring's teeth were shortened. Change the tooth count or the shift. |
| Herringbone helix angle outside 15 to 45 | Choose an angle in that range. |
| Half the face width twists more than a quarter turn | Lower the helix angle or the face width. |
| Groove at least as wide as the face | Lower the groove or widen the face. |

### What is built

Gear parts are made of ordinary features: a profile sketch (the closed tooth outline), an extrude for the body, and optionally a hub, a groove (herringbone), a bore and a keyway. A pair repeats these for the second gear. A helical gear uses the extrude's twist. A herringbone uses two extrudes with opposite twist, up and down from the mid plane.

### Editing a gear afterwards

Double-click any feature the gear made in the feature tree, and the Gear editor opens on the settings. The features are regenerated with the same ids. You cannot edit the profile sketch by hand while it belongs to the gear. To take it over, delete the gear's settings by editing the part file, or rebuild the shape from a copy of the sketch.

Large gears take time to rebuild. Cost grows roughly in line with the tooth count, and a herringbone costs about twice a helical gear of the same size. The preview waits until you stop typing before it rebuilds.

## Propellers

The **Propeller** command opens a three-step wizard in the **Editor** tab of the left panel: **Size**, **Blade** and **Review**. You can also start it from the Catalog: **Primitives** tab, **Generators**, **Propeller**.

On the **Size** step, **Family** selects what kind of propeller you make. You choose the family for a new propeller only. An existing propeller reopens in the family that made it.

| Family | Use it for |
| --- | --- |
| **Airfoil** | Fans, drones and aircraft: airfoil sections lofted into a blade. |
| **Marine** | Boat propellers: the blade face lies on a helicoid, with the thickness on the back. |

On the **Review** step, **Create** adds the propeller as one undo step. When you reopen a built propeller, the button says **Apply** and regenerates it.

The shaft axis is Z, the thrust is toward +Z, and the first blade lies along +X.

### Airfoil propeller

Presets on the **Size** step: **Drone 5 inch**, **Desk fan** and **RC plane**. **Custom** is the default.

#### Size step

| Parameter | What it does | Default | Range |
| --- | --- | --- | --- |
| Diameter | Tip diameter. | 120 mm | 10 mm or more. |
| Hub diameter | Central boss. | 24 mm | Above 0 and at most 60 % of the diameter. |
| Hub length | Hub length along the shaft. | 20 mm | Above 0. |
| Bore diameter | Shaft hole. 0 means none. | 6 mm | Leaves at least 1 mm of hub wall, and stays inside the blade roots. |
| Blades | Number of blades. | 3 | 2 to 8. |
| Rotation | **Counter-clockwise** or **Clockwise**, seen from the thrust side (+Z). | Counter-clockwise | |

#### Blade step

| Parameter | What it does | Default | Range |
| --- | --- | --- | --- |
| Twist | How the blade angle varies along the span: **Pitch** (constant pitch), **Pitch angle** (the same law set by an angle), or **Linear** (straight line from root angle to tip angle). | Pitch | |
| Pitch | Distance advanced per revolution. | 90 mm/rev | Above 0. |
| Angle at reference, Reference radius | Pitch angle and where it is measured, as a fraction of the tip radius. | 20 deg at 0.75 | Angle up to 80 deg. Radius 0.25 to 1. |
| Root angle, Tip angle | Linear twist ends. | 55 and 12 deg | Up to 80 deg. |
| Root, mid and tip chord | Blade width along the span. Drag the three points on the **Chord curve** graph, or type values. | 18, 20, 9 mm | At least 1 mm. |
| Thickness at root, mid and tip | Thickness as a fraction of the chord, on the **Thickness curve**. | 0.14, 0.10, 0.06 | 0.02 to 0.4. |
| Shape exponent | Moves the mid value toward the root (below 1) or the tip (above 1). One for chord, one for thickness. | 1 | 0.2 to 5. |
| Airfoil | **NACA 4-digit**, **Circular arc**, or **Flat plate**. | NACA 4-digit | |
| Camber | Section curvature as a fraction of the chord. | 0.04 | 0 to 0.12. |
| Camber position | NACA 4-digit only. | 0.4 | 0.1 to 0.9. |
| Pivot | Chordwise point the sections turn about. 0 is the leading edge. | 0.4 | 0 to 1. |
| Rake | Backward sweep out of the plane of rotation. | 0 deg | -45 to 45. |
| Skew | Sideways offset of the tip toward the trailing side. | 0 mm | Within half the radius. |
| Root embed | Where the blade starts inside the hub, as a fraction of the hub radius. | 0.6 | 0.3 to 0.9. |
| Sections | Airfoil sections the blade passes through. More follows the twist more closely and builds more slowly. | 7 | 5 to 12. |

Drag a point on a graph up or down, or focus a point and use the arrow keys (hold **Shift** for bigger steps).

#### Review step

The readout gives the diameter, blade count, pitch, pitch-to-diameter ratio, section angles at the root, at 0.7 R and at the tip, and the blade area ratio. Checks list errors (these disable **Create**) and warnings, for example blades that overlap at the hub, a root deeper than the hub, or a tip too thin to print.

#### What is built, and how to edit it

The hub is a circle extruded on the mid plane. Each blade section is a sketch of two splines on its own plane. The blade is a loft through the sections, joined to the hub, repeated as a circular pattern, and a bore is cut.

Hub diameter, hub length, bore and blade count are named variables (`prop_hub_d`, `prop_hub_len`, `prop_bore_d`, `prop_blades`). Edit them in the Variables panel to rebuild just the hub and bore. The blade shape itself is part of the generated sketches, so change it in the wizard. If you change the hub radius in Variables so the blade roots poke out, change the hub in the wizard instead; it moves the roots with it.

Double-click any propeller feature to reopen the wizard.

### Marine propeller

Choose **Marine** under **Family** on the **Size** step. The wizard has the same three steps. Presets: **Outboard, 3 blades**, **Inboard, 4 blades**, **Quiet, 5 blades skewed**.

#### Size step

| Parameter | What it does | Default | Range |
| --- | --- | --- | --- |
| Diameter | Tip diameter. | 250 mm | Above 0. |
| Hub diameter | Central boss. | 50 mm | Above 0 and below 60 % of the diameter. |
| Hub length | Hub length. | 110 mm | Long enough to hold the blade roots. The review tells you how long if it is too short. |
| Bore diameter | Shaft hole. | 20 mm | Must leave a wall (under 90 % of the hub). |
| Blades | Number of blades. | 3 | 2 to 6. |
| Rotation | **Right-hand** or **Left-hand**. Left is the mirror of right. | Right-hand | |

#### Blade step

| Parameter | What it does | Default | Range |
| --- | --- | --- | --- |
| Pitch / diameter | Pitch at the tip divided by the diameter. | 1 | 0.4 to 2. |
| Progressive pitch | How much the pitch changes from tip to root. Positive means more pitch at the hub. | 0 | -0.15 to 0.5. |
| Rake | The blade leans aft by this angle. Negative leans it forward. | 0 deg | -20 to 30. |
| Expanded area ratio | Total developed blade area over disc area. Sets the widest chord. | 0.5 | 0.25 to 1.2. |
| Widest chord at | Where the blade is widest, from the hub (0) to the tip (1). | 0.45 | 0.05 to 0.95. |
| Root chord, Tip chord | Widths at the ends, as a fraction of the widest chord. | 0.55, 0.3 | 0.05 to 1. |
| Tip skew | Sweep back of the mid-chord line at the tip. | 15 deg | -45 to 45. A warning above 45. |
| Thickness at the root, at the tip (t / D) | Blade thickness as a fraction of the diameter, normal to the face. All of it is on the back. | 0.035, 0.005 | 0.005 to 0.08 at the root, 0.001 to 0.04 at the tip. |
| Thickest at | Where along the chord the foil is thickest. | 0.45 | 0.2 to 0.7. |
| Edge thickness | Edge thickness as a fraction of the maximum. The edge is never thinner than 0.3 mm. | 0.06 | 0.02 to 0.5. |
| Tip rounding | Outer share of the span over which the tip closes to a round end. 0 keeps a square tip. | 0.15 | 0 to 0.4. |
| Root embed | Where the blade starts inside the hub. | 0.85 | 0.35 to 0.95. |
| Section spacing | Angle between the helicoid sections. Finer follows the outline better. | 3 deg | 3 to 10. |

#### Marine: what to expect

- The blade is one loft through closed sections in planes through the shaft, joined to the hub, patterned, and bored. Hub diameter, bore and blade count are plain numbers, not document variables.
- With rake and progressive pitch at 0, the face is a true constant-pitch helicoid.
- Joining the blade to the hub is the touchy step. If the preview fails, the wizard retries with section spacings of 7, 6, 4 and 3 degrees and tells you which one built ("The hub fuse failed at ... degrees; built with a section spacing of ..."). If nothing builds, try a pitch/diameter above 0.8 or a coarser spacing by hand.
- A warning tells you when the pitch at the hub is 0.8 D or lower, because those are the cases most likely to need a retry.
- Editing a marine propeller usually changes the section count, so **Apply** removes the old features and adds new ones, and takes two undo steps. An edit that keeps the section count replaces them in place, in one step.
- A rake of about 25 degrees or more can leave a few small gaps in the display mesh. The solid is still valid, but the Check panel may list them.

## Turbo impellers

The **Impeller** command builds an open radial compressor wheel: a shaped hub, back-swept main blades, shorter splitter blades between them, and a shaft bore. The wizard has three steps: **Hub**, **Blade** and **Review**, opened in the **Editor** tab of the left panel. Presets: **Compressor, 7 + 7 blades** (the default), **Small compressor, 5 + 5 blades**, **Wide, 9 + 9 blades, more wrap**.

### Hub step

| Parameter | What it does | Default | Range |
| --- | --- | --- | --- |
| Exducer diameter | Hub diameter at the back face (the wheel exit). | 45 mm | Above 0. |
| Inducer diameter | Hub diameter at the nose plane (the inlet). | 20 mm | Above 0 and below the exducer diameter. |
| Hub length | Axial length from the nose to the back face. | 16 mm | Above 0. |
| Bore diameter | Shaft bore. 0 means none. | 8 mm | Must leave a wall in the hub. |
| Main blades | Full-length blades. | 7 | 3 to 12. |
| Splitter blades | Short blades between the main ones. | 7 | 0 up to the main blade count. |

### Blade step

| Parameter | What it does | Default | Range |
| --- | --- | --- | --- |
| Total wrap | How far each blade winds around the axis. | 75 deg | 20 to 160 (a warning above 120). |
| Blade thickness at the hub | Tangential thickness where the blade meets the hub. | 2.5 mm | Above 0 (the field minimum is 0.3). |
| Blade thickness at the tip | Tangential thickness at the shroud end. | 0.8 mm | At least 0.2 mm. A warning below 0.5 mm. |
| Splitter start | Where splitters begin along the flow path (0 is the nose, 1 the back face). | 0.45 | 0.15 to 0.85. |
| Section line, axial and radial | Reach of the hub-to-shroud line each blade section follows. | 0.6 and 2.2 mm | Above 0 in both. |
| Root embed | How far the blade roots sit below the hub surface, so the join holds. | 1.0 mm | 0.3 to 3. |
| Sections per blade | Sections the blade passes through. | 12 | 8 to 24 (10 to 16 is the suggested range). |

The review step reports the radii, blade counts, wrap, section line length and tip pitch, and lists errors and warnings. If a preview fails, the wizard retries with 12, 10 and then 14 sections and tells you which count built.

### Limits and editing

- There is one meridional blade shape. There is no leading-edge sweep, no changing wrap along the span, and no shroud surface. The hub contour's knee is fixed at 75 % of the length.
- Blades are joined to the hub without a root fillet.
- Reopen the wizard by clicking any feature the impeller made.

## Corner holes

Corner holes put mounting holes on a plate in one step, instead of placing each point by hand.

1. Select the plate's flat face and start **Hole** (**Shift+H**). The Point tool is active as usual, and a **Corner holes** card appears at the top right of the canvas.
2. Choose **Place holes**. By default this puts a hole in each of the four corners, 10 mm in from both edges.
3. Confirm the sketch with the tick, as for any hole. The Hole editor opens for the size, kind, fit and depth.

![A rectangular plate seen face-on with the hole sketch open, the Corner holes card at the top right of the canvas, and four hole points placed in the corners.](../img/corner-holes.png)

| Field | What it does | Default |
| --- | --- | --- |
| Inset | Distance from both edges to each hole centre. | 10 mm |
| Match corner fillet | Shown when the plate has equal rounded corners. The inset follows the fillet radius, so each hole is concentric with its corner. | Off |
| Holes along X, Holes along Y | Holes on each row and column, corners included. 2 and 2 is the four corners. 3 adds a hole in the middle of each side. Holes lie on the edge of the grid, never in the interior. | 2 and 2 |

The card shows the hole count and the plate size. Pressing **Enter** in a count field also places the holes. Placing again replaces the earlier corner points. Points you added by hand with the Point tool stay.

Nothing is placed, and the button is disabled, when the inset is 0 or negative, the inset is half the plate or more, a count is below 2 or not a whole number, or the plate has no size. A warning appears, and the holes are still placed, when less than 1 mm of material would be left between a hole and the edge.

To change them later, double-click the hole in the feature tree. The same card appears above the Hole editor, with the button **Update holes**. It re-places the points against the face as it is now (so a plate that changed size is followed) in one undo step. Hole size, kind, fit and depth are left alone. If you moved or dimensioned the points by hand, **Update holes** puts them back on the grid.

Limits: the exact plate outline is used only for a flat face that is a rectangle, with or without equal rounded corners. Any other outline uses its bounding box and says so. The inset is a plain number, not an expression. A hole sketch on a plane that is not a body face (a standard or datum plane) has no card. Use the Point tool there.

See [Holes and threads](../modelling/holes.md) for the hole settings themselves.

## Samples

The **Samples** list includes ready-made examples to open and study: *Spur gear*, *Gear pair*, *Herringbone pair*, *Marine propeller*, *Turbo impeller*, and a plate with rounded corners and four corner holes. Samples made by these wizards reopen in the same editor. Hand-modelled samples (a bevel gear, helical gear, a four-blade propeller) do not.

## Next

- [The library and samples](library.md)
- [Catalog parts](catalog.md)
- [Holes and threads](../modelling/holes.md)
- [The feature tree and history](../modelling/history.md)
- [Equations and variables](../modelling/equations.md)

# Sheet metal

Sheet metal parts are made from one thickness of stock, bent along straight lines. You set a rule (thickness, k-factor and bend radius), make a first plate from a sketch, add flanges, hems and folds, and the kernel builds the folded solid, the flat pattern and the bend table from the same bend arithmetic. Cut, Corner and Convert to sheet shape the plate itself.

## The Sheet metal tab

The **Sheet metal** tab sits between **Frame** and **Surfaces**. It has four groups:

| Group | Commands |
| --- | --- |
| **Rules** | **Rules** |
| **Create** | **Base flange**, **Edge flange**, **Contour flange**, **Convert to sheet**, **Hem**, **Fold**, **Cut**, **Corner** |
| **Flatten** | **Unfold**, **Refold**, **Flat pattern** |
| **Export** | **Flat pattern DXF**, **Bend table (CSV)**, **Bend table (JSON)** |

A part whose first plate you make opens on the tab. That is a suggestion, not a mode: the other tabs stay as they are. A command that cannot run is greyed out, and its tooltip says why (no first plate yet, the sheet is unfolded, no closed sketch). The tool palette has a **Sheet metal** section with the modelling commands; the three exports stay on the tab and in command search (**F**).

The features appear in the tree with these types, each with its own icon (a rule shows its own name): **Sheet metal rules**, **Base flange**, **Edge flange**, **Contour flange**, **Hem**, **Fold**, **Convert to sheet**, **Sheet cut**, **Sheet corner**, **Unfold** and **Refold**. Each command that changes the part is one undo step and opens its editor with a live preview, except **Unfold** and **Refold**, which are one edit with no editor; **Flat pattern** and the three exports only read the sheet.

## The rule

**Rules** opens the one rules editor of the part; on a part with none it adds a rule named **Sheet 2 mm** (2 mm stock, k-factor 0.44). The form has two sections.

| Stock field | What it sets |
| --- | --- |
| Rule name | The name the base and contour flange list and the tree show |
| Thickness | The stock thickness |
| K-factor | The bend allowance factor, `BA = (r + k t) a` |
| Bend radius | The inside radius of a bend |
| Use for the next base flange | The active rule: the one a new base or contour flange starts with |

| Relief field | What it sets |
| --- | --- |
| Relief width | The width of a tear relief, and of the rectangular relief a partial-width flange cuts at its ends |
| Relief depth | How far a relief reaches past the bend line |
| Corner relief | The size of the corner relief |
| Corner relief shape | **Notch**, **Round**, **Rectangular** or **Tear** |
| Gap between flanges | The gap left between two legs made by one edge flange, and between a partial flange and its neighbour |
| Hem gap | The inside radius of a hem |

A field left empty follows the thickness: bend radius = thickness, relief width = thickness, relief depth = thickness / 2 and corner relief = 4 x thickness. **Follow the thickness again** clears those fields. Inside a rule, `Thickness` is that rule's thickness, so a field may be an expression such as `=Thickness*2`.

The corner shape is stored with the rule. The kernel builds **Round**, **Rectangular** and **Tear** reliefs and shows them in the flat pattern and the DXF; a **Notch** is the open corner between two bends. The note under the field is older than the shaped reliefs and still says every corner is a notch: a round relief is the easy check, because it shows as an arc in the corner of the flat pattern.

A file or a script can carry more than one rule. The **Rule** list of a base or contour flange then offers **The active rule** or a rule by name.

## Base flange

**Base flange** makes the first plate: a closed sketch (holes inside it are allowed) extruded by the rule's thickness.

1. Draw and close a sketch, or select it in the tree. With none selected the command takes the last closed sketch.
2. Click **Base flange**.
3. Set **Rule** (**The active rule**, or one by name) and **Build on the other side of the sketch**, then confirm.

A part has one base flange, and it is its first body feature. If the part has no rule yet, the command adds a 2 mm rule named **Sheet 2 mm** first, so the plate has stock to be made of.

## Edge flange

**Edge flange** bends a flange on an edge of the plate.

1. Press **E** and pick one or more edges of the plate. The edge list in the editor takes more picks: **Use selection**, or click them in the view, and press **Done**.
2. Click **Edge flange**.
3. Set the flange, then confirm.

You can also pick the free end of a flange, to add a second flange or a hem on it (a double fold): click the edge at the tip of the flange.

A flange bends towards the face its edge was picked on: an edge on the top (cap) side bends the leg up, an edge on the bottom side bends it down. **Flip direction** reverses that.

| Field | What it does | Default |
| --- | --- | --- |
| Height | How far the flange reaches, measured as **Height measured** says | 10 x thickness |
| Angle | The angle the leg turns through, more than 0 and less than 180 degrees | 90 degrees |
| Bend radius | The inside radius of this bend | The rule's bend radius |
| Height measured | **To the outer sharp**, **To the inner sharp** or **To the end of the bend** | To the outer sharp |
| Flange position | **Inside the outline** (the outer face stays within the plate's edge), **Outside the outline** (the bend starts at the edge) or **Middle** | Inside the outline |
| Flip direction | Bends the leg the other way | Off |

**Chained bends** adds bends after the flange, each on the far edge of the leg before it: **Bend 2 angle**, **Bend 2 height**, its own **Flip direction**, and **Add a bend** (up to 16). Use it for a return lip or a Z section. The flange's radius, **Height measured** and **Flange position** apply to the whole chain.

Four 90 degree flanges made in one feature keep the gap of the rule at their corners, so their legs do not meet. A flange made later next to an existing one trims the existing bend but not its leg.

## Hem and fold

**Hem** folds an edge 180 degrees back against the sheet. Pick an edge and click **Hem**; the editor has **Length** (measured to the outer face of the hem), **Gap** (inside radius, the rule's hem gap by default) and **Flip direction**. The leg is `length - (gap + thickness)` long, so a length below `gap + thickness` is refused. A hem on a neighbouring edge, or one whose flat layout overlaps another flange or hem, is refused.

**Fold** bends the plate along a sketch line. Draw a line in a sketch (the plate's own outline does not count), select it, and click **Fold**. The editor lists **Sketch** and **Line**, then **Angle** (more than 0, less than 180 degrees; 90 by default), **Bend radius**, **Line position in the bend** (**Centre of the bend**, **Start of the bend**, **End of the bend** or **Outer sharp (mould line)**) and **Flip direction**. When the sheet has more than one panel the editor also offers **Panel** (**Automatic**, or P0, P1 ...). The fold follows the sketch line when the sketch changes. The line may cross a hole or window of the plate: the window is cut through the bend, as a **Cut** across a bend is.

## Contour flange

**Contour flange** makes the first plate from an open chain of sketch lines: the plate is bent at every corner and extruded by a distance.

1. Draw an open chain of lines (an L, U or Z section).
2. Click **Contour flange**.
3. Set **Rule**, **Distance** (50 mm at first), the lines in **Lines in the chain**, **Material on the other side of the line** and **Extrude against the sketch normal**, then confirm.

It needs no plate yet and makes the first plate, so a part has either a base flange or a contour flange. The material lies to the right of the direction of travel; **Material on the other side of the line** puts it on the left. The chain is lines only: an arc in the chain is refused.

## Convert to sheet

**Convert to sheet** turns an existing solid bent plate into a sheet, with panels, bends, a flat pattern, a bend table and DXF.

| Field | What it does |
| --- | --- |
| Thickness | The stock thickness. Empty: the kernel reads it from the body, as the gap between its facing flat faces |
| Use ... of rule ... | Fills in the thickness of the active rule |
| Read the thickness from the body | Clears the field, so the thickness is read again |
| Rule | The rule that supplies the k-factor (the active rule by default) |

The converted rule is named **Converted** and becomes the active rule. After it the part is a sheet: edge flanges, hems, folds, cuts and corners work on it, and **Base flange** and **Contour flange** are off.

The body must be a constant-thickness bent plate: flat panels, straight round bends and walls, one connected chain. Sharp corners between panels, cones, tori, free-form bends, reliefs and embossing are refused, and so is a rebuild whose volume differs from the body by more than 1 %. The card gives the kernel's reason.

## Panels

Once the sheet has more than one panel (a flange, a fold or a converted bend), the **Edge flange** and **Hem** editors get an **Edge of a panel** section, and the **Fold** editor gets a **Panel** list. The panels are numbered from **P0**, the base plate; the legs of a flange follow in the order they were made, and the pieces beyond a fold are appended as the folds are made.

| Control | What it does |
| --- | --- |
| Panel | **Panel P0**, **Panel P1** ... |
| Where on the panel | **Free end (tip)**, **Start side**, **End side**, a named wall (for example **Wall e2**), or **Edge of the panel outline, by number** |
| Edge number | The edge's number in the panel's outline, for the last choice |
| Add this edge | Adds the pick to the edge chips |

A pick in the view is found on the folded sheet; this section adds an edge the view cannot reach. The chips show what was added, such as `P2.tip` or `P1 edge 3`. With a single panel the section is not shown.

## Cut

**Cut** cuts the closed regions of a sketch out of the sheet through the flat pattern, across bends too.

Draw the sketch on the plane of the base plate or on a plane parallel to it: its coordinates are flat coordinates, so read the position off the flat pattern, not off a folded leg. Select the closed sketch and click **Cut**. In the editor, tick the regions in **Shapes**, or click them in the view, then confirm.

A plain **Extrude** cut that goes all the way through the folded sheet (through all, or a depth of at least the thickness) and is sketched parallel to the plate does the same, so the part stays a sheet and still unfolds; a shallower pocket turns the part into an ordinary solid.

A slot that crosses a bend shows in the flat pattern and the DXF as a hole across the bend zone, and the folded solid loses the matching wedge of the bend. A rectangular cut along and across a bend is exact in the solid; another outline across a bend is a staircase of small wedges, though the flat pattern stays exact. A region that misses the sheet, removes or splits a panel, or holds an island is refused with the kernel's reason.

## Corner

**Corner** rounds or chamfers a free corner of a panel.

1. Press **V** (vertex mode) and click the corners, or add them from the editor.
2. Click **Corner**.
3. In **Corners**, use **Pick in view** to pick more (click a corner again to take it out) and **Done** when finished.
4. Choose the **Treatment**: **Round** with a **Radius**, or **Chamfer** with a **Distance**. The size carries over when you switch.

Both walls of the corner must be free of bends, the corner convex, and the walls at least as long as the radius or distance. A corner next to a bend is refused. The round is a true cylinder face in the solid and an arc in the DXF.

## Unfold and refold

**Unfold** flattens the body to its flat sheet; **Refold** bends it back from the bend table. Neither has an editor, and each is one edit. While the sheet is unfolded, flanges, hems and folds are refused with **The sheet is unfolded: refold it first**. Unfold then Refold gives the same solid back.

## The flat pattern

**Flat pattern** opens a panel with the drawing of the blank: the outline and the holes, the bend zones in a light tint, and each bend line dashed, numbered and labelled with its angle. Up bends and down bends have different colours. The width and length of the blank are dimensioned on the drawing.

Under the drawing the panel gives the size and thickness, the rule and k-factor, the number of holes (when there are any) and a row per bend: direction, angle, radius, allowance and length. It follows the document, and while a feature editor is open it follows the draft, so a changed height or radius shows at once. **Escape** or **Close** closes the panel. The panel also carries **Flat pattern DXF**, **CSV** and **JSON**.

## Export the flat pattern

**Flat pattern DXF** asks for the options and writes `<part>-flat.dxf`. The last choice is remembered.

| Option | Choices | Default |
| --- | --- | --- |
| DXF version | **R2000** or **R12** | R2000 |
| Units | mm, cm, m, in or ft | mm |
| Layers | **By role (cut, bends)** or **All on layer 0** | By role |
| Layer names | **CUT_OUTER / CUT_INNER** or **OUTLINE / CUT** | CUT_OUTER / CUT_INNER |
| Bend lines | On or off | On |
| Tangent lines (both ends of the allowance) | On or off | Off |
| Bend notes (number, direction, angle, radius) | On or off | Off |
| Note height | The text height of the bend notes, in mm | 3 |

**Write DXF** writes the file; **Cancel** closes the dialog. **Bend table (CSV)** and **Bend table (JSON)** write `<part>-bends.csv` and `<part>-bends.json`, one row per bend with its angle, direction, radius, allowance, length and line in flat coordinates. Both exports are made by the kernel from the flat pattern; a refusal names the field.

## Worked example: a small tray

The tray is 100 x 60 mm of 2 mm stock with 15 mm walls, a rolled rim and a round relief at each corner.

1. **The sketch.** Start a new part named `Tray` and sketch a rectangle on the **Front** plane from (0, 0) to (100, 60). Close the sketch.
2. **The rule.** Open the **Sheet metal** tab and click **Rules**. Set **Rule name** to `Tray 2 mm`, **Thickness** `2`, **K-factor** `0.44`, **Bend radius** `2`, and leave **Use for the next base flange** on. Under **Relief**, set **Relief width** `2`, **Relief depth** `1`, **Corner relief** `4`, **Corner relief shape** `Notch` for now, **Gap between flanges** `2` and **Hem gap** `0.01`. Confirm.
3. **The plate.** Select the sketch and click **Base flange**. **Rule** stays **The active rule** and **Build on the other side of the sketch** stays off. Confirm.
4. **The walls.** Press **E**, pick the four outer edges of the plate (the rim of its top face), and click **Edge flange**. The editor lists 4 edges. Set **Height** `15`, **Angle** `90`, **Bend radius** `2`, **Height measured** `To the outer sharp` and **Flange position** `Inside the outline`; leave **Flip direction** off. Confirm. The plate has four legs.
5. **The rim.** Click **Hem**. Under **Edge of a panel**, set **Panel** `Panel P1`, **Where on the panel** `Free end (tip)` and press **Add this edge**. Set **Length** `5` and **Gap** `0.01`; if the hem curls the wrong way, tick **Flip direction**. Confirm.
6. **The corner relief.** Open **Rules** again and set **Corner relief shape** to `Round`, with **Corner relief** `4`. Confirm: each of the four corners where two legs meet gets a 4 mm round relief.
7. **The flat pattern.** Click **Flat pattern**. With the hem on one of the long sides the panel reads 123.05 x 88.83 mm, 2 mm thick (**128.83 x 83.05 mm** if the first leg is on a short side). **Rule Tray 2 mm, k-factor 0.44** follows, then the bend rows B1 to B5: the four flange bends at 90 degrees and the hem at 180 degrees, each with its direction, radius, allowance and length. The four flange bends have an allowance of 4.523893 mm; the hem has 2.796017 mm.
8. **The DXF.** In the flat panel click **Flat pattern DXF**. Keep **DXF version** `R2000`, **Units** `mm`, **Layers** `By role (cut, bends)`, **Layer names** `CUT_OUTER / CUT_INNER`, **Bend lines** on, **Tangent lines** off and **Bend notes** off; click **Write DXF**. The file is `Tray-flat.dxf`. **Bend table (CSV)** writes `Tray-bends.csv`; **Bend table (JSON)** writes `Tray-bends.json`.

## SolidWorks sheet-metal parts

A SolidWorks sheet-metal part opens as editable sheet-metal features as far as the kernel can read the feature tree back. The mapping is:

| In the file | In the tree |
| --- | --- |
| `Sheet-Metal` with a `Thickness` dimension | **Sheet metal rules**: thickness, bend radius from D1 and k-factor from D2 (a k-factor outside 0 to 1 is dropped) |
| `Base-Flange` | **Base flange**, with the cap outline as the later features left it (corner rounds and rim cuts baked in) |
| `Edge-Flange` and its `EdgeBend` | **Edge flange** with the leg's outline as its profile, the bend's angle and radius, and **Flange position** **Outside the outline** |
| `Cut-Extrude` or a round hole wizard hole through the plate | **Sheet cut** (a square cut in the rim is already in the base flange's outline) |
| Corner rounds, `Flat-Pattern`, cut-list and bend-line sketches | No feature: the rounds are in the outline, the rest has no geometry |

A feature the reader cannot follow stops the read there: the steps before it are editable, and the file's body stays as the imported remainder. That covers a mitre flange, a hem, a jog or a sketched bend, a flange on a curved edge, a leg with a hole made of other curves than a circle, and a bend cut through later. The flange heights and offsets in the file's dimensions are not used; the faces are.

The part is then an ordinary sheet-metal part: the tab, the flat pattern, the bend table and the DXF work on it. See [Importing](../files/import.md).

## Known limits

- There are no commands for a **jog**, a **mitre flange** or a **sketched bend**, and the SolidWorks reader stops at one.
- A flange needs a straight edge of the base. You can pick an arc, but the kernel refuses it; on a base whose outline has arcs, only the straight edges take flanges.
- The **Edge flange** editor sets a flange on the whole edge with a straight leg. The kernel also takes a partial width (`start` and `length`, or `from` and `to`), a shaped leg (`profile`), holes in the leg and a `relief` cut at the ends; no field here sets them.
- A hem on a neighbouring edge is refused, and so is a hem, flange or fold whose flat layout overlaps another. Give the corner a relief.
- A corner of the panel inside a fold's bend zone, and a fold across the edge a flange hangs on, are refused. A fold line that crosses both arms of a U or V shape is refused too: the pieces would be joined twice, so move the line so that it crosses one arm, or fold each arm with its own line. (A hole in the bend zone is cut through the bend.)
- The **Fold** editor has no control for which side stays; the kernel's `fixed` side is not in the form.
- A contour flange takes lines only. An arc in the chain is refused.
- A cut across a bend is exact in the flat pattern and the DXF. In the solid, an outline that is not rectangular is a staircase of small wedges; the sketch is not followed onto folded panels (use a plane parallel to the base); and a region that splits a panel or encloses an island is refused.
- **Convert to sheet** takes constant-thickness bent plates of flat panels and straight round bends, in one connected chain. Sharp corners, cones, tori, free-form bends, reliefs and embossing are refused, and so is a rebuild more than 1 % away from the body's volume.
- A **Corner** is for the free walls of one panel, convex, with walls at least as long as the radius or distance. A corner across a bend is refused.
- The flat pattern is a view: it cannot be dimensioned or put on a drawing sheet.
- While the sheet is unfolded, flanges, hems and folds are refused. **Refold** first.
- The relief shapes are stored with the rule; the form's note about notches is older than the round, rectangular and tear reliefs, which the kernel builds.

## Every Sheet metal command

| Command | What it does | What it needs picked |
| --- | --- | --- |
| **Rules** | The rule of the part: stock, relief and the active rule; adds one on a part with none | Nothing; edits the selected rule if one is selected |
| **Base flange** | The first plate: a closed sketch extruded by the rule's thickness | A closed sketch (selected, else the last); no first plate yet |
| **Edge flange** | A bent flange on the picked edges, with chained bends if you add them | A sheet, not unfolded; one or more edges, or an edge of a panel from the editor |
| **Contour flange** | The first plate from an open chain of sketch lines, bent at every corner | An open chain of lines; no first plate yet |
| **Convert to sheet** | Turns a solid bent plate into a sheet with panels and bends | A solid body; no sheet yet |
| **Hem** | A 180 degree fold that lays the edge back against the sheet | A sheet, not unfolded; an edge, or an edge of a panel |
| **Fold** | Bends the plate along a sketch line | A sheet, not unfolded; a sketch with a line |
| **Cut** | Cuts closed sketch regions through the flat pattern, across bends too | A sheet, not unfolded; a closed sketch on a plane parallel to the base |
| **Corner** | Rounds or chamfers free corners of a panel | A sheet, not unfolded; one or more corners (vertices) |
| **Unfold** | Flattens the sheet; no editor | A sheet that is not unfolded |
| **Refold** | Bends the flattened sheet back; no editor | An unfolded sheet |
| **Flat pattern** | Shows the blank: outline, holes, bend lines and the bend table | A sheet |
| **Flat pattern DXF** | Writes the flat pattern as a DXF with the options you choose | A sheet |
| **Bend table (CSV)** | Writes one row per bend as CSV | A sheet |
| **Bend table (JSON)** | Writes one row per bend as JSON | A sheet |

The same commands, with their ribbon captions and the full availability rules, are in [Commands and shortcuts](../reference/commands.md#sheet-metal-tab).

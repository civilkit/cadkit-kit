# Frames, cut lists and connectors

The Frame feature turns a sketch of lines into a structural frame: every line becomes a member of standard stock (aluminium T-slot, Australian, US and European steel hollow sections, rolled beams, columns and channels, angle, flat or round bar), the corners are mitred or butted, and the hardware that joins the pieces is placed for you. The same frame gives a cut list and a bill of materials that match the model piece for piece.

## Build a frame

1. Draw the skeleton: a sketch (or a 3D sketch) with one line per member. A line that ends on the middle of another line becomes a tee.
2. Choose **Frame**.
3. Pick the **Skeleton**, tick the lines to use, choose the **Profile** and the **Corners** (mitre, or butt with the first line running through), and **Create**.

## Choosing stock

The **Region** list picks which stock the **Profile** list shows: generic and T-slot (the default), Australia, United States, Europe, or all regions. The regional stock is several thousand profiles, so it is not loaded until you pick a region: the list shows "Loading the ... profiles..." for a moment the first time, and the data is then kept for the session. A file that already contains a frame of a regional profile loads that region by itself when it opens, so the frame, its Edit panel and its cut list work at once.

The **Profile** list is grouped by region, standard and kind of section, and the box above it searches the region you picked: type any words of the name, designation, standard or grade (`shs 50 c350`, `ub`, `hss 4x4`, `a500`, `w14x30`, `ipe 300`, `en 10219`, `t-slot`) and only the matching profiles stay in the list. The US sections can also be found by their metric designation (`W360X44`). The profile you are using always stays listed. Under the list, a line shows the region, standard, grade and mass per metre of the stock, its **material** and whether its figures were checked against the published table. A row or grade that could not be verified wears an **unverified** badge; a hollow-section size that the catalogue marks "check availability" says so.

| Group | Standard | Sections | Profiles |
| --- | --- | --- | --- |
| Generic and T-slot | none | T-slot 20, 30, 40; SHS, RHS, CHS and aluminium tube, angle, flat and round bar in a few common sizes | 13 |
| Australia, hollow sections | AS/NZS 1163, grades C250L0, C350L0 and C450L0 | SHS 20 x 20 to 150 x 150, RHS 50 x 25 to 200 x 100, CHS 26.9 to 168.3 mm outside diameter | 221 |
| Australia, rolled steel | AS/NZS 3679.1, 300PLUS | UB, UC and UBP (I sections), PFC (channels), equal and unequal angles, flat bar, round bar | 160 |
| United States, rolled steel | ASTM A992 (W), ASTM A36 (S, C, MC, L) | W 283, S 28, C 32, MC 40 and angles L 137 (AISC Shapes Database), imperial names (W14x30) with the metric designation | 520 |
| United States, hollow sections and pipe | ASTM A500 Gr C (HSS), ASTM A53 Gr B (pipe) | HSS square 107, rectangular 281 and round 128 (every size in the database), pipe 51 (STD, XS and XXS) | 567 |
| Europe, rolled steel | EN 10025-2, S355 | IPE 18, IPE A 18, IPE O 13, IPE AA 14, HE A 24, HE B 24, HE M 24, HE AA 24, IPN 21, UPN 18 | 198 |
| Europe, hollow sections | EN 10210 hot-finished and EN 10219 cold-formed, S355J2H | SHS 242, RHS 383, CHS 263 | 888 |

Each profile is built with its outside size, wall or flange and web thickness and corner radii, so mass in the cut list agrees with the catalogue. Where the catalogue gives a mass per metre, the cut list and bill of materials use it (mass per metre times stock length), and stock without one (your own, the generic sizes) uses the modelled volume and the material density. Where the profile's source is listed, [Frame stock data and sources](frame-stock-data.md) says what it is and what was left out.

### Material of the stock

Each catalogue profile names the steel grade it is made of by default (its `material_ref`), a grade of the [Material editor](../assemblies/appearance.md#the-material): ASTM A992 for W shapes; ASTM A36 for S, C, MC and L; ASTM A500 Gr C (shaped or round) for HSS; ASTM A53 Gr B for pipe; EN 10025-2 S355 for the European rolled sections; EN 10210 or EN 10219 S355J2H for the European hollow sections; AS/NZS 3679.1 grade 300 for the Australian rolled steel. These are **defaults to confirm**: they follow common practice for each family, not a statement by the catalogue, and the line under the Profile list, the bill of materials and the CSV say "default, confirm" next to them. The AS/NZS 1163 hollow sections name their grade (C350L0 and so on) but have no verified material record, so they show it as the grade only. The Australian profiles list grade `300PLUS` (the catalogue's name) and use the material AS/NZS 3679.1 grade 300; see [Materials and appearance](../assemblies/appearance.md#steel-grades-from-the-standards) for the yield values.

When you create a frame from a catalogue profile and the part has no material of its own yet (nothing set, "steel" or Mild steel), the part's material is set to the profile's grade, so Mass properties in Inspect uses its density, and a notice says so. A part that already has another material keeps it, and Edit never changes it. The cut list and bill of materials mass of catalogue stock is the catalogue mass per metre times the stock length; the grade's density is used for stock with no catalogue mass.

**Hollow sections** have rounded corners as the standards give them (outside radius 2 t up to 3 mm wall and 2.5 t above for AS/NZS 1163, 2 t for HSS, 1.5 t for EN 10210 and 2 t to 3 t for EN 10219), and the same hardware choices as the generic tube: a gusset plate by default, tube brackets where the tube is large enough, a plug for each free end, and a levelling foot where the bore can take its stud. Hardware is offered for hollow sections up to the size a frame is built from (rectangular up to 8 in = 203 mm, round up to 8.625 in = 219 mm outside); the larger structural sizes list none, like the open sections.

**Open sections** (UB, UC, UBP, PFC, W, S, C, MC, IPE, HE, IPN, UPN), **angles** and **bars** are mitred or butted like any other stock. Joints, cut angles, the cut list and the weld count work for them. The brackets, gussets, end caps and feet are made for tube and T-slot faces, so these profiles offer none: the **Connectors** section is not shown for them and the parts list holds no hardware. Beams and channels start with butt corners (the first line of a joint runs through). The flanges of an I section lie in the plane of a sketch drawn on a standard plane, and 90 degrees turns the web into it.

Each member is its own body, named like `F3 M2`. Editing the sketch moves the frame, and reopening the frame from the Features tree brings the panel back.

## Connectors

The **Connectors** section of the panel lists the hardware the profile offers. A new frame starts with the profile's defaults:

| Place | T-slot 20, 30, 40 | Steel and aluminium tube |
| --- | --- | --- |
| Joints | L corner bracket with a T-nut and a button head screw in each arm | Gusset plate, welded |
| End caps | Cap over the section on every free end | Plug-style cap on every free end |
| Levelling feet | Pad on a stud that goes into the bore of a leg standing on the floor | Same, for steel tube |

Set any place to **None** to leave it out.

- At a node where three members meet at right angles, T-slot frames get one **3-way corner block** (a cube with a plate on each member and a screw and T-nut in each) in place of two brackets; set **3-way corners** to None to use brackets, or give one joint its own connector. Tubes offer the block and bracket choices, with weld gussets as the default.
- **Bracket on both sides at tees** puts a second bracket on the other side of the through member. A tee row in the joint list has its own **Both sides** box.
- For steel tube, choose a tube bracket or the corner block and tick **Drill tubes and bolt the brackets**: the members get through holes at each plate hole, and a bolt (length worked out for the tube) with a hex nut goes through. The cut list then shows the drilled volume. Without it the brackets are plates, to be welded or drilled later.
- A bracket needs a 90 degree joint with the section square to the corner; a joint where it cannot go is listed with the reason (a gusset has no angle limit).
- Click a bracket, a corner block or a member near a joint in the model to pick that joint: it lights up and its row in the **Joints** list is selected. Hover a bracket to light its joint; tap works the same on a touch screen. Click a row to light the joint in the model.
- The **Joints** list shows every joint of the frame (the two lines, the angle and the corner type). Pick **None** or another connector for one joint; **Default** goes back to the frame's choice. A tee joint takes one bracket, on the side the through line points to.
- Feet go on the free lower end of a vertical member that stands on the lowest level of the frame. Other free ends get caps.
- The **Parts list** under the Connectors updates with every change and is what the model holds: brackets, T-nuts, screws, caps and feet are real solids, each its own body (`F3 H7`).

Fasteners are modelled at their nominal size sitting in the existing slot and bore; threads are not modelled. Add your own stock and hardware to the library as described in `apps/cad/src/frame/profiles.json`.

## Your own stock and fittings

Open **My stock and fittings** at the bottom of the Frame panel. **Download example** gives a small valid file to start from; **Import file** (or paste the text) adds your profiles, fittings and materials. The file is checked first: every problem is listed with its place in the file (for example `profiles[0].section.t: needs a number above 0 (mm)`), and nothing is imported unless it is all valid. A good library is kept in this browser and offered in the Profile list and the connector lists. Frames that use your stock keep a copy of it in the file, so someone who opens the file without your library still sees the right profile, hardware and bill of materials. **Forget my library** removes it from this browser only.

The file has three parts, all in millimetres:

```json
{
  "materials": { "brass-cz121": { "label": "Brass CZ121", "density": 8.5e-6 } },
  "fittings": {
    "my-hex-m5": { "label": "Hex head bolt M5", "kind": "bolt", "spec": "ISO 4017 M5", "part": { "d": 5, "headD": 8, "headH": 3.5 } },
    "my-nut-m5": { "label": "Hex nut M5", "kind": "nut", "spec": "ISO 4032 M5", "part": { "af": 8, "t": 4 } },
    "my-bracket-30": { "label": "Bracket 30 tube", "kind": "bracket", "spec": "28 x 28 x 3 L angle", "part": { "kind": "lbracket", "arm": 28, "t": 3, "w": 26, "hole": 5.5, "holeAt": 17, "bolt": "my-hex-m5", "nut": "my-nut-m5" } },
    "my-cap-30": { "label": "Plug 30", "kind": "cap", "spec": "30 x 30, 3 thick", "part": { "kind": "cap", "t": 3 } }
  },
  "profiles": [{
    "id": "my-shs-30x30x2", "label": "My SHS 30 x 30 x 2", "family": "shs", "material": "brass-cz121", "corner": "mitre",
    "section": { "kind": "rectTube", "w": 30, "h": 30, "t": 2 },
    "fittings": [{ "id": "weld", "per": "joint", "qty": 1 }],
    "hardware": { "joint": ["my-bracket-30"], "cap": ["my-cap-30"] }
  }]
}
```

- **Sections** are `rect`, `rectTube`, `roundTube`, `roundBar`, `angle`, `channel`, `ibeam` or `tslot`, with their dimensions (`w`, `h`, `t`, `d`, `s`...). `rectTube` also takes an outside corner radius `r`. `channel` takes one thickness `t` or its own flange `tf` and web `tw`, and a root radius `r`. `ibeam` has flanges `w` wide, depth `h`, flange `tf` and web `tw` thickness and root radius `r`. Optional catalogue fields on a profile (`region`, `standard`, `grade`, `designation`, `mass_per_m_kg`, `source`) are kept and shown in the list and the bill of materials.
- **Fitting parts** are `lbracket` (`arm`, `t`, `w`, `hole`, `holeAt`), `gusset` (`leg`, `t`), `corner3` (`block`, `arm`, `t`, `w`, `hole`, `holeAt`), `cap` (`t`) and `foot` (`base`, `baseH`, `studD`, `studLen`, `neck`). A bracket or block names its fasteners by fitting id: `tnut` and `bolt` for T-slot stock, `bolt` and `nut` for drilled tube. Bolts have `d`, `headD`, `headH` (the length is set by the model), T-nuts `l`, hex nuts `af` and `t`.
- **Hardware** lists, per place (`joint`, `corner3`, `cap`, `foot`), the fitting ids a profile offers; the first is the default.
- Ids must be new: the built-in ones cannot be replaced.

## Cut list and bill of materials

**Cut list** opens the Drawings workspace on a drawing of the frame: isometric, front and top views with the pieces numbered, the cut list (profile, stock length, cut angles, quantity, mass) and the bill of materials. The bill of materials is grouped (stock, connectors, fasteners, caps and feet, process) and lists every bracket, nut, screw, cap and foot with its quantity and specification. Stock lines also give the **standard**, **grade** and **material** of the profile and the **total mass** of all its pieces in kilograms (catalogue mass per metre times stock length; stock without a catalogue mass uses its volume and density). Export it as PDF, SVG or DXF, or the two tables as CSV.

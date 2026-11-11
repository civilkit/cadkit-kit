# Frame connectors: brackets, fasteners, caps, feet

Status: implemented in the kernel `frame` feature (`hardware`) and the Frame panel.

## Goal

A frame is built from stock and the hardware that joins it: pick a profile, draw lines, get brackets, T-nuts, bolts, end caps and feet
in the right places, and a bill of materials that matches what is in the model. No hand placement for the common case, an override
for the rest.

## Model

A connector is a catalog part: an `id`, a `kind`, a few dimensions and a label/spec the BOM prints. The catalog lives in
`apps/cad/src/frame/profiles.json` under `fittings` (existing entries keep working; geometry is an optional `geom` object). A
profile names its default connectors under `hardware`:

```json
"hardware": { "joint": "bracket-30", "cap": "cap-30", "foot": "foot-30" }
```

Kinds (kernel builds the solid from the kind and its dimensions plus the section it is placed on):

| kind        | geometry                                                                 | goes on                      | fasteners                    |
|-------------|--------------------------------------------------------------------------|------------------------------|------------------------------|
| `lbracket`  | L angle bracket: two flat arms with a through hole each                  | inner corner of a joint (90 deg) | bolt + T-nut per arm (T-slot) |
| `gusset`    | triangular plate in the corner plane, welded                             | inner corner of a joint, any angle | none (weld)             |
| `corner3`   | 3-way corner block: a cube in the inner octant with a plate on one face of each of three members | node of three members at right angles (equal flat sections) | T-nut + screw per plate (T-slot), drilled hole + bolt + hex nut (tube) |
| `cap`       | plate over the section outline, flush on the end face                     | every free member end        | none                         |
| `foot`      | round pad + stud (levelling foot)                                        | free lower end of a vertical member on the lowest level (down = -Y, the kit is Y up; `hardware.down` overrides) | none |
| `tnut`, `bolt`, `nut` | children of an `lbracket` or `corner3`; the T-nut sits in the slot's undercut, the bolt runs through the arm hole into it | | |

## Regional stock libraries and open sections

The built-in `profiles.json` holds the generic sizes and the T-slot series. Three generated files add catalogue stock: `profiles.au.json`
(AS/NZS 1163 hollow sections, AS/NZS 3679.1 UB, UC, UBP, PFC, angles and bars), `profiles.us.json` (AISC W, S, C, MC, L, ASTM A500 HSS, ASTM A53 pipe)
and `profiles.eu.json` (IPE, IPE A/O/AA, HE A/B/M/AA, IPN, UPN, EN 10210 and EN 10219 hollow sections). They are written by
`tools/build_frame_profiles.mjs` from the source data in `apps/cad/src/frame/data/` and are **loaded on demand**: `frameLib.ts` imports each with a
dynamic `import()` (one bundle chunk per region) through `loadRegion(region)`, which expands the file (`defaults.material`, `defaults.fittings` and a short
`source.ref`) into `PROFILES` once and notifies `onRegionLoaded` listeners. `profileById` is synchronous and returns `undefined` for a profile whose region is not
loaded, so code that reads a document or a kernel report first calls `ensureProfiles(ids)` / `ensureForDocument(features)` (the app does this when a document
opens, when a frame is edited and before the cut list); the id prefix (`au-`, `us-`, `eu-`) names the region. The Frame feature itself embeds the profile section, so
the kernel never needs the library. Headless code and tests call `loadAllRegions()`. A catalogue profile adds `region`
(`AU`, `US`, `EU`; none for generic and T-slot), `standard`, `grade`, `designation` (US also `designation_metric`), `mass_per_m_kg`, `material_ref` (an id of the Material
editor catalogue, `apps/cad/src/materials.ts`) with `material_default` (a default to confirm, not a published fact), `manufacturing` and `check_availability` (EU hollow)
and `source` (`document`, `table`, `verified`). Hardware is offered only for hollow sections up to frame size (rectangular up to 203.2 mm, round up to 222.25 mm).
The cut list and BOM mass is `mass_per_m_kg x stock length` when the profile has one, else volume x density (the catalogue grade's density where `material_ref` is set);
the BOM stock line carries `standard`, `grade`, `material` and `massKg`. Creating a frame from a profile with a `material_ref` sets the part's material when the
part has none of its own (`partMaterialFor`). Sources and checks: guide page "Frame stock data and sources".

Section kinds the kernel builds for them: `rectTube` with the outside corner radius `r` (hollow sections), `roundTube`, `angle`, `rect`,
`roundBar`, and the kinds added for rolled steel, `ibeam {w, h, tf, tw, r}` and `channel {w, h, tf, tw, r}` (own flange and web
thickness and root radius; the old one-thickness `channel {w, h, t}` still reads).

Hardware is gated by section: hollow sections (`rectTube`, `roundTube`) get a gusset by default, a tube bracket by size (smallest outside
dimension 25 to 100 mm), a plug per outline and a levelling foot where the bore is at least 15 mm. Open sections (`ibeam`, `channel`), angles
and bars list no `hardware`: the plates, brackets, caps and feet are placed on the flat faces of tube and T-slot stock, so these profiles
mitre, butt and tee, and are counted (cut list, weld per joint, BOM), but no connector is offered.

## How it attaches: generated inside the frame feature

Two options were weighed.

1. Reuse the mate system (`insertPart` + mates from named features). Right for a loose assembly, but each bracket would be a separate
   part document, the corner type and the member's section axes would have to be re-derived as mate references, and a frame edit
   (longer sketch, other profile) would leave the mates to be re-solved. A BOM would come from the assembly walk, not from the frame.
2. Generate the geometry in `frame` from what it already knows per joint: node, the two member directions, section axes and reach
   (support function) on each side. The inner corner point P solves two plane equations, so placement is exact for any member
   section and follows the skeleton on edit with no solver. The cut list and the hardware list come out of the same pass.

Chosen: 2. It is one deterministic pass, nothing is stored per bracket, and the BOM can be the placement list itself (parts counted in
the kernel reply equal bodies in the model by construction). Mates stay the tool for hardware that is not frame-driven.

### Placement

For a joint of members A, B at node N (directions into the members `u1`, `u2`): `w1` is the unit part of `u2` normal to `u1`, `w2`
likewise. `P` is the inner corner, `(P-N).w1 = reach_A(w1)`, `(P-N).w2 = reach_B(w2)`, in the plane of the corner. Arm 1 lies on A's
face (along `u1` from P, `reach_A(w1)` .. `+t` out along `w1`), arm 2 on B's face. Width is centred on the corner-plane normal.
The same formula serves mitre, butt and tee joints, because it reads only the members' end positions and sections.

Joints: a mitre/butt/inline end pair is one joint; at a node with 3 or more members, the through member pairs with each other member
(a table corner with a leg = two brackets). An `lbracket` needs 90 deg (+-1) and a section axis along each face normal; otherwise the
joint reports `skipped` with the reason (use a gusset, which has neither limit).

### Tees, corner blocks, drilling

- **Tee, both sides.** `hardware.teeBoth` (or `joints[].both`) places a second bracket on the other side of the through member, mirrored along it. Each is a placed body, so the BOM counts it.
- **Corner block.** At a node of exactly three members at right angles, `hardware.corner3` places one block instead of the pairwise brackets. The inner octant touches each member only along an edge, so the block is a cube plus a plate on one face of each member (arranged cyclically: member i takes the face that looks towards member i+2), the plates meeting the cube across a face. The block is built by union (one solid, one part number), with a hole per plate. It needs flat sections of equal reach square to the corner; otherwise, or when a joint at the node has its own `connector`, the node falls back to pairwise brackets. Chosen as the default for T-slot (one part and three screws instead of two brackets and four, and stiffer); tubes keep weld gussets as default and offer the block.
- **Drilling.** `hardware.drill: true` makes the tube members (`rectTube`; plates need flat faces) carry through holes at each bracket and block hole, in both walls. The bolt (`bolt` of the part) runs through plate and both walls into a hex nut (`nut {af, t}`) on the far face. Its length is worked out (plate + section + nut + 1, up to the next 5 mm) and goes in the part id (`hex-m6x50`), so BOM rows are per length. The cut list shows the drilled volume and a `holes` count. With drilling off, tube brackets are plates only (to be welded or drilled later). A round tube has no flat face: no bracket there (a reason is listed).

Joints in the reply carry `bodies` (the hardware bodies placed there), which is how a click on a bracket finds its joint in the Frame panel.

### Payload

```
"hardware": {
  "joint": <part>,      // default for every joint; absent = none
  "cap":   <part>,      // end cap on free ends; absent = none
  "foot":  <part>,      // levelling foot on free lower ends of vertical members
  "corner3": <part>,    // 3-way block at right-angle nodes of three members
  "teeBoth": true,      // a bracket on each side of the through member at tees
  "drill": true,        // drill tube members and bolt through them
  "down": [0,-1,0]      // the direction feet point (default -Y)
}
"joints": [{ "segments": ["e1","e2"], "corner": "butt", "connector": "none" | <part> }]
```

`<part>` is `{id, label, kind, ...dimensions, tnut?: {...}, bolt?: {...}}` (the kit resolves ids to this from the catalog). The
reply adds `hardware: {parts: [{id, label, kind, spec, qty, bodies}], joints: [...], skipped: [...]}` to the frame entry.
Hardware bodies are `<frame id> H<k>`, faces `<frame id>.H<k>.*`; with no `hardware` key a frame is exactly as before.

## BOM

`bom()` in `frameLib.ts` reads the kernel's `hardware.parts` (grouped by part id, qty = bodies). Library `fittings` of the kinds the
kernel places are skipped when a frame has `hardware`; the rest (weld, anything with no geometry) stay as counted rows. The table in
the Drawings workspace and the CSV use the same list.

## User library

`extendLibrary` is the one entry point. The panel's "My stock and fittings" section imports a JSON file (or pasted text) in the shape of `profiles.json`: `profiles`, `fittings`, `materials`. `validateLibrary` checks it and lists every problem with its path (unknown kinds, missing dimensions, ids already built in, references to missing fittings, a fitting of the wrong kind for its place); nothing is imported unless all of it is valid. A valid library is stored in the browser (`ck.frame.userlib`) and loaded at start-up. A frame that uses a user profile also writes that profile, the fittings and the material it needs into its own `library` field, and opening such a file adopts what the browser does not already know, for the session only. A shared file therefore prices and edits the same on a machine that never imported the library.

## Not done

Coped or saddle tube ends, gusset on non-axis-aligned sections, thread detail, washers, tube plug stems, a corner block on round tube or
members of unequal size, drilling for gussets (they are welded).

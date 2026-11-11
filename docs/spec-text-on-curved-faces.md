# Text on curved faces: spec

Status: draft, 2026-10-17; checked against the code 2026-10-31. Still nothing here is built: there is no wrap or project mode, no "Follow face" choice in the text panel and no kernel surface mapping for text (text is flat on its sketch plane, as `docs/text.md` and the guide say). The fonts work this was waiting on is done (fonts from bytes, font picker, fonts saved with the document). The motor samples fake the effect by placing each letter flat on its own tangent plane; that is a workaround, not this feature. Remaining: everything below (surface mapping, outline to curves on the face, tool body, boolean, project mode, GUI).

## Why

Text today lives in its own flat sketch and goes in as a flat shape (`text` sketch entity, `ck-text`). Lettering on a cone
(a dial, a bottle, a knob) or a cylinder needs the letters to follow the face.

## Two modes

| Mode | Works on | How | Result |
|---|---|---|---|
| **Wrap** | planes, cylinders, cones (surfaces that unroll flat) | map the text outline from the flat sketch onto the face so arc lengths along the face are kept | letters bend around the face without stretching |
| **Project** | any face | project the outline along a direction (or along the face normal) onto the face | works on domes and free-form faces; letters stretch where the face is steep |

Wrap is exact: a cylinder unrolls to a rectangle, a cone to a circular sector. Project is the fallback.

## User flow

1. Pick a face, then the Text tool. The text panel (existing) gets a "Follow face" choice: Off (flat, as now), Wrap, Project.
2. Position: the text origin, rotation and baseline direction are given in the face's own coordinates (for a cylinder: height and angle; for a cone: slant distance and angle). A drag on the face moves it.
3. Depth and mode: Emboss (raise) or Engrave (cut), a height, and an optional draft on the letter walls.

## Kernel work

1. **Surface mapping.** For each supported surface type, forward and inverse maps between sketch (u, v) and the face:
   cylinder (u = arc length, v = axis), cone (polar sector from the unrolled slant), plane (identity).
2. **Outline to curves on the face.** Take the glyph outlines (already available from `textOutline`), subdivide, map the points
   onto the face, then fit curves (the existing B-spline fitting) so the tool body's boundary lies on the face within tolerance.
3. **Tool body.** Build each letter as a body bounded by the face-mapped outline and an offset copy (outward for emboss, inward
   for engrave) with side walls along the face normal. For a cylinder and cone the offset is exact (a coaxial surface).
4. **Boolean** onto the target body: union for emboss, cut for engrave. The target is a curved face with tiny tool
   features, which is the kind of boolean that has failed before (see `docs/kernel-bug-text-lens.md`), so first fix or
   characterise that bug.
5. **Project mode** reuses 2 to 4 with a ray cast (the `probe` ray code) to find the hit on the face and the normal there.

## Order of work

1. Cylinder wrap (emboss and engrave) with tests: volume change equals letter area x height within 1e-3, valid solid.
2. Cone wrap (same tests, plus the dial case).
3. Project onto any face.
4. GUI: "Follow face" in the text panel, drag on the face.

## Limits to state in the UI

- Text longer than the face wraps past a seam or the cone apex: refuse with a message naming the limit, do not silently clip.
- Very small text (below about 0.3 mm stroke) may not boolean cleanly; warn.
- Not planned: text along an arbitrary curve (path text) or across several faces.

## Tests

- Cylinder: "ABC" engraved 0.4 mm on R = 20 mm, valid, volume change within 1e-3 of area x depth.
- Cone with the tip clamp case (just below the tip), and a frustum.
- Letters crossing the cylinder's seam.
- Round trip: save, load, regen gives the same volume.

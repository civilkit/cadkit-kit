# Display styles and appearance

Everything here is viewer-only: nothing is written into the part file. `packages/part-model` has no `color` or `appearance`
field (checked in `rebuild/packages/part-model/src`), so per-part colour and material are kept in `localStorage` under
`cad.look`, keyed by part name. Per-feature or per-face colour needs a field in the document format and is not done.

## Display styles (Display popover, View tab "Style", Alt+1..5)

| Style | Faces | Edges |
|---|---|---|
| Shaded | lit | none |
| Shaded with edges (default) | lit | follow the Edges layer |
| Wireframe | colourless, but still hides and picks | always; hidden edges faint (second pass, no depth test, 18 percent) |
| Hidden lines removed | flat white | always, black |
| Ghost | translucent, opacity slider (5 to 100 percent), no depth write | follow the Edges layer |

Picking, hover and selection highlights work in every style: the body mesh stays in the scene (wireframe uses
`colorWrite = false`), so raycasts are unchanged. While a sketch is edited the body is capped at 25 percent opacity on top of
the style (`applyBodyLook(..., fade)`), and restored when the sketch closes.

## Appearance

A palette of eight colours plus a material preset: default, matte plastic, brushed metal (low roughness, high metalness), glass
(35 percent opacity). The Material row of the tree shows a colour chip. Presets are data in
`packages/viewport/src/styles.ts`.

## Hide and show

H hides the body of the selected faces, edges or corners, or the selected sketch, plane or curve feature. Alt+H (or the
"Show all" button in the popover) shows everything. Hidden state is for the session and is not saved. A hidden body also stops
picking. Parts have one body, so "hide body" hides the whole solid.

### Hiding a feature from the tree (the eye)

The eye on a history row hides exactly what that feature made, in the view only: no kernel call, no rebuild, not saved. It
adds the feature id to `lookStore.hidden.ids` (the same list sketches, planes and surface bodies already used). The viewport
drops the triangles and edge lines whose names belong to a hidden feature (`withoutOwned` in `meshgeom.ts`; owner = the id
before the first dot of a face name, or the component id in an assembly), and its sketch curves, curves and plane. Faces a
later feature consumed are simply not there any more, so only what is still visible from the feature is hidden. Hidden faces
stop picking. The row is dimmed and shows a closed eye; clicking it again, Alt+H or "Show all" restores. Suppress (which
rebuilds) is a separate button with a pause glyph, tooltip "Suppress (rebuilds)".

## Lighting and background

Lighting: studio (default), flat, high contrast. Background: theme (the `--vp-bottom` token), light, dark, gradient
(`--vp-top` to `--vp-bottom`, redrawn on theme change).

## Code map

- `packages/viewport/src/styles.ts`: pure specs, material factories, presets (tests in `styles.test.ts`).
- `packages/viewport/src/viewport.ts`: hooks `setLook`, `setLighting`, `setBackground`, `setHidden`.
- `apps/cad/src/look.ts`: state, sanitising, hide rules, signals; `lookCommands.ts`: commands and keys.
- `apps/cad/src/DisplayMenu.tsx`: popover sections.

## Not done

- Silhouette edge emphasis (needs an extra outline pass; not cheap).
- Realistic rendering and a material library.
- Hiding one chosen face (hiding all faces of one feature is done, see above). Hiding a datum plane of the three base planes.
- Colour stored in the document: needs a kernel/part-model field.

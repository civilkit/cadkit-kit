# Materials

The first row of the history tree ("Material: steel", with a colour chip) opens the Material editor: click it, press Enter or F2 on it, or use the pencil that shows on hover. The editor opens in the left panel (Editor tab when the tabs are on, otherwise in place of the tree), with OK and Cancel like the other editors. Enter applies, Escape cancels.

## The editor

- A search box and a list of materials grouped by category: Steel (mild, stainless 304 / 316, tool), Aluminium (6061, 7075), Copper / brass / bronze, Titanium, Cast iron, Plastics (ABS, PLA, PETG, Nylon, Polycarbonate, Acetal, PEEK), Wood (oak, pine, MDF), Rubber, Glass, Concrete, Custom. Search matches a word of the name or of the category.
- Each entry has a density (kg/m3), a default display colour and, where usual, Young's modulus (GPa), Poisson's ratio and yield strength (MPa). The values are textbook figures for choosing a mass, not for certifying a design.
- "Custom material..." takes a name, a density and a colour. Custom materials are kept in the browser (`localStorage`, key `cad.materials.custom`; every access is wrapped in try/catch, so a blocked store only means they last for the session) and appear under Custom with a remove button. A custom name may not equal a built-in one.
- A live swatch, the properties of the picked material and the mass of the current part at its density ("was ..." shows the mass it has now). The volume comes from the same kernel mass-properties path Inspect uses (`controller.massProps()`).
- "Use material colour" (remembered in `cad.materials.useColour`, on by default).

## What Apply changes

| What | How |
| --- | --- |
| `doc.material` | The material's name (for example `Aluminium 6061`). The part file keeps the string only, as before; densities and colours are looked up from the catalogue by name. Older names (`steel`, `aluminium`, `stainless steel`...) resolve to catalogue entries. |
| Undo | One step. The session has no document-level edit op (like the part name), so `Controller.setMaterial()` keeps the material beside the session and a small step list in order with the session's history: undo and redo walk both in the order they were made, and a new edit clears redo. |
| Tree | The row label and the swatch update. |
| Viewport | Colour = the colour picked in Display > Appearance if there is one, otherwise the material colour (when "Use material colour" is on), otherwise the default (`effectiveAppearance` in `look.ts`). Nothing about the material colour is stored in the look, so undoing the material undoes the colour too. Choosing the default grey swatch in Display does not count as an override. |
| Inspect | The density default comes from the catalogue first (`densityOf` in `inspect/mass.ts`, still g/cm3 there), then the older name table. |
| Saved file / autosave | `controller.document()` carries the material, so Save, Save as and autosave write it and the unsaved-changes dot lights. |

## Limits

- The History log lists session edits only, so a material change is not a row there (it is undone with Ctrl+Z all the same; "revert to step" undoes it on the way back).
- A custom material is defined in the browser that made it. A file that names a custom material opened elsewhere keeps the name, but Inspect then asks for a density (the editor pre-fills the name as a new custom material).

## Tests

`apps/cad/src/materials.test.ts` (catalogue, lookup, custom storage, blocked storage), `MaterialEditor.test.tsx`, `controller.material.kernel.test.ts` (undo / redo order with edits, needs `CK_WASM`), `look.test.ts` (colour rule), `packages/ui/src/FeatureTree.test.tsx` (the editable row).

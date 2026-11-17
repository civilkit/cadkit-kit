# Unified Extrude, Revolve and Loft card (design spec, 15 Nov 2026)

Status: proposal, no code. Goal: one editor card per family with **Solid / Surface / Thin** tabs and a **New / Add** row (Cut kept), like Onshape's Extrude dialog, so Extrude, Thin extrude and Extruded surface (likewise Revolve, Loft) stop being three separate things to find.

## Today

| Family | Solid | Thin | Surface |
|---|---|---|---|
| Extrude | `extrude {op, body, target, sketch, end, depth, flip, draft, twist, start*, regions}` | same type, `thin: {thickness, side, ends, cornerStyle}` (commands `add-thin-extrude`, `add-thin-cut`) | own type `surfaceExtrude {sketch, end, depth, flip}` (`add-surface-extrude`) |
| Revolve | `revolve {op, body, target, sketch, axis, end, angle, flip}` | same type, `thin` (`add-thin-revolve`) | own type `surfaceRevolve {sketch, axis, end, angle, flip}` |
| Loft | `loft {op, body, target, sketches, guides, centreLine, ...}` | none in the kernel | same type, `surface: true` |

Thin and Loft-surface are already parameters of the solid type. Only Extrude and Revolve surfaces are separate types, and `asSurfaceOp` (thinRules.ts, used by the open-profile card's "Extrude as surface") already converts an extrude into a `surfaceExtrude` with the same id in one `replace`.

## (a) Tabs switch the stored type or add a mode param?

Decision: **no new mode param, no migration.** The tab is derived from what is stored, and switching writes the existing representation:
- Solid = `extrude` / `revolve` / `loft` without `thin` / `surface`.
- Thin = the same type with `thin` present (as now).
- Surface = `surfaceExtrude` / `surfaceRevolve` (type swap, same `id`, one `replace`), and `loft` with `surface: true`.

Why: (1) every saved document, script, agent edit and kernel test keeps loading unchanged; (2) downstream code keys on the type: `SURFACE_TYPES` (viewdata), `isSurfaceFeature`, `surfaceTarget`, Knit/Trim/Thicken pickers, help (`feature:surfaceExtrude`), the Surfaces tab body registry; a `mode` param on `extrude` would make all of these inspect params, and would need a kernel change for a pure UI concern; (3) the kernel keeps validating each shape strictly (a surface has no `op`). Cost: a pure converter `convertFeature(eff, tab)` (replaces `asSurfaceOp`) that maps fields, and the card reading `tabOf(eff)`. Face names of a solid and its surface twin share the feature id prefix but not the same topology, so later features that reference the faces can fail after a switch; the live preview shows the kernel's reason, as for any edit.

The type change is part of the **draft** (previewed, undone by Cancel, one undo step on OK). Today's `asSurface` commits immediately; that goes away.

## (b) New / Add today, and what is missing

Today the card's Operation row is **New / Add / Cut** (`opChoices`, `opPatch`): New = `op: 'newBody'` plus a body name, Add joins the target body (`target` picks which), Cut removes (`target` list = "Cut from"). Loft has the same options as a select, hidden when `surface` is on. The default is chosen by `defaultExtrudeOp` (first solid adds, a sketch that misses the body is New, Cut commands start on Cut).

Mapping in the unified card: Solid and Thin tabs show New / Add / Cut unchanged (Cut stays: it is what `add-cut` and `add-thin-cut` open on). Missing:
1. **Intersect** (Onshape has it): kernel `op` is only `add | cut | newBody`. Out of scope; needs a kernel op. Not shown.
2. **Surface New / Add**: surfaces have no `op`. New is implicit. Onshape's Add (merge into an existing surface) is today the separate Knit command. Proposal: on the Surface tab the row shows only New, with Add disabled and a one-line reason ("Surfaces join with Knit"); a later step may make Add create the feature plus a Knit.
3. **Surface Cut** needs `cutWithSurface`, not in the kernel. Hidden on the Surface tab.
4. **Thin loft** has no kernel support: the Thin tab is disabled for Loft with the reason ("Make a surface loft, then Thicken").

## (c) Old buttons as shortcuts

Command ids, labels, keys (Shift+E, Shift+C, Shift+R, Shift+O), menu entries, scripts and the search palette are **unchanged**. Each `run` goes through one function `openFamily({family, tab, op})` that creates the feature already in that state (what `addExtrude(op, thin)` does now: thin => `thin` set, cut => `op: 'cut'`, surface => `surfaceExtrude`) and opens the card, so the user lands on the right tab. A new feature opens on the tab its command names; later the user can switch.

Ribbon (the layout test requires every command exactly once, so nothing is dropped, only regrouped; Surfaces keeps its plain buttons as just fixed by the GUI audit):
- Home > Create: `extrude` slot = `add-extrude`, `add-cut`, `add-thin-extrude`, `add-thin-cut`; new `revolve` slot = `add-revolve`, `add-thin-revolve` (replaces the bare button); the old `thin` slot is deleted; `loft-sweep` unchanged. The slot shows the last used, as now. RAIL_SECTIONS gets the same slot edits.
- Surfaces > Create: `add-surface-extrude`, `add-surface-revolve`, `add-surface-loft` stay as they are.
- Net effect: Home loses one slot; no id is placed twice.

## (d) Switching tabs mid-edit

`convertFeature` carries over what both sides read: `id`, `name`, `suppressed`, `sketch`, `flip`, `end` (only `blind` / `mid`; any other end falls back to `blind` and the depth), `depth` / `angle`, `axis` (revolve). Solid <-> Thin: everything carries, and Thin gets defaults (`defaultThickness`) the first time. Solid/Thin -> Surface drops `op`, `body`, `target`, `draft`, `twist`, `start*`, `endRef`, `endOffset`, `regions`, `thin`. A Surface -> Solid switch starts from `op: 'add'` (or `new` when the sketch misses the body, via `defaultExtrudeOp`). Loft: only `surface` and `op` / `body` / `target` change; sketches, guides, centre line and connectors always carry.

Dropped fields are **stashed in the open card session** (not saved) per tab, so Solid -> Surface -> Solid restores draft, twist and target; the stash is cleared when the card closes. If a field is dropped that the user had set (draft, twist, a non-blind end, a target), the tab shows a one-line note ("Draft and Cut-from are not used by surfaces").

## (e) Help, search, guide, i18n, tests

- Help: `HELP` is keyed by feature type, so each type keeps its entry. Add a "Solid, Surface and Thin" subsection per family in the guide (modelling/solids, modelling/surfaces point to it) and make the card's help button open that section for any tab; `helpMap.test.ts` checks the anchors.
- Search palette: keep all existing command ids and labels; add the words surface / thin / solid to the tips (`tip.*`) so "thin" finds Extrude as well as Thin extrude. No new commands.
- Guide: rewrite the Extrude, Revolve, Loft sections around the tabs; fill the audit's gap (the guide never mentions surfaceRevolve).
- i18n: new keys `opt.tab.solid|surface|thin`, the tab notes and disabled reasons, in en.ts and the other locale files; existing `cmd.*` and `rb.*` keys stay.
- Tests: `toolbarModel.test.ts` (slots, once-only); a pure `extrudeModes.test.ts` (tabOf, convertFeature round trips, stash restore, every dropped field); `optionRules.test.ts` (`managedPaths` for the surface types, since they now use the same card); a kernel test that each converted feature rebuilds; a component test for the card tabs and disabled states; one browser test per family: old button opens the right tab, switching previews, Cancel restores, undo is one step, a pre-change saved document loads.

## (f) Tasks, smallest first

1. Pure `tabOf` and `convertFeature` plus tests; make `asSurfaceOp` use it.
2. Ribbon and rail slot regroup (thin slot removed, revolve slot added) plus `toolbarModel` test.
3. i18n keys and tip keywords.
4. Tab strip in the card for Extrude and Revolve (Solid/Thin/Surface), tab state in the draft, previewed through `replace`, Cancel reverts.
5. Surface tab fields: reuse the End and Depth/Angle/Axis sections of `ExtrudeOptions`; hide Operation, Draft, Twist, Start, Thin; add the notes.
6. Stash of dropped fields per card session.
7. Old commands go through `openFamily`; open on the right tab.
8. Loft tabs: Solid/Surface on the existing `surface` flag, Thin disabled with a reason.
9. Guide sections, help anchors, the browser tests.
10. Optional: Surface Add (feature plus Knit); later kernel work: Intersect, thin loft, cut with surface.

## Open questions for the owner

1. Should Surface "Add" really create a Knit (step 10), or stay a hint that points at Knit?
2. Keep the label **Cut** or use Onshape's **Remove**? (Today's strings and help say Cut.)
3. Is a Thin loft wanted enough to ask for a kernel option, or is "surface loft then Thicken" the answer?
4. Should a converted feature whose later features reference its faces be blocked, or only previewed with the kernel's error as now?

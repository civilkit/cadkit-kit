# Research: sketch constraint workflows in other CAD products

Date: 2026-10-19. Web research only; no code was changed. Companion to `plan-sketch-constraints.md` and `sketch-tools.md`.

## How to read the evidence

Every claim carries a tag:

* **[doc]** official vendor help, API reference or vendor blog.
* **[3p]** third-party training provider, reseller blog, tutorial or university page.
* **[forum]** user forum or Q&A; may be outdated.
* **[?]** could not be verified. Either the page refused automated fetch (SolidWorks help is JavaScript driven and returned only navigation chrome; Siemens help, FreeCAD wiki and CATIA documentation were not reachable) or the search found nothing.

Where a claim comes only from a search-result summary rather than a page I read in full, it is tagged **[snippet]**. Quotes are limited to one short phrase per source.

Products covered: SolidWorks, Fusion 360, Onshape, CATIA V5 (Sketcher, Sketch Analysis), Siemens NX and Solid Edge (both thin), plus FreeCAD Sketcher and Shapr3D. NX and Solid Edge together stand in for the fifth product because the public material for each is weak; NX has the clearer degrees-of-freedom story, Solid Edge has the relationship-handle idea.

## 1. Comparison table

| Capability | SolidWorks | Fusion 360 | Onshape | CATIA V5 | NX / Solid Edge | FreeCAD | Shapr3D |
|---|---|---|---|---|---|---|---|
| Inference while drawing | Pointer glyph previews the relation (horizontal, vertical, coincident, midpoint, perpendicular, tangent) plus dotted inference lines; clicking applies it; Ctrl suppresses [doc, snippet] | Inferred constraints on by default [?]; details not found | Constraint glyphs appear beside the cursor, "snap to inferences" [doc] | [?] | Solid Edge IntelliSketch applies relations as you draw; Alt suspends it [doc mirror + forum]. NX [?] | Auto-constraints while drawing [?] | Auto-constraining toggle: H/V, perpendicular, tangent, coincident [3p snippet] |
| Constraint suggestion / batch | Fully Define Sketch: scope all or selected entities, choose relations, dimension scheme baseline / chain / ordinate, Calculate [doc] | AutoConstrain: several result tiles, each showing counts and fully/partly constrained, purple preview on canvas, Accept, Generate more [doc] | Select entities then pick constraint from toolbar, or pick constraint then entities [doc] | [?] | NX "continuous auto dimensioning" runs the auto dimensioner after each curve [doc, API] | Not found | Adaptive UI offers only constraints valid for the selection [3p snippet] |
| Status colours | Blue under, black fully, red over, yellow invalid, pink unsolvable [doc 2019 help via search] | Blue not fully, black fully; marked experimental, wrong on offsets [forum, Autodesk staff quoted] | Blue under, black fully, red conflict [doc] | Status button / tree icon: green fully, magenta over [3p, CERN] | NX: red over plus DOF arrows, green fully [3p, TU Darmstadt]; NXOpen has four states: under, well, over, inconsistent [doc, API] | Count of DOF in solver messages [doc snippet] | Green fully, blue under [doc snippet] |
| DOF display | Status bar text only; drag a blue entity to learn [3p] | Colour only; staff: "no extra information" [forum] | Colour only; drag to learn [doc, forum] | Solving-status button [3p] | **Per-point DOF arrows** plus a status-line count of constraints still needed (an estimate) [forum, Siemens rep] | Count; clicking the underlined text **selects the under-constrained elements** [doc snippet] | Colour [doc snippet] |
| Constraint list / manager | Display/Delete Relations dialog [doc] | Show Constraints toggle [doc blog] | **Constraint manager**: filter by type, mode, status, external references; hover highlights entities; zoom to selection [doc] | [?] | Relations Browser (known to miss vertex DOF) [doc, Siemens KB] | Constraint list with select-redundant / select-conflicting tools [doc snippet] | [?] |
| Driving vs driven | Reference dimension [?] | "Driven" dimension [3p only] | Mode filter shows driving vs driven [doc] | [?] | NX convert to/from reference [?] | Toggle Driving/Reference per dimension [doc snippet] | [?] |
| Conflict diagnosis | **SketchXpert**: click "Over Defined" in status bar, Diagnose, several solution sets, accept one; over-defined only [3p, doc summary] | Not found | Red icon; Errors filter in the manager; staff advice is "choose one to delete" [doc, forum] | Diagnostic page lists geometry status [3p snippet] | Inconsistent state exists in API [doc] | Lists indices of conflicting / redundant constraints; Select Conflicting and Select Redundant tools; "auto remove redundants" option [doc snippet] | [?] |
| Open-contour / gap tool | **Check Sketch for Feature Usage** (per feature type) then **Repair Sketch** (max gap distance, Refresh, magnifier per finding) [doc summary + 3p] | None found as a tool; open sketch simply yields no profile [?] | **Profile inspector** under sketch diagnostic tools: lists unclosed loops, Previous / Next, click highlights, entry disappears when fixed [doc] | **Sketch Analysis** (Tools menu): profile closed / open, gaps shown as small blue circles, multiple profiles, extra points, overlapping geometry [3p, forum] | [?] | **Validate Sketch**: finds missing coincidences within a tolerance, yellow crosses, Fix adds coincident; ignores construction by default [doc snippet] | [?] |
| Repair action | Repair Sketch fixes small gaps, overlaps and short segments automatically [doc summary]; some reports say you fix by hand afterwards [3p] | Not found | Manual after highlight | Manual after analysis | Not found | One-click Fix adds constraints (with known false positives) [forum, tracker] | Not found |
| Errors link to sketch | Feature error then Check Sketch / "What's Wrong" [3p] | [?] | Profile inspector click highlights [doc] | Sketch Analysis highlights [3p] | [?] | Validate Sketch markers in 3D view [doc snippet] | [?] |

## 2. Product notes

### SolidWorks

Setting constraints
* Automatic relations are inferred as you sketch. The pointer changes shape to show the relation about to be written (horizontal, vertical, coincident, midpoint, perpendicular, tangent), dotted inference lines show alignments, and accepting a point while a relation shows applies it. Ctrl while sketching suppresses it. Source: SolidWorks help pages on Using Automatic Relations and Inferencing, found via search (e.g. https://help.solidworks.com/2017/English/solidworks/sldworks/t_Using_Automatic_Relations.htm) [doc]. I could not fetch the pages directly (JavaScript shell), so exact wording is from search summaries **[snippet]**.
* Fully Define Sketch has scope (all entities or selected entities), a choice of which relations to add, and dimension schemes baseline / chain / ordinate with placement above, below, left or right, then a Calculate button. Source: https://help.solidworks.com/2018/english/SolidWorks/sldworks/HIDD_FULLY_DEFINE_SKETCH.htm [doc, snippet]. A reseller warns the output "does not always" match design intent and advises adding key relations first: https://www.javelin-tech.com/blog/2026/07/how-to-use-the-fully-define-sketch-tool-in-solidworks/ [3p, snippet].

Finding under-defined geometry
* Blue under, black fully, red over, yellow invalid, pink unsolvable (https://help.solidworks.com/2019/english/SolidWorks/acadhelp/c_sketch_states_acadhelp.htm) [doc, snippet]. No per-entity DOF count; guides recommend dragging a blue entity to see what type of constraint is missing: https://knowledge.cadimensions.com/knowledge/sketch-troubleshooting-guide [3p].

Editing and conflicts
* Add Relations and Display/Delete Relations are dialogs [doc, snippet]. SketchXpert opens by clicking "Over Defined" in the status bar, has a Diagnose step, offers several solutions each of which clears the errors, and you accept one. It handles over-defined only; invalid and unsolvable sketches do not open it. Source: https://knowledge.cadimensions.com/knowledge/how-do-i-use-the-solidworks-sketchxpert [3p]. What it highlights and whether it previews: not stated **[?]**.

Open and bad geometry
* Check Sketch for Feature Usage: Tools > Sketch Tools; checks the sketch against the contour type the chosen feature needs (for example extruded boss versus cut); passing shows "NO PROBLEM FOUND"; failing gives a message and highlights the problem area; one walkthrough shows it can report an open contour while still saying no problems, so read every message. Source: https://www.cati.com/?p=120369 [3p].
* Repair Sketch: you set a maximum gap distance and click Refresh; it lists errors (small gaps, overlapping entities, multiple short segments) with a magnifier icon per item; the official troubleshooting page describes the same three classes. Sources: https://www.javelin-tech.com/blog/2026/09/how-to-fix-sketch-errors-in-solidworks/ [3p], https://help.solidworks.com/2021/english/SolidWorks/sldworks/c_SOLIDWORKS_Troubleshooting_Resources.htm [doc, snippet]. Whether it repairs by itself or only lists is inconsistent between sources; the CATI walkthrough ends with a manual fix **[unclear]**.

Standout: two separate questions answered by two separate tools. "Is this sketch valid for the feature I am about to make" (feature aware) and "where are the tiny gaps" (tolerance aware).

### Fusion 360

* Colour: black fully constrained, blue not, with a lock icon on the sketch in the browser. Autodesk staff on the forum say it only signals full constraint "by color" and gives no help about what is missing; the colouring is reported unreliable on offset geometry. Sources: https://forums.autodesk.com/t5/fusion-design-validate-document/sketch-offset-not-fully-constrained/m-p/8509488/highlight/true and https://forums.autodesk.com/t5/fusion-design-validate-document/sketch-defined-or-constraint-versus-fixed/td-p/6777559 [forum]. A reseller says colouring by constraint status was a Preview preference at one point (https://ukcommunity.arkance.world/hc/en-us/articles/21551279388690-Fusion-360-Updates-September) [3p]; may be stale.
* Show Constraints toggle; Autodesk advises adding geometric constraints before dimensions and treating blue geometry as draggable (https://www.autodesk.com/products/fusion-360/blog/sketching-basics-in-autodesk-fusion/) [doc blog].
* AutoConstrain: generates several candidate results; each tile shows constraint and dimension counts, and whether the result is fully or partly constrained; picking a tile previews the additions in purple on the canvas; Generate more adds two; Start Over; Set Datum; Accept. Help warns to review each result. Source: https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-AUTO-CONSTRAIN-CONCEPT.htm [doc]. The description says "AI-produced"; the candidate-list-with-preview interaction is the useful part.
* Open-contour diagnosis, conflict diagnosis and driven-dimension docs: not found **[?]**.

Standout: candidate fully-define results with preview before commit.

### Onshape

* Colour: blue under, black fully, red conflict; constraint icons black on grey when fine, white on red when a problem; when picking, blue and red points win over overlapping black ones. Source: https://cad.onshape.com/help/Content/troubleshooting.htm [doc].
* Constraints: Show constraints in the sketch dialog shows all; hover shows only the hovered entity's; Shift keeps them all visible while moving; hover highlight orange, related entities yellow. Apply by constraint-then-entities or entities-then-constraint. Select an icon and press Delete. Source: https://cad.onshape.com/help/Content/Sketch/working_with_constraints.htm [doc]. The page does not say how to suppress inference **[?]**.
* Constraint manager (diagnostic tools icon): lists every constraint and dimension; filter by type, by mode (driving / driven), by status (solved, under-constrained, conflicting, errors) and by external references; hover a row to highlight what it names; zoom to selection; delete or edit; icons are draggable; constraints that cross sketches have a blue background. Source: https://www.onshape.com/de/resource-center/tech-tips/sketch-constraint-manager [doc]. A moderator-level forum answer for conflicts is simply "choose one to delete" [forum]; I found no minimal-conflict-set display.
* Profile inspector (same diagnostic menu): lists unclosed loops; clicking an entry highlights it in the sketch; Previous and Next step through; an entry disappears when fixed. Source: troubleshooting page above [doc]. Gap size, overlap, duplicate and self-intersection findings: not mentioned **[?]**.
* Third-party advice: drag a blue entity to see what is loose, check for an inferred horizontal you did not notice [forum].

Standout: one manager panel with filters that turns "find the bad constraint" into a query, plus a live issue list that shrinks as you fix.

### CATIA V5 (Sketcher)

* Sketch Solving Status button reports fully / under / over defined; the specification tree shows a green mark for fully constrained and magenta for over-constrained (only for sketches created after the feature was added). Sources: https://cad.grabcad.com/tutorials/how-to-use-sketch-analysis-in-catia-v5 [3p, snippet], https://cad-support.web.cern.ch/node/568 [3p].
* Sketch Analysis (Tools menu, also an icon at the bottom of the Sketcher): Diagnostic page shows the status of each geometry piece (menu path from an IBM support note, https://www.ibm.com/support/pages/node/5348781 [3p]); a good sketch reports the profile as closed; gaps and overlaps are marked with small blue circles; flags multiple profiles and extra points [forum]. A "User-Edges" page lists referenced outside geometry with broken links marked wrong [forum]. The tab names I was asked about (Geometry, Projections/Intersections, Isolate) could not be confirmed **[?]**; no official Dassault documentation was reachable.
* Advice that support geometry should be construction (dashed) rather than hidden [forum].

Standout: sketch status is surfaced on the sketch in the feature tree, not only inside the sketcher. Also the Diagnostic page is a per-entity table, not a modal message.

### Siemens NX and Solid Edge

NX
* Degrees of freedom arrows on unconstrained points, plus a status line count of constraints still needed (a Siemens representative says the count is an estimate); a Show All Constraints option displays what is applied. Source: https://eng-tips.com/threads/sketching-in-nx6.299402 [forum, vendor staff].
* A university tutorial: red marks over-constrained geometry and remaining DOF arrows, green means fully constrained; the Sketch Constraints Browser does not always show component status correctly. Source: https://www.iim.maschinenbau.tu-darmstadt.de/CAD-Tutorial/ (4.1.1.3 Complex sketch) [3p].
* API enumeration of sketch status: under, well, over, inconsistently constrained. https://docs.plm.automation.siemens.com/data_services/resources/nx/12/nx_api/custom/en_US/nxopen_python_ref/NXOpen.SketchStatus.html [doc].
* Continuous auto dimensioning (a sketch preference) adds dimensions after each curve, which makes the sketch look constrained; Siemens KB says to switch it off to see status colours. https://support.sw.siemens.com/en-US/okba/PL8171019/ [doc, snippet]. This is a warning for us: automatic dimensions hide the DOF signal.
* A Siemens KB notes the Relations Browser lists only the line, not its vertices, so vertex DOF is easy to miss [doc, snippet].
* A sketch need not be fully constrained to extrude [forum, vendor staff].

Solid Edge
* IntelliSketch applies relationships while drawing; relationship handles on the geometry show relations, can be shown or hidden, and deleting a handle removes the relation. Alt suspends IntelliSketch. Sources: https://soliddna.com/SEHelp/ST6/EN/working_with_2d_geometry/sedrw1a.htm [doc mirror, not the vendor site], and Eng-Tips FAQ https://eng-tips.com/forums/562/faqs/1410 [forum].
* Sketch Relationship Colors (Inspect menu) shows when a profile is fully constrained; an option marks under-constrained profiles in the edge bar [forum, single source].
* Over-constraint handling: not found **[?]**.

Standout: NX per-point DOF arrows as the established way to show direction freedom (supports our `sketchFreedoms` item); Solid Edge relationship handles as selectable objects.

### FreeCAD Sketcher (extra)

* Solver messages: under-constrained shows a DOF count and clicking the underlined text selects the under-constrained elements; redundant or conflicting sets list constraint indices; red entries are warnings and only the first applies. https://wiki.freecad.org/Sketcher_Dialog/en [doc, snippet].
* Select Redundant and Select Conflicting tools; "auto remove redundants" option; Toggle Driving/Reference on dimensions. https://wiki.freecad.org/Sketcher_SelectRedundantConstraints [doc, snippet].
* Validate Sketch, Missing coincidences: Find marks vertices that overlap but lack coincidence as yellow crosses and reports a count; Fix adds the constraints; a tolerance drop-down is shared by Find and Fix; "Highlight troublesome vertexes" shows points outside tolerance; construction geometry ignored by default. https://wiki.freecad.org/Sketcher_ValidateSketch [doc, snippet]. Trackers (https://tracker.freecad.org/view.php?id=2994, https://tracker.freecad.org/view.php?id=3298) report false positives with point-to-point tangent or perpendicular constraints, where Fix makes the sketch over-constrained [forum].

Standout: Find then Fix split with a tolerance and a count; also a documented repair that over-constrains when the analyser ignores existing constraints (a trap to avoid).

### Shapr3D (extra)

* Sketch state shown by colour: green fully defined, blue under-defined. https://support.shapr3d.com/hc/en-us/articles/7409883850908 [doc, snippet]. An older forum answer said it has no confirmation at all; treat as outdated.
* Auto-constraining toggle writes H/V, perpendicular, tangent and coincident while sketching; selecting an element shows only the constraints valid for it. https://www.shapr3d.com/product/cad-constraints and https://support.shapr3d.com/hc/en-us/articles/18816009328284-Sketching-in-Shapr3D [doc, snippet].

## 3. Cross-cutting findings

1. **Nobody shows free directions except NX.** SolidWorks, Fusion and Onshape give a colour and tell you to drag. Our planned `sketchFreedoms` arrows would match the best of the field, and would be a real differentiator for the LLM use case because the data is structured.
2. **Gap tooling is weakest in the mainstream parametric tools.** Fusion has none that I could find; Onshape lists unclosed loops only; SolidWorks has a tolerance-aware tool; CATIA marks gaps with circles. The plan's `sketchAnalyze` (gap size, near-coincident, overlap, duplicate, tiny segment) goes beyond all of them in what it reports. Only SolidWorks documents (secondary sources) overlap and short segments.
3. **Conflict diagnosis is shallow everywhere.** The best are SketchXpert (several alternative solutions) and FreeCAD (lists the redundant and conflicting indices). No product publicly shows a minimal conflicting subset or an explanation. Ours (minimal subset plus "make this one reference") would exceed them. Not verified whether any product computes it internally.
4. **Preview before commit** appears in Fusion AutoConstrain and in SolidWorks inference glyphs; both are the reverse of commit-then-undo.
5. **A status filter list beats a modal message**: Onshape's Constraint manager and Profile inspector both stay open and update live.
6. **Inference suppression is a held key** (SolidWorks Ctrl, Solid Edge Alt). We already use Alt for snaps; keep the same key for inference.
7. **Pitfalls seen**: Fusion colour wrong for offset geometry and unreliable; NX auto dimensions mask status; FreeCAD Fix creating over-constraint; SolidWorks Check Sketch passing while still reporting an open contour.

## 4. Best ideas to adopt, ranked for us

Ranking skips what `plan-sketch-constraints.md` and `sketch-tools.md` already have (colour by definition, conflict list, fully define, reference dimensions, snap constraints) and weighs the "LLM drives the kernel, wants exact can/cannot feedback" aim. Size is rough: S under a day, M a few days, L a week or more.

| # | Idea | Source | Size | Kernel change? |
|---|---|---|---|---|
| 1 | **Live issue list with Prev/Next, click-to-highlight, entry vanishes when fixed** as the analyzer panel behaviour | Onshape Profile inspector | S on top of the planned panel | No (UI over `sketchAnalyze`) |
| 2 | **Gap tolerance field plus a Find step that lists counts** ("3 gaps within 0.05 mm") and a "show those beyond tolerance" toggle; use it to settle the open tolerance question | SolidWorks Repair Sketch, FreeCAD Validate | S | `sketchAnalyze` takes a `tolerance` argument |
| 3 | **Repair must be checked by the solver**: a one-click close-gap first tries the fix and refuses or flags if DOF rises or conflicts appear; do not propose coincident where a point-to-point tangent or perpendicular already ties the ends | FreeCAD tracker false positives | S | No (kit re-solves) |
| 4 | **Feature-aware check**: `sketchAnalyze(featureId, usage)` where usage is extrude, cut, revolve; report the rule broken (open contour, crossing axis for revolve, nested or overlapping loops) | SolidWorks Check Sketch for Feature Usage | M | Yes, small: `usage` parameter; rules are mostly there in `sketchShapes` |
| 5 | **Free-direction arrows** from the Jacobian null space (already planned); also the chip shows "N more constraints needed" | NX | M (planned) | Yes (`sketchFreedoms`, planned) |
| 6 | **Constraint manager filters**: type, driving/reference, status (ok, redundant, conflicting), "external/other sketch"; hover highlights entities; zoom to selection; make the existing panel filterable | Onshape | S to M | No |
| 7 | **Alternative resolutions for a conflict**: for each constraint in the conflict set, try "delete it" and "make it reference", re-solve, list the choices that clear the conflict with a preview; accept one | SketchXpert, plus our minimal set | M | No for the try-each loop; minimal subset (planned) needs kernel |
| 8 | **Fully define with candidates and preview**: show 2 or 3 alternative schemes (origin-based as now, chain, baseline) as ghost dimensions in a distinct colour, with counts and "fully / partly defined", then Accept | Fusion AutoConstrain, SolidWorks schemes | M | No (all via the solver) |
| 9 | **Fully define for a selection only**, and a toggle for which relations to include | SolidWorks | S | No |
| 10 | **Click the "N degrees of freedom" chip to select and list the under-defined entities** | FreeCAD | S | No (uses the existing probe, later `sketchFreedoms`) |
| 11 | **Sketch status badge in the feature tree** (fully / under / over, plus open profile) | CATIA tree icon | S | No |
| 12 | **Inference preview glyph beside the cursor, Alt suspends it** (already planned as item 1) | SolidWorks, Solid Edge, Onshape | L (planned) | No |
| 13 | **Select-then-act showing only valid constraints** (already planned) | Shapr3D | M (planned) | No |
| 14 | **Relation glyphs as selectable objects** with Delete key; show-all vs hover-only vs Shift to pin | Onshape, Solid Edge | S to M | No |
| 15 | **Warn when auto dimensions mask status**: if Fully define or an auto-dimension tool adds dimensions, they are shown as such; never colour dark because of an auto-added dimension without marking it | NX | S | No |
| 16 | **Drag test with spring-back** (already planned) | SolidWorks, Onshape (manual advice) | M (planned) | No |

Ideas that look good elsewhere but I would skip: AI-style candidate generation (Fusion's engine is opaque; the preview UI is what matters, idea 8), and NX auto-dimension continuous mode.

## 5. Amendments to `plan-sketch-constraints.md`

1. **Section 4 (analyzer panel)**: say the list is live, ordered, and navigable with Prev/Next; clicking selects, zooms and highlights; an entry disappears when the cause is fixed (Onshape). Add a "gap within N mm" count line.
2. **`sketchAnalyze` signature**: add `tolerance` (default per the open question; research supports a user-editable value, not a fixed one) and an optional `usage` of `extrude | cut | revolve`. Report the rule that failed. Mark `usage` as the only new kernel input.
3. **Repairs**: add a rule that every repair is solved before commit; if DOF rises or the status becomes over-constrained, do not apply and say why. Skip suggesting a coincident for ends already tied by tangent or perpendicular endpoints. Add a test with exactly that fixture (FreeCAD false positive).
4. **Open questions**: resolve tolerance as a field with a default and a "show beyond tolerance" toggle; keep the "move the free end onto the other, midpoint if both free" proposal (no contradicting evidence found, no product documented this detail **[?]**).
5. **Section 2**: add "chip click selects the under-defined set" and "N more constraints needed" text. Keep arrows as the headline: only NX shows them, so there is no copy-the-leader risk.
6. **Section 3, conflict**: split "minimal subset" (kernel) from "alternative resolutions" (kit, try delete / make reference for each member, re-solve, list those that clear it). The second ships first and needs no kernel change.
7. **Section 1, batch**: add "Fully define: selection only", a relation include list, and alternative schemes with ghost preview and Accept. Reuse the existing `fullyDefine` functions; the new part is previewing without committing.
8. **Section 3, panel**: add filters (type, driving/reference, status) and zoom-to-selection to the constraint panel; hover already highlights.
9. **New small item**: sketch status badge in the feature tree.
10. **Order of work**: move "analyzer panel + repairs" and "panel filters" ahead of "inference preview" as planned, and add the cheap items (chip click, tree badge, selection-only fully define, alternative resolutions) as a batch between steps 2 and 3. They need no kernel work.
11. **Tests**: add a fixture for a tolerance edge (gap exactly at, just under and just over the tolerance), the tangent-endpoint false positive, and a revolve sketch crossing its axis.
12. **Differential check** stays as planned (Ghidra strings for the original kernel's analysis names). Nothing in the research contradicts it, and no public product documents finding names we could mirror.

## 6. What I could not verify

* Direct text of SolidWorks help pages (fetch returned only navigation). SolidWorks details come from search summaries of help pages and reseller articles.
* Fusion 360 inference behaviour, driven-dimension documentation, open-profile diagnosis.
* CATIA official help text; tab names of Sketch Analysis.
* NX Sketcher official help (Show DOF, Auto Constrain, Make Corner, convert to reference); Solid Edge over-constraint handling and Sketch Relationship Colors outside one forum post.
* Whether SketchXpert previews or highlights; whether Repair Sketch edits automatically or only reports.
* Whether any product computes a minimal conflicting set internally.
* Shapr3D constraint detail beyond two support snippets.
* FreeCAD wiki pages were reached only through search summaries (direct fetch was blocked).

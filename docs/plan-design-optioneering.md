# Plan: requirements in, ranked manufacturable design options out

Status: plan, 2026-10-20. Nothing here is built. Related: `docs/future-cad-llm.md`, `docs/plan-agent-layer.md`, kernel `docs/spec-agent-interface.md`, `docs/persisted-cache.md`.

## What the reference shows
A product pipeline: requirements (design CAD, load cases and FEA, manufacturing rules, supplier cost, lead time) go into one deterministic engine, and out come ranked design options for one part (here a control arm): CNC milled aluminium (best), additive aluminium, additive titanium, aluminium extrusion. Each option is a real, different geometry shaped for its process, scored on performance and goals.

Our basic version is the same loop on a much smaller scale:

    study = { part template, load cases, material list, process list, objectives, constraints }
    for each (process, material, parameter set): build geometry -> check manufacturability -> simulate -> cost -> score
    output = ranked options, each with its numbers, its reasons, and an editable ckpart

## What we already have
- Kernel: parametric features with named variables, exact B-rep, fast cached regen (edits in seconds), mass properties, thicken with variable thickness, shell, fillets, patterns, stable face names (tags) that survive edits, structured refusals, verifiable replies. These are the geometry half and the "an LLM drives it and gets exact feedback" half.
- Kit: variables panel, script panel, samples, measure/analysis tools, assembly.
- CivilKit: an FEA solver. To confirm before design is fixed: its element types (frame/beam only, or shell/solid), units, how a model and results are described, and whether it runs in wasm or native. Everything below assumes a linear static solver is available through a function `solve(model) -> displacements, stresses`.

## What is missing (gap list)
1. **Study definition**: a file format for requirements (loads, supports, keep-out zones, allowed processes and materials, objectives, constraints).
2. **Manufacturing checks (DFM) as kernel queries**: minimum wall thickness, minimum internal corner radius, pocket depth to width ratio, tool access direction, overhang angle and support volume, constant-section along an axis (extrusion), minimum feature size. Measurement queries exist in part (distance, thickness, extrema); the process rules are new.
3. **Meshing for FEA**: a B-rep to tetrahedral (or hex-voxel) mesh with face groups carried over, so loads and supports attach to named faces.
4. **Load and support mapping**: a load or fixed support is "on face `bore_left`" (stable name), converted to nodes on that face.
5. **Cost and lead-time model**: material mass and price, process time estimate, setup, supplier tables (static first).
6. **Ranking and explanation**: constraints first (stress safety factor, deflection limit), then weighted objectives or a Pareto set, with a plain reason per option.
7. **Option generation**: how each process gets its own geometry (templates, then optimisation).

## Pathway

### Phase 1: study runner on one part, no optimisation (about 1 week)
Pick the control arm. Write one template `.ckpart` per process with named variables (web thickness, pocket sizes, rib spacing; extrusion has a constant section, additive has ribs and bore bosses, CNC has 2.5D pockets with tool-radius fillets). Study runner = a loop over variable sets and materials calling the kernel (fast with the regen cache), reading mass, volume, bounding box, and running DFM checks, with no FEA yet. Output: a table, ranked by mass and cost with constraints on the DFM results. Deliverable: study JSON in, ranked JSON out, plus a kit "Study" panel showing option cards like the reference (thumbnail, process, material, key numbers, pass/fail reasons).

### Phase 2: DFM queries in the kernel (about 1 week, parallel)
Add read-only kernel queries with structured results and tests on small fixtures: `dfmMinWall`, `dfmMinInternalRadius`, `dfmPocketRatio`, `dfmOverhang(direction, angle)`, `dfmConstantSection(axis)`. Each returns the value, the location, and the rule it breaks, in the same style as `sketchAnalyze`. These also serve the original aim: an LLM gets exact feedback on whether a part can be milled or printed.

### Phase 3: FEA inside the loop (about 2 weeks)
- Meshing: start with a robust voxel or tetrahedral mesh from the kernel tessellation (kernel gives watertight faces with names); report mesh size and convergence. A coarse hex-voxel mesh is the cheapest first step and fine for ranking; stress at fillets needs refinement later.
- Loads and supports on named faces, material from a library (we already have materials with density and modulus).
- Solver: the CivilKit solver, or a small linear-static tet solver if CivilKit's is frame-only. Results: max von Mises, max displacement, safety factor, mass-normalised stiffness.
- Verification (matches our principle: perfect feedback): analytical benchmark tests (cantilever deflection, plate with a hole Kt about 3, thick cylinder), mesh-convergence check reported in every result, deterministic output (same study, same numbers, bit for bit).

### Phase 4: cost, lead time, supply chain (about 1 week)
Static tables first: material price per kg, process rates (machine time from removed volume, print time from volume and height), setup cost, lead time per process and supplier. Live supplier quotes are out of scope. Output cost and lead time per option with the formula shown.

### Phase 5: generate geometry per process automatically
- 5a: parameter search (grid, then a simple optimiser) over each template's variables to minimise mass subject to the stress and DFM constraints.
- 5b: topology optimisation on a voxel grid (SIMP) for the additive case, then convert to a clean B-rep (hard) or use it only to place ribs and pockets in the parametric template (practical).
- 5c: LLM proposes templates and variable ranges from a text brief; the kernel and solver judge them. This is where the verifiable loop pays off.

## Where things live
- Kernel (Rust): DFM queries, mass and measurement, stable names, regen; later mesh export.
- Solver: CivilKit's FEA exposed as a library or service the study runner calls; same protocol idea as the kernel (JSON in, results out).
- Study runner: TypeScript in the kit packages (like `packages/session`), usable from the UI and from an LLM agent (tool: `study.run`, `study.explain`).
- Kit UI: Study panel (requirements form, option cards, rank, "open option as part").

## Determinism and trust
Every number in an option carries its source (kernel query, solver run, table row) and a reproducible input hash. Same study and same build give the same ranking. Anything not modelled (fatigue, buckling, thermal) is listed as "not checked", never silently assumed fine.

## Smallest demo that is convincing
Control arm, three processes (CNC pocketed, extruded, additive ribbed), two materials, two load cases (named faces), ranked on mass subject to safety factor at least 1.5 and a deflection limit. Options shown as cards. This needs: templates, Phase 2 checks for min wall and min radius, a coarse FEA, and a mass-and-cost formula.

## Questions for you
1. What does the CivilKit solver support today: frame only, or shell and solid elements? Where is it (path, language, runs in wasm or native)? The meshing work depends on this.
2. Which part first: a control arm like the reference, or something from our samples (bracket, fan shroud)? A part with obvious loads is better than a decorative one.
3. Is cost and lead time needed in the first version, or is mass, stiffness and manufacturability enough to start?
4. Should option generation start as templates written by us (fast, controllable), or go straight to optimiser-generated shapes (slower, more impressive)?

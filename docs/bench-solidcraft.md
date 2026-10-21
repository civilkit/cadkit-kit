# Benchmark: SolidCraft vs our kernel on two parts

Date 2026-10-20. Background: `research-solidcraft.md`. Two of our parts were converted to SolidCraft's JSON command scripts (same dimensions, same construction order), built and run on the CI box, and compared with our kernel (`ck-wasm`, release). Everything from their repo was treated as data: only `git clone` and `cargo build --release -p solidcraft-cli` were run from it; no install/packaging scripts, no network fetches beyond cargo's normal dependency download. Files are in `docs/bench-solidcraft/`.

## 1. Build info

| | |
|---|---|
| Source | `tangency-labs/solidcraft` shallow clone, commit `68c72082030a999c9090c174a571b64e8244f9e8`, version 0.16.2 |
| Box | CI box (ssh alias from `tools/remote_build.sh`, user `ci`), 16 cores, 62 GB; rustc 1.98.0 (repo needs 1.95), no toolchain change needed |
| Command | `cargo build --release -p solidcraft-cli` under `nice -n 10`, cold target dir, deps downloaded |
| Build time | **499 s (8 min 19 s)**, rc 0, no warnings shown in the tail of the log; box was loaded by other work (load 8 to 14 during the build) |
| Binary | `target/release/solidcraft-cli` **396 MB** (their release profile keeps debuginfo), **67.7 MB stripped**; `target/` is 2.6 GB |
| Ours for scale | `ck_wasm.wasm` 7.1 MB (release), repo `b6e030a` of the kernel, sha256 prefix `bc36f3ec19696ffe` |
| Clone/target left on the box | `~/solidcraft-bench/` (src, work, ours); delete when done |

## 2. Results per part

Timing method: box, each run under `flock ~/timing.lock`, load 0.97 at start and 5.6 at the end (other jobs run at nice 15 outside the lock); 3 cold runs each, a new process (SolidCraft) or a new wasm instance with `noCache:true` (ours). SolidCraft times are the whole `solidcraft-cli run x.json --out x.step --quiet` process (parse, all commands, STEP export). Ours has two numbers: **regen only** (the `regen` request, `noCache`, `cacheStats` on, in a fresh instance, wall and process CPU delta) and the whole **node process** (wasm compile, regen, massProps, validate, STEP export). The wasm is single-threaded; its CPU exceeds wall because V8 compiles/tiers up wasm on background threads. SolidCraft's user time is 2.4x wall: it uses several threads.

### Motor end cap (BenchCAD motor_end_cap_000242)

| | SolidCraft | Ours |
|---|---|---|
| Wall, 3 runs | 17.41 / 17.43 / 17.73 s | regen 0.61 / 0.60 / 0.62 s; whole process 1.96 / 1.92 / 1.97 s |
| CPU (user+sys) | 45.3 / 45.0 / 43.0 s | regen 2.30 / 2.28 / 2.31 s (V8 background compile included) |
| Volume mm3 | 245872.8508 | **245873.6614** |
| Area mm2 | 43117.1627 | 43117.6851 |
| Bodies / faces / edges | 1 / 26 / 41 (kernel-level: 48 faces, 126 edges, 1 shell) | 1 / 26 / 41 |
| Closed / valid | one shell, no feature error, no warning, no boolean-retry events; no explicit "valid" flag exists (see 4) | `validate` ok, no issues |
| STEP size | 100,268 B | 26,910 B |
| Errors/warnings/refusals | none (timeline: 14 features, all `error: null`, `warning: null`, 0 boolean diagnostics events) | none |

Analytic volume (disc minus bore, plus boss, minus the chamfer ring and the two edge-fillet rings by Pappus, minus 16 holes): **245873.6614**. Ours matches it to 1e-12 relative; SolidCraft is 3.3e-6 low. Both inside the 1e-3 tolerance; ours is the exact one.

Where SolidCraft's time goes (`run --profile`): total 17.65 s, of which boolean 16.43 s; the two `solid.pattern.circular` commands take 8.12 s and 6.89 s (seven replayed cuts each), the two hole cuts 1.20 s and 0.97 s. Everything else is under 0.2 s per command.

### Vented louvre case (brepjs-vented_louvre_case.ckpart)

The part is built purely from sketch extrudes and cuts (a rounded-rectangle case with a cavity and rim, 51 hexagon vents plus 42 round vents in the floor, a second body for the lid with a lip and 6 rounded slots). It contains no shell, fillet, chamfer or pattern feature, so those command families are not exercised.

| | SolidCraft | Ours |
|---|---|---|
| Wall, 3 runs | 5.65 / 5.92 / 5.61 s | regen 1.59 / 1.62 / 1.58 s; whole process 6.21 / 7.40 / 6.07 s (includes massProps, validate and STEP export, which cost more than the regen itself) |
| CPU (user+sys) | 13.2 / 13.5 / 13.1 s | regen 4.19 / 3.84 / 3.92 s |
| Volume mm3 | 67633.3205 (Case 45254.3321, Lid 22378.9884) | **67633.0825** (Case 45254.1486, Lid 22378.9339) |
| Area mm2 | 73031.8040 | 73031.6472 |
| Bodies / faces / edges | 2 / 452 (376 + 76) / 1290 (1074 + 216) | 2 / 452 / 1290 |
| Closed / valid | each body one shell, no error, no warning, 0 boolean diagnostics events | `validate` ok, no issues |
| STEP size | 726,435 B | 546,215 B |
| Errors/warnings/refusals | none (18 features, all clean) | none |

Analytic volume (`louvre_analytic.py`: every feature is a prism, so the volume is the sum of profile area times layer height; vents and slots by shoelace with densely sampled arcs): Case 45254.1486, Lid 22378.9339, **total 67633.0825**. Ours matches to 1e-9; SolidCraft is 3.5e-6 high. Same verdict as the cap.

Where SolidCraft's time goes: total 5.11 s in commands, boolean 3.21 s, tessellation 0.26 s. Three extrudes dominate: the 51-hexagon vent cut (1.66 s of boolean) and the lid cuts (1.70 s and 0.59 s).

### Volume tolerance behaviour

SolidCraft's volume is not exact. The same geometry gives 245872.85 natively, 245873.03 after reading our STEP and 245873.04 after reading its own STEP (spread 8e-7 to 3e-6 relative). Its kernel has `volume_at(tol)` (`crates/kernel/src/body.rs`), so I read this as a tolerance-driven integral; I did not check that further. It is well inside their own oracle tolerance (1e-3) and ours.

## 3. STEP interchange

| Direction | Cap | Louvre |
|---|---|---|
| Our STEP read by SolidCraft (`solidcraft-cli eval x.step`) | read OK, 1 body, 26 faces, 41 edges, 1 shell, no warning; volume 245873.026 (3e-6 of ours/analytic) | read OK, 2 bodies, 376 + 76 faces, no warning; Case 45254.494, Lid 22378.984, total 67633.477 (6.0e-6 of ours/analytic); same face counts as ours |
| Their STEP read by our `importStep` (`step_in_ours.mjs`) | ok, 26 faces, `validate` ok, volume 245873.66139666 (relative difference to ours 4e-13), area 43117.6851 | ok, 452 faces, valid, volume 67633.08248804 (4e-14), bodies 45254.1486 + 22378.9339 |
| Our own STEP re-read by ours (control) | same volume to 1e-13 | same |
| SolidCraft's own STEP re-read by SolidCraft | 1 body, 26 faces, volume 245873.037 | 2 bodies, 376 + 76 faces, volume 67633.448 |

Interchange is clean both ways for these two parts: closed solids, the same face counts, volumes equal to within SolidCraft's own 3e-6 noise. (Re-reading their STEP into theirs reports 66 edges for the cap instead of 41 because of seam/edge splitting on import; faces are the same.)

## 4. What their command set could not express, and substitutions

Nothing was missing for these two parts; the script is the same feature list. Differences in how it is expressed (none changes the geometry):

- **Frame.** SolidCraft is Z-up; our kernel is Y-up. The louvre sketches go on `XY` with the sketch x,y unchanged and extrusions along +Z (a proper rotation of our frame, so volumes and topology are comparable). The cap axis is world X in both: sketches on `YZ`, circular pattern `axis: "X"`.
- **Plane references.** Our `plane` features (offset planes) became `offset` on `sketch.create`. Our cut `flip:true` (cut along the plane normal, away from the sketch plane's material side, the way the cavity cuts only make sense) became `solid.extrude` `operation:"cut"`, `direction:"positive"`.
- **"throughBoth" bore and holes.** Used `direction:"symmetric"` with `distance` equal to the disc thickness (16.17), which cuts exactly the disc; `through_all:true` also exists but was not used. The cap bore stays a blind pocket because the boss is added after it, exactly as in our feature list.
- **Edge selection.** Their fillet/chamfer take a point on each edge (`[x,y,z]`), not a selector like our `edges('>X')` or face-pair references. I passed the coordinates of the three edges (boss top outer circle, disc outer circle on the minus-X face, bore circle on the minus-X face). There is no stable-name way to do this from a script written without the geometry.
- **Second body.** The lid is a disjoint `solid.extrude` with `operation:"new"` and `body_name:"Lid"`; the cuts then use the default target selection and each cut landed on the right body (checked by volumes).
- **Patterns.** `solid.pattern.circular` with `features:["Hole44"]` replays the cut feature natively, as our `circularPattern`; no substitution.
- **Profiles with holes/many loops.** Hexagons became closed `sketch.line` polylines, rounded outlines individual `sketch.line` / `sketch.arc.center_point` (centre, start, end counter-clockwise); profiles were found automatically (51 hexagons + 42 circles in one sketch extruded without selecting profiles). No error.
- **Validity.** `eval` / `inspect.measure` give no valid/closed flag; the evidence for "closed, valid" is: kernel reports 1 shell per body, no feature error or warning, no boolean-diagnostic events, and the STEP re-reads as a solid in both kernels. SolidCraft's oracle also validates exported STEP, but I did not run it.

## 5. Warnings and errors (verbatim)

None in any run: stderr was empty, `timeline[].error` and `.warning` were `null` for all 14 + 18 features, `boolean_diagnostics.events` empty for all, STEP exports written, exit code 0. One failure on my side, not theirs: `timeline.inspect` needs a `feature` parameter (`error: step 25 (timeline.inspect): invalid parameters for `timeline.inspect`: `feature` must be an id or name`); I used `run --save x.solidcraft` then `eval x.solidcraft` instead.

## 6. Verdict

**Completeness.** For these two parts SolidCraft gets everything right on the first conversion: same B-rep face and edge counts as ours on both (26/41 and 452/1290), no refusals, no healing, no retries needed. Their command set covers sketch to extrude/cut/chamfer/fillet/pattern with 1:1 equivalents, and an equivalent script is about as long as ours (the cap is 25 commands because sketch create/finish are separate). Their API is by coordinates, ours by named references; theirs is harder to keep stable under edits (I did not test edits). Neither kernel was stressed: no shell, no louvre fillets, no curved-to-curved blend were in these parts, which is where their ROADMAP says fillet gaps remain.

**Accuracy.** Ours is exact against the analytic volumes (1e-12 and 1e-9); SolidCraft is within 3.3e-6 to 3.5e-6, fine for CAD use and 300x inside the 1e-3 tolerance, but its volume figure moves by up to 3e-6 across re-imports of the same solid, so it should not be used as a reference for tight comparisons.

**Speed.** Cold, on the same box: SolidCraft needs 17.4 s for the cap and 5.7 s for the louvre case; ours regenerates the same parts in 0.61 s and 1.59 s (28x and 3.6x faster in regen wall time; counting our whole node process, with wasm compile, validate and STEP export, the ratios are 9x and about 0.9x). SolidCraft's CPU is much higher because it uses threads (user time 43 s and 11.7 s); ours is single-threaded plus wasm compile threads. The cap's time is almost entirely the circular patterns (15 of 17.6 s): they replay the hole cut seven times as full boolean operations. That is the clearest speed gap. On the louvre case, where everything is plain prism cuts, the gap is small relative to our own non-regen overhead (in our process, validate, massProps and STEP export take the remaining ~4.6 s beyond the 1.6 s regen; I did not split them further). I did not run our louvre on a native build; the wasm was run in node on the box.

**Binary and build.** 8 min 19 s to build, 68 MB stripped, versus a 7 MB wasm for our whole kernel (not a like-for-like comparison, theirs includes the GUI-free CLI, MCP, renderer, IO, etc.).

**Caveats.** Two parts only; one box with other jobs (load 1 to 6) so absolute numbers carry noise, but the three runs of each agree within 2% to 5%. Their timing includes tessellation and STEP export; ours regen includes tessellation for the display mesh too (body mesh), STEP is separate. Face counts for SolidCraft are the `faces` field of `eval` (the user-facing count); the finer "kernel" count is higher (48 for the cap).

## 7. Reproduce

```sh
# Build (box; $H is the ssh host used by tools/remote_build.sh)
ssh $H 'export PATH=$HOME/.cargo/bin:$PATH; mkdir -p ~/solidcraft-bench && cd ~/solidcraft-bench &&
  git clone --depth 1 https://github.com/tangency-labs/solidcraft.git src && cd src &&
  time nice -n 10 cargo build --release -p solidcraft-cli'
# Scripts: motor_end_cap.json (hand written), vented_louvre_case.json (generated):
python3 docs/bench-solidcraft/gen_louvre.py apps/cad/public/samples/brepjs-vented_louvre_case.ckpart docs/bench-solidcraft/vented_louvre_case.json
# Copy motor_end_cap.json, vented_louvre_case.json to ~/solidcraft-bench/work; ours_run.mjs, kernel.mjs, ck_wasm.wasm and the two .ckpart to ~/solidcraft-bench/ours
# (with {"type":"module"} in a package.json there). Timing (3 cold reps each, under the shared lock):
flock -w 3000 ~/timing.lock bash ~/solidcraft-bench/bench_box.sh      # bench_box.sh and its output bench_box.log are in docs/bench-solidcraft/
# Per-command profile, topology, warnings:
solidcraft-cli run motor_end_cap.json --profile                       # stdout JSON, see *.profile.json
solidcraft-cli run motor_end_cap.json --save cap.solidcraft --quiet && solidcraft-cli eval cap.solidcraft   # see *.eval.json
solidcraft-cli run motor_end_cap.json --out cap.step --quiet
# STEP interchange:
solidcraft-cli eval ours_cap.step                                     # our STEP into theirs
node docs/bench-solidcraft/step_in_ours.mjs <ck_wasm.wasm> cap.step   # their STEP into ours
# Ours, single run with STEP written:
node docs/bench-solidcraft/ours_run.mjs <ck_wasm.wasm> <part>.ckpart --step ours.step --reps 3
# Analytic louvre volume:
python3 docs/bench-solidcraft/louvre_analytic.py apps/cad/public/samples/brepjs-vented_louvre_case.ckpart
```

Files in `docs/bench-solidcraft/`: `motor_end_cap.json`, `vented_louvre_case.json`, `gen_louvre.py`, `louvre_analytic.py`, `ours_run.mjs`, `kernel.mjs` (copy of `tools/kernel.mjs` in the kernel repo), `step_in_ours.mjs`, `bench_box.sh`, `bench_box.log`, `*.profile.json`, `*.eval.json`, the two `.ckpart` inputs, `solidcraft_commands_0.16.2.json` (their `commands` output). The cap input is the sample `bench-motor_end_cap.ckpart`, which is the same construction as the "Motor end cap" example in `packages/script/src/examples.ts`.

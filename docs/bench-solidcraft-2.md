# Benchmark 2: SolidCraft on two blend/loft parts

Date 2026-10-20. Follows `bench-solidcraft.md` (same box, same SolidCraft 0.16.2 build, same method). Two more of our parts were converted by hand to SolidCraft command scripts: `fillet_issue.ckpart` (plate, counterbored holes, cone loft + thicken, three fillets) and `failing_fillets_lofts.ckpart` (plate, cone loft + thicken, one fillet, suppressed in our file). Generator and earlier variants: `docs/bench-solidcraft2/`. Scripts, results, STEP and `.solidcraft` files: `~/Downloads/solidcraft-test/`.

## Method
Box `ci`, each run under `flock ~/timing.lock`, 3 cold reps, `solidcraft-cli run x.json --allow-errors --out x.step --quiet` (whole process). Ours: `ours_run.mjs`, fresh wasm instance, `noCache`; two columns, regen only and whole node process (adds massProps, validate, STEP). Same `ck_wasm.wasm` as benchmark 1. Frame: our (X,Y,Z) maps to SolidCraft (X,-Z,Y).

## Result: SolidCraft completes neither part as converted

| Case | SolidCraft wall (3 reps) | Outcome | Ours regen | Ours whole process | Ours result |
|---|---|---|---|---|---|
| fillet_issue | 13.07 / 13.08 / 13.07 s | error at step 25 `solid.fillet`: "not supported yet: an edge without two faces (the operation failed: not supported yet: only straight edges can be blended)" | 1.54 / 1.54 / 1.54 s | 2.64 / 2.64 / 2.64 s | ok, vol 20081.05, 37 faces, valid |
| failing_fillets_lofts (thicken -3) | 265.3 / 265.0 / 270.8 s | error at step 12 `surface.thicken`: "boolean Union: the operation failed: no result" | 0.315 / 0.317 / 0.314 s | 0.86 / 0.85 / 0.84 s | ok, vol 14949.91, 14 faces, valid |
| same with F19 fillet on | 266.2 / 266.3 / 271.4 s | same thicken error (fillet never reached) | 0.374 / 0.376 / 0.381 s | 0.93 / 0.93 / 0.94 s | ok, vol 14956.80, 15 faces, valid |

Ours has no errors on any of the three. Neither SolidCraft failure leaves a STEP or a saved timeline.

## What SolidCraft can do on the same parts (workarounds, untimed for ours)

| Script | Wall (3 reps) | Result |
|---|---|---|
| fi_nofillet (fillet_issue, fillets removed) | 14.28 / 14.22 / 14.24 s | runs; warning "Boolean retry: tool displacement 1.569e-4 mm, rotation 2e-6 rad". Plate: 2 shells (28 user faces, kernel 40 faces), vol 20099.45; plus a leftover body ConeSurface (vol 7957.9) |
| ffl_pos (thicken +3, no fillet) | 16.18 / 16.09 / 16.11 s | runs, same retry warning. Plate: 2 shells, 15 faces, vol 16231.67; leftover ConeSurface body (vol 16963.9) |
| ffl_on_pos (thicken +3, F19 fillet on) | 14.94 / 14.87 / 15.19 s | thicken ok, then error at step 13 `solid.fillet`: same "only straight edges can be blended" |

## Findings
1. **Fillets whose edge is a cone rim (curved-to-curved blend) are refused**: "only straight edges can be blended". Hit by fillet_issue F11/F12 and failing_fillets_lofts F19. Ours does them.
2. **`surface.thicken` with `operation:"join"` does not produce one solid here**: the target plate ends with 2 shells and the ConeSurface remains as a separate body, with a boolean-retry warning (the tool was nudged by 1.6e-4 mm). The result is not what our thicken gives (one body). I did not check whether the second shell is a gap or an overlap beyond the shell count, so the volumes above are not comparable to ours.
3. **Thicken direction -3 fails after about 265 s** (3.5 to 4 minutes of CPU on several threads) with "no result"; +3 completes in about 15 s. Our thicken sign mapping to theirs is a guess (script generator default is -1 for this part); both signs are included.
4. Speed where both finish nothing: failures cost 13 s and 265 s against ours at 1.5 s and 0.3 s regen.

## Caveats
Hand conversion; the sign of the thicken and the frame mapping are my reading of the two APIs, which is why both signs are reported. SolidCraft timings are for runs that end in an error (parse, commands up to the failure). One shared box, load 0.5 at start and 2.0 at the end. Ours volumes were not checked against an independent analytic value for these parts.

## Reproduce
`flock -w 3600 ~/timing.lock bash bench2_box.sh` (and `p2.sh` for the workaround scripts), both in `~/Downloads/solidcraft-test/logs/`. Inputs in `~/Downloads/solidcraft-test/inputs/`; generator `docs/bench-solidcraft2/gen_scripts.py`.

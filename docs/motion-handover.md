# Motion studies: what is on the branches, what was run, what is open

For whoever merges `motion-kernel` (kernel repo) and `motion-kit` (this repo). Spec: `spec-motion-studies.md`. Issue: #69.

## Order
Kernel branch first (the kit needs its wasm and the `@ck/session` wrappers), then the kit branch. Both are based on the mains of 2026-11-21.

## Kernel (`motion-kernel`)
- `ck-model/src/features/motion.rs` (Runner, `solvePoses`, `sweep`), `motion_contact.rs` (tessellation contact, parts wholly inside another, clearance),
  `mate_kinds.rs` (hinge and slot drive, `restore_places`, `limit_violation`), `mate.rs` (a soft least-squares solve, hinges that pull both ways, a frozen
  driven part and a move budget, all used only in motion mode; the normal solve is unchanged).
- `ck-model/Cargo.toml`: `ck-tess` moves from dev-dependencies to dependencies (no cycle).
- Requests `solvePoses` and `sweepDriver` in `ck-server` and `ck-wasm/engine.rs`; `REQUEST_TYPES` goes from 67 to 69 (expect a count conflict with other
  branches that add requests: keep both, add 2).
- `packages/session`: typed `solvePoses` / `sweepDriver` (`queries.ts`, `session.ts`).
- `tools/ci/quick_tests.txt`: `motion_drive`, `motion_sweep`, `mates_ext`.
- Findings: the `limits` mate measures its angle unsigned (0 to 180), so the shipped hinge door (limit 0 to 110) also swings to -110.

## Kit (`motion-kit`)
- `packages/motion` (pure: drivers, poses, studies, player, GIF and ZIP encoders), `apps/cad/src/motion/*` (store, panel, timeline, export, ribbon commands),
  `packages/agent-tools/src/motionTools.ts` (tools `motion_list`, `motion_drive`, `motion_sweep`, `motion_study_run`), `packages/viewport` (`captureFrame`,
  `recordStream`), `tools/clips/55-motion-studies.mjs` and its poster.
- Small edits in shared files: `toolbarModel.ts` (Motion tab, `motion-` ids off the tool rail), `commands.ts`, `main.tsx` (about 60 lines in 9 places),
  `assembly/AssemblyPanel.tsx`, `assembly/display.ts`, `controller.ts`, `locales/en.ts`, `packages/ui/src/icons.tsx` (6 icons), `vite.config.ts` (alias),
  `tools/i18n_dynamic.json` (4 entries).
- UI: a Motion ribbon tab, a short slider list in the left panel, and a timeline docked along the bottom of the view (keys, scrub, play, export).

## Run
- Kernel quick check (box): gate numbers unchanged (wire 280/280, valid 280/319, vol 319/319, mass 271/319, naming 214/216, blend corpus 146/160). One
  failing test, `sweep_tube_fillet::a_radius_beyond_the_rim_is_refused_fast_with_the_limit` ("refused after 8.6 s", a speed assertion on a loaded box;
  no blend code is touched): compare on main.
- Kernel tests with exact numbers: door limit 110, slot slider 8.00 / 7.50 mm, gear train 20:40, slider-crank travel 30..70 (1e-5) with no branch jump,
  a too-short rod stops the solver at 48.1 degrees (analytic 48.59).
- Kit on the box: typecheck clean; all non-kernel tests 302 of 303 files (the one failure, `onlineLibrary.test.ts`, fetches online libraries); the
  kernel-backed tool tests on the hinge door pass.
- Browser (local build): sliders, Find limits, study with two keys, ribbon Play, timeline, clip format list. Not exercised: pressing Export (a download),
  contact tint / Show on a real contact, Copy range to a limit.

## Not built / open
Pattern copies of a component do not follow a pose; the path trail of a picked point; the 200-pose sweep budget (20 s) is not measured on a large
assembly; contact is highlighted by the selection tint (no marker); Woodwork joints as drivers wait for the kernel's kinematic joint object (decision 4).
The What's new clip (`motion-studies`) is recorded by `tools/clips/record.mjs`; the video files are not committed.

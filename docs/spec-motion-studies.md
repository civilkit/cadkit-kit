# Spec: motion studies (move a part, find its limits, show it moving)

Status: proposal, 2026-11-20. Owner of the decision: the project owner. Nothing here is built. Issue: see `docs/roadmap.md`.

## 1. The gap

CadKit solves an assembly at one pose. You cannot see a part move, and you cannot ask "how far does this pin travel in its slot
before something stops it?" without editing a number by hand, rebuilding, and looking. A mechanism that cannot be driven through its
range cannot be tested, and that is most of what an assembly is for (doors, drawers, linkages, gear trains, sliders, clamps).

Example that prompted this: a slot with a part that has to slide along it. Today you can add a `slot` mate, but you cannot slide the
part, see where it stops, or learn whether it hits the slot end, a screw head or another body on the way.

## 2. What exists today (read from the code, 2026-11-20)

| Piece | Where | What it gives | Why it is not enough |
|---|---|---|---|
| Mates: hinge, slot, limits, gear, screw, rackPinion, ... | kernel `ck-model/src/features/mate_kinds.rs`, kit `docs/assemblies.md` | A pose that satisfies the mates | One pose per regeneration. The solver is one mover at a time (Gauss-Seidel), measured against the placements components had when the mate was created. |
| `limits` mate | same | Clamps a distance or angle between min and max | A static clamp. It does not report "stopped at 87.3 deg by face X". |
| Drive angle plus "Test drive" slider | `AssemblyPanel.tsx`, `docs/assemblies.md` | Previews a gear, screw or rackPinion at an angle (`host.preview`) | Only those three kinds. A hinge angle, a slide distance or a slot position cannot be driven. No play, no sweep, no collision check. |
| DOF report | `regen` with `opts.dofReport` | Which components can still move and how many ways | Says a component is free, not how far it can go. |
| Interference and distance queries | kernel `interference`, `distance` | Shared volume, minimum distance for a pair | Interference returns `booleanFailed` on some bodies (the NIST FTC 7 and 10 imports); too slow to call per frame. |
| Exploded view | `assembly/display.ts` | Display-only offsets saved in the document | A fixed arrangement, not a motion. |
| MuJoCo bridge | kernel `packages/mjcf`, `docs/mjcf.md` | Export an assembly to MJCF, read a joint log back, store it as `doc.motion.studies`, `posesAt(t)` gives component placements | Works from the command line only. No GUI, no playback, and nothing in the app writes or reads `doc.motion`. |

So the mechanics (mates, limits, a stored study format, a physics export) exist. What is missing is the layer that drives them over a
range, watches for contact, and shows the result.

## 3. Goals and non-goals

Goals
1. Drive any single degree of freedom (hinge angle, slide distance, slot position, gear drive) with a slider and see the assembly move.
2. Sweep a driver over a range and report where and why it stops: a mate limit, contact with a named body (with the contact point), or
   the solver failing.
3. Play a stored motion (keyframes or a sweep) with play, pause, loop, ping-pong and scrub, and export it as a clip.
4. The same operations through the assistant and MCP, so an LLM can check a mechanism and get an exact answer (this is the project's
   "verifiable feedback" aim).
5. Everything saved in the document (`doc.motion`), ignored by the kernel as today, so a file opens with its studies.

Non-goals (first versions)
- Forces, mass, friction, contact dynamics (a later phase through the existing MuJoCo bridge, section 9).
- Flexible bodies, cams and cables.
- Real-time rates for large assemblies (a budget is set in section 7).

## 4. Concepts

- **Driver**: a named handle on one degree of freedom. Kinds: `angle` (hinge, or any `angle` / `limits` of angle), `distance` (slide, or
  `distance` / `limits` of distance), `slot` (position along a slot, in mm from one end), `gear` (drive angle of the driver gear; the
  follower follows). A mate becomes a driver by marking it ("Drive this"); its current value is the driver's value.
- **Range**: min and max of a driver. Defaults from the mate's own `limits`, else from the first stop found (section 6).
- **Study**: a named motion: a list of tracks. A track is a driver and a list of keyframes `{t, value, ease}`, or a sweep `{from, to, steps}`.
- **Pose**: the placements of all components at one set of driver values.
- **Stop**: the reason a sweep ended: `limit` (a `limits` mate), `contact` (two bodies touch or come within clearance), `solver` (the mates
  cannot be satisfied, or over-constrained), `range` (reached the end of the range).

## 5. Data model

`doc.motion` already exists as a free field (kernel ignores it). Extend it, keeping the mjcf bridge's `studies` entries valid:

```jsonc
"motion": {
  "version": 1,
  "drivers": [ { "id": "d1", "name": "Slide", "mate": "M4", "kind": "distance", "min": 0, "max": 42.5, "value": 10 } ],
  "studies": [
    { "id": "s1", "name": "Slide in slot", "duration": 4, "loop": "pingpong", "clearance": 0.2,
      "tracks": [ { "driver": "d1", "keys": [ {"t":0,"v":0}, {"t":2,"v":42.5,"ease":"inOut"}, {"t":4,"v":0} ] } ] }
  ],
  "limitsFound": [ { "driver": "d1", "min": {"v": 0, "stop": "range"}, "max": {"v": 42.5, "stop": "contact", "a": "Slider", "b": "Rail", "at": [12.0, 0.0, 3.1]} } ]
}
```

Rules: drivers refer to mates by feature id; deleting the mate removes its driver (one undo step, as deleting a mate removes its patterns
today). `value` is a live preview value, not an undo step, and never triggers a rebuild of the feature tree (same rule as `explode`).
Studies written by the mjcf bridge (`posesAt`) stay readable; the player treats a study with logged joint values as keyframes at each
sample. Units: mm, degrees in the document (radians in the kernel request).

## 6. Kernel work

The point is speed: a sweep of 100 poses must not be 100 full regenerations.

1. **`solvePoses` request** (new, read-only). Input: the assembly (or the session's current one), a list of poses `[{driver: value, ...}]`,
   options `{checkContact: bool, clearance: mm, stopAtFirstContact: bool}`. Output per pose: component placements, per-mate residual,
   `ok` or the failing mate (`mateGeometry`, `mateConflict`, ...), and when asked, the closest pair and distance. It reuses the mate
   solver but warm-starts each pose from the previous one and does not rebuild the part features that do not depend on the mates.
2. **Driving every kind**. Today a drive `angle` exists for gear, screw and rackPinion only. Add the same input for hinge (angle), slot
   (position), `distance` and `angle` mates: an override value that replaces the mate's own value for one solve and is never written.
3. **Contact test that does not use booleans**. Use the tessellation and a bounding-box hierarchy: broad phase on component boxes, then
   triangle-triangle distance on the two meshes (the `ck-tess` / `ck-mesh` data already exists). `interference` stays the exact test for the
   final report (shared volume at the stop). The `booleanFailed` bodies then no longer block a sweep.
4. **Find the stop**: `sweepDriver(driver, from, to, clearance)` does a coarse step, then bisection between the last free and first blocked
   value to a tolerance (default 0.01 mm or 0.01 deg). Returns the stop reason, value, the pair and the contact point.
5. **Branch safety**: a closed-loop linkage can flip to another valid pose between steps. The warm start keeps the nearest solution; a pose
   whose placements jump more than a set amount from the previous one is reported as `branchJump` and the sweep stops there.

Acceptance on the box (glibc libm): determinism (same input, same poses), the three shipped samples pass (section 10), no change to any
existing gate metric (wire 280/280, valid 280/319, vol 319/319, mass 271/319, naming 214/216, blend-corpus 145/154).

## 7. Performance budget

| Operation | Target (assembly of 20 bodies, 200 k triangles total) |
|---|---|
| One pose, mates only | under 20 ms |
| One pose with contact check | under 100 ms |
| Slider drag | at least 10 poses per second (coalesce: drop all but the newest pending pose) |
| Sweep of 200 poses with contact | under 20 s, runs in the kernel worker, cancel button, progress bar |
| Playback | draw at display rate from a cached list of poses; poses are computed once per study and cached until a mate or part changes |

Larger assemblies degrade by lowering the contact check to component boxes and saying so ("approximate contact").

## 8. User interface

New section in the Assembly panel and a ribbon button, **Motion** (Assembly tab), also in command search (`motion`):

1. **Drivers**: a list of the assembly's drivable mates ("Drive" on a mate row adds it), each with a slider, a numeric field, min and max,
   and a lock icon. Moving a slider moves the assembly live. A driver at its stop shows the stop in words ("Stopped by Rail at 42.5 mm").
2. **Find limits** button per driver: runs the sweep both ways, shows min and max and the stop reasons; "Use as range" saves them.
   Contact is highlighted in the view (the two bodies tinted, a marker at the contact point); a click on the result frames it.
3. **Clearance field** (default 0 mm): a sweep stops when two bodies come closer than this, so a tolerance can be tested.
4. **Studies**: New study, add a driver track, set keyframes by "Key" at the current slider value, ease (linear, in-out), duration, loop
   (once, loop, ping-pong). Transport: play, pause, scrub bar, speed, loop. A trail option draws the path of a picked point.
5. **Export**: clip (WebM through the existing recording path; GIF), frames (PNG sequence), and the study in the file. The What's new clips
   (docs/whats-new) can then be made from a study instead of a screen recording.
6. Plain words everywhere ("The slider cannot go further: it would hit the rail."), no codes on screen; the technical code in the
   tooltip, as the mate errors do today.

Display only: moving a driver never adds an undo step, never rebuilds the feature tree, and is not saved except as the driver `value` on
Save. Undo and redo keep working on the mates and studies themselves. Measure, section, mass, export use the pose on screen (a banner
says "Showing a motion pose", with Reset to the assembled pose, as the exploded view does).

## 9. Assistant and MCP

Tools, each returning the same structured result as the panel:
- `motion_drive {driver, value}` returns the new pose summary and any contact.
- `motion_sweep {driver, from, to, clearance}` returns `{min, max, stops[]}` with the pair and contact point.
- `motion_study_run {study}` returns per-keyframe contact and clearance (no images unless asked).
- `motion_list` returns drivers, ranges, studies.
This lets an agent verify "the drawer opens 250 mm without hitting the carcass" with an exact answer, the project's intended use.

Physics later (phase 4): reuse `packages/mjcf` (hinge, slide, ball and free joints already map). A "Simulate" mode runs a MuJoCo wasm or the
local kernel service with gravity, contact and actuators and stores the result as a study. Out of scope until phases 1 to 3 ship; the data
model above is the same.

## 10. Test plan

Samples (new or extended; each with an expected number, checked by a kernel-backed test):
1. `assembly-hinge-door` (exists): sweep the door angle; expect min 0 and max 110 deg from the `limits` mate, stop reason `limit`.
2. `assembly-slot-slider` (new): a block with a pin in a straight slot of known length; sweep the slot position; expect travel
   equal to slot length minus pin diameter, stop `contact` with the slot end (within 0.02 mm), and with a 0.5 mm clearance a travel shorter by 0.5 mm per end.
3. `assembly-gear-train` (exists): drive the 20-tooth gear 360 deg; follower turns 180 deg; no contact stop.
4. `assembly-slider-crank` (new): closed loop; sweep the crank 0 to 360; expect the slider's travel to equal twice the crank radius, and no
   `branchJump`; a deliberately too-short rod reports `solver` at the right angle.
5. Over-constrained and conflicting mates return `solver` with the mate names, no crash.

Unit tests: driver add, remove and undo; document round trip of `doc.motion`; warm-start determinism; coalescing of drags; cancel mid-sweep.
UI test through the headless harness: add a driver, drag the slider, see the pose change, run Find limits, read the plain-language stop,
play the study and export a clip.

## 11. Phases

| Phase | Content | Size |
|---|---|---|
| M1 | Driver on any mate kind (hinge, slot, angle, distance, gear, screw, rackPinion), `solvePoses` without contact, a slider per drivable mate in the Assembly panel's Motion section, display-only pose with a banner and Reset | M |
| M2 | Mesh-based contact test (a stop by default), `sweepDriver` with bisection (Find limits), clearance, plain-language stops, highlight, copy a found range into a `limits` mate | L |
| M3 | Studies: keyframes, transport, loop, trail, playback from a cached pose list | L |
| M4 | Export (WebM, GIF, MP4; PNG frames) and the MCP tools (`motion_drive`, `motion_sweep`, `motion_study_run`, `motion_list`) | L |
| Later | Physics: MuJoCo simulate mode through `packages/mjcf`; Woodwork joints as drivers | L |

M1 alone answers "slide the part along the slot and see it", M2 answers "where does it stop and why".

### M1 as built

- Kernel request `solvePoses {tag, poses:[{<mate id>: value}]}` returns `{drivers, poses:[{ok, places, error?, mate?}]}`. Angles are degrees, distances mm.
  Hinge and slot values are measured from the pose the mate was created at (0 = assembled pose); `angle` and `distance` replace the mate's own value;
  gear, screw and rackPinion take the drive angle of the driver. A driver a pose does not list is not driven: in the first pose it is at its assembled value, later it stays where the pose before left it. Poses
  after the first warm-start from the one before. The tag's assembly is copied, never written.
- M2 (built): `sweepDriver` walks a driver in coarse steps and bisects the first blocked step; the stop is a `limits` mate (named, with its
  bound), `contact` (the two parts and the point), `solver`, `branchJump` or `range`. Contact is the tessellation: two parts touch when a
  surface edge of one pierces a triangle of the other by more than 5 um, a part wholly inside another counts, and a pair already touching where
  the sweep starts (mated faces) only stops it by crossing; with a clearance a pair closer than it stops too (touching pairs are exempt).
  Closed loops (slider-crank) are solved by least squares over all of a part's mates, the driven part held where the drive put it.
  The `limits` mate measures its angle unsigned (0 to 180), so a limit of 0 to 110 also lets the door swing the other way, to -110.
- M3 (built): `doc.motion.studies` hold tracks of keyframes `{t, v, ease}` (linear or inOut) per driver, a duration, a loop mode (once, loop,
  ping-pong) and a clearance. A study is solved once for 30 frames a second (at most 600 frames) and played from that cache with play, pause,
  scrub and speed; any edit drops the cache. The panel says the first frame that touches or fails. Not built: the trail of a picked point.
- M4 (built): export as WebM or MP4 (the browser's own MediaRecorder on the canvas, played at the study's speed: Chrome, Edge and Safari write
  MP4, Firefox only WebM; no library and no server step), as an animated GIF (own encoder, about 15 frames a second) or as a ZIP of PNG frames.
  Agent tools `motion_list`, `motion_drive`, `motion_sweep` and `motion_study_run` (read only, plain words next to the numbers).
- The panel lists every drivable mate; ranges are saved in `doc.motion.drivers` as a view setting (decision 2), defaults are one turn each way
  and 100 mm each way until Find limits (M2) can say more.

## 12. Decisions (owner, 2026-11-21)

1. **Contact is a stop by default.** The fast approximate check (bounding boxes, then triangles) is on unless a study turns it off.
2. **A driver's range is a study setting** (display only, the model is untouched). A button copies it into a `limits` mate when it should be permanent.
3. **Clip export: WebM and GIF first, and MP4 as well.** MP4 is in scope, not deferred (it may need a library or a server-side step: decide in phase M4).
4. **Woodwork plugin joints become drivers later**, once the kernel's kinematic joint object exists; the driver model maps onto its revolute and prismatic joints.

## 13. UI direction (owner, 2026-11-21)

The Motion section in the Assembly panel (section 8, as built in M1 to M4) is too narrow for sliders, studies, keyframes and export together. Motion
gets its own place:

1. **A Motion ribbon tab** (next to Assembly, also found by command search `motion`) with the groups Drive (sliders, Find limits), Study (New, Key,
   Delete), Playback (Play / Pause, loop, speed) and Export (format, Export clip).
2. **A timeline docked along the bottom of the viewport** while that tab is active: the scrubber, the keyframes of each driver as marks on a track,
   and the line that says what the study touches ("At 2.4 s Rail would hit Slider"). Keys are added, moved and removed there.
3. The sliders and Find limits results stay in the left panel as a short list.

The data model, the kernel requests and the pure logic (`packages/motion`) do not change; only the screens move.

Status: built. The ribbon tab (Drive: Sliders, Limits; Study: New study, Key; Playback: Play; Clip: Export) and the timeline are views of one store
(`apps/cad/src/motion/store.ts`), as is the short list in the left panel (`MotionPanel`); the ribbon commands call the same store actions. The timeline
reserves the bottom of the view (`data-ovr-reserve`), so the other overlays keep clear of it. Double-click a track to key at that time.


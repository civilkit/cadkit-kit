# Design checks

The Check tab of the drawer runs the kernel's design-rule profiles (3D printing, 3-axis CNC, injection moulding) on the
part and shows what is wrong, where. Nothing runs on its own unless you switch on "Check after every edit" or set a rule
to Block.

## Using it

1. Open the drawer (`\`) and choose the **Check** tab. Pick a **Profile** and press **Run check**.
2. The list groups issues by severity (errors, warnings, notes) with counts. A row shows the rule, the message and
   "measured / limit" with the unit. Clicking a row selects its faces (face mode) or edges (edge mode) and frames them;
   hovering a row lights them in the viewport.
3. **Show on part** (also the Design issues entry of the Display menu, off by default) tints the faces named by the issues:
   red for errors, amber for warnings, blue for notes.
4. The status bar shows the last result, for example "FDM 3D printing: 2 errors, 5 warnings". Clicking it opens the tab.
   There is no chip before the first check.
5. When the part changes, the result is greyed with an "out of date" note, the tint disappears and rows stop being
   clickable until you run it again (or "Check after every edit" has).

## Rule modes and limits

"Rules and limits" lists every rule of the profile with a mode and its parameters (number fields with the kernel's unit,
min and max; vectors as three fields). Modes:

| Mode | Sent to the kernel as | Effect |
| --- | --- | --- |
| Off | the rule is left out | not checked |
| Info | severity `info` | listed as a note |
| Warn | severity `warn` | listed as a warning |
| Block | severity `error` | listed as an error, and rejects edits that make it worse (below) |

Rules start as the kernel lists them (kernel `warn` and `error` rules start as Warn: nothing blocks an edit until you choose
Block). The app sends the profile inline: `{id, name, rules:[{id, severity, params}]}` with only the rules that are not Off.
Settings are kept per profile in `localStorage` (`cad.check.<profile>`, shape `{v: 1, rules: {<rule>: {mode, params}}}`; the
versioned shape is meant to move into the document later). Unknown rules or parameters in saved data are dropped, new ones
get the kernel defaults. "Reset to profile" restores the defaults. The active profile and the after-edit switch are
remembered too.

## Check after every edit and Block

* **Check after every edit** (default off): after a successful edit the active profile runs with your rule set, 400 ms
  after the last edit, never two at once (a request that arrives meanwhile runs once afterwards), with the usual busy state
  and cancel. The chip and the tab update.
* **Block**: for a committed feature edit (the editor's Confirm, tree commands, delete, redo) the app compares the check
  before and after. A Block rule that has MORE issues after than before, with issues on faces or edges that were not flagged
  before, rejects the edit: it is undone, the history gets no record, the shell logs it as a rejected edit, and a message
  names the rule, value, faces and limit, for example "Edit rejected, it would break a Block rule: Overhang: 62 degrees on
  F5.S.e2, limit 45". Violations that already existed never block, so an imperfect part can still be edited.
  The baseline is the last check of the current state, or one the app makes just before the edit.
* Sketch confirmations and previews are never blocked, only committed feature edits. If the check itself fails (kernel
  error, cancelled) the edit is kept.

## How it maps to the kernel

`controller.profiles()` is the `profiles` request (the catalogue, asked once). `controller.checkProfile(profile)` is
`checkProfile` on the current document (read-only; a private regeneration through the kernel's cache). The result's
`issues[]` carry `rule`, `severity`, `message`, `faces` (persistent face names), `edges` (`faceA|faceB#n` keys), `value`,
`limit`, `unit`; `summary` gives the counts. Rules per profile: `fdm-print` (openShell, bodyCount, minWall, overhang,
bridge, minFeature, plateContact), `cnc-3axis` (openShell, minInternalRadius, minWall, undercut), `injection` (openShell,
draft, uniformWall, minWall) plus the kit's own `mouldUndercut` (below).

`mouldUndercut` is not a kernel rule. A two-part mould pulls one half along the pull axis and the other against it, so a face is an undercut
only when neither half can reach it. The kit runs the kernel's `undercut` rule along the pull and against it inside one `checkProfile` call and
keeps the faces both runs flag (`packages/readback/src/mould.ts`: `withMouldRule` adds it to the injection profile, `expandMould` / `mergeMould`
turn it into two kernel rules and back). Its parameters are the kernel's `direction` (the pull axis) and `minArea`; it is Warn by default.

## Limits (from the kernel)

The rules are a first slice, not a certification.

* Exact, from the B-rep: hole and pin diameters, concave cylinder radii and sharp concave edges parallel to the tool axis,
  watertightness, solid count.
* Mesh based (display triangulation, error about 4e-4 of the part diagonal): overhang, bridge, plateContact, draft and the
  facing-away half of undercut. Exact for planes; a per-triangle area-weighted measure for curved faces. A face is flagged
  for draft when at least half of its area is under the limit. Overhang is measured from vertical and ignores triangles on
  the build plate. Bridge reports a flat downward face's narrowest width and does not look for supports underneath.
* Sampled (rays from area-proportional samples): minWall, the gap half of minFeature, the hidden half of undercut and
  uniformWall. A feature thinner than the sample spacing can be missed. Thickness is the straight distance along the
  surface normal, not the inscribed-sphere thickness.
* Not covered yet: sheet-metal rules, custom user rules, draft sign and parting line, tool reach and stock, support volume,
  build orientation suggestion.
* Each rule reports at most 100 issues; the rest is counted ("some issues were left out").

## Code

`apps/cad/src/designCheck.ts` (issues: grouping, colours, targets, blocking diff and message), `checkSettings.ts` (modes,
limits, storage, policy), `CheckPanel.tsx` (the tab), `useDesignCheck.ts` (state and viewport wiring),
`Controller.profiles / checkProfile / policy / onCheck` in `controller.ts`, and `Viewport.setIssueFaces / setIssueHover /
frameNames` in `packages/viewport`.

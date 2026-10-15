# Diagnostics: one cause, many consequences

A parametric edit that breaks one feature usually breaks everything built on its result. The kernel reports every one
of those errors; read as a flat list they bury the one that matters. The kit sorts them.

## The summarizer (`apps/cad/src/errorSummary.ts`)

`diagnose(errors, features)` is pure. `errors` is the regen error list (`id`, `code`, `params`, optional `hint`),
`features` the part's features in document order. It returns:

- `roots`: errors that stand on their own. The first failure in document order is always a root.
- `consequences`: later errors that follow from an earlier failure, each with `blockedBy` (the root's id) and `via`.
- `blockedBy`: id to root id, for every consequence.
- `all`: every error, in document order (the raw list).

A later error is a **consequence** when either

1. the feature references (directly, or through other features) a feature that already failed. References are read from
   the feature's fields: `sketch: "F1"`, `surfaces: [...]`, `base: {id}`, `faces: ["F13.S.e4"]`,
   `edges: [{faces: [...]}]` (a persistent-name prefix such as `F13.` counts as a reference to F13), or
2. its code is one that a missing earlier result causes (`nothingToCut`, `cutNoEffect`, `missingReference`,
   `missingEdge`, `missingSketch`, `missingPath`, `referenceLost`, `referenceChanged`, `noFaces`, `noBodies`,
   `ribNoContact`, `upToNextNone`, `noSeeds`, and a few projection codes) and some earlier feature failed.
   It is blocked by the latest root before it.

Everything else is a root, so two unrelated problems stay two problems. `newBreakage(candidate, committed)` returns the
roots a preview has that the committed model did not have.

The text (`apps/cad/src/diagnosticsText.ts`, strings in `locales/en.ts` under `diag.*`) builds the summary line
("The edit broke the model at F14 Trim barrel and handle: the surfaces do not cut each other. 16 later features could
not be built because of it."), plain advice for the common codes (`trimNoIntersection`, `nothingToCut`, `cutNoEffect`,
`missingReference`, `missingEdge`, `booleanFailed`, `fillInvalid`, `filletChamfer`, `shellTooThick`, `shellFailed`,
`noClosedProfile`, `sweepFailed`, `loftFailed`, `profileCrossesAxis`; anything else gets generic advice) and one line per
consequence.

## Where it shows

- **Editor panel.** While an editor is open the live preview's errors are summarised under the fields: the sentence, the
  advice, `Cancel edit`, `Select F14`, `Show N consequences` (folded; each item selects its feature) and
  `Copy all errors`. If the preview has a cause the committed model did not have, Confirm is greyed with the tooltip
  "This change breaks the model (F14). Cancel or adjust." Holding Shift while confirming tries the edit anyway.
  The Gear, Thread and Hole editors show the one-sentence summary as their hint (no card, no hold-back).
- **Diagnostics drawer tab.** The full card for the committed model (`Undo this change` when there is history to undo),
  or, after a refused edit, for that edit with the note "This edit was not applied; your model is unchanged."
- **Feature tree.** The root failed feature keeps the red error style with its plain advice. Consequences are muted with
  a `blocked by F14` chip (link icon) that selects the cause; no red text. The tree badge and the status bar count
  causes, and the status bar adds `(+N blocked)`.
- **Toast and history.** A refused edit's toast and its history entry carry the one-sentence summary, not the joined
  error list.

## What the kernel does and does not do

`Session.edit` is atomic: an edit whose regen has any error is refused and the document is unchanged. So Shift-confirm
cannot put a broken model into the document; it shows the refusal (toast, Diagnostics tab) instead of silently doing
nothing. A broken model can still arrive by opening a file that already has failing features; that is the case where
the tree shows the cause and blocked rows and the drawer offers `Undo this change`.

Example: in the large sample sample, Barrel surface (F2) angle 120 gives root F14 (trimNoIntersection) and 16
consequences; 170 gives root F24 (fillInvalid) and 15. See `apps/cad/src/errorSummary.kernel.test.ts`.

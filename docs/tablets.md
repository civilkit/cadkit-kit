# CivilKit CAD on an iPad

What was checked for the installed app on an iPad (Safari / WebKit, Apple Pencil, finger, optional hardware keyboard), how, and what only a real iPad can answer. The user-facing text is in the guide, [On an iPad](../guide/src/getting-started/interface.md). For phones see the same page.

## What the code does

- **Keyboard after a lift.** iOS raises the on-screen keyboard only for a `focus()` made inside a user gesture's own event handler. The value field a tool shows after a lift does not exist yet when the finger or pen leaves the glass (the solver answers a moment later), so `apps/cad/src/SketchFields.tsx` keeps a hidden, always-mounted `#sketch-kb-primer` box. `primeSketchKeyboard()` focuses it from the lift (a drag has no mousedown or click after it, so the focus stays) and `armKeyboardPrime()` focuses it again from the `click` that follows a tap (the browser's own mousedown takes the focus away first). The real field takes the focus from the primer when it appears; focus moving from box to box keeps the keyboard up. The primer lets go after 1.5 s if no field comes. It runs for a dragged circle (the radius field) and for the Dimension tool's value field; other tools show their fields next to the shape and a tap on one raises the keyboard as usual. The desktop path (typing a digit starts the first field, Tab, Enter) is unchanged.
- **Minus key.** `packages/ui/src/keypad.tsx`: number boxes that can be negative carry `data-sign`; one `SignKey` (mounted in `main.tsx`) shows a `±` key above the keyboard (`--kb-inset`) on a coarse pointer while such a box has the focus. `ExprInput` keeps its own `±` and `ƒ` keys. `numberAttrs('signed' | 'positive' | 'integer')`, `kindForMin(min)`, `textAttrs`, `searchAttrs` are the helpers.
- **Pen.** `packages/viewport/src/viewport.ts`: a pen takes the press, drag, lift path of a finger on the sketch tools; pen hover-out is not "pointer left"; `PenGuard` (`touchguard.ts`) drops touches that land while the pen is down.
- **Updates (`apps/cad/src/updateCheck.ts`, wired in `main.tsx`).** An installed iPad app is suspended, not closed, so the old 5-minute timer rarely ran. `watchForUpdate` now checks at launch and when the page becomes visible; after more than 60 s hidden it skips the 5-minute gap and calls `registration.update()` so the worker and page agree. `onForeground` then asks the pure `decideUpdate({stale, dirty, editing, hiddenMs, autoOn})`: `reload` only at such a foreground moment with nothing modified, no sketch/feature editor/wizard/dialog open, no touch, key or wheel since the page came to the front, and the setting on (`updatePrefs.ts`, Settings > General); otherwise the existing notice. The reload leaves `cad.updatedTo` in sessionStorage and the new page shows "Updated to <version>" once. In the lite worker (`tools/pages/sw.mjs`), activate carries the kernel over from the previous cache if it had one, then refetches it in the background, so the app starts offline right after an update without a bigger install.
- **Page gestures.** `app.css`: `#app { touch-action: pan-x pan-y }` (no page pinch-zoom or double-tap zoom), `-webkit-touch-callout: none`, `#vp canvas { touch-action: none; user-select: none }`.

## Verified in Chrome (touch emulation, production build)

`tools/ux/mobile.mjs --dir <pages build>` serves a production build (`tools/pages_serve.mjs`, no Vite, no `window.__cad`) and drives it with real touch events through CDP at 390x844, 820x1180 and 1180x820. Pen input is sent as mouse events with `pointerType: 'pen'`. It checks tap-target sizes, overlapping overlays, dialogs that fit, page scroll, the docked panels, and the sketch flow: a rectangle and a circle dragged with a finger, a circle dragged with the pen (with hover first), a palm touch during a pen stroke, the pen leaving hover range, a long press, the number-box attributes, and that the finished sketch holds what was drawn (read back from the autosave). For the circle it asserts that, right after the lift, a text box has the focus, then that the radius field has it with `inputmode="decimal"` and `enterkeyhint="done"`.

Steps that need the dev hook (camera poses, store) are listed as skipped on a production build; run against a dev server with `--url` to include them.

## Only a real iPad can answer

- Whether the keyboard actually rises after the lift (Chrome has no iOS keyboard; the test asserts the focus and the attributes the keyboard reads).
- Whether a suspended installed app really delivers `visibilitychange` on return, and how soon iPadOS lets the worker fetch after a resume (Chrome's emulated lifecycle was used).
- Which keys the `decimal` pad shows on iPadOS (the `±` key is there either way).
- Apple Pencil hover (M2 and later), squeeze, double tap, and the real palm-rejection behaviour of iPadOS (what arrives as touch while the Pencil is down).
- Long-press callouts and text selection in Safari and in the installed app; the page not zooming on pinch in the installed app.
- Add to Home Screen: icon, splash, status bar, safe areas with the home indicator, and the layout with the Stage Manager and Split View window sizes.
- A hardware keyboard: Tab and Enter in the value fields, one-letter tool keys, Cmd+Z.

## Manual checklist for the owner

1. Safari, Share, Add to Home Screen; open from the icon; the app is full screen, no browser bar.
2. Open a sample (Library), tap **Sketch**, pick a plane, pick **Circle**. Drag out a circle with a finger and lift: the radius field is focused and the keyboard is up with number keys. Type `12.5`, Done: the radius is 12.5.
3. Same with the Pencil (press, drag, lift). Hover the Pencil over the drawing (M2 and later): the snap marker follows. Lift the Pencil out of range while a line is half drawn: the line and its fields stay.
4. Rest the side of your hand on the screen while drawing with the Pencil: nothing orbits or jumps.
5. Pick **Dimension**, then two lines: the angle field opens and the keyboard is up.
6. Tap a number box that can be negative (Move: X): the `±` key shows above the keyboard and flips the sign. Tap a count (Pattern: Count): digits only.
7. Tap a name or search box: no capital, no auto-correct, the key says Search.
8. Pinch the toolbar: the page does not zoom. Long-press the model: no callout, no selection.
9. Rotate the iPad: the layout follows, nothing is cut off, the keyboard does not cover the field you type in.
10. With a hardware keyboard: type `5` while the Line tool waits for its length (goes into the field), Tab, Enter, Escape, Cmd+Z.

## Page zoom (the "whole browser zooms in and stays" report)

What was found: the 16 px field rule only covered `#app[data-layout=phone|tablet]` (`app.css`), so a field outside `#app` (the hidden copy box of the diagnostics card, `DiagnosticsCard.tsx`) or any field with the screen layout set to Desktop on an iPad was under 16 px and WebKit zooms the page when it is focused (and when the sketch helper focuses it after a lift). Only `#app` had `touch-action`, which is not inherited by what is mounted beside it. WebKit ignores `user-scalable=no` for pinch.

What changed:
- `app.css`: `@media (pointer: coarse)` sets `font-size: max(16px, 1em) !important` on every input, select and textarea; `html, body, body > *` get `touch-action: pan-x pan-y`.
- `index.html`: `maximum-scale=1, user-scalable=no`. This takes zoom away from people who rely on it (WCAG 1.4.4); it is deliberate because the owner wants the page fixed and the app has its own sizes. Remove the two words to give it back; the other fixes stand without them.
- `pageZoom.ts`: `gesturestart`/`gesturechange` are cancelled (not over a field; the 3D pinch uses pointer events), `resetPageZoom()` pins the meta viewport to scale 1 and restores it after 120 ms (the only way to reset on iOS), it runs when a field blurs while `visualViewport.scale > 1.01`, and a zoom that stays shows a "Reset zoom" toast button.
- A double tap on the canvas: `touch-action: none` there, so no page zoom. `dblclick` finishes a sketch polyline or opens the face under the pointer; it is intended.
- A Pencil 2 barrel double tap is an iPadOS system gesture; a page cannot receive it. Pencil strokes are plain pointer events; the viewport does not read `getCoalescedEvents`, so the Safari duplicate-move problem (each Pencil move delivered twice with the same coalesced list) does not apply, and it has no touch listeners that would double-handle touch and pointer.

Not verifiable without a real iPad: WebKit's real zoom-on-focus, whether the meta viewport reset works on the current iPadOS, and `gesturestart` delivery. Chrome emulation checks computed font sizes, `visualViewport.scale` after the sketch flow, and `touch-action` (`tools/ux/mobile.mjs`).

Manual check: focus every kind of field (palette search, tree search, sketch value fields, wizard fields, settings, variables, the note and name fields), double-tap in many places (toolbar, tree, dialogs, status bar, canvas, empty areas), pinch on chrome and on the canvas; the page must never zoom. If pen strokes look wrong, a standalone page that logs raw `pointermove` events and their coalesced lists to JSON can be recorded on the iPad and analysed offline.

# Document tabs

Several parts can be open at once, as tabs under the top bar (code: `apps/cad/src/tabs/`, wiring in `apps/cad/src/main.tsx`). The design follows
SolidCraft's own: the active document is the app's, the others wait with everything that belongs to them alone.

## What a tab holds

Each tab has its own `Controller` (session and kernel state, undo and redo history, selection and the rest of the document's state), its file
(name, handle and part name), its unsaved-changes mark, its look (hidden sketches and planes) and its camera. `controller` in `main.tsx` is a
switch to the active tab's controller; the others keep running quietly (a build that finishes in the background does not draw over the viewport).
Switching brings the tab's file, look and camera back and has the controller republish its view and status; the kernel keeps each tab's state on
a tag of its own, so this is a quick refresh, not a rebuild from a file.

## How tabs come and go

- **+** opens a new, empty part in a new tab; the new tab goes in after the active one.
- Opening anything (a file, a sample, a recent entry, a dropped file, an import, New part, a script) uses the active tab when it is still blank
  (no features, no file, no changes) and a new tab otherwise. Nothing asks about unsaved changes: the current part stays open in its tab.
- **×** (or a middle click) closes a tab. A tab with unsaved changes is brought up and asks Save / Don't save / Cancel. Closing the last tab
  leaves a blank part. Closing the active tab shows its right neighbour (else the left one).
- At most 32 tabs. Switching away in the middle of a sketch finishes the sketch (as the check mark does) and keeps it; if it cannot be finished it stays open and says so. An open feature editor is closed on a switch.
- Drag a tab to reorder; the ▾ button lists every open part when the strip overflows (or there are more than seven).
- Keys: Ctrl+Tab / Ctrl+Shift+Tab next / previous, Ctrl+Alt+1..9 jump to a tab (9 = last), Ctrl+Alt+T new part, Ctrl+Alt+W close. (Browsers keep Ctrl+Tab and Ctrl+W for their own tabs; in the installed app Ctrl+Tab works, and the Ctrl+Alt keys work everywhere.)
- The page asks before it is left (reload, close the window) when any tab has unsaved changes.
- The Drawing view is a mode of the tab's document; it closes when you switch tabs.

## Component tabs

"Edit this part" on an assembly's component opens the component's part in a tab of its own, linked to the assembly. A bar over the viewport says
"Editing <part> (in <assembly>)": **Done** writes the part back into the assembly as one undo step in the assembly's own history (the assembly
may refuse it when a mate depends on something removed: the part stays open and says so) and closes the tab; **Cancel** closes it unchanged.
Closing a changed component tab with × offers Save (write back), Don't save and Cancel. Save to a file is refused on a component tab.

## Autosave

Every changed part is written to the browser's storage a moment after the last change (several as one stored session) and when the page is
hidden. After a crash or reload the app offers "Restore your last session": each changed part comes back in a tab of its own, marked as changed,
with the tab that was active shown. Component tabs are not stored. The stored session is limited to about 3 MB.

## Not done

The undo history of a restored tab (the session's undo steps hold whole earlier documents and are not stored), and a hover preview.

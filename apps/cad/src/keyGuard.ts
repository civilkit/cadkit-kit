/** True when a key event comes from somewhere text is typed: an input, textarea, select, a contenteditable region, a CodeMirror editor or an ARIA textbox. The viewport's single-key shortcuts must leave such keys alone. */
export function isTextEntry(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  if (el.isContentEditable) return true;
  return !!el.closest?.('[contenteditable=""],[contenteditable="true"],.cm-editor,[role="textbox"],.script-panel textarea');
}

/**
 * Whether a plain (no Ctrl/Cmd/Alt) key should skip the viewport's single-key shortcuts and go to the Script editor instead: the Script tab is
 * showing and the key did not come from the 3D canvas itself (focus was left on the page body, a toolbar or viewport button or a panel after a tab switch,
 * Fit or a cancelled prompt, so typing would otherwise trigger Fit, view changes, face/edge mode and so on).
 */
export function scriptOwnsKey(scriptTabActive: boolean, t: EventTarget | null, lastPressOnCanvas = false): boolean {
  if (!scriptTabActive) return false;
  const el = t as HTMLElement | null;
  if (el && el.tagName === 'CANVAS') return false;   // typed with the 3D view itself focused: meant for the viewport
  // the canvas takes no focus, so keys after a click on it arrive at the page body: those are the viewport's too
  if ((!el || el === document.body) && lastPressOnCanvas) return false;
  return true;   // a Fit or view button inside the viewport, a toolbar, a panel, the bare page after a tab switch: not
}
